import { describe, it, expect } from 'vitest';
import {
	basicSchema,
	budgetSchema,
	legSchema,
	travelFormSchema,
	tripsSchema,
	validate
} from '../../domain/schema';

function makeLeg(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: 'leg-1',
		from: '北京',
		to: '上海',
		departDate: '2026-03-15',
		returnDate: '2026-03-17',
		transport: 'train',
		...overrides
	};
}

function makeForm(overrides: Record<string, unknown> = {}) {
	return {
		reason: '赴上海参加客户现场技术支持',
		urgency: 'normal',
		legs: [makeLeg()],
		budget: { transport: 120000, hotel: 240000, allowance: 60000, other: 8000 },
		...overrides
	};
}

describe('basicSchema', () => {
	it('接受合法的基本信息', () => {
		expect(
			basicSchema.safeParse({ reason: '赴上海参加客户现场技术支持', urgency: 'normal' }).success
		).toBe(true);
	});

	it('事由少于 10 字时报错', () => {
		const result = validate(basicSchema, { reason: '出差', urgency: 'normal' });

		expect(result).toMatchObject({ ok: false, errors: { reason: expect.stringContaining('10') } });
	});

	it('只有空白的事由等同未填写', () => {
		// trim 在 min 之前生效
		expect(basicSchema.safeParse({ reason: '            ', urgency: 'normal' }).success).toBe(
			false
		);
	});

	it('拒绝未知的紧急程度', () => {
		expect(
			basicSchema.safeParse({ reason: '赴上海参加客户现场技术支持', urgency: 'asap' }).success
		).toBe(false);
	});
});

describe('legSchema', () => {
	it('接受合法的单段行程', () => {
		expect(legSchema.safeParse(makeLeg()).success).toBe(true);
	});

	it('当日往返是合法的', () => {
		expect(legSchema.safeParse(makeLeg({ returnDate: '2026-03-15' })).success).toBe(true);
	});

	it('返回日早于出发日时报错，并定位到 returnDate', () => {
		const result = validate(legSchema, makeLeg({ returnDate: '2026-03-14' }));

		expect(result).toMatchObject({ ok: false, errors: { returnDate: '返回日期不能早于出发日期' } });
	});

	it('出发地与目的地相同时报错', () => {
		const result = validate(legSchema, makeLeg({ to: '北京' }));

		expect(result).toMatchObject({ ok: false, errors: { to: '出发地与目的地不能相同' } });
	});

	it('拒绝格式错误的日期', () => {
		expect(legSchema.safeParse(makeLeg({ departDate: '2026/03/15' })).success).toBe(false);
	});

	it('拒绝格式合法但不存在的日期', () => {
		// 2026 年不是闰年，2 月 30 日不存在；new Date 会静默滚到 3 月
		const result = validate(legSchema, makeLeg({ departDate: '2026-02-30' }));

		expect(result).toMatchObject({ ok: false, errors: { departDate: '日期不存在' } });
	});
});

describe('tripsSchema', () => {
	it('至少需要一段行程', () => {
		const result = validate(tripsSchema, { legs: [] });

		expect(result).toMatchObject({ ok: false, errors: { legs: '请至少添加一段行程' } });
	});

	it('接受多段互不重叠的行程', () => {
		const value = {
			legs: [
				makeLeg({ id: 'leg-1', departDate: '2026-03-15', returnDate: '2026-03-17' }),
				makeLeg({ id: 'leg-2', departDate: '2026-03-20', returnDate: '2026-03-22' })
			]
		};

		expect(tripsSchema.safeParse(value).success).toBe(true);
	});

	it('日期重叠时报错，并定位到冲突那一段', () => {
		const result = validate(tripsSchema, {
			legs: [
				makeLeg({ id: 'leg-1', departDate: '2026-03-15', returnDate: '2026-03-18' }),
				makeLeg({ id: 'leg-2', departDate: '2026-03-17', returnDate: '2026-03-20' })
			]
		});

		expect(result).toMatchObject({
			ok: false,
			errors: { 'legs.1.departDate': expect.stringContaining('重叠') }
		});
	});

	it('前后段首尾相接（同一天返回又出发）视为重叠', () => {
		// 同一天不可能既在 A 地返回又从 B 地出发
		const result = validate(tripsSchema, {
			legs: [
				makeLeg({ id: 'leg-1', departDate: '2026-03-15', returnDate: '2026-03-17' }),
				makeLeg({ id: 'leg-2', departDate: '2026-03-17', returnDate: '2026-03-19' })
			]
		});

		expect(result.ok).toBe(false);
	});

	it('乱序录入也能检出重叠', () => {
		// 用户先填了晚的行程再补早的，重叠依然要被发现
		const result = validate(tripsSchema, {
			legs: [
				makeLeg({ id: 'leg-1', departDate: '2026-03-20', returnDate: '2026-03-25' }),
				makeLeg({ id: 'leg-2', departDate: '2026-03-18', returnDate: '2026-03-22' })
			]
		});

		expect(result.ok).toBe(false);
	});

	it('超过 10 段行程时报错', () => {
		const legs = Array.from({ length: 11 }, (_, i) =>
			makeLeg({
				id: `leg-${i}`,
				departDate: `2026-03-${String(i * 2 + 1).padStart(2, '0')}`,
				returnDate: `2026-03-${String(i * 2 + 1).padStart(2, '0')}`
			})
		);

		expect(tripsSchema.safeParse({ legs }).success).toBe(false);
	});
});

