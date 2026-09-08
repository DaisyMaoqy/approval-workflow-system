<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { Role } from '$lib/domain/types';
	import favicon from '$lib/assets/favicon.svg';
	import IdentitySwitcher from '$lib/components/layout/IdentitySwitcher.svelte';
	import SideNav from '$lib/components/layout/SideNav.svelte';
	import { pageTitle } from '$lib/format';
	import { provideIdentity } from '$lib/state/identity.svelte';
	import { provideApplicationType } from '$lib/state/applicationType.svelte';
	import { provideAuth } from '$lib/state/auth.svelte';
	import { loadRequests } from '$lib/data/requests';

	let { children } = $props();

	// 申请详情（/requests/[id]）为只读视角，隐藏角色切换开关，避免误切身份
	const showSwitch = $derived(!page.url.pathname.startsWith('/requests/'));

	// 统计报表页面仅主管可见，员工与财务均不可切换
	const disabledRoles = $derived.by<Role[]>(() => {
		const path = page.url.pathname;
		if (path === '/reports') return ['employee', 'finance'];
		if (path === '/approvals') return ['employee'];
		return [];
	});

	// 在根部提供一次，整棵树通过 useIdentity() 读取
	const identity = provideIdentity();
	// 申请类型（差旅/请假…）同样在根部提供，整棵树通过 useApplicationType() 读取；
	// 持久化到 localStorage，只有侧栏「切换申请类型」下拉会改它，导航点击不改
	provideApplicationType();
	// 登录态（Qy_token）：整棵树通过 useAuth() 读取，供后续请求携带鉴权头
	const auth = provideAuth();

	// 登录页使用独立布局，不渲染侧栏 / 角色切换
	const isLogin = $derived(page.url.pathname === '/login');

	// 浏览器端启动：拉取 Mock 数据；已登录则刷新当前登录人（GET /aws/v1/users/me）
	onMount(() => {
		void loadRequests();
		if (auth.isAuthenticated) void identity.loadCurrentUser().catch(() => {});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- 网站图标 -->
	<!-- 兜底标题：各页面用 <svelte:head><title> 覆盖，后出现的生效 -->
	<title>{pageTitle()}</title>
</svelte:head>

<!-- 登录页：独立布局，不带侧栏 / 角色切换 -->
{#if isLogin}
	<main class="login-page">
		{@render children()}
	</main>
{:else}
	<!-- 跳过导航：键盘用户不必逐个 Tab 过侧栏才能到达正文 -->
	<a href="#main" class="app-layout__skip-link">跳到主要内容</a>

	<div class="app-layout">
		<aside class="app-layout__sidebar">
			<div class="app-layout__sidebar-inner">
				<SideNav />
			</div>
		</aside>

		<div class="app-layout__main-col">
			<header class="app-layout__header">
				<IdentitySwitcher {showSwitch} {disabledRoles} />
			</header>

			<main id="main" class="app-layout__main">
				{@render children()}
			</main>
		</div>
	</div>
{/if}
