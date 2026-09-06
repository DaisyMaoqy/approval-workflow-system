import { get } from 'svelte/store';
import type { Request, Role, User, UserId } from '$lib/domain/types';
import { USERS, findUser } from '$lib/domain/org';
import { getRequestsByApplicant, requestsStore } from '$lib/data/requests';
import { apiGet, USE_BACKEND } from '$lib/core/http';

/**
 * 用户 / 组织相关接口集成层（联调端点 #1–#3）。
 *
 * 与 `requests.ts` 集成函数、`identity.svelte.ts` 的 `loadCurrentUser` 同构：
 * `USE_BACKEND` 为真时调后端 `/aws/v1/users*`，失败（端点未实现 / 网络错误）
 * 静默回退到本地 `org.ts` / `requestsStore`，保证页面始终有数据。
 *
 * 接入现状：
 * - #3 `fetchUserRequests` 已接到「我的申请」页（取代 `GET /requests?scope=mine`，
 *   scope=mine 仍作兼容兜底）。
 * - #1 `listUsers` / #2 `fetchUser` 作为可调用能力预留，待组织 / 部门筛选 UI 按需使用。
 */

/** 本地按部门 / 角色过滤（兜底与 Mock 态共用） */
function filterLocalUsers(opts?: { department?: string; role?: Role }): User[] {
	return USERS.filter(
		(u) =>
			(!opts?.department || u.department === opts.department) &&
			(!opts?.role || u.role === opts.role)
	);
}

/** #1 `GET /users` —— 用户 / 组织列表，支持按部门 / 角色过滤。 */
export async function listUsers(opts?: { department?: string; role?: Role }): Promise<User[]> {
	if (!USE_BACKEND) return filterLocalUsers(opts);
	try {
		const query: Record<string, string | undefined> = {};
		if (opts?.department) query.department = opts.department;
		if (opts?.role) query.role = opts.role;
		return await apiGet<User[]>('/users', query);
	} catch {
		// 端点未实现 / 出错：回退本地组织表
		return filterLocalUsers(opts);
	}
}

/** #2 `GET /users/:id` —— 用户详情（含 managerId）。 */
export async function fetchUser(id: UserId): Promise<User | undefined> {
	if (!USE_BACKEND) return findUser(id);
	try {
		return await apiGet<User>(`/users/${id}`);
	} catch {
		return findUser(id);
	}
}

/**
 * #3 `GET /users/:id/requests` —— 某用户发起的全部申请。
 *
 * 「我的申请」页在后端态下以此端点取代 `GET /requests?scope=mine`（scope=mine 作为兼容
 * 兜底，见 `requests/+page.svelte`）。本地态直接读 `requestsStore` 按 `applicantId`
 * 过滤，与 `getRequestsByApplicant` 等价。
 *
 * 该端点返回用户「全部」申请（契约未含 status/year/month/keyword 等维度），
 * 这些维度由页面本地 filterBy* 层叠加过滤，与本地态行为一致。
 */
export async function fetchUserRequests(id: UserId): Promise<Request[]> {
	if (!USE_BACKEND) return getRequestsByApplicant(id, get(requestsStore));
	// 后端态：调用 /users/:id/requests；失败时向外抛出，由「我的申请」页兜底到 scope=mine。
	const payload = await apiGet<Request[] | { list: Request[] }>(`/users/${id}/requests`);
	return Array.isArray(payload) ? payload : payload.list;
}
