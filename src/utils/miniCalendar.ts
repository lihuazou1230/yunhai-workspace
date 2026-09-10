/**
 * 迷你月历网格（纯函数，日期可注入便于测试）
 *
 * 输出「按周切好的二维网格」而不是一维日期数组：模板直接把它铺进
 * `grid-template-columns: repeat(7, 1fr)` 的容器即可对齐，不必在模板里再算下标。
 */

import { toDateKey } from './dateFormatter'

/** 月历中的一天 */
export interface CalendarDay {
  /** YYYY-MM-DD（本地时区） */
  date: string
  /** 当月第几天（1~31），直接渲染 */
  day: number
  /** 是否今天（对照 `now`，而不是对照展示的月份） */
  isToday: boolean
  /**
   * 是否属于当前展示的月份。
   * 当前实现把跨月位置留成 null 占位，所以真实格子恒为 true；
   * 保留这个字段是为了让「显示相邻月份日期」这类改法不必动类型与调用方。
   */
  isCurrentMonth: boolean
}

/** 一个月历网格 */
export interface MonthGrid {
  year: number
  /** 1~12（不是 JS 的 0~11：展示层拿到就能直接用，少一次 +1 的机会出错） */
  month: number
  /** 每周固定 7 格，跨月的空位为 null */
  weeks: (CalendarDay | null)[][]
  /** 标题文案，如 2026年9月 */
  label: string
}

/** 标题文案：2026年9月 */
export function monthLabel(now: Date = new Date()): string {
  return `${now.getFullYear()}年${now.getMonth() + 1}月`
}

/** 目标月份的第一天（delta 正数往后、负数往前，跨年自动进位） */
export function shiftMonth(now: Date, delta: number): Date {
  const target = now.getMonth() + delta
  const year = now.getFullYear() + Math.floor(target / 12)
  const month = ((target % 12) + 12) % 12
  return new Date(year, month, 1)
}

/** 展示的月份是否就是当前月（组件据此决定要不要露出「今天」按钮） */
export function isViewingCurrentMonth(view: Date, now: Date = new Date()): boolean {
  return view.getFullYear() === now.getFullYear() && view.getMonth() === now.getMonth()
}

/**
 * 生成网格：周一为首列，每周恰好 7 格，跨月位置用 null 占位。
 *
 * 占位用 null 而不是「上/下月的日期」，是为了让模板不必再判断「这格能不能点」——
 * null 直接渲染成不可交互的空 span，既不会被点到，也不会画出小圆点。
 *
 * @param now  今天的基准（决定 isToday）；缺省取系统当前时间
 * @param view 要展示的月份（只需年月，内部取 1 号）；缺省与 `now` 同月
 */
export function buildMonthGrid(now: Date = new Date(), view: Date = now): MonthGrid {
  const year = view.getFullYear()
  const month = view.getMonth()
  const leading = (new Date(year, month, 1).getDay() + 6) % 7 // 周日=0 → 转成周一=0
  const dayCount = new Date(year, month + 1, 0).getDate()
  const today = toDateKey(now)

  const cells: (CalendarDay | null)[] = Array.from({ length: leading }, () => null)
  for (let day = 1; day <= dayCount; day++) {
    const date = toDateKey(new Date(year, month, day))
    cells.push({ date, day, isToday: date === today, isCurrentMonth: true })
  }
  // 尾部补齐到 7 的整数倍：少一格就会让最后一行的列整体左移
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (CalendarDay | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return { year, month: month + 1, weeks, label: monthLabel(view) }
}

/**
 * 日期集合 → 计数表。
 * UI 真正关心的是「这天有没有产出」（要不要画小圆点），用 Map 查一次是 O(1)，
 * 比每个格子都回头遍历一遍数组便宜得多；顺带留下次数，未来要做「越忙点越深」也不用改签名。
 */
export function countByDate(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}
