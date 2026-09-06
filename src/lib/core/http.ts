import { PUBLIC_MOCK_BASE_URL, PUBLIC_USE_BACKEND } from '$env/static/public';

/**
 * 统一请求客户端：请求拦截 + 响应拦截 + 错误处理。
 *
 * - 请求拦截：拼接 base（Mock / 后端 /aws/v1）、附加 `Content-Type` 与
 *   `Authorization: Bearer <Qy_token>`（token 取自已持久化的 `Qy_token`）。
 * - 响应拦截：联调模式下拆统一信封 `{ code, data, msg }`，仅返回 `data`；
 *   非 `0` 视为业务错误并抛出 {@link ApiError}。
 * - 错误处理：网络/超时、HTTP 非 2xx（401 清 token 并跳登录）、业务码非 0，
 *   统一抛 {@link ApiError}，调用方按 `status`/`code` 精细处理。
 *
 * `USE_BACKEND` 由环境变量 `PUBLIC_USE_BACKEND`（`'true'` 即开）驱动，见下方常量；
 * 与下方 base 解析同源。开启时拆统一信封 `{ code, data, msg }`，关闭（Mock 态）原样返回。
 */

const TOKEN_KEY = 'Qy_token';

/**
 * 数据开关：false=沿用 Apifox Mock（仅 `/api/requests`，绝不拼 `/aws/v1`）；
 * true=后端 `/aws/v1`。由环境变量 `PUBLIC_USE_BACKEND` 决定（`'true'` 即开），
 * 见 `.env` / `.env.example`。无需改代码即可在「联调后端」与「Mock 演示」间切换。
 */
export const USE_BACKEND = PUBLIC_USE_BACKEND === 'true';
const BACKEND_BASE = '/aws/v1';
const MOCK_BASE = PUBLIC_MOCK_BASE_URL;

// 全局跳转控制
let isRedirecting = false;

/** 统一错误类型，便于调用方区分网络 / HTTP / 业务错误 */
export class ApiError extends Error {
	readonly status: number; // HTTP 状态；网络/超时错误为 0
	readonly code: string; // 业务码；网络错误为 'NETWORK' / 超时为 'TIMEOUT'
	readonly raw?: unknown;

	constructor(msg: string, status = 0, code = 'NETWORK', raw?: unknown) {
		super(msg);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.raw = raw;
	}
}

function getToken(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(TOKEN_KEY);
}

function buildUrl(
	path: string,
	query?: Record<string, string | number | undefined>
): string {
	let url: string;
	if (USE_BACKEND) {
		// 后端模式：path 以 / 开头，统一拼到 /aws/v1 下
		url = `${BACKEND_BASE}${path}`;
	} else {
		const base = (MOCK_BASE ?? '').replace(/\/$/, '');
		url = `${base}${path}`;
	}
	if (query) {
		const qs = Object.entries(query)
			.filter(([, v]) => v !== undefined && v !== '')
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
			.join('&');
		if (qs) url += `?${qs}`;
	}
	return url;
}

function handleUnauthorized(): void {
	if (isRedirecting) {
		console.warn('正在跳转中，忽略重复 401');
		return;
	}
		
	// 如果已在登录页，直接抛出错误，不触发跳转
	if (typeof location !== 'undefined' && location.pathname.includes('/login')) {
		console.warn('已在登录页，不重复跳转');
		throw new ApiError('登录已过期，请重新登录', 0, 'LOGINOUT');
	}
	
	isRedirecting = true;
	console.warn('执行 401 跳转');
	// 清除登录态并跳登录页
	// if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY);
	// if (typeof location !== 'undefined') location.href = '/login';
	
	localStorage.removeItem(TOKEN_KEY);
	location.href = '/login';
	// 延迟重置标志
	setTimeout(() => {
		isRedirecting = false;
	}, 2000);
}

export interface ApiRequestOptions {
	query?: Record<string, string | number | undefined>;
	body?: unknown;
	timeoutMs?: number;
	/** 跳过 401 自动跳转（如登录请求自身） */
	suppressUnauthorizedRedirect?: boolean;
}

async function apiRequest<T>(
	method: string,
	path: string,
	opts: ApiRequestOptions = {}
): Promise<T> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const token = getToken();
	if (token) headers['Authorization'] = `Bearer ${token}`;

	const controller = new AbortController();
	const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;

	try {
		// 请求拦截：base + 头 + body 统一在此完成
		const res = await fetch(buildUrl(path, opts.query), {
			method,
			headers,
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
			signal: controller.signal
		});

		// 响应拦截：HTTP 层错误
		if (!res.ok) {
			
			if (res.status === 401 && !opts.suppressUnauthorizedRedirect) handleUnauthorized();
			let detail = '';
			try {
				detail = (await res.json())?.msg ?? '';
			} catch {
				/* 响应体非 JSON，忽略 */
			}
			throw new ApiError(detail || `请求失败（${res.status}）`, res.status, String(res.status));
		}

		const json = (await res.json().catch(() => null)) as unknown;

		// 响应拦截：联调模式拆统一信封 { code, data, msg }
		if (USE_BACKEND && json && typeof json === 'object') {
			const env = json as { code?: unknown; msg?: string; data?: T };
			if (env.code === '401') {
				handleUnauthorized()
				throw new ApiError('登录失效', 0, 'LOGINOUT');
			} else if (env.code !== '200') {
				throw new ApiError(
					env.msg || '业务处理失败',
					res.status,
					String(env.code ?? 'BIZ'),
					json
				);
			}
			return env.data as T;
		}

		// Mock / 非信封：原样返回
		return json as T;
	} catch (err) {
		if (err instanceof ApiError) throw err;
		if (err instanceof DOMException && err.name === 'AbortError') {
			throw new ApiError('请求超时', 0, 'TIMEOUT');
		}
		throw new ApiError(err instanceof Error ? err.message : '网络错误', 0, 'NETWORK');
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/** GET；query 透传为查询串 */
export function apiGet<T>(
	path: string,
	query?: Record<string, string | number | undefined>,
	opts?: ApiRequestOptions
): Promise<T> {
	return apiRequest<T>('GET', path, { ...opts, query });
}

/** POST；body 自动 JSON 序列化 */
export function apiPost<T>(path: string, body?: unknown, opts?: ApiRequestOptions): Promise<T> {
	return apiRequest<T>('POST', path, { ...opts, body });
}

/** PUT */
export function apiPut<T>(path: string, body?: unknown, opts?: ApiRequestOptions): Promise<T> {
	return apiRequest<T>('PUT', path, { ...opts, body });
}

/** PATCH */
export function apiPatch<T>(path: string, body?: unknown, opts?: ApiRequestOptions): Promise<T> {
	return apiRequest<T>('PATCH', path, { ...opts, body });
}

/** DELETE */
export function apiDelete<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
	return apiRequest<T>('DELETE', path, opts);
}
