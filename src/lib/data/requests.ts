import seed from './seed.json' with { type: 'json' };
import { PENDING_STATUSES, APPLICATION_TYPE_VALUES } from '$lib/domain/types';
import type {
	ApplicationType,
	AuditAction,
	Budget,
	Request,
	StatusFilter,
	TravelFields,
	User,
	UserId,
	RequestQuery,
	PolishResponse
} from '$lib/domain/types';
import { APPLICATION_TYPES, LEAVE_TYPE_OPTIONS } from '$lib/domain/applicationTypes';
import { budgetTotal, formatYuan } from '$lib/domain/money';
import { transition, actionRequiresComment } from '$lib/domain/workflow';
import type { TripLeg } from '$lib/domain/types';
import { writable, get } from 'svelte/store';
import { toLocalISO } from '$lib/format/date';
import { apiGet, apiPost, apiPut, apiDelete, USE_BACKEND } from '$lib/core/http';
export { USE_BACKEND };

// —— 联调说明（对照 backend/docs/API-ALIGNMENT.md §7）——
// 以下「写操作」对外暴露两套实现：
//   1) 同步本地函数（createRequest / createDraft / updateRequestFromDraft / deleteRequest）
//      为「本地兜底」实现，联调模式下已被异步集成函数取代，保留仅用于单测溯源（已停用）。
//   2) 异步集成函数（submitNewRequest / saveDraftRequest / resubmitRequest /
//      removeRequest / applyAction）为联调入口：USE_BACKEND 为真时调后端
//      `/aws/v1/<type>-requests` 及其 RPC 子路径，并把服务端返回值回写本地 store；
//      后端不可用或抛错时降级到同名的本地兜底函数，保证页面始终可用。
// 服务端统一信封 { code, data, msg }（成功 code:"200"）由 http.ts 自动拆包。

// 统一请求客户端（src/lib/core/http.ts）已持有联调开关 USE_BACKEND、base 解析、
// 请求/响应拦截与错误处理。此处不再重复实现，仅消费客户端返回的数组/分页包。

/**
 * 申请单数据源（演示用）。
 *
 * 数据获取策略（单一变化点，页面层不关心数据从哪来）：
 *
 * 1. 工作数据集 `requestsStore` 初始为「localStorage 缓存 → seed.json 兜底」。
 * 2. 应用启动（浏览器端 `loadRequests()`）尝试从云端 Mock 拉取
 *    `GET {PUBLIC_MOCK_BASE_URL}/api/requests`，**3 秒超时**。
 * 3. 成功：写入 localStorage 缓存，替换工作数据集。
 * 4. 超时 / 失败：回退到 localStorage 缓存，再不行用 seed.json。
 *
 * 接口契约为「类型可选」：`/api/requests` 不带 `type` 返回全部；带 `?type=leave`
 * 仅返回该类型。这是为了后续接入真后端时按类型分接口，前端统一 store + 客户端
 * `filterByType` 筛选的现状保持不变 —— 真后端只需支持「无 type = 全部」即可。
 *
 * 写操作（新建 / 流转）目前只落到 `requestsStore` + localStorage，不回写 Mock。
 * 注意返回的是引用共享的数组，调用方若需要不可变语义请自行浅拷贝。
 */
const STORAGE_KEY = 'travel-requests';

function readStorage(): Request[] | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as Request[]) : null;
		// 丢弃缓存里缺 `type` 的旧形状数据，避免污染新模型
		return parsed ? parsed.filter((r) => 'type' in r) : null;
	} catch {
		return null;
	}
}

function writeStorage(list: Request[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
	} catch {
		// 隐私模式 / 配额满：忽略，下次从远端或 seed 取
	}
}

/** 工作数据集：随加载结果变化，页面通过 store 订阅自动更新 */
export const requestsStore = writable<Request[]>(readStorage() ?? (seed as unknown as Request[]));

