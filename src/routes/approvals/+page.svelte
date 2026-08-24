<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/common/EmptyState.svelte';
	import Pagination from '$lib/components/form/Pagination.svelte';
	import ApprovalCard from './components/ApprovalCard.svelte';
	import RejectDialog from '$lib/components/RejectDialog.svelte';
	import { useIdentity } from '$lib/state/identity.svelte';
	import { requestsStore, sortBySubmittedAtDesc, applyAction } from '$lib/data/requests';
	import { canViewRequest } from '$lib/domain/workflow';
	import type { RequestStatus } from '$lib/domain/types';
	import type { Request } from '$lib/domain/types';

	const identity = useIdentity();

	// 两级审批：主管看「待主管审批」，财务看「待财务审批」。
	// 各自的待办状态由身份决定；自审规则由 workflow 在 transition 时再兜底拦截，
	// 这里先按身份收窄到对应状态。
	const myPendingStatus: RequestStatus | null = identity.isManager
		? 'pending_manager'
		: identity.isFinance
			? 'pending_finance'
			: null;

	const todo = $derived(
		sortBySubmittedAtDesc(
			$requestsStore.filter(
				(r) =>
					myPendingStatus !== null &&
					r.applicantId !== identity.user.id &&
					canViewRequest(r, identity.user) &&
					r.status === myPendingStatus
			)
		)
	);
	// 切换审批身份时回到首页，避免停留在另一角色的无数据页码
	const approvalResetKey = $derived(identity.role);
	const allIds = $derived(todo.map((r) => r.id));

	// 批量选择：以 id 数组为唯一真相，卡片只回传切换事件，由这里维护集合
	let selected = $state<string[]>([]);
	const selectedCount = $derived(selected.length);
	const allSelected = $derived(allIds.length > 0 && selected.length === allIds.length);

	function isSelected(id: string): boolean {
		return selected.includes(id);
	}
	function toggle(id: string): void {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	}
	function toggleAll(): void {
		selected = allSelected ? [] : [...allIds];
	}

	// 通过/驳回只描述意图，具体落到 pending_finance 还是 approved 由状态机决定。
	// 联调入口 applyAction 在 USE_BACKEND 时调后端 RPC，否则降级本地状态机；
	// 服务端返回值会回写本地 store。见 requests.ts 的 applyAction 注释。
	async function approve(request: Request): Promise<void> {
		try {
			await applyAction(request, 'approve', identity.user);
			selected = selected.filter((id) => id !== request.id);
		} catch {
			// 流转失败静默：列表项保留，待用户重试
		}
	}
	function batchApprove(): void {
		// 每张都按最新引用再流转，避免 store 更新后的 stale 引用
		for (const id of selected) {
			const found = $requestsStore.find((r) => r.id === id);
			if (found) void approve(found);
		}
		selected = [];
	}

	// 驳回需填意见：意见与校验由 RejectDialog，这里只拿到最终 comment 去流转
	let rejectTarget = $state<Request | null>(null);
	let rejectError = $state<string | null>(null);

	function openReject(request: Request): void {
		rejectTarget = request;
		rejectError = null;
	}
	function closeReject(): void {
		rejectTarget = null;
		rejectError = null;
	}
	async function confirmReject(comment: string): Promise<void> {
		if (!rejectTarget) return;
		try {
			await applyAction(rejectTarget, 'reject', identity.user, comment);
			closeReject();
		} catch (err) {
			rejectError = err instanceof Error ? err.message : '驳回失败';
		}
	}
</script>

{#if identity.isManager || identity.isFinance}
	<PageHeader title="待我审批" />

	{#if todo.length === 0}
		<EmptyState title="暂无待我审批的申请" />
	{:else}
		<div class="toolbar">
			<label class="toolbar__check">
				<input type="checkbox" checked={allSelected} aria-label="全选" onchange={toggleAll} />
				全选
			</label>
			<span class="toolbar__count">已选 {selectedCount} 项 · 共 {todo.length} 条</span>
			<span class="toolbar__spacer"></span>
			<button
				type="button"
				class="btn btn--primary"
				disabled={selectedCount === 0}
				onclick={batchApprove}
			>
				批量通过
			</button>
		</div>

		<Pagination
			items={todo}
			pageSizeOptions={[5, 10, 20]}
			resetKey={approvalResetKey}
			children={approvalListSnippet}
		/>
		{#snippet approvalListSnippet({ pageItems }: { pageItems: Request[] })}
			<ul class="approval-list">
				{#each pageItems as request (request.id)}
					<li>
						<ApprovalCard
							{request}
							selected={isSelected(request.id)}
							ontoggle={toggle}
							onapprove={approve}
							onreject={openReject}
						/>
					</li>
				{/each}
			</ul>
		{/snippet}
	{/if}

	<RejectDialog
		open={rejectTarget !== null}
		error={rejectError}
		onclose={closeReject}
		onconfirm={confirmReject}
	/>
{:else}
	<!-- 员工没有审批权限 -->
	<div class="notice-card">
		<p class="notice-card__text">
			当前身份是 <span class="font-medium text-slate-900">{identity.user.name}</span
			>，没有审批职责。可切换到审批身份查看待办。
		</p>
		<div class="notice-card__actions">
			<button
				type="button"
				onclick={() => identity.switchTo('manager')}
				class="notice-card__action btn btn--primary"
			>
				切换到主管身份
			</button>
			<button
				type="button"
				onclick={() => identity.switchTo('finance')}
				class="notice-card__action btn btn--primary"
			>
				切换到财务身份
			</button>
		</div>
	</div>
{/if}
