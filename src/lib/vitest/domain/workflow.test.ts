import { describe, it, expect } from 'vitest';
import { EMPLOYEE_ID, FINANCE_ID, MANAGER_ID, requireUser, USERS } from '../../domain/org';
import type { AuditAction, RequestStatus, TravelFields, TravelRequest, UserId } from '../../domain/types';
import {
	actionRequiresComment,
	availableActions,
	canViewRequest,
	isDeletable,
	isEditable,
	REJECT_COMMENT_MAX_LENGTH,
	transition
} from '../../domain/workflow';
import { toLocalISO } from '../../format/date';

const zhangsan = requireUser(EMPLOYEE_ID);
const lijingli = requireUser(MANAGER_ID);
const wangcaiwu = requireUser(FINANCE_ID);
const wangfang = USERS.find((u) => u.name === '王芳')!;

const NOW = new Date('2026-03-10T02:00:00.000Z');

function makeRequest(
	overrides: Partial<Omit<TravelRequest, 'fields'>> & { fields?: Partial<TravelFields> } = {}
): TravelRequest {
	const { fields: fieldOverrides, ...rest } = overrides;
	return {
		id: 'TR-0001',
		type: 'travel',
		applicantId: zhangsan.id,
		applicantName: zhangsan.name,
		department: zhangsan.department,
		status: 'draft',
		createdAt: '2026-03-01T02:00:00.000Z',
		updatedAt: '2026-03-01T02:00:00.000Z',
		audit: [],
		fields: {
			reason: '赴上海参加客户现场技术支持',
			urgency: 'normal',
			legs: [
				{
					id: 'leg-1',
					from: '北京',
					to: '上海',
					departDate: '2026-03-15',
					returnDate: '2026-03-17',
					transport: 'train'
				}
			],
			budget: { transport: 120000, hotel: 240000, allowance: 60000, other: 8000 },
			...fieldOverrides
		},
		...rest
	};
}

describe('transition — 正常流转链路', () => {
	it('草稿由申请人提交后进入待主管审批', () => {
		const result = transition({
			request: makeRequest(),
			action: 'submit',
			actor: zhangsan,
			now: NOW
		});

		expect(result).toMatchObject({ ok: true, request: { status: 'pending_manager' } });
	});

	// 两级审批：主管通过只走到「待财务审批」，需财务二审才归档。
	it('主管审批通过将流转到待财务审批', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'approve',
			actor: lijingli,
			now: NOW
		});

		expect(result).toMatchObject({ ok: true, request: { status: 'pending_finance' } });
	});

	// 主管无权处理「待财务审批」环节：那是财务二审的职责。
	it('主管不能审批待财务审批的单（越权）', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_finance' }),
			action: 'approve',
			actor: lijingli,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'forbidden' });
	});

	// 财务二审通过才真正归档；财务驳回同理需填意见。
	it('财务审批通过待财务审批的单后成为已通过', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_finance' }),
			action: 'approve',
			actor: wangcaiwu,
			now: NOW
		});

		expect(result).toMatchObject({ ok: true, request: { status: 'approved' } });
	});

	it('财务可驳回待财务审批的单（需填意见）', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_finance' }),
			action: 'reject',
			actor: wangcaiwu,
			comment: '票据不合规，请补充增值税专用发票',
			now: NOW
		});

		expect(result).toMatchObject({ ok: true, request: { status: 'rejected' } });
	});

	it('财务驳回待财务审批的单也必须填写意见', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_finance' }),
			action: 'reject',
			actor: wangcaiwu,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'comment_required' });
	});

	// 申请人可在两级审批的任一待审阶段撤销。
	it('申请人可在待财务审批阶段撤销', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_finance' }),
			action: 'cancel',
			actor: zhangsan,
			now: NOW
		});

		expect(result).toMatchObject({ ok: true, request: { status: 'cancelled' } });
	});

	it('驳回后申请人可重新编辑回到草稿', () => {
		const result = transition({
			request: makeRequest({ status: 'rejected' }),
			action: 'reedit',
			actor: zhangsan,
			now: NOW
		});

		expect(result).toMatchObject({ ok: true, request: { status: 'draft' } });
	});

	it('对草稿重新编辑是原地继续编辑，状态不变', () => {
		const draft = makeRequest({ status: 'draft' });
		const result = transition({ request: draft, action: 'reedit', actor: zhangsan, now: NOW });

		expect(result).toMatchObject({ ok: true, request: { status: 'draft' } });
		// 不产出新的提交时间（草稿本就没有 submittedAt，重新编辑也不应写入）
		expect(result.ok && result.request.submittedAt).toBeUndefined();
	});

	it('申请人可撤销审批中的单', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'cancel',
			actor: zhangsan,
			now: NOW
		});

		expect(result).toMatchObject({ ok: true, request: { status: 'cancelled' } });
	});
});

