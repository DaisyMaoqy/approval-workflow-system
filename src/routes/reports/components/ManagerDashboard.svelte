<script lang="ts">
	import type { ApplicationType, RequestStatus } from '$lib/domain/types';
	import type { Request } from '$lib/domain/types';
	import { USE_BACKEND } from '$lib/core/http';
	import { loadDashboard } from '$lib/data/reports';
	import {
		statusDistribution,
		monthlyApplicationTrend,
		monthlyLeaveDays,
		leaveTypeDistribution,
		leaveOverview,
		managerOverview,
		STATUS_COLORS,
		LEAVE_TYPE_COLORS,
		CHART_COLORS,
		computeDateRange,
		filterByDateRange,
		mapBackendDashboard,
		type BackendDashboard,
		type DatePreset
	} from '$lib/domain/dashboard';
	import Panel from '$lib/components/common/Panel.svelte';
	import StatCard from '$lib/components/common/StatCard.svelte';
	import DateFilter from './DateFilter.svelte';
	import ApplicationTable from './ApplicationTable.svelte';
	import StatusDistributionChart from './charts/StatusDistributionChart.svelte';
	import LeaveTypeBarChart from './charts/LeaveTypeBarChart.svelte';
	import ApplicationTrendChart from './charts/ApplicationTrendChart.svelte';

	let {
		requests,
		/** 看板当前类型筛选；'leave' 时图表与卡片切换为请假语义指标 */
		type = 'all'
	}: { requests: readonly Request[]; type?: ApplicationType | 'all' } = $props();

	// 当前是否为请假视图：驱动图表/卡片/表头的差异化渲染
	const isLeave = $derived(type === 'leave');

	// ---- 筛选状态 ----
	let preset = $state<DatePreset>('all');
	let customStart = $state('');
	let customEnd = $state('');
	let selectedStatus = $state<RequestStatus | null>(null);
	let selectedLeaveType = $state<string | null>(null);
	let selectedMonth = $state<string | null>(null);
	let showDateFilter = $state(false);

	// ---- 后端看板（GET /aws/v1/reports/dashboard） ----
	// 后端仅支持 type/year/month/department，不支持状态/请假类型/自定义日期区间，
	// 故仅在「无本地筛选」时走后端聚合；一旦用户加了本地筛选，回退客户端聚合。
	let backendData = $state<BackendDashboard | null>(null);

	const hasLocalFilters = $derived(
		preset !== 'all' ||
			!!selectedStatus ||
			!!selectedLeaveType ||
			!!selectedMonth ||
			!!customStart ||
			!!customEnd
	);
	const useBackend = $derived(USE_BACKEND && !hasLocalFilters);

	// 联调：无本地筛选时用后端聚合；否则清空，交回本地聚合（含交互筛选）
	$effect(() => {
		if (!useBackend) {
			backendData = null;
			return;
		}
		const currentType = type;
		void loadDashboard({ type: currentType })
			.then((d) => {
				if (useBackend) backendData = d;
			})
			.catch(() => {
				backendData = null;
			});
	});

	const backend = $derived(backendData ? mapBackendDashboard(backendData, isLeave) : null);

	function resetDateFilter(): void {
		preset = 'all';
		customStart = '';
		customEnd = '';
		showDateFilter = false;
	}

	function resetAllFilters(): void {
		resetDateFilter();
		selectedStatus = null;
		selectedLeaveType = null;
		selectedMonth = null;
	}

	// ---- 日期范围 ----
	const dateRange = $derived.by(() => {
		const start = customStart ? new Date(customStart) : undefined;
		const end = customEnd ? new Date(customEnd) : undefined;
		return computeDateRange(preset, start, end);
	});
	// 日期筛选变化 → 重挂载环形图以重播入场动画（仅日期维度，不含状态/月份点击）
	const dateKey = $derived(`${preset}:${customStart}:${customEnd}`);

	// ---- 筛选 & 排序 ----
	const dateFiltered = $derived(filterByDateRange(requests, dateRange));
	// 顶部「全部/差旅/请假」视图筛选：看板所有聚合与明细表都以 typeFiltered 为基准，
	// 保证切换视图时图表与列表实时跟着变（此前漏了这层，导致切视图图表不动）。
	const typeFiltered = $derived(
		type === 'all' ? dateFiltered : dateFiltered.filter((r) => r.type === type)
	);
	const finalFiltered = $derived.by(() => {
		let result = typeFiltered;
		if (selectedStatus) {
			result = result.filter((r) => r.status === selectedStatus);
		}
		if (selectedLeaveType) {
			result = result.filter(
				(r) =>
					r.type === 'leave' &&
					(r.fields as Record<string, unknown>).leaveType === selectedLeaveType
			);
		}
		if (selectedMonth) {
			result = result.filter((r) => r.createdAt.slice(0, 7) === selectedMonth);
		}
		return result;
	});
	const sortedRequests = $derived(
		[...finalFiltered].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		)
	);

	// 筛选条件改变 → 分页回到首页
	const filterKey = $derived(
		`${preset}:${selectedStatus ?? ''}:${selectedLeaveType ?? ''}:${selectedMonth ?? ''}:${customStart}:${customEnd}`
	);

	// ---- 图表聚合（仅对日期+类型筛选后的数据做聚合，作为后端不可用时的兜底） ----
	const overview = $derived(backend ? backend.overview : managerOverview(typeFiltered));
	const leave = $derived(backend ? backend.leave : leaveOverview(typeFiltered));

	// 状态分布（差旅视图用饼图、请假视图用环形图，共用同一份聚合）
	const localStatusSlices = $derived(
		statusDistribution(typeFiltered).map((s) => ({
			name: s.name,
			value: s.value,
			key: s.status,
			color: STATUS_COLORS[s.status]
		}))
	);
	// 请假类型分布（请假视图用横向条形图，与状态环形图形成形状对比）
	const localLeaveTypeSlices = $derived(
		leaveTypeDistribution(typeFiltered).map((s) => ({
			name: s.name,
			value: s.count,
			key: s.value,
			color: LEAVE_TYPE_COLORS[s.value] ?? CHART_COLORS[0]
		}))
	);

	// 状态分布：后端数据时补上 key/color（图表与点击交互需要），否则用本地聚合
	const statusSlices = $derived(
		backend
			? backend.statusSlices.map((s) => ({
					name: s.name,
					value: s.value,
					key: s.status,
					color: STATUS_COLORS[s.status]
				}))
			: localStatusSlices
	);
	const leaveTypeSlices = $derived(
		backend
			? backend.leaveTypeSlices.map((s) => ({
					name: s.name,
					value: s.count,
					key: s.value,
					color: LEAVE_TYPE_COLORS[s.value] ?? CHART_COLORS[0]
				}))
			: localLeaveTypeSlices
	);

	// 趋势：后端数据为「申请量（单）」口径；本地模式保留请假视图「天数」语义
	const trend = $derived(
		backend ? backend.trend : isLeave ? monthlyLeaveDays(typeFiltered) : monthlyApplicationTrend(typeFiltered)
	);
	const trendName = $derived(backend ? backend.trendName : isLeave ? '请假天数' : '申请量');
	const trendUnit = $derived(backend ? backend.trendUnit : isLeave ? '天' : '单');

	// ---- 图表点击交互（子组件回传分类名，这里按维度筛选下方申请记录） ----
	function handleStatusSelect(name: string): void {
		const slice = statusSlices.find((s) => s.name === name);
		if (!slice) return;
		selectedStatus =
			selectedStatus === (slice.key as RequestStatus) ? null : (slice.key as RequestStatus);
		selectedLeaveType = null;
		selectedMonth = null;
		resetDateFilter();
	}

	function handleLeaveTypeSelect(name: string): void {
		const slice = leaveTypeSlices.find((s) => s.name === name);
		if (!slice) return;
		selectedLeaveType = selectedLeaveType === slice.key ? null : slice.key;
		selectedStatus = null;
		selectedMonth = null;
		resetDateFilter();
	}

	function handleMonthSelect(month: string): void {
		selectedMonth = selectedMonth === month ? null : month;
		selectedStatus = null;
		selectedLeaveType = null;
		resetDateFilter();
	}
