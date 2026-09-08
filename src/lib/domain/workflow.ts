import type {
	AuditAction,
	AuditEntry,
	Request,
	RequestStatus,
	Transport,
	Urgency,
	User
} from './types';
import { findUser } from './org';
import { toChinaISO } from '$lib/format/date';

/**
 * 审批状态机。
 *
 * 设计要点：
 * - **声明式流转表**：谁能在什么状态下做什么动作，集中在 TRANSITIONS 一张表里。
 *   加一个审批环节只需改表，不用去各个页面里找 if。
 * - **不抛异常**：返回判别联合 TransitionResult。非法流转是可预期的业务结果
 *   （比如两个标签页同时操作同一张单），不是程序缺陷，调用方应当展示提示而非崩溃。
 * - **纯函数**：不改入参，返回新的 TravelRequest，便于测试与时间旅行调试。
 */

/** 状态在 UI 上的中文名，列表筛选、时间线、图表图例共用，保证三处措辞一致 */
export const STATUS_LABELS: Record<RequestStatus, string> = {
	draft: '草稿',
	pending_manager: '待主管审批',
	pending_finance: '待财务审批',
	approved: '已通过',
	rejected: '已驳回',
	cancelled: '已撤销'
};

export const ACTION_LABELS: Record<AuditAction, string> = {
	submit: '提交申请',
	approve: '通过',
	reject: '驳回',
	cancel: '撤销',
	reedit: '重新编辑'
};

/** 交通方式在 UI 上的中文名，行程表与详情页共用 */
export const TRANSPORT_LABELS: Record<Transport, string> = {
	train: '动车',
	flight: '飞机',
	car: '汽车',
	other: '其他'
};

/** 紧急程度的中文名，详情页与列表徽章共用 */
export const URGENCY_LABELS: Record<Urgency, string> = {
	normal: '普通',
	urgent: '紧急'
};

/**
 * 该动作是否必须填写意见。
 *
 * 直接问流转表而非在页面里写 `action === 'reject'` —— 若以后新增一个
 * 也需要意见的动作，只改 TRANSITIONS 即可，详情页/审批页的弹窗逻辑不用动。
 */
export function actionRequiresComment(action: AuditAction): boolean {
	return TRANSITIONS[action].some((rule) => rule.commentRequired);
}

/** 必填审批意见（驳回理由）的最大长度；超出时 transition 直接拒绝，避免意见无限拉长 */
export const REJECT_COMMENT_MAX_LENGTH = 200;

/** 谁有资格执行该动作 */
type ActorRule =
	/** 仅申请人本人 */
	| 'applicant'
	/** 申请人的直属主管，且不能是本人 */
	| 'manager'
	/** 财务角色，审批「待财务审批」环节，且不能是申请人本人 */
	| 'finance';

interface TransitionRule {
	from: RequestStatus;
	to: RequestStatus;
	actor: ActorRule;
	/** 该动作是否必须填写意见 */
	commentRequired: boolean;
}

/**
 * 完整流转表。
 *
 * ```
 * draft ──submit──▶ pending_manager ──approve(主管)──▶ pending_finance ──approve(财务)──▶ approved
 *                        │                                      │
 *                        ├──reject(主管)──▶ rejected ◀──reject(财务)──┤
 *                        └──cancel──────▶ cancelled ◀──cancel───────┘
 *
 * rejected ──reedit──▶ draft
 *
 * 草稿本身即可编辑，reedit 对草稿是「原地继续编辑」（状态不变、不追加审计），
 * 只是把数据回填进向导；对驳回单才是 rejected → draft 的真实状态流转。
 * ```
 *
 * 两级审批：主管先审，通过后进入「待财务审批」，由独立财务角色二审。
 */
const TRANSITIONS: Record<AuditAction, readonly TransitionRule[]> = {
	submit: [{ from: 'draft', to: 'pending_manager', actor: 'applicant', commentRequired: false }],
	approve: [
		{ from: 'pending_manager', to: 'pending_finance', actor: 'manager', commentRequired: false },
		{ from: 'pending_finance', to: 'approved', actor: 'finance', commentRequired: false }
	],
	// 驳回必须说明理由，否则申请人不知道该改什么
	reject: [
		{ from: 'pending_manager', to: 'rejected', actor: 'manager', commentRequired: true },
		{ from: 'pending_finance', to: 'rejected', actor: 'finance', commentRequired: true }
	],
	// 申请人可在两级审批的任一待审阶段撤销；已通过的单不可撤销（差旅已成行）
	cancel: [
		{ from: 'pending_manager', to: 'cancelled', actor: 'applicant', commentRequired: false },
		{ from: 'pending_finance', to: 'cancelled', actor: 'applicant', commentRequired: false }
	],
	// 被驳回：rejected → draft 才是真实状态流转（记一条审计）；
	// 草稿：原地继续编辑，状态不变，不追加审计，仅把数据回填进向导
	reedit: [
		{ from: 'rejected', to: 'draft', actor: 'applicant', commentRequired: false },
		{ from: 'draft', to: 'draft', actor: 'applicant', commentRequired: false }
	]
};

export type TransitionFailureCode =
	/** 当前状态不允许该动作 */
	| 'invalid_status'
	/** 当前用户没有执行该动作的资格 */
	| 'forbidden'
	/** 缺少必填的审批意见 */
	| 'comment_required'
	/** 审批意见超出长度上限 */
	| 'comment_too_long';

