import { describe, it, expect } from 'vitest';
import {
	formatDateTime,
	toChinaLiteral,
	chinaMonthKey,
	chinaYearKey,
	toChinaISO
} from '../../format/date';

/**
 * 中国时区（UTC+8）时间戳读取单测。
 *
 * 全站时间戳统一为北京时间字面量（+08:00），前端按字面量截取、不做时区换算。
 * 这里锁定两条关键不变量：
 * 1. `+08:00` 标准数据 → 原样截取（零解析）；
 * 2. 仍是 `Z`（UTC，历史数据 / 未迁移接口 / 旧缓存）→ 先换算成北京时间再截取，
 *    且跨天、跨月边界都要正确翻篇（否则会显示早 8 小时、月份错位）。
 * 时区逻辑微妙，改动 `format/date.ts` 前请先跑这个。
 */

describe('中国时区字面量读取', () => {
	it('+08:00 字面量：原样返回、零解析', () => {
		expect(toChinaLiteral('2026-08-31T19:04:00.000+08:00')).toBe('2026-08-31T19:04:00.000+08:00');
		expect(formatDateTime('2026-08-31T19:04:00.000+08:00')).toBe('2026-08-31 19:04');
		expect(chinaMonthKey('2026-08-31T19:04:00.000+08:00')).toBe('2026-08');
		expect(chinaYearKey('2026-08-31T19:04:00.000+08:00')).toBe('2026');
	});

	it('Z（UTC）字面量：换算成北京时间后读取，不再早 8 小时', () => {
		// UTC 11:04 == 北京 19:04
		expect(toChinaLiteral('2026-08-31T11:04:00.000Z')).toBe('2026-08-31T19:04:00.000+08:00');
		expect(formatDateTime('2026-08-31T11:04:00.000Z')).toBe('2026-08-31 19:04');
	});

	it('Z 跨天：UTC 20:00 -> 北京次日 04:00（日期也要翻篇）', () => {
		expect(formatDateTime('2026-08-31T20:00:00.000Z')).toBe('2026-09-01 04:00');
		expect(chinaMonthKey('2026-08-31T20:00:00.000Z')).toBe('2026-09');
	});

	it('Z 跨月边界：UTC 2026-02-28T16:30Z -> 北京 2026-03-01 00:30', () => {
		expect(formatDateTime('2026-02-28T16:30:00.000Z')).toBe('2026-03-01 00:30');
		expect(chinaMonthKey('2026-02-28T16:30:00.000Z')).toBe('2026-03');
	});

	it('toChinaISO 不挪动时刻（解析回来仍是同一瞬间）', () => {
		const d = new Date('2026-08-31T11:04:00.000Z');
		expect(new Date(toChinaISO(d)).getTime()).toBe(d.getTime());
	});
});
