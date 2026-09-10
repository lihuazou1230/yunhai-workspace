/**
 * 内置法定节假日 + 调休查询（数据在 src/data/holidays.json）。
 *
 * 数据来源：国务院办公厅《关于 2026 年部分节假日安排的通知》
 * （国办发明电〔2025〕7 号，2025-11-04 发布，www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm）。
 * 通知给的只有「放假区间 + 调休上班日」两样东西，因此本模块的口径是：
 * - holidays 收录**整段放假日期**（含靠调休凑出来的那几天）：只收 3 天法定日的话，
 *   日历上的假期会断成几截、「距离下个假期还有几天」也会多算几天
 * - workdays 只收通知里点名的补班日（周末上班），不自己推断
 *
 * ⚠️ 每年初必须更新：国务院一般在上一年 11 月前后公布次年安排，公布前没有权威日期。
 * 未收录的年份 loadHolidays 返回空结构（不抛错、不猜）：假期写错比没有更糟——
 * 用户会照着它请假、订票。2027 目前只收录元旦（法定固定为 1 月 1 日，不必等通知），
 * 春节及 2027 全部调休日待正式通知发布后补录；这条「已知的缺口」由 UI 直说，不假装。
 */

import holidaysData from '@/data/holidays.json'
import { daysUntil } from '@/utils/countdown'
import { isValidDateKey } from '@/utils/validation'

/** 某一年的放假安排 */
export interface HolidayYear {
  /** 放假日期（YYYY-MM-DD）-> 节日名 */
  holidays: Record<string, string>
  /** 调休上班日（周末补班） */
  workdays: string[]
}

/** 全部内置数据，键为年份字符串 */
const DATA = holidaysData as Record<string, HolidayYear>

/** 已内置的年份（升序），UI 可据此提示「数据未更新」 */
export const HOLIDAY_YEARS: readonly number[] = Object.keys(DATA)
  .map(Number)
  .sort((a, b) => a - b)

/** 数据来源说明（提示语可引用，避免各处各写一份） */
export const HOLIDAY_DATA_SOURCE =
  '国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7 号）'

/** 某年是否已内置数据 */
export function hasHolidayData(year: number): boolean {
  return DATA[String(year)] !== undefined
}

/** 读取某年安排；没有该年数据时返回空结构（永不抛错） */
export function loadHolidays(year: number): HolidayYear {
  const data = DATA[String(year)]
  if (!data) return { holidays: {}, workdays: [] }
  // 返回浅拷贝：调用方改到的是副本，不会污染模块级 JSON 数据
  return { holidays: { ...data.holidays }, workdays: [...data.workdays] }
}

/** 日期对应的节日名；不是放假日期则 undefined */
export function holidayName(dateKey: string): string | undefined {
  if (!isValidDateKey(dateKey)) return undefined
  return DATA[dateKey.slice(0, 4)]?.holidays[dateKey]
}

/** 是否放假（含调休凑出来的假期） */
export function isHoliday(dateKey: string): boolean {
  return holidayName(dateKey) !== undefined
}

/** 是否调休补班日（周末上班） */
export function isMakeupWorkday(dateKey: string): boolean {
  if (!isValidDateKey(dateKey)) return false
  return DATA[dateKey.slice(0, 4)]?.workdays.includes(dateKey) ?? false
}

/** 某年某月（1..12）的放假日期，供日历打点/角标渲染 */
export function holidayDatesOfMonth(year: number, month1to12: number): Record<string, string> {
  const prefix = `${year}-${String(month1to12).padStart(2, '0')}-`
  const out: Record<string, string> = {}
  for (const [date, name] of Object.entries(loadHolidays(year).holidays)) {
    if (date.startsWith(prefix)) out[date] = name
  }
  return out
}

/**
 * 某年某月（1..12）的**调休补班日**，供月历标出「这天要上班」。
 * 与 holidayDatesOfMonth 配对使用：一个标「休」一个标「班」，
 * 免得用户看到周末却不知道要不要上班（这正是每年调休最容易被骂的点）。
 */
export function makeupWorkdaysOfMonth(year: number, month1to12: number): string[] {
  const prefix = `${year}-${String(month1to12).padStart(2, '0')}-`
  return loadHolidays(year)
    .workdays.filter((date) => date.startsWith(prefix))
    .sort()
}

/** 未来假期条目 */
export interface UpcomingHoliday {
  date: string
  name: string
  /** 距参照日期的天数，参照日当天为 0 */
  days: number
}

/**
 * fromKey（含当天）之后最近的若干条放假日期，按日期升序。
 *
 * 「天数」以 fromKey 当作「今天」来算——这样本函数不需要再引入一个时钟，
 * 也保证卡片、日历、倒计时三处用同一个参照日。跨年时会继续往后找
 * （走到没有数据的年份就停），找不到就返回已有的部分。
 */
export function upcomingHolidays(fromKey: string, limit = 3): UpcomingHoliday[] {
  if (limit <= 0 || !isValidDateKey(fromKey)) return []
  const [y, m, d] = fromKey.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  const out: UpcomingHoliday[] = []
  // 最多往后看 3 年：跨年（如 12-31）时当年已无假期，必须能拿到次年的
  for (let year = y; year <= y + 3 && out.length < limit; year++) {
    const { holidays } = loadHolidays(year)
    const dates = Object.keys(holidays)
      .filter((date) => date >= fromKey)
      .sort()
    for (const date of dates) {
      if (out.length >= limit) break
      out.push({ date, name: holidays[date], days: daysUntil(date, base) })
    }
  }
  return out
}

/**
 * 展示用的假期列表：同一个节日的连续放假合并成一条（取其第一天）。
 * 不合并的话 7 天国庆会把 3 个名额全占满，用户根本看不到后面的节日；
 * 日历打点需要逐日数据，用 holidayDatesOfMonth 而不是这个。
 */
export function upcomingFestivals(fromKey: string, limit = 3): UpcomingHoliday[] {
  const seen = new Set<string>()
  const out: UpcomingHoliday[] = []
  // 多取一些原始日期再合并（一个节日可能占 9 天）
  for (const holiday of upcomingHolidays(fromKey, Math.max(limit * 4, 12))) {
    if (seen.has(holiday.name)) continue
    seen.add(holiday.name)
    out.push(holiday)
    if (out.length >= limit) break
  }
  return out
}
