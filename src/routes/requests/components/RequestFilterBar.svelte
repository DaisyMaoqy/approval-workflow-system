<script lang="ts">
	import FilterTabs from '$lib/components/form/FilterTabs.svelte';
	import SearchInput from '$lib/components/form/SearchInput.svelte';
	import UnitSelect from '$lib/components/form/UnitSelect.svelte';
	import Icon from '$lib/components/common/Icon.svelte';
	import type { StatusFilter } from '$lib/domain/types';
	import {
		APPLICATION_TYPE_VALUES,
		APPLICATION_TYPE_LABELS,
		type ApplicationType
	} from '$lib/domain/types';

	interface Props {
		/** 状态筛选值（双向绑定） */
		status: StatusFilter;
		/** 关键字（双向绑定） */
		keyword: string;
		/** 年份筛选（双向绑定），'all' 表示全部 */
		year: number | 'all';
		/** 月份筛选（双向绑定），'all' 表示全部 */
		month: number | 'all';
		/** 申请类型筛选（双向绑定），'all' 表示全部 */
		type: ApplicationType | 'all';
		statusOptions: ReadonlyArray<{ value: StatusFilter; label: string; count: number }>;
		yearOptions: ReadonlyArray<{ value: number | 'all'; label: string }>;
		monthOptions: ReadonlyArray<{ value: number | 'all'; label: string }>;
		/** 是否显示「清除筛选」；由调用方决定，它才知道当前列表是否为空 */
		showClear?: boolean;
		onclear?: () => void;
	}

	let {
		status = $bindable(),
		keyword = $bindable(),
		year = $bindable(),
		month = $bindable(),
		type = $bindable(),
		statusOptions,
		yearOptions,
		monthOptions,
		showClear = false,
		onclear
	}: Props = $props();

	/**
	 * 搜索行默认收起，点漏斗展开。
	 */
	let showFilters = $state(false);
</script>

<!-- 第一行：状态筛选（左）+ 漏斗开关（右） -->
<div class="filter-bar">
	<FilterTabs options={statusOptions} bind:value={status} ariaLabel="按状态筛选" />

	<button
		type="button"
		onclick={() => (showFilters = !showFilters)}
		aria-pressed={showFilters}
		aria-label="显示或隐藏筛选"
		title="筛选"
		class="filter-bar__toggle"
		class:filter-bar__toggle--active={showFilters}
	>
		<Icon name="filter" class="filter-bar__toggle-icon" />
	</button>
</div>

<!-- 第二行：年 / 月 / 关键字，默认收起 -->
{#if showFilters}
	<div class="filter-bar__row">
		<select class="filter-bar__select" bind:value={type} aria-label="按申请类型筛选">
			<option value="all">全部类型</option>
			{#each APPLICATION_TYPE_VALUES as t (t)}
				<option value={t}>{APPLICATION_TYPE_LABELS[t]}</option>
			{/each}
		</select>
		<UnitSelect bind:value={year} options={yearOptions} unit="年" ariaLabel="按年份筛选" />
		<UnitSelect bind:value={month} options={monthOptions} unit="月" ariaLabel="按月份筛选" />
		<SearchInput bind:value={keyword} placeholder="搜索事由或目的地" ariaLabel="搜索事由或目的地" />

		<!-- 清除筛选跟随搜索行，置于筛选控件簇内，不另起一行影响状态栏 -->
		{#if showClear}
			<button type="button" onclick={onclear} class="filter-bar__clear">清除筛选</button>
		{/if}
	</div>
{/if}

<style>
	.filter-bar {
		margin-bottom: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.filter-bar__toggle {
		/* 挤到最右，与左侧状态栏拉开 */
		margin-left: auto;
		display: inline-flex;
		height: 2.25rem;
		width: 2.25rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.5rem;
		border: 1px solid var(--color-slate-200);
		color: var(--color-slate-500);
		cursor: pointer;
		transition:
			background-color 150ms ease,
			border-color 150ms ease,
			color 150ms ease;
	}
	.filter-bar__toggle:hover {
		background-color: var(--color-slate-50);
		color: var(--color-slate-800);
	}
	.filter-bar__toggle:focus-visible {
		outline: 2px solid var(--color-brand-500);
		outline-offset: 2px;
	}
	/* 展开态：让漏斗保持点亮，提示「筛选行还开着」 */
	.filter-bar__toggle--active {
		border-color: var(--color-brand-500);
		background-color: var(--color-brand-50);
		color: var(--color-brand-600);
	}
	.filter-bar__toggle :global(.filter-bar__toggle-icon) {
		height: 1rem;
		width: 1rem;
	}
	.filter-bar__row {
		margin-bottom: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.filter-bar__select {
		height: 2.25rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-slate-200);
		border-radius: 0.5rem;
		background: var(--color-white);
		font-size: 0.875rem;
	}
	.filter-bar__clear {
		font-size: 0.875rem;
		color: var(--color-brand-600);
		cursor: pointer;
	}
	.filter-bar__clear:hover {
		color: var(--color-brand-700);
		text-decoration: underline;
	}
</style>
