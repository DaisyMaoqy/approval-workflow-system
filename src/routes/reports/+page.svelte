<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import { useIdentity } from '$lib/state/identity.svelte';
	import { useApplicationType } from '$lib/state/applicationType.svelte';
	import { requestsStore, filterByType } from '$lib/data/requests';
	import {
		APPLICATION_TYPE_VALUES,
		APPLICATION_TYPE_LABELS,
		type ApplicationType
	} from '$lib/domain/types';
	import ManagerDashboard from './components/ManagerDashboard.svelte';

	const identity = useIdentity();
	const appType = useApplicationType();
	// 报表数据随请求数据集变化（含启动时的 Mock 加载）自动刷新
	const all = $derived($requestsStore);
	// 主管只查看本部门员工（不含自己、排除草稿）的申请数据
	const deptRequests = $derived.by(() =>
		all.filter(
			(r) =>
				r.department === identity.user.department &&
				r.applicantId !== identity.user.id &&
				r.status !== 'draft'
		)
	);

	// 是否以「全部类型」局部视图查看报表（不写回全局类型）
	let showAll = $state(false);
	// 默认按持久化的全局申请类型查看；选「全部类型」则局部覆盖，且不随全局类型变
	const selectedType = $derived<ApplicationType | 'all'>(showAll ? 'all' : appType.value);
	const visibleRequests = $derived(
		selectedType === 'all' ? deptRequests : filterByType(deptRequests, selectedType)
	);
	const typeLabel = $derived(
		selectedType === 'all' ? '团队申请' : APPLICATION_TYPE_LABELS[selectedType]
	);
	const description = $derived(`${typeLabel}统计与审批效率`);

	// 切换类型：选具体类型即写入全局持久化类型（侧栏品牌区同步）；
	// 选「全部类型」仅作报表内局部视图，不改动全局类型
	function changeReportType(event: Event): void {
		const type = (event.currentTarget as HTMLSelectElement).value;
		if (type !== 'all') {
			showAll = false;
			appType.switchTo(type as ApplicationType);
		} else {
			showAll = true;
		}
	}
</script>

{#if identity.isManager}
	<PageHeader title="统计报表" {description}>
		{#snippet actions()}
			<select
				class="reports__type-select"
				value={selectedType}
				onchange={changeReportType}
				aria-label="按申请类型查看报表"
			>
				<option value="all">全部类型</option>
				{#each APPLICATION_TYPE_VALUES as t (t)}
					<option value={t}>{APPLICATION_TYPE_LABELS[t]}</option>
				{/each}
			</select>
		{/snippet}
	</PageHeader>

	<ManagerDashboard requests={visibleRequests} type={selectedType} department={identity.user.department} />
{:else}
	<!-- 统计报表是领导（主管）专属视图，其余身份无权查看 -->
	<div class="notice-card">
		<p class="notice-card__text">
			当前身份是 <span class="font-medium text-slate-900">{identity.user.name}</span
			>，统计报表仅对领导（主管）开放。可切换到主管身份查看团队数据。
		</p>
		<div class="notice-card__actions">
			<button
				type="button"
				onclick={() => identity.switchTo('manager')}
				class="notice-card__action btn btn--primary"
			>
				切换到主管身份
			</button>
		</div>
	</div>
{/if}