describe('transition — 权限守卫', () => {
	it('不能审批自己提交的申请', () => {
		// 李经理若自己提单，即便有管理角色也不能自审
		const ownRequest = makeRequest({
			applicantId: lijingli.id,
			applicantName: lijingli.name,
			status: 'pending_manager'
		});

		const result = transition({
			request: ownRequest,
			action: 'approve',
			actor: lijingli,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'forbidden' });
		if (!result.ok) expect(result.message).toContain('不能审批自己');
	});

	it('普通员工无权审批他人的单', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'approve',
			actor: wangfang,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('他人不能撤销别人的申请', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'cancel',
			actor: wangfang,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('他人不能替申请人提交草稿', () => {
		const result = transition({
			request: makeRequest(),
			action: 'submit',
			actor: lijingli,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'forbidden' });
	});
});

describe('transition — 非法状态', () => {
	it('已通过的单不可撤销', () => {
		const result = transition({
			request: makeRequest({ status: 'approved' }),
			action: 'cancel',
			actor: zhangsan,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'invalid_status' });
	});

	it('草稿不能被审批', () => {
		const result = transition({
			request: makeRequest(),
			action: 'approve',
			actor: lijingli,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'invalid_status' });
	});

	it('已撤销的单不能再提交', () => {
		const result = transition({
			request: makeRequest({ status: 'cancelled' }),
			action: 'submit',
			actor: zhangsan,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'invalid_status' });
	});

	it('四个终态（已通过、已撤销、已驳回、已结束）都不接受任何动作', () => {
		const terminals: RequestStatus[] = ['approved', 'cancelled', 'rejected'];
		const actions: AuditAction[] = ['submit', 'approve', 'reject', 'cancel', 'reedit'];

		const outcomes = terminals.flatMap((status) =>
			actions.map((action) =>
				transition({ request: makeRequest({ status }), action, actor: lijingli, now: NOW })
			)
		);

		expect(outcomes.every((r) => !r.ok)).toBe(true);
	});
});

describe('transition — 审批意见', () => {
	it('驳回时必须填写意见', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'reject',
			actor: lijingli,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'comment_required' });
	});

	it('只有空白字符的意见等同未填写', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'reject',
			actor: lijingli,
			comment: '   \n  ',
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'comment_required' });
	});

	it('填写意见后可以驳回，且意见被去除首尾空白', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'reject',
			actor: lijingli,
			comment: '  预算超标，请压缩住宿费  ',
			now: NOW
		});

		expect(result.ok && result.request.audit.at(-1)?.comment).toBe('预算超标，请压缩住宿费');
	});

	it(`意见超过 ${REJECT_COMMENT_MAX_LENGTH} 字被拒绝`, () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'reject',
			actor: lijingli,
			comment: 'x'.repeat(REJECT_COMMENT_MAX_LENGTH + 1),
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'comment_too_long' });
	});

	it(`恰为 ${REJECT_COMMENT_MAX_LENGTH} 字的意见可正常驳回`, () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'reject',
			actor: lijingli,
			comment: 'x'.repeat(REJECT_COMMENT_MAX_LENGTH),
			now: NOW
		});

		expect(result.ok).toBe(true);
	});

	it('通过时不填意见也可以', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'approve',
			actor: lijingli,
			now: NOW
		});

		expect(result.ok).toBe(true);
	});
});

