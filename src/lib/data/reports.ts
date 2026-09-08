import { apiGet, USE_BACKEND } from '$lib/core/http';
import type { ApplicationType } from '$lib/domain/types';
import type { BackendDashboard } from '$lib/domain/dashboard';

/**
 * 统计看板数据层。
 *
 * 与 `requests.ts` 的集成函数同构：后端就绪（`USE_BACKEND`）即走
 * `GET /aws/v1/reports/dashboard`，失败或本地模式返回 `null`，
 * 调用方据此回退到客户端聚合（见 `ManagerDashboard`）。
 *
 * 后端仅支持 `type` / `year` / `month` / `department` 四个维度，
 * 不支持状态/请假类型/自定义日期区间等前端本地筛选，故这些维度仍由前端本地承担。
 */
export interface DashboardQuery {
	type?: ApplicationType | 'all';
	year?: number;
	month?: number;
	department?: string;
}

export async function loadDashboard(query: DashboardQuery = {}): Promise<BackendDashboard | null> {
	if (!USE_BACKEND) return null;
	try {
		const q: Record<string, string | number | undefined> = {};
		if (query.type && query.type !== 'all') q.type = query.type;
		if (query.year) q.year = query.year;
		if (query.month) q.month = query.month;
		if (query.department) q.department = query.department;
		const res = await apiGet<BackendDashboard>('/reports/dashboard', q);
		return res ?? null;
	} catch {
		// 后端不可用（未实现 Controller / 网络错误）：静默回退本地聚合
		return null;
	}
}
