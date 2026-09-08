import { z } from 'zod';
import { budgetTotal } from './money';
import { TRANSPORT_VALUES, URGENCY_VALUES } from './types';

/**
 * 表单校验规则的唯一真相。
 *
 * 同一份 schema 被三处复用：
 * - `+page.server.ts` 的 form action：无 JS 时的服务端兜底校验
 * - 客户端 `use:enhance`：有 JS 时的即时反馈
 * - localStorage 草稿回读：结构变更或被手改过的脏数据一律丢弃
 *
 * 只写一次，三处就不会漂移。
 */

/** 事由最少字数：太短的事由（如「出差」）对审批人没有信息量 */
export const REASON_MIN_LENGTH = 10;

/** 单次差旅预算上限（分）。超过需填写说明，而非直接拒绝 */
export const BUDGET_NOTE_THRESHOLD_CENTS = 1_000_000;

/** 单张单最多行程段数，防止 UI 与数据被恶意撑爆 */
export const MAX_LEGS = 10;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * YYYY-MM-DD 日期。
 *
 * 除了格式，还要确认它是真实存在的日期 —— `2026-02-30` 符合正则但不存在，
 * `new Date()` 会静默滚到 3 月 2 日。
 */
/** YYYY-MM-DD 日期字符串校验，供配置驱动的字段构建器复用 */
export const dateStringSchema = z.preprocess(
	// 未选择时字段值是 undefined / null，先归一成空串，让下面的 .min(1) 命中「请选择日期」，
	// 而不是被 z.string() 的「类型错误」挡在前面（那会给出泛型/英文消息）
	(v) => (v === undefined || v === null ? '' : v),
	z
		.string()
		.trim()
		.min(1, '请选择日期')
		.regex(DATE_PATTERN, '请选择日期')
		.refine((value) => {
			const date = new Date(`${value}T00:00:00Z`);
			return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
		}, '日期不存在')
);

const dateString = dateStringSchema;

/** 金额（分）：非负整数，且不超过千万元，避免误输一长串数字 */
const centsAmount = z
	.number({ error: '请输入金额' })
	.int('金额精确到分')
	.min(0, '金额不能为负')
	.max(1_000_000_000, '金额超出合理范围');

// ── 第一步：基本信息 ─────────────────────────────────────────────

export const basicSchema = z.object({
	reason: z
		.string()
		.trim()
		.min(REASON_MIN_LENGTH, `出差事由请不少于 ${REASON_MIN_LENGTH} 个字`)
		.max(200, '出差事由请控制在 200 字以内'),
	urgency: z.enum(URGENCY_VALUES, { error: '请选择紧急程度' })
});

// ── 第二步：行程明细 ─────────────────────────────────────────────

export const legSchema = z
	.object({
		id: z.string().min(1),
		from: z.string().trim().min(1, '请填写出发地').max(30, '地点名称过长'),
		to: z.string().trim().min(1, '请填写目的地').max(30, '地点名称过长'),
		departDate: dateString,
		returnDate: dateString,
		transport: z.enum(TRANSPORT_VALUES, { error: '请选择交通方式' })
	})
	.refine((leg) => leg.returnDate >= leg.departDate, {
		// ISO 日期字符串可直接字典序比较
		message: '返回日期不能早于出发日期',
		path: ['returnDate']
	})
	.refine((leg) => leg.from !== leg.to, {
		message: '出发地与目的地不能相同',
		path: ['to']
	});

export const tripsSchema = z.object({
	legs: z
		.array(legSchema)
		.min(1, '请至少添加一段行程')
		.max(MAX_LEGS, `最多添加 ${MAX_LEGS} 段行程`)
		.superRefine((legs, ctx) => {
			// 逐段与前面所有段比对，把错误精确挂到冲突的那一行，
			// 这样 UI 能高亮具体某段而不是给一句笼统的「行程有冲突」
			const sorted = legs
				.map((leg, index) => ({ leg, index }))
				.sort((a, b) => a.leg.departDate.localeCompare(b.leg.departDate)); // 按出发日期升序

			for (let i = 1; i < sorted.length; i++) {
				const prev = sorted[i - 1];
				const curr = sorted[i];

				if (curr.leg.departDate <= prev.leg.returnDate) {
					ctx.addIssue({
						code: 'custom',
						message: `与第 ${prev.index + 1} 段行程日期重叠`,
						path: [curr.index, 'departDate']
					});
				}
			}
		})
});

