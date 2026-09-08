<script lang="ts">
	// —— 登录卡片组件（深色玻璃拟态整页）——
	// 样式集中定义于 src/lib/styles/components.css 的 .login-page / .login-card 块，
	// 按「页面级样式语义化」约定收口，令牌（brand / brand-2 / ink）见 tokens.css。
	interface Credentials {
		username: string;
		password: string;
		remember: boolean;
		onLogin?: () => void;
	}

	let {
		onLogin,
		title = 'OA 工作台',
		subtitle = '欢迎登录企业协同办公系统'
	}: {
		/** 真实登录逻辑；不传则走 1.2s 演示等待 */
		onLogin?: (creds: Credentials) => Promise<void> | void;
		title?: string;
		subtitle?: string;
	} = $props();
	// interface Props {
	// 	onLogin?: () => void;
	// 	title?: string;
	// 	subtitle?: string;
	// }

	// —— 表单状态（Svelte 5 runes）——
	let username = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let remember = $state(true);
	let loading = $state(false);
	let error = $state('');

	const canSubmit = $derived(username.trim().length > 0 && password.length > 0);

	async function handleLogin(event: SubmitEvent) {
		event.preventDefault();
		error = '';

		if (!canSubmit) {
			error = '请输入账号和密码';
			return;
		}
		loading = true;
		try {
			if (onLogin) {
				await onLogin({ username, password, remember });
			} else {
				await new Promise((r) => setTimeout(r, 1200)); // 演示用
			}
		} catch (e) {
			// 接收父组件的err信息
			error = e instanceof Error ? e.message : '登录失败，请重试';
		} finally {
			loading = false;
		}
	}
</script>

<div class="login-page">
	<!-- 背景霓虹光晕（紫 / 青） -->
	<div class="login-page__glow login-page__glow--brand"></div>
	<div class="login-page__glow login-page__glow--brand-2"></div>

	<div class="login-page__stage">
		<div class="login-page__card-wrap">
			<!-- 登录卡片（玻璃拟态） -->
			<div class="login-card">
				<!-- 品牌区 -->
				<div class="login-card__brand">
					<div class="login-card__logo">OA</div>
					<h1 class="login-card__title">{title}</h1>
					<p class="login-card__subtitle">{subtitle}</p>
				</div>

				<form onsubmit={handleLogin} class="login-form">
					{#if error}
						<div class="login-alert">{error}</div>
					{/if}

					<!-- 账号 -->
					<div class="login-field">
						<label for="username" class="login-field__label">账号</label>
						<div class="login-field__control">
							<svg
								class="login-field__icon"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
							>
								<path
									d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
								<circle cx="12" cy="7" r="4" />
							</svg>
							<input
								id="username"
								type="text"
								bind:value={username}
								placeholder="请输入账号 / 手机号"
								autocomplete="username"
								class="login-input login-input--brand"
							/>
						</div>
					</div>

					<!-- 密码 -->
					<div class="login-field">
						<label for="password" class="login-field__label">密码</label>
						<div class="login-field__control">
							<svg
								class="login-field__icon"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
							>
								<rect x="3" y="11" width="18" height="11" rx="2" />
								<path d="M7 11V7a5 5 0 0 1 10 0v4" stroke-linecap="round" />
							</svg>
							<input
								id="password"
								type={showPassword ? 'text' : 'password'}
								bind:value={password}
								placeholder="请输入密码"
								autocomplete="current-password"
								class="login-input login-input--brand-2 login-input--toggle"
							/>
							<button
								type="button"
								onclick={() => (showPassword = !showPassword)}
								aria-label={showPassword ? '隐藏密码' : '显示密码'}
								class="login-field__toggle"
							>
								{#if showPassword}
									<svg
										class="h-5 w-5"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
									>
										<path
											d="M2 12s3.5-7 10-7 10 7 10 7a13 13 0 0 1-2 2.5M6.5 6.5A13 13 0 0 1 12 5c6.5 0 10 7 10 7a13 13 0 0 1-2 2.5"
											stroke-linecap="round"
										/>
										<path d="M9.5 9.5a3.5 3.5 0 0 0 5 5" stroke-linecap="round" />
										<line x1="3" y1="3" x2="21" y2="21" stroke-linecap="round" />
									</svg>
								{:else}
									<svg
										class="h-5 w-5"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
									>
										<path
											d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
										<circle cx="12" cy="12" r="3" />
									</svg>
								{/if}
							</button>
						</div>
					</div>

					<!-- 记住我 / 忘记密码 -->
					<div class="login-options">
						<label class="login-remember">
							<input type="checkbox" bind:checked={remember} class="login-checkbox" />
							记住我
						</label>
						<!-- <a href="/forgot" sclass="text-brand-2 transition hover:underline">忘记密码？</a> -->
					</div>

					<!-- 登录按钮 -->
					<button type="submit" disabled={loading} class="login-submit">
						{#if loading}
							<span class="login-spinner"></span>
							登录中…
						{:else}
							登 录
						{/if}
					</button>
				</form>

				<p class="login-copyright">© 2026 公司名称. 保留所有权利.</p>
			</div>
		</div>
	</div>
</div>