describe('budgetSchema', () => {
	it('接受合法预算', () => {
		const value = { budget: { transport: 120000, hotel: 240000, allowance: 60000, other: 8000 } };

		expect(budgetSchema.safeParse(value).success).toBe(true);
	});

	it('合计为 0 时报错', () => {
		const result = validate(budgetSchema, {
			budget: { transport: 0, hotel: 0, allowance: 0, other: 0 }
		});

		expect(result).toMatchObject({
			ok: false,
			errors: { 'budget.transport': '预算合计需大于 0' }
		});
	});

	it('拒绝负数金额', () => {
		const result = validate(budgetSchema, {
			budget: { transport: -100, hotel: 240000, allowance: 0, other: 0 }
		});

		expect(result).toMatchObject({ ok: false, errors: { 'budget.transport': '金额不能为负' } });
	});

	it('拒绝非整数分，防止浮点金额混入', () => {
		const result = validate(budgetSchema, {
			budget: { transport: 1200.5, hotel: 0, allowance: 0, other: 0 }
		});

		expect(result).toMatchObject({ ok: false, errors: { 'budget.transport': '金额精确到分' } });
	});

	// 回归：必填兜底曾一律替换 invalid_type，把「金额精确到分」「请输入金额」等
	// 已有文案覆盖成「请填写该字段」。下面两条分别锁定「保留已有文案」与「补兜底」。
	it('必填兜底不覆盖已有的自定义文案（金额未填仍提示「请输入金额」）', () => {
		const result = validate(budgetSchema, {
			budget: { hotel: 240000, allowance: 0, other: 0 }
		});

		expect(result).toMatchObject({ ok: false, errors: { 'budget.transport': '请输入金额' } });
	});

	it('未配文案的必填字段：把 Zod 英文默认换成中文「请填写该字段」', () => {
		const result = validate(basicSchema, { urgency: 'normal' });

		expect(result).toMatchObject({ ok: false, errors: { reason: '请填写该字段' } });
	});

	it('超过 10000 元且未填说明时报错', () => {
		const result = validate(budgetSchema, {
			budget: { transport: 600000, hotel: 500000, allowance: 0, other: 0 }
		});

		expect(result).toMatchObject({
			ok: false,
			errors: { budgetNote: expect.stringContaining('10,000') }
		});
	});

	it('超过 10000 元但填了说明时通过', () => {
		const value = {
			budget: { transport: 600000, hotel: 500000, allowance: 0, other: 0 },
			budgetNote: '需在客户现场驻场两周，住宿周期较长'
		};

		expect(budgetSchema.safeParse(value).success).toBe(true);
	});

	it('恰好等于 10000 元不需要说明', () => {
		// 阈值是「超过」而非「达到」，边界值应放行
		const value = { budget: { transport: 1000000, hotel: 0, allowance: 0, other: 0 } };

		expect(budgetSchema.safeParse(value).success).toBe(true);
	});
});

describe('travelFormSchema', () => {
	it('接受完整合法的整单', () => {
		expect(travelFormSchema.safeParse(makeForm()).success).toBe(true);
	});

	it('同时汇总来自不同步骤的错误', () => {
		const result = validate(
			travelFormSchema,
			makeForm({
				reason: '出差',
				legs: [makeLeg({ returnDate: '2026-03-14' })]
			})
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(Object.keys(result.errors)).toEqual(
				expect.arrayContaining(['reason', 'legs.0.returnDate'])
			);
		}
	});

	it('合并后仍保留预算的对象级规则', () => {
		// superRefine 不随 .shape 展开传递，整单 schema 必须重新挂一次
		const result = validate(
			travelFormSchema,
			makeForm({ budget: { transport: 600000, hotel: 500000, allowance: 0, other: 0 } })
		);

		expect(result).toMatchObject({
			ok: false,
			errors: { budgetNote: expect.stringContaining('10,000') }
		});
	});

	it('合并后仍保留行程重叠规则', () => {
		const result = validate(
			travelFormSchema,
			makeForm({
				legs: [
					makeLeg({ id: 'leg-1', departDate: '2026-03-15', returnDate: '2026-03-18' }),
					makeLeg({ id: 'leg-2', departDate: '2026-03-17', returnDate: '2026-03-20' })
				]
			})
		);

		expect(result.ok).toBe(false);
	});
});

describe('validate', () => {
	it('成功时返回解析后的数据', () => {
		const result = validate(basicSchema, {
			reason: '  赴上海参加客户现场技术支持  ',
			urgency: 'normal'
		});

		// trim 后的值，说明拿到的是规范化结果而非原始输入
		expect(result).toEqual({
			ok: true,
			data: { reason: '赴上海参加客户现场技术支持', urgency: 'normal' }
		});
	});

	it('同一字段有多条错误时只保留第一条', () => {
		const result = validate(basicSchema, { reason: '短', urgency: 'nope' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(typeof result.errors.reason).toBe('string');
		}
	});

	it('根级错误归到下划线键', () => {
		const result = validate(basicSchema, 'not-an-object');

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors._).toBeDefined();
	});
});
