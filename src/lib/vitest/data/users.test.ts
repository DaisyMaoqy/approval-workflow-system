import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request } from '$lib/domain/types';
import { USERS } from '$lib/domain/org';

const MOCK_BASE = 'https://mock.test';

/** 构造最小可过类型的 Request，仅用于断言 applicantId 过滤 */
function makeReq(id: string, applicantId: string): Request {
	return {
		id,
		type: 'travel',
		applicantId,
		applicantName: 'x',
		department: '研发部',
		status: 'approved',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		audit: [],
		fields: {
			reason: 'r',
			urgency: 'normal',
			legs: [],
			budget: { transport: 0, hotel: 0, allowance: 0, other: 0 },
			budgetNote: ''
		}
	} as unknown as Request;
}

function mockFetchOnce(data: unknown, ok = true) {
	// 后端态下 http.ts 会拆统一信封 { code, data, msg }，故 mock 响应需封装
	vi.mocked(fetch).mockResolvedValueOnce({
		ok,
		status: ok ? 200 : 500,
		json: async () => ({ code: '200', msg: 'ok', data })
	} as Response);
}

/** 取上一次 fetch 调用的 pathname+search，便于断言请求路径 */
function lastUrl(): URL {
	return new URL(vi.mocked(fetch).mock.calls[0][0] as string, 'http://localhost');
}

describe('users.ts — 后端态（USE_BACKEND=true）', () => {
	let users: typeof import('$lib/data/users');
	let requests: typeof import('$lib/data/requests');

	beforeEach(async () => {
		vi.resetModules();
		vi.doMock('$env/static/public', () => ({
			PUBLIC_USE_BACKEND: 'true',
			PUBLIC_MOCK_BASE_URL: MOCK_BASE
		}));
		vi.stubGlobal('fetch', vi.fn());
		users = await import('$lib/data/users');
		requests = await import('$lib/data/requests');
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('listUsers() 打 GET /aws/v1/users 并返回后端列表', async () => {
		mockFetchOnce([{ ...USERS[0] }, { ...USERS[1] }]);
		const res = await users.listUsers();
		expect(res).toHaveLength(2);
		expect(lastUrl().pathname).toBe('/aws/v1/users');
		expect(lastUrl().search).toBe('');
	});

	it('listUsers({department,role}) 把筛选维度转发为查询参数', async () => {
		mockFetchOnce([{ ...USERS[0] }]);
		await users.listUsers({ department: '研发部', role: 'employee' });
		const url = lastUrl();
		expect(url.pathname).toBe('/aws/v1/users');
		expect(url.searchParams.get('department')).toBe('研发部');
		expect(url.searchParams.get('role')).toBe('employee');
	});

	it('listUsers() 后端失败时静默回退本地组织表', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('network'));
		const res = await users.listUsers();
		expect(res).toHaveLength(USERS.length);
	});

	it('fetchUser(id) 打 GET /aws/v1/users/:id', async () => {
		mockFetchOnce({ ...USERS[0] });
		const res = await users.fetchUser(USERS[0].id);
		expect(res?.id).toBe(USERS[0].id);
		expect(lastUrl().pathname).toBe(`/aws/v1/users/${USERS[0].id}`);
	});

	it('fetchUser(id) 后端失败时回退 findUser', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('network'));
		const res = await users.fetchUser(USERS[2].id);
		expect(res?.id).toBe(USERS[2].id);
	});

	it('fetchUserRequests(id) 兼容「数组」与「{list}」两种信封', async () => {
		const a = makeReq('R-A', USERS[0].id);
		const b = makeReq('R-B', USERS[0].id);
		mockFetchOnce([a, b]);
		expect(await users.fetchUserRequests(USERS[0].id)).toHaveLength(2);
		mockFetchOnce({ list: [a] });
		expect(await users.fetchUserRequests(USERS[0].id)).toHaveLength(1);
		expect(lastUrl().pathname).toBe(`/aws/v1/users/${USERS[0].id}/requests`);
	});

	it('fetchUserRequests(id) 后端失败时向外抛出（交由页面兜底 scope=mine）', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('network'));
		await expect(users.fetchUserRequests(USERS[0].id)).rejects.toThrow();
	});
});

describe('users.ts — Mock 态（USE_BACKEND=false）', () => {
	let users: typeof import('$lib/data/users');
	let requests: typeof import('$lib/data/requests');

	beforeEach(async () => {
		vi.resetModules();
		vi.doMock('$env/static/public', () => ({
			PUBLIC_USE_BACKEND: 'false',
			PUBLIC_MOCK_BASE_URL: MOCK_BASE
		}));
		users = await import('$lib/data/users');
		requests = await import('$lib/data/requests');
	});

	afterEach(() => {
		vi.resetModules();
	});

	it('listUsers() 不走网络，直接按本地 USERS 过滤', async () => {
		const all = await users.listUsers();
		expect(all).toHaveLength(USERS.length);
		const managers = await users.listUsers({ role: 'manager' });
		expect(managers).toHaveLength(1);
		expect(managers[0].role).toBe('manager');
	});

	it('fetchUser(id) 走本地 findUser，不打网络', async () => {
		const res = await users.fetchUser(USERS[3].id);
		expect(res?.id).toBe(USERS[3].id);
	});

	it('fetchUserRequests(id) 读 requestsStore 按 applicantId 过滤', async () => {
		const mine = makeReq('R-MINE', USERS[1].id);
		const other = makeReq('R-OTHER', USERS[2].id);
		requests.requestsStore.set([mine, other]);
		const res = await users.fetchUserRequests(USERS[1].id);
		expect(res).toHaveLength(1);
		expect(res[0].id).toBe('R-MINE');
	});
});
