<script lang="ts">
	import { get } from 'svelte/store';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import RequestFilterBar from './components/RequestFilterBar.svelte';
	import RequestList from './components/RequestList.svelte';
	import { resolve } from '$app/paths';
	import { useIdentity } from '$lib/state/identity.svelte';
	import { useApplicationType } from '$lib/state/applicationType.svelte';
	import { requestListFilters } from '$lib/state/requestListFilters';
	import {
		distinctYears,
		filterByDate,
		filterByStatus,
		filterByType,
		getRequestsByApplicant,
		requestsStore,
		searchRequests,
		sortBySubmittedAtDesc,
		type StatusFilter
	} from '$lib/data/requests';
	import { type ApplicationType } from '$lib/domain/types';
	import { firstStep } from '$lib/domain/wizard';

	const identity = useIdentity();
	const appType = useApplicationType();

	/** 筛选 tab：「审批中」是 pending_manager + pending_finance 两个状态的合集 */
	const FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
		{ value: 'all', label: '全部' },
		{ value: 'draft', label: '草稿' },
		{ value: 'pending', label: '审批中' },
		{ value: 'approved', label: '已通过' },
		{ value: 'rejected', label: '已驳回' },
		{ value: 'cancelled', label: '已撤销' }
	];

	const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

	// 以共享 store 的当前值初始化，离开本页（去重新编辑申请）后再回来可恢复上次筛选
	const savedFilters = get(requestListFilters);
	let activeFilter = $state<StatusFilter>(savedFilters.status);
	let keyword = $state(savedFilters.keyword);
	let year = $state<number | 'all'>(savedFilters.year);
	let month = $state<number | 'all'>(savedFilters.month);
	// 类型筛选默认取持久化的全局申请类型（侧栏「切换申请类型」即设它），
	// 不再从 URL 的 ?type= 读取——点导航不会改类型。
	// 该筛选可写（本地能临时选「全部」）又需随全局类型自动跟随，无法用纯 $derived，
	// 故此处用 $state + $effect，豁免该规则
	// eslint-disable-next-line svelte/prefer-writable-derived
	let typeFilter = $state<ApplicationType | 'all'>(appType.value);

	// 主动切换申请类型（侧栏下拉）时把列表筛选同步到该类型；
	// 本地选「全部」不回写全局类型，故此处只单向同步 store → 本地筛选，
	// 且 effect 仅在 appType.value 变化时重跑，不会把本地「全部」覆盖掉
	$effect(() => {
		typeFilter = appType.value;
	});

	// 任一筛选维度变化都同步回 store，供「返回我的申请」等跨页导航恢复
	$effect(() => {
		requestListFilters.set({ status: activeFilter, keyword, year, month });
	});

	// 切角色即切登录人，依赖 identity.user（读取响应式的 role）会自动重算；
	// 传入 $requestsStore（响应式）让列表随远端加载 / 缓存回退自动刷新
	const mine = $derived(
		sortBySubmittedAtDesc(getRequestsByApplicant(identity.user.id, $requestsStore))
	);
	const years = $derived(distinctYears(mine));
	// 维度正交：状态 → 类型 → 年/月 → 关键字，叠加生效
	const visible = $derived(
		(() => {
			const byStatus = filterByStatus(mine, activeFilter);
			const byDate = filterByDate(byStatus, year, month);
			const byType = typeFilter === 'all' ? byDate : filterByType(byDate, typeFilter);
			return searchRequests(byType, keyword);
		})()
	);

	// 状态 tab：数量徽标只看「状态分布」，但需跟随其余正交筛选维度
	// （类型 / 年 / 月）——否则按类型或年月收窄列表时，徽标数字仍按全量算，
	// 会出现「全部: N」却只列出部分单子的对不上的情况；
	// 不受搜索词影响（清空关键字即可看到这些单子），与列表其它维度的行为保持一致。
	const filterOptions = $derived(
		FILTERS.map((f) => {
			const byType = typeFilter === 'all' ? mine : filterByType(mine, typeFilter);
			const byDate = filterByDate(byType, year, month);
			return { ...f, count: filterByStatus(byDate, f.value).length };
		})
	);
	const yearOptions = $derived<ReadonlyArray<{ value: number | 'all'; label: string }>>([
		{ value: 'all', label: '全部' },
		...years.map((y) => ({ value: y, label: String(y) }))
	]);
	const monthOptions = $derived<ReadonlyArray<{ value: number | 'all'; label: string }>>([
		{ value: 'all', label: '全部' },
		...MONTHS.map((m) => ({ value: m, label: String(m) }))
	]);

	// 清除筛选按钮显隐：只关心年/月/搜索框，不含状态栏
	const hasClearableFilter = $derived(keyword.trim() !== '' || year !== 'all' || month !== 'all');

	// 清除筛选只重置年/月/搜索框，保留当前状态栏筛选
	function resetFilters(): void {
		keyword = '';
		year = 'all';
		month = 'all';
	}

	// 「发起申请」跟随类型：列表按某类型筛选时走该向导；选「全部」时走全局当前类型
	const applyType = $derived(typeFilter === 'all' ? appType.value : typeFilter);
	const applyHref = $derived(
		resolve('/apply/[type]/[step]', { type: applyType, step: firstStep(applyType) })
	);

	// 筛选条件拼接串：任一维度变化都令分页回到首页
	const filterKey = $derived(`${activeFilter}|${keyword}|${year}|${month}`);
</script>

<PageHeader title="我的申请" description="{identity.user.name} 发起的全部申请">
	{#snippet actions()}
		<a href={applyHref} class="btn btn--primary">发起申请</a>
	{/snippet}
</PageHeader>

<RequestFilterBar
	bind:status={activeFilter}
	bind:keyword
	bind:year
	bind:month
	bind:type={typeFilter}
	statusOptions={filterOptions}
	{yearOptions}
	{monthOptions}
	showClear={hasClearableFilter && visible.length > 0}
	onclear={resetFilters}
/>

<RequestList
	requests={visible}
	{keyword}
	hasNoRequests={mine.length === 0}
	{hasClearableFilter}
	resetKey={filterKey}
	onclear={resetFilters}
/>