// ── 第三步：费用预算 ─────────────────────────────────────────────

const budgetShape = {
	budget: z.object({
		transport: centsAmount,
		hotel: centsAmount,
		allowance: centsAmount,
		other: centsAmount
	}),
	budgetNote: z.string().trim().max(200, '说明请控制在 200 字以内').optional()
};

/**
 * 预算的对象级规则，被第三步 schema 与整单 schema 共用。
 *
 * 提成具名函数而非各写一遍，是因为这条规则在两处被引用 ——
 * 复制一份就意味着改阈值时会漏掉其中一处。
 */
function checkBudgetTotal(
	value: { budget: z.infer<(typeof budgetShape)['budget']>; budgetNote?: string },
	ctx: z.RefinementCtx
): void {
	const total = budgetTotal(value.budget);

	if (total <= 0) {
		ctx.addIssue({ code: 'custom', message: '预算合计需大于 0', path: ['budget', 'transport'] });
		return;
	}

	// 超限不拒绝，只要求补充说明 —— 大额差旅是合理存在的，需要的是解释而非阻断
	if (total > BUDGET_NOTE_THRESHOLD_CENTS && !value.budgetNote) {
		ctx.addIssue({
			code: 'custom',
			message: '预算超过 10,000 元，请填写说明',
			path: ['budgetNote']
		});
	}
}

export const budgetSchema = z.object(budgetShape).superRefine(checkBudgetTotal);

// ── 整单：提交前的完整校验 ────────────────────────────────────────

/**
 * 合并三步。
 *
 * 用 `.shape` 取字段再组合，而不是 `.and()` 交叉类型 —— 后者产生的
 * ZodIntersection 无法反查字段，错误路径也会变得难以定位。
 *
 * 注意：`.superRefine()` 只包在对象外层，展开 `.shape` 时**不会**被带过来，
 * 所以下面要把预算的对象级规则重新挂一次。
 */
export const travelFormSchema = z
	.object({
		...basicSchema.shape,
		...tripsSchema.shape,
		...budgetSchema.shape
	})
	.superRefine(checkBudgetTotal);

export type BasicInput = z.infer<typeof basicSchema>;
export type LegInput = z.infer<typeof legSchema>;
export type TripsInput = z.infer<typeof tripsSchema>;
export type BudgetInput = z.infer<typeof budgetSchema>;
export type TravelFormInput = z.infer<typeof travelFormSchema>;

/**
 * 扁平化的字段错误，形如 `{ 'legs.0.returnDate': '返回日期不能早于出发日期' }`。
 *
 * 用点号路径而非 zod 原生的嵌套结构，是为了让表单组件能用一个字符串键
 * 直接查到自己的错误，不必层层解构。
 */
export type FieldErrors = Record<string, string>;

/** 把 ZodError 拍平成字段路径 → 首条错误消息 */
export function toFieldErrors(error: z.ZodError): FieldErrors {
	const result: FieldErrors = {};

	for (const issue of error.issues) {
		const key = issue.path.join('.') || '_';
		// 同一字段只保留第一条，避免 UI 上堆叠多行提示
		// result[key] ??= issue.message;		
		result[key] ??= issue.code === 'invalid_type' ? '请填写该字段' : issue.message;
	}

	return result;
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/** 校验并直接拿到扁平化错误，是 form action 与客户端的共用入口 */
export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
	const parsed = schema.safeParse(input);

	return parsed.success
		? { ok: true, data: parsed.data }
		: { ok: false, errors: toFieldErrors(parsed.error) };
}
