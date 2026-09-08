import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAllRequests, getRequestById, loadRequests, requestsStore } from '$lib/data/requests';
import type { Request } from '$lib/domain/types';
import seed from '$lib/data/seed.json' with { type: 'json' };

// loadRequests 是全仓唯一的异步/网络逻辑，此前零测试。这里 mock 掉 `fetch` 与
// `PUBLIC_MOCK_BASE_URL`，把三条降级路径（成功 / !res.ok / 网络错误 / 无 base）逐一覆盖。
// 注意：USE_BACKEND 由 PUBLIC_USE_BACKEND 驱动，这里固定为 'true' 以保留原「联调态」
// 的信封拆包行为（mock 的响应是 {code,msg,data} 信封），聚焦验证 loadRequests 的
// 拉取 / 降级 / 并入 store 逻辑本身。
vi.mock('$env/static/public', () => ({
	PUBLIC_MOCK_BASE_URL: 'https://mock.test',
	PUBLIC_USE_BACKEND: 'true'
}));

const SEED = seed as unknown as Request[];

function remoteData(): Request[] {
	return [
		{
			id: 'TR-REMOTE-A',
			type: 'travel',
			applicantId: 'u-1',
			applicantName: '甲',
			department: '部门',
			status: 'draft',
			createdAt: '2026-01-01T00:00:00.000Z',
			// 较早
			updatedAt: '2026-01-01T00:00:00.000Z',
			audit: [],
			fields: {
				reason: '远端A',
				urgency: 'normal',
				legs: [],
				budget: { transport: 0, hotel: 0, allowance: 0, other: 0 },
				budgetNote: ''
			}
		},
		{
			id: 'TR-REMOTE-B',
			type: 'travel',
			applicantId: 'u-1',
			applicantName: '甲',
			department: '部门',
			status: 'draft',
			createdAt: '2026-06-01T00:00:00.000Z',
			// 较晚
			updatedAt: '2026-06-01T00:00:00.000Z',
			audit: [],
			fields: {
				reason: '远端B',
				urgency: 'normal',
				legs: [],
				budget: { transport: 0, hotel: 0, allowance: 0, other: 0 },
				budgetNote: ''
			}
		}
	];
}

beforeEach(() => {
	requestsStore.set([]);
	localStorage.clear();
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('loadRequests', () => {
	it('云端成功：写入工作数据集并按更新时间倒序', async () => {
		const data = remoteData();
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ code: '200', msg: 'ok', data })
		} as Response);

		await loadRequests();

		const list = getAllRequests();
		expect(list).toHaveLength(2);
		// 倒序：较晚的 B 在前
		expect(list[0].id).toBe('TR-REMOTE-B');
		expect(list[1].id).toBe('TR-REMOTE-A');
	});

	it('云端返回非 2xx：降级到 seed，不写入远端数据', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 500,
			json: async () => []
		} as Response);

		await loadRequests();

		expect(getAllRequests().length).toBe(SEED.length);
		expect(getRequestById('TR-REMOTE-A')).toBeUndefined();
	});

	it('网络/超时错误：同样降级到 seed', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('network'));

		await loadRequests();

		expect(getAllRequests().length).toBe(SEED.length);
		expect(getRequestById('TR-REMOTE-A')).toBeUndefined();
	});

	it('带 type 时请求带 ?type= 查询参数，并把结果并入统一 store（保留其它类型）', async () => {
		// 先放一条存量（模拟 store 里已有其它类型数据）
		requestsStore.set([
			{
				id: 'LV-EXISTING',
				type: 'leave',
				applicantId: 'u-1',
				applicantName: '甲',
				department: '部门',
				status: 'approved',
				createdAt: '2026-02-01T00:00:00.000Z',
				updatedAt: '2026-02-01T00:00:00.000Z',
				audit: [],
				fields: {
					leaveType: 'annual',
					leaveStart: '2026-02-02',
					leaveEnd: '2026-02-03',
					reason: '存量'
				}
			} as unknown as Request
		]);

		const data = remoteData(); // 两条 travel
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ code: '200', msg: 'ok', data })
		} as Response);

		await loadRequests('travel');

		// URL 带 ?type=travel
		const calledUrl = new URL(vi.mocked(fetch).mock.calls[0][0] as string, 'http://localhost');
		expect(calledUrl.searchParams.get('type')).toBe('travel');

		const list = getAllRequests();
		// 并入而非替换：存量 leave 仍在，travel 也已写入
		expect(list.find((r) => r.id === 'LV-EXISTING')).toBeDefined();
		expect(list.find((r) => r.id === 'TR-REMOTE-A')).toBeDefined();
	});

	it('不带 type 时整体替换 store（启动加载语义）', async () => {
		requestsStore.set([{ id: 'STALE' } as unknown as Request]);

		const data = remoteData();
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ code: '200', msg: 'ok', data })
		} as Response);

		await loadRequests();

		const calledUrl = new URL(vi.mocked(fetch).mock.calls[0][0] as string, 'http://localhost');
		expect(calledUrl.search).toBe('');
		expect(getAllRequests().find((r) => r.id === 'STALE')).toBeUndefined();
		expect(getAllRequests()).toHaveLength(2);
	});
});
