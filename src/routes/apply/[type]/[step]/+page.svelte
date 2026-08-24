<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import StepRenderer from '$lib/components/form/StepRenderer.svelte';
	import { draft, ensureDraftType, loadDraftForEdit } from '$lib/state/wizardDraft';
	import {
		evaluateSteps,
		stepHref,
		getActiveEditId,
		setActiveEditId,
		stepBySlug
	} from '$lib/domain/wizard';
	import { getRequestById } from '$lib/data/requests';
	import { resetRequestListFilters } from '$lib/state/requestListFilters';
	import { useApplicationType } from '$lib/state/applicationType.svelte';
	import { APPLICATION_TYPES } from '$lib/domain/applicationTypes';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const type = $derived(data.type);
	const slug = $derived(data.step);
	const stepDef = $derived(stepBySlug(type, slug));
	const appType = useApplicationType();

	// 步骤条的可达性由草稿实际填写情况决定：已完成 + 第一个未完成可点，其余置灰，
	// 防止用户跳到预算页却看到空行程。
	const steps = $derived(evaluateSteps(type, $draft));

	const isEditing = $derived(page.url.searchParams.has('edit'));

	// 新建入口进入某类型向导：确保草稿桶对应此类型，跨类型不串台。
	$effect(() => {
		if (!isEditing) ensureDraftType(type);
	});

	// 重新编辑进入向导时 URL 带 ?edit=ID；外壳据此同步编辑态与回填草稿，
	// 这样直接打开编辑链接或刷新也能恢复。普通新建不带该参数，则清掉编辑态。
	$effect(() => {
		const id = page.url.searchParams.get('edit');
		if (id) {
			if (getActiveEditId() !== id) {
				const req = getRequestById(id);
				if (req) {
					setActiveEditId(id);
					loadDraftForEdit(req);
				}
			}
		} else if (getActiveEditId() !== null) {
			setActiveEditId(null);
		}
	});

	// 预览页「修改」链接带 ?focus=xxx 时，进入对应步骤后滚动到目标区块（如行程列表）。
	$effect(() => {
		const focus = page.url.searchParams.get('focus');
		if (!browser || !focus) return;
		const el = document.getElementById(focus);
		if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	});

	function backToRequests(): void {
		// 把全局类型对齐到正在编辑的类型，返回列表即按该类型展示、便于看到这张单
		appType.switchTo(type);
		resetRequestListFilters();
	}
</script>

{#if isEditing}
	<a class="edit-back" href={resolve('/requests')} onclick={backToRequests}>← 返回我的申请</a>
{/if}

<PageHeader
	title={isEditing ? '编辑申请' : `发起${APPLICATION_TYPES[type].label}`}
	description={stepDef.description}
/>

<!-- stepHref 内部已用 resolve() 构造地址，但 ESLint 无法跨函数追踪，故整段豁免该规则 -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<ol class="step-nav">
	{#each steps as item, i (item.step.slug)}
		{@const active = item.step.slug === slug}
		<li class="step-nav__item">
			{#if item.reachable}
				<a
					class="step-nav__link"
					class:step-nav__link--active={active}
					href={stepHref(type, item.step.slug, page.url.searchParams.get('edit'))}
					aria-current={active ? 'step' : undefined}
				>
					<span
						class="step-nav__badge"
						class:step-nav__badge--active={active}
						class:step-nav__badge--done={!active && item.completed}>{i + 1}</span
					>
					{item.step.title}
				</a>
			{:else}
				<span class="step-nav__link step-nav__link--disabled" aria-disabled="true">
					<span class="step-nav__badge step-nav__badge--disabled">{i + 1}</span>
					{item.step.title}
				</span>
			{/if}
			{#if i < steps.length - 1}
				<span class="step-nav__sep" aria-hidden="true">→</span>
			{/if}
		</li>
	{/each}
</ol>

<!-- 按 step slug 强制重挂载：每进入一个步骤都重置该步的「已交互 / 已提交」状态，
	 避免上一步的 touched/attempted 残留污染当前步的实时校验展示。 -->
{#key slug}
	<StepRenderer {type} step={stepDef} />
{/key}
