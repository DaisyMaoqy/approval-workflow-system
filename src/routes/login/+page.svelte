<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Role, User } from '$lib/domain/types';
	import { HOME } from '$lib/core/routes';
	import { apiPost, ApiError } from '$lib/core/http';
	import { useIdentity } from '$lib/state/identity.svelte';
	import { useAuth } from '$lib/state/auth.svelte';
	import LoginCard from '$lib/components/common/LoginCard.svelte';

	const identity = useIdentity();
	const auth = useAuth();

	let tenantId = $state('tenant_001');

	interface LoginUser {
		id: string;
		name: string;
		role: string;
		// title: string;
		department: string;
		managerId: string | null;
	}

	async function handleSubmit({
		username,
		password
	}: {
		username: string;
		password: string;
	}): Promise<void> {
		// error = '';

		try {
			// [占位] 真实登录逻辑请复用另一前端项目的企业 SSO 实现；
			// 下方为联调骨架：调用后端 POST /aws/v1/auth/login。

			const res = await apiPost('/auth/login', {
				userId: username,
				password,
				tenantId
			});
			if (!res) {
				// 后端约定：非 2xx 视为登录失败
				throw new Error('登录失败，请检查账号');
			}
			// http.ts 已拆统一信封，res 即 data；后端签发的令牌字段为 Qy_token（兼容 token）。
			const data = res as unknown as { Qy_token?: string; token?: string; user?: LoginUser };
			const token = data.Qy_token ?? data.token;
			if (!token) throw new Error('登录失败：未返回令牌');

			// 保存 Qy_token，供后续请求以 Authorization: Bearer <Qy_token> 携带
			auth.setToken(token);

			// 联调：以令牌拉取当前登录人（GET /aws/v1/users/me）。
			// 后端就绪即返回真实 id/name/department/managerId/role，覆盖演示身份；
			// 若后端尚未实现该接口（或网络失败），回退到登录响应里的 user 字段。
			const me = await identity.loadCurrentUser();
			if (!me && data.user) {
				identity.saveUserInfo(data.user as User);
				identity.switchTo(data.user.role as Role);
			}

			goto(HOME);
		} catch (err) {
			// 处理登录错误并传给LoginCard
			throw new Error(err instanceof ApiError ? err.message : '登录失败', { cause: err });
		}
	}
</script>

<svelte:head>
	<title>登录 · 审批工作流</title>
</svelte:head>

<LoginCard onLogin={handleSubmit} title="OA审批工作台" subtitle="欢迎登录企业协同办公系统" />