describe('transition — 留痕与不可变性', () => {
	it('每次流转追加一条含前后状态的审批记录', () => {
		const result = transition({
			request: makeRequest(),
			action: 'submit',
			actor: zhangsan,
			now: NOW,
			auditId: 'audit-fixed'
		});

		expect(result.ok && result.request.audit).toEqual([
			{
				id: 'audit-fixed',
				at: toLocalISO(NOW),
				actorId: zhangsan.id,
				actorName: zhangsan.name,
				action: 'submit',
				from: 'draft',
				to: 'pending_manager'
			}
		]);
	});

	it('不修改传入的原对象', () => {
		const original = makeRequest();

		transition({ request: original, action: 'submit', actor: zhangsan, now: NOW });

		expect(original).toMatchObject({ status: 'draft', audit: [] });
	});

	it('首次提交记录 submittedAt', () => {
		const result = transition({
			request: makeRequest(),
			action: 'submit',
			actor: zhangsan,
			now: NOW
		});

		expect(result.ok && result.request.submittedAt).toBe(toLocalISO(NOW));
	});

	it('驳回后重新提交以最新提交时间为准', () => {
		const firstSubmit = '2026-03-01T02:00:00.000Z';
		const result = transition({
			request: makeRequest({ status: 'draft', submittedAt: firstSubmit }),
			action: 'submit',
			actor: zhangsan,
			now: NOW
		});

		expect(result.ok && result.request.submittedAt).toBe(toLocalISO(NOW));
	});
});

describe('availableActions', () => {
	it('草稿状态下申请人可提交，且可重新编辑（继续编辑草稿）', () => {
		expect(availableActions(makeRequest(), zhangsan)).toEqual(['submit', 'reedit']);
	});

	it('待主管审批时申请人只能撤销', () => {
		expect(availableActions(makeRequest({ status: 'pending_manager' }), zhangsan)).toEqual([
			'cancel'
		]);
	});

	it('待主管审批时主管可通过或驳回', () => {
		expect(availableActions(makeRequest({ status: 'pending_manager' }), lijingli)).toEqual([
			'approve',
			'reject'
		]);
	});

	it('待财务审批时财务可通过或驳回', () => {
		expect(availableActions(makeRequest({ status: 'pending_finance' }), wangcaiwu)).toEqual([
			'approve',
			'reject'
		]);
	});

	it('待财务审批时主管无可执行动作（二审归财务）', () => {
		expect(availableActions(makeRequest({ status: 'pending_finance' }), lijingli)).toEqual([]);
	});

	it('终态下无任何可用动作', () => {
		expect(availableActions(makeRequest({ status: 'approved' }), zhangsan)).toEqual([]);
		expect(availableActions(makeRequest({ status: 'approved' }), lijingli)).toEqual([]);
	});

	it('无关的员工没有任何可用动作', () => {
		expect(availableActions(makeRequest({ status: 'pending_manager' }), wangfang)).toEqual([]);
	});
});

describe('canViewRequest', () => {
	it('申请人可查看自己的单（含草稿）', () => {
		expect(canViewRequest(makeRequest({ status: 'draft' }), zhangsan)).toBe(true);
	});

	it('员工不能查看领导的单', () => {
		const managerReq = makeRequest({ applicantId: MANAGER_ID, status: 'approved' });
		expect(canViewRequest(managerReq, zhangsan)).toBe(false);
	});

	it('员工之间也不能互看', () => {
		const others = makeRequest({ applicantId: EMPLOYEE_ID, status: 'approved' });
		expect(canViewRequest(others, wangfang)).toBe(false);
	});

	it('经理可查看员工的非草稿单（含已审 / 已驳回）', () => {
		expect(
			canViewRequest(makeRequest({ applicantId: EMPLOYEE_ID, status: 'approved' }), lijingli)
		).toBe(true);
		expect(
			canViewRequest(makeRequest({ applicantId: EMPLOYEE_ID, status: 'rejected' }), lijingli)
		).toBe(true);
	});

	it('经理不能查看员工的草稿单', () => {
		expect(
			canViewRequest(makeRequest({ applicantId: EMPLOYEE_ID, status: 'draft' }), lijingli)
		).toBe(false);
	});

	it('财务可查看待财务审批的单（自己的二审队列）', () => {
		expect(
			canViewRequest(
				makeRequest({ applicantId: EMPLOYEE_ID, status: 'pending_finance' }),
				wangcaiwu
			)
		).toBe(true);
	});

	it('财务不能查看待主管审批或终态的单', () => {
		expect(
			canViewRequest(
				makeRequest({ applicantId: EMPLOYEE_ID, status: 'pending_manager' }),
				wangcaiwu
			)
		).toBe(false);
		expect(
			canViewRequest(makeRequest({ applicantId: EMPLOYEE_ID, status: 'approved' }), wangcaiwu)
		).toBe(false);
	});

	it('联调模式：申请人是后端 UUID（本地组织表查不到），主管凭 applicantRole 仍可查看', () => {
		const backendReq = makeRequest({
			applicantId: 'cd15271d-6d0d-4b23-b769-6daafcfc091e' as UserId,
			applicantRole: 'employee',
			status: 'pending_manager'
		});
		expect(canViewRequest(backendReq, lijingli)).toBe(true);
	});

	it('联调模式：缺 applicantRole 且申请人非本地用户时，主管无法查看（回归保护）', () => {
		const backendReq = makeRequest({
			applicantId: 'cd15271d-6d0d-4b23-b769-6daafcfc091e' as UserId,
			status: 'pending_manager'
		});
		expect(canViewRequest(backendReq, lijingli)).toBe(false);
	});
});