function byUpdatedDesc(a: Request, b: Request): number {
	return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * 按「首次提交时间」倒序（最新提交在前）。
 *
 * 草稿没有 `submittedAt`，用空串兜底沉到末尾，保证有实际提交记录的单据始终排在前面。
 * 列表（我的申请 / 待我审批）统一走此排序，让卡片以提交时间先后呈现。
 */
export function sortBySubmittedAtDesc(requests: readonly Request[]): Request[] {
	return [...requests].sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
}

/**
 * 启动加载 / 按类型刷新：`/api/requests`（不带 type 取全部；带 `?type=` 取单类型）。
 *
 * 统一 store 策略下，带 type 的调用会把远端返回**并入**现有数据集（按 id 去重），
 * 保留其它类型，避免「待我审批 / 报表全量」等跨类型视图被一次单类型请求清空；
 * 不带 type 的启动调用则整体替换（与缓存策略一致）。
 */

/**
 * 启动加载 / 按筛选刷新：`GET /aws/v1/requests`（联调）或 `GET /api/requests`（Mock）。
 *
 * 联调模式下，除 `type` 外的其余筛选维度（status / keyword / year / month /
 * applicantId / department / scope / sort）也随查询串下沉到后端，由服务端过滤；
 * 后端不可用或报错时降级到缓存 / seed，前端本地过滤（filterBy* / searchRequests）仍兜底，
 * 两层语义一致。Mock 模式只认 `type`（其余维度本地过滤）。
 *
 * `type` 存在时把结果**并入**统一 store（按 id 去重，保留其它类型）；
 * 不带 `type`（如 scope=mine / scope=todo）时整体替换 store。
 */
export async function loadRequests(
	type?: ApplicationType,
	extra?: Partial<RequestQuery>
): Promise<void> {
	// 联调模式走 /aws/v1/requests，否则沿用原 Mock 的 /api/requests
	const path = USE_BACKEND ? '/requests' : '/api/requests';

	// 组合查询参数：仅 USE_BACKEND 时把筛选维度下沉到后端；
	// Mock 模式只认 type（其余维度由前端本地过滤兜底）。
	const query: Record<string, string | number | undefined> = {};
	const merged: RequestQuery = { ...(type ? { type } : {}), ...extra };
	const hasType = Boolean(merged.type);
	if (USE_BACKEND) {
		if (hasType) query.type = merged.type;
		if (merged.status && merged.status !== 'all') query.status = merged.status;
		if (merged.keyword && merged.keyword.trim() !== '') query.keyword = merged.keyword.trim();
		if (merged.year && merged.year !== 'all') query.year = merged.year;
		if (merged.month && merged.month !== 'all') query.month = merged.month;
		if (merged.applicantId) query.applicantId = merged.applicantId;
		if (merged.department) query.department = merged.department;
		if (merged.scope && merged.scope !== 'all') query.scope = merged.scope;
		if (merged.sort) query.sort = merged.sort;
		if (merged.page) query.page = merged.page;
		if (merged.pageSize) query.pageSize = merged.pageSize;
	} else if (hasType) {
		query.type = merged.type;
	}

	try {
		// 客户端已处理 base / 鉴权头 / 信封拆包；这里兼容「数组」与「分页包」
		const payload = await apiGet<Request[] | { list: Request[] }>(path, query);
		const data = Array.isArray(payload) ? payload : payload.list;
		const sorted = [...data].sort(byUpdatedDesc);
		if (hasType) {
			// 按类型拉取：并入统一 store（按 id 去重），保留其它类型数据。
			requestsStore.update((list) => {
				const byId = new Map(list.map((r) => [r.id, r]));
				for (const r of sorted) byId.set(r.id, r);
				return [...byId.values()].sort(byUpdatedDesc);
			});
		} else {
			requestsStore.set(sorted);
		}
		writeStorage(get(requestsStore));
	} catch (error) {
		console.error('loadRequests failed', error instanceof Error ? error.message : '获取失败，请稍后重试');
		// 超时 / 网络 / 业务错误：降级到缓存 / seed，保证页面永远有数据
		requestsStore.set(readStorage() ?? (seed as unknown as Request[]));
	}
}

/**
 * 按 id 拉取单条详情（联调模式）。
 *
 * 详情页深链直访时，store 可能尚未含此单（列表未加载 / 该单不在当前 scope 下）。
 * USE_BACKEND 为真时依次尝试两个资源 `GET /aws/v1/<type>-requests>/<id>`，
 * 命中即写回统一 store（按 id 去重）并回传；两个都失败（不存在 / 无权限 / 后端未起）
 * 则降级到本地 store 查找（通常为 undefined，详情页据此走「未找到」分支）。
 * 非联调模式直接读本地 store，不联网。
 */
export async function loadRequestById(targetId: string): Promise<Request | undefined> {
	if (!USE_BACKEND) return getRequestById(targetId);

	for (const type of APPLICATION_TYPE_VALUES) {
		try {
			const fetched = await apiGet<Request>(`${resourcePath(type)}/${targetId}`);
			if (fetched) {
				// 按 id 去重写回 store：已存在则替换，否则置顶插入
				requestsStore.update((list) => {
					const exists = list.some((r) => r.id === fetched.id);
					const next = exists
						? list.map((r) => (r.id === fetched.id ? fetched : r))
						: [fetched, ...list];
					writeStorage(next);
					return next;
				});
				return fetched;
			}
		} catch {
			// 该类型下不存在（404 或后端未实现），尝试下一个类型
		}
	}
	return getRequestById(targetId);
}

/** 全部申请单（按更新时间倒序，与 Mock 响应约定一致） */
export function getAllRequests(): readonly Request[] {
	return get(requestsStore);
}

/** 按业务单号取单条；不存在返回 undefined（详情页据此走「未找到」分支） */
export function getRequestById(
	id: string,
	requests: readonly Request[] = get(requestsStore)
): Request | undefined {
	return requests.find((r) => r.id === id);
}

/**
 * 用流转后的新对象替换工作数据集里的旧记录，并同步 localStorage 缓存。
 *
 * 写操作只落本地（与 loadRequests 的缓存策略一致）：云端 Mock 是只读的，
 * 这里改了不会回写，刷新后若 Mock 优先加载会丢掉改动 —— 演示范围内可接受。
 */
export function updateRequest(updated: Request): void {
	requestsStore.update((list) => {
		const next = list.map((r) => (r.id === updated.id ? updated : r));
		writeStorage(next);
		return next;
	});
}

/**
 * 删除一张申请单。
 *
 * 仅草稿允许删除，调用方需先经 {@link isDeletable} 校验；与 updateRequest 一样只落本地
 * localStorage 缓存（云端 Mock 只读，删除不会回写远端）。删除后该 id 从工作数据集消失，
 * 列表/详情订阅会自动刷新。
 */
export function deleteRequest(id: string): void {
	requestsStore.update((list) => {
		const next = list.filter((r) => r.id !== id);
		writeStorage(next);
		return next;
	});
}

/** 某用户发起的全部申请（我的申请 / 待我审批都从这里再按角色筛） */
export function getRequestsByApplicant(
	applicantId: UserId,
	requests: readonly Request[] = get(requestsStore)
): Request[] {
	return requests.filter((r) => r.applicantId === applicantId);
}

/**
 * 按筛选维度过滤。
 *
 * - `'all'`：全部
 * - `'pending'`：审批中（pending_manager 或 pending_finance）
 * - 其余：精确匹配该状态
 */
export function filterByStatus(
	requests: readonly Request[],
	filter: StatusFilter | undefined
): Request[] {
	if (!filter || filter === 'all') return [...requests];
	if (filter === 'pending')
		return requests.filter((r) => PENDING_STATUSES.some((s) => r.status === s));
	return requests.filter((r) => r.status === filter);
}

/** 按申请类型过滤（列表/统计按业务线切分） */
export function filterByType(requests: readonly Request[], type: ApplicationType): Request[] {
	return requests.filter((r) => r.type === type);
}

/**
 * 按事由与目的地（行程任意一段的 from/to）模糊搜索。
 * 大小写不敏感，空串视为不过滤。非差旅类型（无 legs）仅匹配事由。
 */
export function searchRequests(requests: readonly Request[], keyword: string): Request[] {
	const kw = keyword.trim().toLowerCase();
	if (kw === '') return [...requests];

	return requests.filter((r) => {
		const fields = r.fields as Partial<TravelFields>;
		const inReason = String(fields.reason ?? '')
			.toLowerCase()
			.includes(kw);
		const legs = (fields.legs ?? []) as TripLeg[];
		const inLeg = legs.some(
			(leg) => leg.from.toLowerCase().includes(kw) || leg.to.toLowerCase().includes(kw)
		);
		return inReason || inLeg;
	});
}

/**
 * 按申请创建时间的年/月过滤。
 *
 * 两个维度独立：年份或月份为 `'all'` 表示该维度不限制。
 * 用 UTC 解析，与 seed 生成（Date.UTC）保持一致，避免时区导致跨月错位。
 */
export function filterByDate(
	requests: readonly Request[],
	year: number | 'all',
	month: number | 'all'
): Request[] {
	return requests.filter((r) => {
		const d = new Date(r.createdAt);
		if (year !== 'all' && d.getUTCFullYear() !== year) return false;
		if (month !== 'all' && d.getUTCMonth() + 1 !== month) return false;
		return true;
	});
}

/** 数据里出现过的年份（倒序），用于年份下拉框的可选项 */
export function distinctYears(requests: readonly Request[]): number[] {
	const years = new Set<number>();
	for (const r of requests) years.add(new Date(r.createdAt).getUTCFullYear());
	return [...years].sort((a, b) => b - a);
}

/** 行程摘要，形如「北京 → 上海 → 广州」（差旅专用；空行程返回「无行程」） */
export function summarizeLegs(request: Request): string {
	const legs = (request.fields as Partial<TravelFields>).legs as TripLeg[] | undefined;
	if (!legs || legs.length === 0) return '无行程';
	const stops = legs.flatMap((leg) => [leg.from, leg.to]);
	return [...new Set(stops)].join(' → ');
}

/** 预算合计（分） */
export function requestTotal(request: Request): number {
	const budget = (request.fields as Partial<TravelFields>).budget as Budget | undefined;
	return budget ? budgetTotal(budget) : 0;
}

/**
 * 卡片副标题：随申请类型给出一行摘要。
 * 差旅=行程城市链；请假=请假类型 + 日期区间。取代原本写死差旅的 summarizeLegs，
 * 让列表 / 审批卡片对新增类型也能给出有意义的描述。
 */
export function requestSummary(request: Request): string {
	if (request.type === 'leave') {
		const f = request.fields as Record<string, unknown>;
		const start = f.leaveStart as string | undefined;
		const end = f.leaveEnd as string | undefined;
		const type = f.leaveType as string | undefined;
		const typeLabel = type ? (LEAVE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type) : '';
		const range = [start, end].filter(Boolean).join(' ~ ');
		return [typeLabel, range].filter(Boolean).join(' · ') || '请假申请';
	}
	return summarizeLegs(request);
}

/**
 * 卡片底部指标：差旅=预算合计（元），请假=请假天数。
 * 返回 { label, value } 由卡片直接渲染，避免卡片内部再按类型分支。
 */
export function requestMetric(request: Request): { label: string; value: string } {
	if (request.type === 'leave') {
		const f = request.fields as Record<string, unknown>;
		const start = f.leaveStart as string | undefined;
		const end = f.leaveEnd as string | undefined;
		const days =
			start && end
				? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1)
				: 0;
		return { label: '请假天数', value: `${days} 天` };
	}
	return { label: '预算合计', value: `¥${formatYuan(requestTotal(request))}` };
}