</script>

<div class="cards">
	<StatCard label="申请总数" value={String(overview.total)} />
	<StatCard label="待处理" value={String(overview.pending)} />
	{#if isLeave}
		<StatCard label="请假总天数" value={`${leave.totalDays} 天`} />
	{/if}
	<StatCard label="通过率" value={`${(overview.passRate * 100).toFixed(1)}%`} />
</div>

<div class="grid">
	{#if isLeave}
		<Panel title="请假类型分布">
			<LeaveTypeBarChart slices={leaveTypeSlices} onSelect={handleLeaveTypeSelect} />
		</Panel>
		<Panel title="申请状态分布">
			{#key dateKey}
				<StatusDistributionChart
					slices={statusSlices}
					variant="donut"
					onSelect={handleStatusSelect}
				/>
			{/key}
		</Panel>
		<Panel title="近 12 个月请假天数趋势">
			<ApplicationTrendChart
				points={trend}
				name={trendName}
				unit={trendUnit}
				onSelect={handleMonthSelect}
			/>
		</Panel>
	{:else}
		<Panel title="申请状态分布">
			<StatusDistributionChart slices={statusSlices} variant="pie" onSelect={handleStatusSelect} />
		</Panel>
		<Panel title="近 12 个月申请量趋势">
			<ApplicationTrendChart
				points={trend}
				name={trendName}
				unit={trendUnit}
				onSelect={handleMonthSelect}
			/>
		</Panel>
	{/if}
</div>

<Panel title="申请记录" actions={header}>
	<ApplicationTable requests={sortedRequests} {type} resetKey={filterKey} />
</Panel>

{#snippet header()}
	<DateFilter
		bind:preset
		bind:customStart
		bind:customEnd
		bind:visible={showDateFilter}
		onreset={resetAllFilters}
	/>
{/snippet}

<style>
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 1.25rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1.25rem;
		margin-bottom: 1.25rem;
	}
</style>
