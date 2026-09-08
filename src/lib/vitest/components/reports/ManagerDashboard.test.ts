import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import seed from '$lib/data/seed.json';
import type { Request } from '$lib/domain/types';

// 桩掉 echarts，避免 jsdom 下 canvas 初始化失败；捕获 Chart 收到的 option 与事件
const setOptionSpy = vi.fn();
const onSpy = vi.fn();
vi.mock('echarts', () => ({
	init: () => ({
		setOption: (...args: unknown[]) => setOptionSpy(...args),
		resize: () => {},
		on: (...args: unknown[]) => onSpy(...args),
		off: () => {},
		dispose: () => {}
	})
}));

import ManagerDashboard from '../../../../routes/reports/components/ManagerDashboard.svelte';

// jsdom 未实现 ResizeObserver，图表组件在挂载时会用到
class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver =
	globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

const requests = seed as unknown as Request[];

type Series = { type?: string; data?: Array<{ name?: string }> };

/** 从所有 setOption 调用里，倒序找回指定 series 类型的分类名 */
function namesOfType(type: string): string[] {
	for (let i = setOptionSpy.mock.calls.length - 1; i >= 0; i--) {
		const option = setOptionSpy.mock.calls[i]?.[0] as
			{ series?: Series[]; yAxis?: { data?: string[] } } | undefined;
		const series = option?.series?.[0];
		if (series?.type === type) {
			// 横向条形图的分类名在 yAxis.data（series.data 只放数值）
			if (type === 'bar') return option?.yAxis?.data ?? [];
			return (series.data ?? []).map((d) => d.name ?? '');
		}
	}
	return [];
}
const pieNames = () => namesOfType('pie');
const barNames = () => namesOfType('bar');

const STATUS_NAMES = ['已通过', '待主管审批', '待财务审批', '已驳回', '已撤销', '草稿'];
const LEAVE_TYPE_NAMES = ['年假', '病假', '事假'];

describe('ManagerDashboard 图表形态与交互', () => {
	beforeEach(() => {
		setOptionSpy.mockClear();
		onSpy.mockClear();
	});

	it('差旅视图：状态分布为饼图，不出现横向条形', async () => {
		render(ManagerDashboard, { props: { requests, type: 'travel' as const } });
		await tick();
		await new Promise((r) => setTimeout(r, 90));
		expect(pieNames().some((n) => STATUS_NAMES.includes(n))).toBe(true);
		expect(barNames().length).toBe(0);
		// 交互：饼图与折线都注册了 click
		expect(onSpy).toHaveBeenCalledWith('click', expect.any(Function));
	});

	it('请假视图：请假类型分布为横向条形 + 申请状态为环形图', async () => {
		render(ManagerDashboard, { props: { requests, type: 'leave' as const } });
		await tick();
		await new Promise((r) => setTimeout(r, 90));
		expect(barNames().some((n) => LEAVE_TYPE_NAMES.includes(n))).toBe(true);
		expect(pieNames().some((n) => STATUS_NAMES.includes(n))).toBe(true);
		// 交互：条形、环形、折线三张图都注册了 click
		const clickCalls = onSpy.mock.calls.filter((c) => c[0] === 'click');
		expect(clickCalls.length).toBeGreaterThanOrEqual(3);
	});
});

/**
 * 「全部类型」是跨类型汇总视图，图表按单类型语义统计会失真，
 * 因此隐藏整个图表区，只保留概览卡片与明细表（日期筛选器保持不动）。
 *
 * 断言统一按每次 render 自己的 container 查询，避免跨用例的 DOM 残留互相干扰。
 */
describe('全部类型：隐藏图表区', () => {
	beforeEach(() => {
		setOptionSpy.mockClear();
		onSpy.mockClear();
	});

	it('不渲染图表容器，也不初始化任何 echarts 实例', async () => {
		const { container } = render(ManagerDashboard, { props: { requests, type: 'all' as const } });
		await tick();
		await new Promise((r) => setTimeout(r, 90));

		// .grid 是图表区唯一的类名（Panel 用 panel__*），故可直接判定
		expect(container.querySelector('.grid')).toBeNull();
		expect(setOptionSpy).not.toHaveBeenCalled();
		expect(onSpy).not.toHaveBeenCalled();
	});

	it('四张图表的面板标题全部消失', async () => {
		const { container } = render(ManagerDashboard, { props: { requests, type: 'all' as const } });
		await tick();
		await new Promise((r) => setTimeout(r, 90));

		expect(container.textContent).not.toContain('申请状态分布');
		expect(container.textContent).not.toContain('近 12 个月申请量趋势');
		expect(container.textContent).not.toContain('请假类型分布');
		expect(container.textContent).not.toContain('近 12 个月请假天数趋势');
	});

	it('概览卡片与申请记录表仍照常渲染', async () => {
		const { container } = render(ManagerDashboard, { props: { requests, type: 'all' as const } });
		await tick();
		await new Promise((r) => setTimeout(r, 90));

		expect(container.textContent).toContain('申请总数');
		expect(container.textContent).toContain('待处理');
		expect(container.textContent).toContain('通过率');
		expect(container.textContent).toContain('申请记录');
		// 请假视图专属卡片不应出现（全部类型不是请假视图）
		expect(container.textContent).not.toContain('请假总天数');
	});

	it('对照组：切到具体类型后图表区恢复显示', async () => {
		const { container } = render(ManagerDashboard, {
			props: { requests, type: 'travel' as const }
		});
		await tick();
		await new Promise((r) => setTimeout(r, 90));

		expect(container.querySelector('.grid')).not.toBeNull();
		expect(container.textContent).toContain('申请状态分布');
		expect(setOptionSpy).toHaveBeenCalled();
	});
});
