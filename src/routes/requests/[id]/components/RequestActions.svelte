<script lang="ts">
	import { goto } from '$app/navigation';
	import RejectDialog from '$lib/components/RejectDialog.svelte';
	import {
		ACTION_LABELS,
		actionRequiresComment,
		availableActions,
		isDeletable
	} from '$lib/domain/workflow';
	import { applyAction, removeRequest } from '$lib/data/requests';
	import { setActiveEditId, stepHref } from '$lib/domain/wizard';
	import { loadDraftForEdit } from '$lib/state/wizardDraft';
	import Modal from '$lib/components/common/Modal.svelte';
	import type { AuditAction, Request, User } from '$lib/domain/types';

	interface Props {
		request: Request;
		/** 当前操作者；切角色即切人，自审规则由 workflow 统一拦截 */
		actor: User;
		/** 无可用操作时展示的提示，审批页可能想换成别的措辞 */
		emptyHint?: string;
		/** 删除成功后回调（一般用于跳回列表），可选 */
		ondeleted?: () => void;
		/** 提交成功后回调（草稿详情页提交后直接回「我的申请」），可选 */
		onsubmitted?: () => void;
	}

	let {
		request,
		actor,
		emptyHint = '当前状态下你没有可执行的操作',
		ondeleted,
		onsubmitted
	}: Props = $props();

	// 能做什么完全由状态机决定，详情页与审批页共用同一套按钮逻辑
	const actions = $derived(availableActions(request, actor));
	// 展示顺序：提交/通过靠前，重新编辑居中，驳回/撤销靠后
	const ACTION_ORDER: readonly AuditAction[] = ['submit', 'approve', 'reedit', 'reject', 'cancel'];
	const visibleActions = $derived(ACTION_ORDER.filter((a) => actions.includes(a)));
	// 草稿页「重新编辑」与「提交申请」并存：重新编辑降为次级（ghost），让提交更突出；
	// 被驳回时重新编辑是唯一出口，保持主按钮（primary）。
	const reeditSecondary = $derived(visibleActions.includes('submit'));
	// 删除是状态机之外的「移除」操作，不进 availableActions，单独用 isDeletable 判定
	const deletable = $derived(isDeletable(request, actor));

	let feedback = $state<string | null>(null);
	let showReject = $state(false);
	let showDelete = $state(false);

	/**
	 * 执行一次流转并回写本地 store（联调入口，取代直接调 workflow.transition）。
	 * USE_BACKEND 时调后端 POST /<type>-requests/:id/<action>，否则降级本地状态机。
	 * 需要意见的动作（驳回）由调用方传入 comment。
	 */
	async function runAction(action: AuditAction, comment?: string): Promise<void> {
		feedback = null;
		try {
			await applyAction(
				request,
				action,
				actor,
				actionRequiresComment(action) ? comment : undefined
			);
			showReject = false;
			// 草稿详情页「提交申请」提交后直接回到「我的申请」，由页面层决定去向
			if (action === 'submit') onsubmitted?.();
		} catch (err) {
			feedback = err instanceof Error ? err.message : '操作失败';
		}
	}

	function openReject(): void {
		feedback = null;
		showReject = true;
	}

	// 删除是破坏性操作，且不属于状态流转，故不经过 applyAction，直接移除数据；
	// 联调时调后端 DELETE /<type>-requests/:id，本地 store 始终同步移除。
	async function onDeleteConfirm(): Promise<void> {
		await removeRequest(request.id);
		showDelete = false;
		ondeleted?.();
	}

	// 重新编辑：把数据回填进向导草稿并带上 ?edit=ID 跳转到发起页 —— 复用同一套排版，
	// 只是字段都有值可改。
	// - 草稿：本身就是可编辑态，直接回填即可，不走状态机（不追加审计）。
	// - 被驳回：先走 applyAction 把 rejected → draft（联调时调后端 reedit RPC，
	//   记一条「重新编辑」审计）再回填。
	async function onReedit(): Promise<void> {
		if (request.status !== 'draft') {
			try {
				const updated = await applyAction(request, 'reedit', actor);
				setActiveEditId(updated.id);
				loadDraftForEdit(updated);
				// 目标地址由 stepHref() 内部 resolve() 生成，ESLint 无法跨模块追踪，故豁免
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				goto(stepHref(request.type, 'basic', updated.id));
			} catch (err) {
				feedback = err instanceof Error ? err.message : '重新编辑失败';
			}
			return;
		}

		setActiveEditId(request.id);
		loadDraftForEdit(request);
		// 目标地址由 stepHref() 内部 resolve() 生成，ESLint 无法跨模块追踪，故豁免
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(stepHref(request.type, 'basic', request.id));
	}
</script>

{#if visibleActions.length > 0}
	<div class="action-bar">
		{#if feedback}
			<p class="action-bar__feedback" role="alert">{feedback}</p>
		{/if}
		<div class="action-bar__buttons">
			{#each visibleActions as action (action)}
				{#if action === 'reedit'}
					<button
						type="button"
						class="btn {reeditSecondary ? 'btn--ghost' : 'btn--primary'}"
						onclick={onReedit}
					>
						{ACTION_LABELS[action]}
					</button>
				{:else if actionRequiresComment(action)}
					<button type="button" class="btn btn--danger" onclick={openReject}>
						{ACTION_LABELS[action]}
					</button>
				{:else}
					<button
						type="button"
						class="btn {action === 'cancel' ? 'btn--ghost' : 'btn--primary'}"
						onclick={() => runAction(action)}
					>
						{ACTION_LABELS[action]}
					</button>
				{/if}
			{/each}
			{#if deletable}
				<button type="button" class="btn btn--danger" onclick={() => (showDelete = true)}>
					删除
				</button>
			{/if}
		</div>
	</div>
{:else}
	<p class="action-empty">{emptyHint}</p>
{/if}

<RejectDialog
	open={showReject}
	error={feedback}
	onclose={() => (showReject = false)}
	onconfirm={(c) => runAction('reject', c)}
/>

<Modal open={showDelete} title="删除草稿" onclose={() => (showDelete = false)}>
	{#snippet body()}
		<p class="modal__hint">删除后该草稿将无法恢复，确定要删除吗？</p>
	{/snippet}
	{#snippet actions()}
		<button type="button" class="btn btn--ghost" onclick={() => (showDelete = false)}>取消</button>
		<button type="button" class="btn btn--danger" onclick={onDeleteConfirm}>确认删除</button>
	{/snippet}
</Modal>

<style>
	.action-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 1rem;
	}
	.action-bar__feedback {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-rose-700);
	}
	.action-bar__buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.action-empty {
		text-align: center;
		font-size: 0.875rem;
		color: var(--color-slate-400);
		padding: 1rem 0;
	}
</style>
