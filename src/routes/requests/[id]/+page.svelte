<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import RequestDetail from './components/RequestDetail.svelte';
	import { useIdentity } from '$lib/state/identity.svelte';
	import { requestsStore, loadRequestById } from '$lib/data/requests';
	import { canViewRequest } from '$lib/domain/workflow';
	import { USE_BACKEND } from '$lib/core/http';

	const identity = useIdentity();
	const id = $derived(page.params.id);
	// 入口来源：?from=approvals 表示由「待我审批」点进来，详情页据此隐藏底部操作
	const from = $derived(page.url.searchParams.get('from'));

	// 从响应式 store 派生，流转后仍会自动刷新（RequestActions 改的是同一 store）
	const request = $derived($requestsStore.find((r) => r.id === id));
	// 查看权限：自己的单或待我审批的单才可看；随身份切换响应式变化（员工看不到领导的单）
	const canView = $derived(request ? canViewRequest(request, identity.user) : false);

	// 联调模式：store 里没有这张单（深链直访 / 列表未含此单）时，按 id 向后端拉取。
	// 命中后写回 store 会使上面的推导重新计算、request 出现，effect 随即不再触发；
	// 两个资源都拉不到（不存在 / 后端未起）则保持「未找到」分支，不阻塞页面。
	$effect(() => {
		if (USE_BACKEND && !request && id) {
			void loadRequestById(id).catch(() => {});
		}
	});
</script>

{#if !request}
	<!-- 数据里没有这张单：可能 id 拼错，或流转后本地缓存与远端不一致 -->
	<div class="notice-card">
		<p class="notice-card__text">没有找到单号为 {id} 的申请</p>
	</div>
{:else if !canView}
	<!-- 单存在但当前身份无权查看（如员工访问领导的单）；切到有权身份会自动恢复 -->
	<div class="notice-card">
		<p class="notice-card__text">
			当前身份（{identity.user.name}）没有权限查看这张申请
		</p>
		<a href={resolve('/requests')} class="notice-card__action btn btn--primary"> 返回我的申请 </a>
	</div>
{:else}
	<RequestDetail {request} actor={identity.user} {from} />
{/if}
