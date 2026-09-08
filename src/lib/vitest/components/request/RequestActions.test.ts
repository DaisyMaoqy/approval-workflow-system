import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { setActiveEditId, getActiveEditId, stepHref } from '$lib/domain/wizard';
import { goto } from '$app/navigation';
import { applyAction, removeRequest } from '$lib/data/requests';
import RequestActions from '../../../../routes/requests/[id]/components/RequestActions.svelte';
import type { Request, TravelRequest, User } from '$lib/domain/types';

// 模块级 mock：把数据层（applyAction / removeRequest）与跳转替换成可观测的替身，
// 从而断言编排层（runAction / onReedit / onDeleteConfirm）调用了正确的动作与参数。
// 本地状态机 / store 的落库逻辑由 store.test.ts / requests.edit.test.ts 单独覆盖，
// 组件测试只验证「点了哪个按钮 → 触发哪个动作 / 跳转 / 回调」。
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/data/requests', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/data/requests')>();
	return { ...actual, applyAction: vi.fn(), removeRequest: vi.fn() };
});

// 默认 applyAction 替身：原样返回请求（reedit 时把状态翻成 draft，供组件取 id 回填）。
function defaultApplyAction(request: Request, action: string): Promise<Request> {
	return Promise.resolve({
		...request,
		status: action === 'reedit' ? 'draft' : request.status
	});
}

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 'u-self',
		employeeId: 'EMP1',
		name: '本人',
		title: '工程师',
		department: '测试部',
		role: 'employee',
		managerId: null,
		...overrides
	};
}

function makeRequest(overrides: Partial<TravelRequest> = {}): TravelRequest {
	return {
		id: 'TR-0001',
		type: 'travel',
		applicantId: 'u-self',
		applicantName: '本人',
		department: '测试部',
		status: 'draft',
		createdAt: '2026-03-10T02:00:00.000Z',
		updatedAt: '2026-03-10T02:00:00.000Z',
		audit: [],
		fields: {
			reason: '出差',
			urgency: 'normal',
			legs: [],
			budget: { transport: 0, hotel: 0, allowance: 0, other: 0 },
			budgetNote: ''
		},
		...overrides
	};
}

const applicant = makeUser();

beforeEach(() => {
	vi.mocked(applyAction).mockReset();
	vi.mocked(applyAction).mockImplementation(defaultApplyAction);
	vi.mocked(removeRequest).mockReset();
	vi.mocked(removeRequest).mockResolvedValue(undefined);
	vi.mocked(goto).mockClear();
	setActiveEditId(null);
});

afterEach(cleanup);

describe('RequestActions — 提交申请', () => {
	it('草稿提交成功：触发 applyAction(submit)、触发 onsubmitted、不跳转', async () => {
		const onsubmitted = vi.fn();
		render(RequestActions, { props: { request: makeRequest(), actor: applicant, onsubmitted } });

		await fireEvent.click(screen.getByText('提交申请'));
		await tick();

		expect(applyAction).toHaveBeenCalledWith(makeRequest(), 'submit', applicant, undefined);
		expect(onsubmitted).toHaveBeenCalledTimes(1);
		expect(goto).not.toHaveBeenCalled();
	});

	it('流转失败（如非法状态）只提示、不触发 onsubmitted', async () => {
		vi.mocked(applyAction).mockRejectedValue(new Error('当前状态不可提交'));
		const onsubmitted = vi.fn();
		render(RequestActions, { props: { request: makeRequest(), actor: applicant, onsubmitted } });

		await fireEvent.click(screen.getByText('提交申请'));
		await tick();

		expect(screen.getByText('当前状态不可提交')).toBeTruthy();
		expect(applyAction).toHaveBeenCalledTimes(1);
		expect(onsubmitted).not.toHaveBeenCalled();
	});
});

describe('RequestActions — 重新编辑', () => {
	it('被驳回单：走 applyAction(reedit)，带 ?edit=ID 跳转', async () => {
		const req = makeRequest({ id: 'TR-0009', status: 'rejected' });
		render(RequestActions, { props: { request: req, actor: applicant } });

		await fireEvent.click(screen.getByText('重新编辑'));
		await tick();

		expect(applyAction).toHaveBeenCalledWith(req, 'reedit', applicant);
		// setActiveEditId 必须先于 stepHref 执行，否则 URL 丢掉 ?edit=ID、编辑态退化为新建
		expect(getActiveEditId()).toBe('TR-0009');
		expect(goto).toHaveBeenCalledWith(stepHref('travel', 'basic', 'TR-0009'));
	});

	it('草稿单：跳过 applyAction、不落库，但仍带 ?edit=ID 跳转', async () => {
		const req = makeRequest({ id: 'TR-0009', status: 'draft' });
		render(RequestActions, { props: { request: req, actor: applicant } });

		await fireEvent.click(screen.getByText('重新编辑'));
		await tick();

		expect(applyAction).not.toHaveBeenCalled();
		expect(getActiveEditId()).toBe('TR-0009');
		expect(goto).toHaveBeenCalledWith(stepHref('travel', 'basic', 'TR-0009'));
	});
});

describe('RequestActions — 删除（草稿）', () => {
	it('仅在草稿态渲染删除按钮，确认后调用 removeRequest 与 ondeleted', async () => {
		const ondeleted = vi.fn();
		render(RequestActions, { props: { request: makeRequest(), actor: applicant, ondeleted } });

		// 非草稿不渲染删除（这里本身就是草稿，按钮存在）
		await fireEvent.click(screen.getByText('删除'));
		await tick();
		await fireEvent.click(screen.getByText('确认删除'));
		await tick();

		expect(removeRequest).toHaveBeenCalledWith('TR-0001');
		expect(ondeleted).toHaveBeenCalledTimes(1);
	});

	it('非本人草稿不渲染删除按钮', () => {
		render(RequestActions, {
			props: { request: makeRequest({ applicantId: 'u-other' }), actor: applicant }
		});
		expect(screen.queryByText('删除')).toBeNull();
	});
});