export type TransitionResult =
	{ ok: true; request: Request } | { ok: false; code: TransitionFailureCode; message: string };

function canActAs(rule: ActorRule, actor: User, request: Request): boolean {
	switch (rule) {
		case 'applicant':
			return actor.id === request.applicantId;
		case 'manager':
			// 主管审批：必须是管理角色，且不能审批自己提交的单
			return actor.role === 'manager' && actor.id !== request.applicantId;
		case 'finance':
			// 财务审批：必须是财务角色，且不能审批自己提交的单
			return actor.role === 'finance' && actor.id !== request.applicantId;
	}
}

/** 当前用户在当前状态下可执行的动作，用于决定按钮显示哪些 */
export function availableActions(request: Request, actor: User): AuditAction[] {
	return (Object.keys(TRANSITIONS) as AuditAction[]).filter((action) =>
		TRANSITIONS[action].some(
			(rule) => rule.from === request.status && canActAs(rule.actor, actor, request)
		)
	);
}

/**
 * 当前用户能否查看这张申请单。
 *
 * 规则：
 * - 自己的单（任意状态）一定可看；
 * - 经理可查看**员工**的**非草稿**单（草稿仅申请人自己可见），便于主管掌握
 *   团队差旅进展，员工的已审批 / 已驳回等也对他可见；
 * - 财务只查看流转到「待财务审批」的单，避免越权看到他人草稿或主管环节；
 * - 其余（员工看他人或领导的单、经理看员工的草稿、经理看其他经理的单）一律不可看。
 *
 * 注意查看权限与操作权限（availableActions）是两回事：能看不代表能审批，
 * 审批仍受「不能自审」等流转表规则约束。
 */
export function canViewRequest(request: Request, viewer: User): boolean {
	if (request.applicantId === viewer.id) return true;
	// 后端联调时申请人是后端 UUID，本地组织表查不到，用随单返回的 applicantRole；
	// 本地模式（demo）退化为 findUser 反查。
	const applicantRole = request.applicantRole ?? findUser(request.applicantId)?.role;
	if (viewer.role === 'manager') {
		return applicantRole === 'employee' && request.status !== 'draft';
	}
	if (viewer.role === 'finance') {
		return request.status === 'pending_finance';
	}
	return false;
}

/** 是否可编辑内容：只有草稿可改 */
export function isEditable(request: Request, actor: User): boolean {
	return request.status === 'draft' && actor.id === request.applicantId;
}

/** 是否可删除：只有本人的草稿可删 */
export function isDeletable(request: Request, actor: User): boolean {
	return isEditable(request, actor);
}

export interface TransitionInput {
	request: Request;
	action: AuditAction;
	actor: User;
	comment?: string;
	/** 注入时间，便于测试与 seed 生成得到确定性结果 */
	now?: Date;
	/** 注入 ID 生成器，同上 */
	auditId?: string;
}

/**
 * 执行一次状态流转。
 *
 * 成功时返回**新的**申请对象，并自动追加一条 AuditEntry。
 */
export function transition({
	request,
	action,
	actor,
	comment,
	now = new Date(),
	auditId
}: TransitionInput): TransitionResult {
	const candidates = TRANSITIONS[action]; // 当前状态下所有可能的流转规则
	const byStatus = candidates.filter((rule) => rule.from === request.status); // 筛选符合当前状态的规则

	if (byStatus.length === 0) {
		return {
			ok: false,
			code: 'invalid_status',
			message: `「${STATUS_LABELS[request.status]}」状态下无法${ACTION_LABELS[action]}`
		};
	}

	const rule = byStatus.find((r) => canActAs(r.actor, actor, request)); // 找到符合当前用户的规则
	if (!rule) {
		// 自审是最容易撞上的一种越权，单独给一句更具体的提示
		const selfApproval = actor.id === request.applicantId && action !== 'cancel';
		return {
			ok: false,
			code: 'forbidden',
			message: selfApproval ? '不能审批自己提交的申请' : `你没有权限${ACTION_LABELS[action]}此申请`
		};
	}

	const trimmed = comment?.trim();
	if (rule.commentRequired && !trimmed) {
		return {
			ok: false,
			code: 'comment_required',
			message: `${ACTION_LABELS[action]}时必须填写意见`
		};
	}

	if (rule.commentRequired && trimmed && trimmed.length > REJECT_COMMENT_MAX_LENGTH) {
		return {
			ok: false,
			code: 'comment_too_long',
			message: `${ACTION_LABELS[action]}意见不能超过 ${REJECT_COMMENT_MAX_LENGTH} 字`
		};
	}

	// 用户动作产生的时间戳按中国时区（UTC+8）存储（toChinaISO），与后端输出 +08:00 一致。
	const at = toChinaISO(now);
	const entry: AuditEntry = {
		id: auditId ?? `audit-${request.audit.length + 1}-${at}`,
		at,
		actorId: actor.id,
		actorName: actor.name,
		action,
		from: request.status,
		to: rule.to,
		...(trimmed ? { comment: trimmed } : {})
	};

	return {
		ok: true,
		request: {
			...request,
			status: rule.to,
			updatedAt: at,
			// 每次提交都刷新提交时间；驳回后「重新编辑 → 再提交」应以最新的提交时间为准
			submittedAt: action === 'submit' ? at : request.submittedAt,
			audit: [...request.audit, entry]
		}
	};
}