/** 由现有单号（如 TR-#### / LV-####）推算下一个，保证新单号唯一且连续 */
export function nextRequestId(
	type: ApplicationType,
	requests: readonly Request[] = get(requestsStore)
): string {
	const prefix = APPLICATION_TYPES[type].idPrefix;
	let max = 0;
	for (const r of requests) {
		if (!r.id.startsWith(`${prefix}-`)) continue;
		const n = Number(r.id.slice(prefix.length + 1));
		if (Number.isFinite(n) && n > max) max = n;
	}
	return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

function buildBase(
	type: ApplicationType,
	fields: Record<string, unknown>,
	applicant: User
): Request {
	const now = toLocalISO();
	return {
		id: nextRequestId(type),
		type,
		applicantId: applicant.id,
		applicantName: applicant.name,
		department: applicant.department,
		status: 'draft',
		createdAt: now,
		updatedAt: now,
		audit: [],
		fields
	};
}

/**
 * [已停用·本地兜底] 由向导整单表单数据新建申请并直接提交（draft → pending_manager）。
 *
 * 联调模式下由 {@link submitNewRequest} 取代；此处保留仅用于单测溯源。
 * 内部走 workflow 的 submit 流转，自动追加首条 audit（记录提交人与提交时间）。
 */
export function createRequest(
	type: ApplicationType,
	fields: Record<string, unknown>,
	applicant: User
): Request {
	const base = buildBase(type, fields, applicant);
	const result = transition({ request: base, action: 'submit', actor: applicant });
	if (!result.ok) throw new Error(result.message);
	return result.request;
}

/**
 * [已停用·本地兜底] 由向导整单表单数据新建一条「草稿」申请，不提交。
 *
 * 联调模式下由 {@link saveDraftRequest} 取代；此处保留仅用于单测溯源。
 * 草稿不要求字段齐全，直接落当前填写内容；无审计、无提交时间，状态停 `draft`。
 */
export function createDraft(
	type: ApplicationType,
	fields: Record<string, unknown>,
	applicant: User
): Request {
	return buildBase(type, fields, applicant);
}

/** 把新单插入工作数据集（置顶）并同步 localStorage 缓存 */
export function addRequest(request: Request): void {
	requestsStore.update((list) => {
		const next = [request, ...list];
		writeStorage(next);
		return next;
	});
}

/**
 * [已停用·本地兜底] 重新编辑后提交：在原有申请上套用新表单数据并走 submit 流转。
 *
 * 联调模式下由 {@link resubmitRequest} 取代；此处保留仅用于单测溯源。
 * 与 {@link createRequest} 的区别是**不生成新的编号** —— 保留原单号、申请人、
 * 创建时间、审计轨迹，只更新用户填写部分并追加一条新的提交审计。
 */
export function updateRequestFromDraft(
	id: string,
	type: ApplicationType,
	fields: Record<string, unknown>,
	actor: User
): Request {
	const existing = getRequestById(id);
	if (!existing) throw new Error('申请不存在');
	const now = new Date().toISOString();
	const updated: Request = {
		...existing,
		type,
		fields,
		updatedAt: now
	};
	const result = transition({ request: updated, action: 'submit', actor });
	if (!result.ok) throw new Error(result.message);
	updateRequest(result.request);
	return result.request;
}

// ============ 联调集成层（异步；USE_BACKEND 时调后端，失败降级本地兜底）============
//
// 以下函数是对外（页面/组件）的「写操作」唯一入口。统一职责：
// 1. 拼 `/aws/v1/<type>-requests` 资源路径与 RPC 子路径（submit/approve/reject/cancel/reedit）；
// 2. 调 http.ts（自动带 Bearer、拆 {code,data,msg} 信封、成功 code:"200"）；
// 3. 用服务端返回值回写本地 store（addRequest/updateRequest/deleteRequest），保证 UI 即时一致；
// 4. 后端不可用或抛错时降级到上方「已停用·本地兜底」同步函数，页面始终可用。

/** 资源路径：`/<type>-requests`（type 即 travel / leave） */
function resourcePath(type: ApplicationType): string {
	return `/${type}-requests`;
}

/**
 * 新建并提交一张申请（联调入口，取代 {@link createRequest}）。
 * 后端：POST /<type>-requests { fields } 拿到服务端单号 → POST /<type>-requests/:id/submit。
 * 失败降级到本地 createRequest + addRequest。
 */
export async function submitNewRequest(
	type: ApplicationType,
	fields: Record<string, unknown>,
	applicant: User
): Promise<Request> {
	if (USE_BACKEND) {
		try {
			const created = await apiPost<Request>(resourcePath(type), { fields });
			const submitted = await apiPost<Request>(`${resourcePath(type)}/${created.id}/submit`, {});
			addRequest(submitted);
			return submitted;
		} catch (error) {
			console.error('提交申请失败，原始错误:', error);
			throw error;
			// 降级：后端不可用时走本地兜底
		}
	}
	const local = createRequest(type, fields, applicant);
	addRequest(local);
	return local;
}

/**
 * 仅存草稿（联调入口，取代 {@link createDraft}）。
 * 后端：POST /<type>-requests { fields }。失败降级到本地 createDraft + addRequest。
 */
export async function saveDraftRequest(
	type: ApplicationType,
	fields: Record<string, unknown>,
	applicant: User
): Promise<Request> {
	if (USE_BACKEND) {
		try {
			const created = await apiPost<Request>(resourcePath(type), { fields });
			addRequest(created);
			return created;
		} catch {
			// 降级
		}
	}
	const local = createDraft(type, fields, applicant);
	addRequest(local);
	return local;
}

/**
 * 一键AI润色
 * @param type 
 * @param content 
 * @returns 
 */
export async function polishText({type, content}: {type: ApplicationType, content: string}): Promise<PolishResponse> {
	if (USE_BACKEND) {
		try {
			const polished = await apiPost<PolishResponse>(`/ai/polish`, { type, content });
			return polished;
		} catch {
			// 降级：返回原始内容
			return { success: false, polished: content };
		}
	}
	return { success: false, polished: content };
}

/**
 * 编辑后重新提交（联调入口，取代 {@link updateRequestFromDraft}）。
 * 后端：PUT /<type>-requests/:id { fields } → POST /<type>-requests/:id/submit。
 * 失败降级到本地 updateRequestFromDraft。
 */
export async function resubmitRequest(
	id: string,
	type: ApplicationType,
	fields: Record<string, unknown>,
	actor: User
): Promise<Request> {
	if (USE_BACKEND) {
		try {
			await apiPut(`${resourcePath(type)}/${id}`, { fields });
			const submitted = await apiPost<Request>(`${resourcePath(type)}/${id}/submit`, {});
			updateRequest(submitted);
			return submitted;
		} catch {
			// 降级
		}
	}
	return updateRequestFromDraft(id, type, fields, actor);
}

/**
 * 删除申请（联调入口）。
 * 后端：DELETE /<type>-requests/:id；无论后端成败，本地 store 始终移除，保证 UI 一致。
 */
export async function removeRequest(id: string): Promise<void> {
	const r = getRequestById(id);
	const type = r?.type ?? 'travel';
	if (USE_BACKEND) {
		try {
			await apiDelete(`${resourcePath(type)}/${id}`);
		} catch {
			// 后端删除失败也继续本地移除，避免脏数据
		}
	}
	deleteRequest(id);
}

/**
 * 执行一次状态流转（联调入口，取代 UI 里直接调 workflow.transition 的写法）。
 * 后端：POST /<type>-requests/:id/<action> { comment? }，用返回值回写 store。
 * 失败或后端不可用时降级到本地 transition + updateRequest。
 */
export async function applyAction(
	request: Request,
	action: AuditAction,
	actor: User,
	comment?: string
): Promise<Request> {
	if (USE_BACKEND) {
		try {
			const body = actionRequiresComment(action) ? { comment } : {};
			const updated = await apiPost<Request>(
				`${resourcePath(request.type)}/${request.id}/${action}`,
				body
			);
			updateRequest(updated);
			return updated;
		} catch {
			// 降级
		}
	}
	const result = transition({ request, action, actor, comment });
	if (!result.ok) throw new Error(result.message);
	updateRequest(result.request);
	return result.request;
}

/**
 * 批量状态流转（联调入口，取代审批页逐条 `applyAction` 的写法）。
 * 后端：`POST /aws/v1/requests/batch` `{ action: approve|reject|cancel, ids: string[], comment? }`。
 * 成功返回后以服务端为准重新拉取列表（回写本地 store，含其它类型）；
 * 后端不可用或抛错时降级到本地逐条 `transition`，保证页面始终可用。
 *
 * 仅受理 approve / reject / cancel（与契约 `BatchActionDto` 一致；submit / reedit 不在批量范围内）。
 */
export async function batchAction(
	action: Exclude<AuditAction, 'submit' | 'reedit'>,
	ids: string[],
	actor: User,
	comment?: string
): Promise<void> {
	if (ids.length === 0) return;
	if (USE_BACKEND) {
		try {
			await apiPost('/requests/batch', { action, ids, comment });
			// 以服务端为权威刷新工作数据集，列表 / 待办随订阅自动更新
			await loadRequests();
			return;
		} catch {
			// 降级：后端不可用时走本地状态机
		}
	}
	for (const id of ids) {
		const req = getRequestById(id);
		if (!req) continue;
		const result = transition({ request: req, action, actor, comment });
		if (result.ok) updateRequest(result.request);
	}
}
