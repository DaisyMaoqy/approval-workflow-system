<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ApplicationType } from '$lib/domain/types';
	import type { StepDef } from '$lib/domain/applicationTypes';
	import { flattenFields } from '$lib/domain/applicationTypes';
	import { draft, resetDraft } from '$lib/state/wizardDraft';
	import { useIdentity } from '$lib/state/identity.svelte';
	import { useApplicationType } from '$lib/state/applicationType.svelte';
	import { saveDraftRequest, submitNewRequest, resubmitRequest } from '$lib/data/requests';
	import { validate } from '$lib/domain/schema';
	import { buildStepSchema, buildTypeSchema } from '$lib/domain/schemaConfig';
	import { nextStep, prevStep, stepHref, setActiveEditId } from '$lib/domain/wizard';
	import { resetRequestListFilters } from '$lib/state/requestListFilters';
	import DynamicForm from './DynamicForm.svelte';
	import DynamicPreview from './DynamicPreview.svelte';
	import WizardFooter from './WizardFooter.svelte';

	interface Props {
		type: ApplicationType;
		step: StepDef;
	}

	let { type, step }: Props = $props();

	const identity = useIdentity();
	const appType = useApplicationType();
	const editId = $derived(page.url.searchParams.get('edit'));

	let attempted = $state(false);
	let submitting = $state(false);
	let submitError = $state('');
	let savingDraft = $state(false);

	// 已交互字段的点号路径集合（与 errors 的 key 对齐）。
	// 「实时校验」策略：错误始终在后台计算（allErrors），但只有被 touched 过、或已
	// 点击过「下一步/提交」（attempted）的字段才把错误展示出来，避免初次进入满屏红字。
	let touched = $state<Record<string, boolean>>({});

	function markTouched(path: string): void {
		touched = { ...touched, [path]: true };
	}

	const allErrors = $derived.by(() => {
		const result = validate(
			step.kind === 'preview' ? buildTypeSchema(type) : buildStepSchema(type, step.slug),
			$draft
		);
		return result.ok ? {} : result.errors;
	});

	const previewFields = $derived(flattenFields(type));
	const isPreview = $derived(step.kind === 'preview');

	const primaryLabel = $derived(isPreview ? (editId ? '重新提交' : '提交申请') : '下一步');
	const prevHref = $derived(
		editId
			? stepHref(type, prevStep(type, step.slug) ?? '', editId)
			: stepHref(type, prevStep(type, step.slug) ?? '')
	);

	async function onSaveDraft(): Promise<void> {
		if (editId) return;
		savingDraft = true;
		try {
			// 联调：调后端 POST /<type>-requests { fields }，服务端返回值已回写本地 store
			await saveDraftRequest(type, $draft, identity.user);
			setActiveEditId(null);
			resetDraft();
			resetRequestListFilters('draft');
			// 把全局类型对齐到刚存草稿的类型，返回列表即按该类型展示、便于看到这张单
			appType.switchTo(type);
			await goto(resolve('/requests'));
		} catch {
			savingDraft = false;
		}
	}

	async function onSubmit(): Promise<void> {
		attempted = true;
		const result = validate(
			isPreview ? buildTypeSchema(type) : buildStepSchema(type, step.slug),
			$draft
		);
		if (!result.ok) {
			submitError = isPreview ? '信息不完整，请返回各步骤检查后重试' : '请先完善本步骤信息';
			return;
		}
		if (!isPreview) {
			const next = nextStep(type, step.slug);
			// stepHref 内部已用 resolve 构造地址，这里只是带编辑态 query 跳转
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			if (next) await goto(stepHref(type, next, editId));
			return;
		}
		submitError = '';
		submitting = true;
		try {
			if (editId) {
				// 联调：PUT /<type>-requests/:id { fields } → POST .../:id/submit
				await resubmitRequest(editId, type, $draft, identity.user);
			} else {
				// 联调：POST /<type>-requests { fields } → POST .../:id/submit
				await submitNewRequest(type, $draft, identity.user);
			}
			setActiveEditId(null);
			resetDraft();
			resetRequestListFilters();
			// 把全局类型对齐到刚提交的类型，返回列表即按该类型展示、便于看到这张单
			appType.switchTo(type);
			await goto(resolve('/requests'));
		} catch {
			alert(`提交申请失败，请联系管理员`);
			submitting = false;
		}
	}
</script>

<section class="step-card">
	{#if isPreview}
		<DynamicPreview fields={previewFields} value={$draft} />
	{:else}
		<DynamicForm
			fields={step.fields}
			value={$draft}
			errors={allErrors}
			{touched}
			{attempted}
			{markTouched}
			{type}
			onPatch={(k, v) => draft.update((d) => ({ ...d, [k]: v }))}
		/>
	{/if}

	{#if submitError}
		<p class="field__error step-card__error">{submitError}</p>
	{/if}
</section>

<WizardFooter
	prevHref={prevStep(type, step.slug) ? prevHref : null}
	{primaryLabel}
	loading={submitting}
	onPrimary={onSubmit}
	secondaryLabel={editId ? undefined : '存为草稿'}
	secondaryLoading={savingDraft}
	onSecondary={onSaveDraft}
/>

<style>
	.step-card {
		background: var(--color-white);
		border: 1px solid var(--color-slate-200);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
	}
	.step-card__error {
		margin-top: 1rem;
	}
</style>
