/**
 * ISO 时间字符串 → YYYY-MM-DD（仅取日期部分）。
 *
 * 列表卡片与申请详情都只展示日期，统一在此格式化，避免「日期该怎么切」的逻辑散落多处、
 * 时区/格式一旦要调整得改好几处。
 */
export function formatDate(iso: string): string {
	return iso.slice(0, 10);
}

/**
 * ISO 时间字符串 → `YYYY-MM-DD HH:mm`（按字面量取墙钟分量）。
 *
 * 全站时间戳统一为**中国时区（UTC+8）的 ISO 字面量**（形如
 * `2026-08-31T19:04:00.000+08:00`），由后端按 `+08:00` 输出、前端直接使用。
 * 因此这里**直接截取字符串字面量**还原日期时间，不做任何时区换算
 * —— 字面量本身就是中国墙钟，切出来即所见，避免 `getUTC*`（会读回 UTC、早 8 小时）
 * 和 `getMonth()`（依赖运行环境时区）带来的偏差。
 *
 * 兼容：若拿到的是 UTC 字面量（结尾 `Z`，历史数据 / 尚未迁移的接口 / 旧缓存），
 * 先经 {@link toChinaLiteral} 换算成北京时间字面量再截取，避免显示早 8 小时。
 */
export function formatDateTime(iso: string): string {
	const s = toChinaLiteral(iso);
	return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}

/** 中国时区固定偏移（毫秒），供需要按绝对时刻做加减的地方使用 */
export const CHINA_OFFSET_MS = 8 * 3600 * 1000;

/**
 * 按 `Asia/Shanghai` 格式化日期时间的各分量。
 *
 * 用 `Intl` 固定时区，而不是读取运行环境的本地时区 —— Docker / K8s 容器默认 UTC，
 * 若依赖运行时时区，生产环境会悄悄整体偏移 8 小时，且本地测不出来。
 */
const CN_FORMAT = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Asia/Shanghai',
	// 用 hourCycle 而非 hour12：部分 ICU 版本在 hour12:false 下会把午夜输出为 24
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

/** 取某个时刻在中国时区下的各分量（year/month/day/hour/minute/second） */
function chinaParts(now: Date): Record<string, string> {
	const parts: Record<string, string> = {};
	for (const p of CN_FORMAT.formatToParts(now)) parts[p.type] = p.value;
	return parts;
}

/**
 * Date → **中国时区 ISO 字面量**（带真实 `+08:00` 偏移），如 `2026-08-09T16:25:53.296+08:00`。
 *
 * 注意这**只是格式化，没有挪动时刻**：取的是 `now` 这一绝对瞬间在北京时区下的墙钟分量，
 * 再标上 `+08:00`，因此把它解析回来仍是同一个瞬间
 * （`new Date(toChinaISO(d)).getTime() === d.getTime()` 恒为真）。
 *
 * 之所以用 `Intl` + 固定时区而不是 `getFullYear()/getHours()` 等本地 getter：
 * 后者依赖运行环境时区，容器为 UTC 时会整体差 8 小时；`Intl` 写法与部署环境无关。
 *
 * 用于用户主动产生的时刻（新建 / 提交 / 审批 / 撤回等），seed / Mock / 接口数据不调用。
 */
export function toChinaISO(now: Date = new Date()): string {
	const p = chinaParts(now);
	const ms = String(now.getMilliseconds()).padStart(3, '0');
	return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${ms}+08:00`;
}

/**
 * 归一化时间戳为**北京时间字面量**：
 * - 已经是北京字面量（带 `+08:00` 等偏移）→ 原样返回；
 * - 仍是 UTC 字面量（结尾 `Z`，历史数据 / 未迁移接口 / 旧 localStorage 缓存）→
 *   按真实时刻换算成北京时间字面量。
 *
 * 读取端（展示 / 分月 / 分年）统一先过这一层，这样即便后端尚未全部迁移到 `+08:00`，
 * 前端也不会出现"整体早 8 小时"。正常路径（+08:00）是纯返回、零解析开销。
 */
export function toChinaLiteral(iso: string): string {
	return iso.endsWith('Z') ? toChinaISO(new Date(iso)) : iso;
}

/** 时间戳 → 中国年月 `YYYY-MM`（北京时间字面量直接截取，零时区处理） */
export function chinaMonthKey(iso: string): string {
	return toChinaLiteral(iso).slice(0, 7);
}

/** 时间戳 → 中国年份 `YYYY` */
export function chinaYearKey(iso: string): string {
	return toChinaLiteral(iso).slice(0, 4);
}

/** 当前中国时间的年月 `YYYY-MM` */
export function chinaNowMonthKey(now: Date = new Date()): string {
	return toChinaISO(now).slice(0, 7);
}