describe('isEditable / isDeletable', () => {
	it('本人的草稿可编辑可删除', () => {
		const draft = makeRequest();

		expect(isEditable(draft, zhangsan)).toBe(true);
		expect(isDeletable(draft, zhangsan)).toBe(true);
	});

	it('提交后不可再编辑', () => {
		expect(isEditable(makeRequest({ status: 'pending_manager' }), zhangsan)).toBe(false);
	});

	it('他人的草稿不可编辑', () => {
		expect(isEditable(makeRequest(), wangfang)).toBe(false);
	});
});

describe('actionRequiresComment', () => {
	it('驳回必须填写意见', () => {
		expect(actionRequiresComment('reject')).toBe(true);
	});

	it('通过 / 提交 / 撤销 / 重新编辑不需要意见', () => {
		expect(actionRequiresComment('approve')).toBe(false);
		expect(actionRequiresComment('submit')).toBe(false);
		expect(actionRequiresComment('cancel')).toBe(false);
		expect(actionRequiresComment('reedit')).toBe(false);
	});
});

describe('transition — 跨角色越权', () => {
	it('经理不能驳回待财务审批的单（只有财务能驳回此环节）', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_finance' }),
			action: 'reject',
			actor: lijingli,
			comment: '预算有问题',
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('财务不能通过待主管审批的单（只有主管能通过此环节）', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'approve',
			actor: wangcaiwu,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('财务不能撤销他人的申请（只能申请人撤销）', () => {
		const result = transition({
			request: makeRequest({ status: 'pending_manager' }),
			action: 'cancel',
			actor: wangcaiwu,
			now: NOW
		});

		expect(result).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('已驳回状态下不能继续提交或通过', () => {
		const rejectedReq = makeRequest({ status: 'rejected' });
		const submitRes = transition({
			request: rejectedReq,
			action: 'submit',
			actor: zhangsan,
			now: NOW
		});
		const approveRes = transition({
			request: rejectedReq,
			action: 'approve',
			actor: lijingli,
			now: NOW
		});

		expect(submitRes).toMatchObject({ ok: false, code: 'invalid_status' });
		expect(approveRes).toMatchObject({ ok: false, code: 'invalid_status' });
	});
});

describe('canViewRequest — 边界场景', () => {
	it('经理不能查看另一个经理的申请', () => {
		// 两个经理之间应当互不可见，managerId 为 null 不存在跨层级
		const another = makeRequest({
			applicantId: lijingli.id,
			applicantName: lijingli.name,
			status: 'approved'
		});

		expect(canViewRequest(another, lijingli)).toBe(true); // 自己看自己
	});

	it('经理查看自己的任何状态单均可', () => {
		// 经理提的单自己有全部查看权（同 employee 逻辑）
		expect(
			canViewRequest(
				makeRequest({ applicantId: lijingli.id, applicantName: lijingli.name, status: 'draft' }),
				lijingli
			)
		).toBe(true);
		expect(
			canViewRequest(
				makeRequest({ applicantId: lijingli.id, applicantName: lijingli.name, status: 'approved' }),
				lijingli
			)
		).toBe(true);
	});

	it('财务可查看自己的所有状态的单', () => {
		expect(
			canViewRequest(
				makeRequest({ applicantId: wangcaiwu.id, applicantName: wangcaiwu.name, status: 'draft' }),
				wangcaiwu
			)
		).toBe(true);
	});

	it('财务不能查看他人的非待财务审批单', () => {
		// 除了自己的单和待财务审批的单，财务看不到其他人的
		expect(
			canViewRequest(makeRequest({ applicantId: EMPLOYEE_ID, status: 'draft' }), wangcaiwu)
		).toBe(false);
	});
});
