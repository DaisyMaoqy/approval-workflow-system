import type { Role, User, UserId } from './types';

/**
 * 组织架构。
 *
 * 这是演示用的固定编制，不随业务流转变化，因此作为本地常量而非远程数据 ——
 * 远程只提供会变的申请单列表（GET /api/requests，可按 ?type= 过滤单类型）。
 *
 * 主键用 UUID 且写死而非运行时 `randomUUID()` 生成：seed.json 里的
 * `applicantId` 引用了这些值，每次启动都换一批 ID 会让存量数据全部失联。
 */

/** 主管的 UUID。单独提出来是因为下面每位员工的 managerId 都要引用它 */
const LI_JINGLI_ID = '0841d235-b926-4a41-aecd-3c5de814bd68'; // 新员工的id用randomUUID()

/** 财务审批人的 UUID。主管通过后的二级审批由这一独立角色承接 */
export const FINANCE_ID = 'f1a2c3e4-5b6d-4f8a-9c0b-1d2e3f4a5b6c';

export const USERS = [
	{
		id: 'e61fe483-3b09-4e05-b4fe-dde3bc2a8694',
		employeeId: 'EMP10086',
		name: '张三',
		title: '软件工程师',
		department: '研发部',
		role: 'employee',
		managerId: LI_JINGLI_ID
	},
	{
		id: '5170a4c5-20dc-4d18-91a9-95ba9786e3f0',
		employeeId: 'EMP10087',
		name: '王芳',
		title: '高级软件工程师',
		department: '研发部',
		role: 'employee',
		managerId: LI_JINGLI_ID
	},
	{
		id: '0fc31634-c8ac-482a-8b95-4df36fdbf571',
		employeeId: 'EMP10088',
		name: '刘洋',
		title: '测试工程师',
		department: '研发部',
		role: 'employee',
		managerId: LI_JINGLI_ID
	},
	{
		id: 'ba778d9f-8224-4de3-bbaa-05ca9cbcc679',
		employeeId: 'EMP10089',
		name: '陈静',
		title: '产品经理',
		department: '研发部',
		role: 'employee',
		managerId: LI_JINGLI_ID
	},
	{
		id: LI_JINGLI_ID,
		employeeId: 'EMP10001',
		name: '李经理',
		title: '研发部主管',
		department: '研发部',
		role: 'manager',
		managerId: null
	},
	{
		id: FINANCE_ID,
		employeeId: 'EMP20001',
		name: '王会计',
		title: '财务专员',
		department: '财务部',
		role: 'finance',
		managerId: null
	}
] as const satisfies readonly User[];

/**
 * `as const satisfies` 让 UserId 由数据本身推导：
 * 拼错 ID 会在编译期报错，而不是运行时查不到人。
 */
export type KnownUserId = (typeof USERS)[number]['id'];

// 用模拟用户
const USER_BY_ID = new Map<UserId, User>(USERS.map((u) => [u.id, u]));

/** 演示的两个身份：切角色即切登录人，员工用'张三' */
export const EMPLOYEE_ID = 'e61fe483-3b09-4e05-b4fe-dde3bc2a8694' satisfies KnownUserId;
export const MANAGER_ID = LI_JINGLI_ID satisfies KnownUserId;

/** 角色 → 该角色对应的登录人。角色切换时用它换身份。 */
export const IDENTITY_BY_ROLE: Record<Role, KnownUserId> = {
	employee: EMPLOYEE_ID,
	manager: MANAGER_ID,
	finance: FINANCE_ID
};

export function findUser(id: UserId): User | undefined {
	return USER_BY_ID.get(id);
}

/**
 * 取用户，取不到就抛。
 *
 * 用户表是随应用一起发布的常量，取不到只可能是数据损坏或 ID 拼错，
 * 属于程序缺陷 —— 早失败比让 undefined 悄悄渗进 UI 更好排查。
 */
export function requireUser(id: UserId): User {
	const user = USER_BY_ID.get(id);
	if (!user) throw new Error(`未知用户：${id}`);
	return user;
}

/** 从本地存储加载用户信息 */
export function loadUserInfo(): User | null {
	if (typeof localStorage === 'undefined') return null;
	const userInfo = localStorage.getItem('user-info');
	if (!userInfo) return null;
	const user = JSON.parse(userInfo);
	return user;
}
