/**
 * 倒计时纯函数（发薪日 / 纪念日 / 自定义），now 可注入便于单测。
 *
 * 口径统一成「日期键 + 日历天」：界面上说的「还有 3 天」必须等于日历上撕掉 3 页，
 * 所以所有天数差都走 UTC 零点相减，而不是拿两个本地时间戳直接除毫秒数
 * （原因见 daysUntil）。全部运算只依赖传入的 now，不读系统时间，便于测试与复用。
 */

import { toDateKey, todayKey } from '@/utils/dateFormatter'
import { isValidDateKey } from '@/utils/validation'

/** 倒计时类型：发薪日 / 纪念日（生日、结婚纪念日等） / 自定义 */
export type CountdownKind = 'payday' | 'anniversary' | 'custom'

/** 一条倒计时 */
export interface CountdownItem {
  id: string
  title: string
  kind: CountdownKind
  /** 目标日期 YYYY-MM-DD（yearly 时只有月日有意义） */
  date: string
  /** 每年重复（生日/纪念日） */
  yearly: boolean
}

/** 解析结果（UI 直接消费，不再自己算天数） */
export interface ResolvedCountdown {
  /** 真正要倒数的那天（yearly 已顺延到今年或明年） */
  date: string
  /** 距今天数：今天 0、明天 1、已过为负 */
  days: number
  isToday: boolean
  /** 已过去（只有非 yearly 的固定日期才可能为 true） */
  isPast: boolean
}

/** 条目 + 解析结果（sortCountdowns 返回的列表项） */
export interface SortedCountdown extends ResolvedCountdown {
  item: CountdownItem
}

const MS_PER_DAY = 86400000

/**
 * 日期键 -> UTC 零点毫秒。
 *
 * 刻意用 Date.UTC 而不是 new Date(y, m - 1, d)：后者是**本地时间**，
 * 在夏令时切换那天只有 23 或 25 小时，两个本地时间戳相减再除 86400000
 * 会算出 0 天或 2 天（北美/欧洲的 3 月与 11 月各踩一次）。
 * 换成 UTC 零点后两边都是整天的整数倍，相减再除必定是精确的日历天数差——
 * 与运行机器的时区、DST 规则完全无关。
 */
function utcMidnight(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/**
 * 距 dateKey 还有几天：今天 0、明天 1、昨天 -1。
 * 非法日期键按 0 返回（调用方应先过 isValidDateKey）：宁可显示「今天」，
 * 也不要让 NaN 顺着排序和文案一路传染。
 */
export function daysUntil(dateKey: string, now: Date = new Date()): number {
  if (!isValidDateKey(dateKey)) return 0
  return Math.round((utcMidnight(dateKey) - utcMidnight(todayKey(now))) / MS_PER_DAY)
}

/** 闰年判断（2/29 纪念日顺延用） */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** 把「MM-DD」落到指定年份；2/29 落在平年时退到 3/1（否则这天在平年根本不存在） */
function monthDayInYear(dateKey: string, year: number): string {
  const monthDay = dateKey.slice(5)
  if (monthDay === '02-29' && !isLeapYear(year)) return `${year}-03-01`
  return `${year}-${monthDay}`
}

/**
 * 下一次发生日期。
 * - 非 yearly：原样返回（过期就是过期，由 UI 标「已过去」）
 * - yearly：取今年的月日；今年这天已经过了（严格早于今天）才顺延到明年。
 *   「就是今天」不顺延——生日当天要显示「今天」，而不是「还有 365 天」
 * - 2/29 的纪念日在平年退到 3/1（下一个闰年再回到 2/29）
 */
export function nextOccurrence(item: CountdownItem, now: Date = new Date()): string {
  if (!item.yearly || !isValidDateKey(item.date)) return item.date
  const year = now.getFullYear()
  const candidate = monthDayInYear(item.date, year)
  return candidate < todayKey(now) ? monthDayInYear(item.date, year + 1) : candidate
}

/** 解析一条倒计时：真正要倒数的那天 + 天数 + 今天/已过标记 */
export function resolveCountdown(item: CountdownItem, now: Date = new Date()): ResolvedCountdown {
  const date = nextOccurrence(item, now)
  const days = daysUntil(date, now)
  return { date, days, isToday: days === 0, isPast: days < 0 }
}

/** 发薪日钳制到 1..31；NaN / Infinity / 非数字一律当 1 号（宁可月初发，也不要让日期算崩） */
export function clampPaydayDay(day: number): number {
  if (!Number.isFinite(day)) return 1
  return Math.min(31, Math.max(1, Math.trunc(day)))
}

/** 某年某月（month0 从 0 起）的第 day 天；该月天数不足时钳到当月最后一天 */
function paydayOfMonth(year: number, month0: number, day: number): string {
  const lastDay = new Date(year, month0 + 1, 0).getDate()
  return toDateKey(new Date(year, month0, Math.min(day, lastDay)))
}

/**
 * 下一次发薪日的日期键。
 * - 0 / 32 / NaN 等越界输入先按 clampPaydayDay 归一到 1..31 再参与计算
 * - 短月钳制：31 号在大月之外落到当月最后一天（4/30、2/28），不会跳到下个月
 * - 今天就是发薪日则返回今天（0 天），不跳到下月
 */
export function nextPayday(dayOfMonth: number, now: Date = new Date()): string {
  const day = clampPaydayDay(dayOfMonth)
  const year = now.getFullYear()
  const month0 = now.getMonth()
  const thisMonth = paydayOfMonth(year, month0, day)
  // 本月的还没过（含就是今天）就用本月的，已经过了才看下个月
  if (thisMonth >= todayKey(now)) return thisMonth
  return paydayOfMonth(year, month0 + 1, day)
}

/**
 * 解析 + 排序：未来的在前（按剩余天数升序），已过去的排在后面。
 * 「已过去的沉底」是产品口径，钉在 utils 里而不是各组件各写一遍，
 * 否则几个卡片迟早会排出不一样的结果。
 */
export function sortCountdowns(
  items: readonly CountdownItem[],
  now: Date = new Date(),
): SortedCountdown[] {
  return items
    .map((item) => ({ item, ...resolveCountdown(item, now) }))
    .sort((a, b) => Number(a.isPast) - Number(b.isPast) || a.days - b.days)
}

/** 天数 -> 人话：今天 / 明天 / 后天 / 还有 N 天 / 已过去 N 天 */
export function formatCountdown(days: number): string {
  if (days === 0) return '今天'
  if (days === 1) return '明天'
  if (days === 2) return '后天'
  return days > 0 ? `还有 ${days} 天` : `已过去 ${Math.abs(days)} 天`
}
