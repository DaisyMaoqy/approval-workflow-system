import { getContext, setContext } from 'svelte';
import { IDENTITY_BY_ROLE, requireUser, loadUserInfo } from '$lib/domain/org';
import type { Role, User } from '$lib/domain/types';

/**
 * 当前登录身份。
 *
 * 演示中「切角色」即「切登录人」：employee → 张三，manager → 李经理。
 * 这样「审批人不能审批自己的单」这条硬规则无需任何后门就能完整演示。
 *
 * 用 context 持有而非模块级 `$state`：模块级状态在 SSR 下由所有请求共享，
 * 会造成用户之间串号。context 的生命周期跟随组件树，每个请求各自独立。
 *
 * 角色持久化到 localStorage，刷新页面后保持登录身份不变。
 */

const STORAGE_KEY = 'identity-role';
const USER_INFO_KEY = 'user-info';
const VALID_ROLES: Set<string> = new Set(['employee', 'manager', 'finance']);

function loadRole(): Role {
	if (typeof localStorage === 'undefined') return 'employee';
	const saved = localStorage.getItem(STORAGE_KEY);
	return saved && VALID_ROLES.has(saved) ? (saved as Role) : 'employee';
}

function saveRole(role: Role): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, role);
}

const IDENTITY_KEY = Symbol('identity');

export class IdentityState {
	role = $state<Role>(loadRole());

	/** 当前角色对应的登录人 */
	get user(): User {
		// console.log('user getter called', this.role);
		try {
			const userInfo = loadUserInfo()
			return userInfo || requireUser(IDENTITY_BY_ROLE[this.role]);
		} catch {
			return requireUser(IDENTITY_BY_ROLE[this.role]);
		}
		
	}

	get isManager(): boolean {
		return this.role === 'manager';
	}

	/** 当前身份是否为财务审批人（二级审批） */
	get isFinance(): boolean {
		return this.role === 'finance';
	}

	saveUserInfo(info: User): void {
		// console.log('saveUserInfo', info);
		localStorage.setItem(USER_INFO_KEY, JSON.stringify(info));
	}

	switchTo(role: Role): void {
		this.role = role;
		saveRole(role);
	}
}

/** 在根 layout 调用一次，向整棵组件树提供身份 */
export function provideIdentity(): IdentityState {
	return setContext(IDENTITY_KEY, new IdentityState());
}

/** 在任意后代组件中取当前身份 */
export function useIdentity(): IdentityState {
	const state = getContext<IdentityState | undefined>(IDENTITY_KEY);
	if (!state) throw new Error('useIdentity 必须在 provideIdentity 的后代组件中调用');
	return state;
}
