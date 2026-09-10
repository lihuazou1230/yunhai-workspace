import { describe, expect, it } from 'vitest'

import {
  buildMonthGrid,
  countByDate,
  isViewingCurrentMonth,
  monthLabel,
  shiftMonth,
} from './miniCalendar'
import type { CalendarDay, MonthGrid } from './miniCalendar'

const NOW = new Date(2026, 8, 15, 10, 0) // 2026-09-15（周二）

/** 剔除 null 占位后的真实日期 */
function days(grid: MonthGrid): CalendarDay[] {
  return grid.weeks.flat().filter((c): c is CalendarDay => c !== null)
}

describe('miniCalendar', () => {
  it('monthLabel 输出「YYYY年M月」', () => {
    expect(monthLabel(NOW)).toBe('2026年9月')
    expect(monthLabel(new Date(2026, 0, 3))).toBe('2026年1月')
    expect(monthLabel(new Date(2026, 11, 31))).toBe('2026年12月')
  })

  it('周一为首列：2026-09-01 是周二，首格留空', () => {
    const grid = buildMonthGrid(NOW)
    expect(grid.weeks[0][0]).toBeNull()
    expect(grid.weeks[0][1]?.date).toBe('2026-09-01')
    expect(grid.weeks[0][1]?.day).toBe(1)
  })

  it('恰好从周一开始的月份没有前导空位', () => {
    // 2026-06-01 是周一
    const grid = buildMonthGrid(new Date(2026, 5, 10, 10, 0))
    expect(grid.weeks[0][0]?.date).toBe('2026-06-01')
    expect(grid.weeks[0][0]?.isCurrentMonth).toBe(true)
    // 30 天正好从周一开始：尾部补 5 格
    expect(grid.weeks.flat().filter((c) => c === null)).toHaveLength(5)
  })

  it('每周固定 7 格，前导/尾部都是 null 占位（30 / 31 / 29 天各验一遍）', () => {
    const cases: Array<{ now: Date; dayCount: number }> = [
      { now: new Date(2026, 8, 15), dayCount: 30 }, // 2026-09：周二开头，尾补 4
      { now: new Date(2026, 5, 10), dayCount: 30 }, // 2026-06：周一开头，尾补 5
      { now: new Date(2026, 7, 3), dayCount: 31 }, // 2026-08：周六开头，6 周
      { now: new Date(2026, 10, 3), dayCount: 30 }, // 2026-11：周日开头，6 周
    ]

    for (const { now, dayCount } of cases) {
      const grid = buildMonthGrid(now)
      expect(grid.weeks.every((week) => week.length === 7)).toBe(true)
      expect(days(grid)).toHaveLength(dayCount)
      expect(grid.weeks.flat()).toHaveLength(grid.weeks.length * 7)
      expect(grid.month).toBe(now.getMonth() + 1)
      expect(grid.year).toBe(now.getFullYear())
    }
  })

  it('闰年 2028-02 有 29 天，最后一天是 2028-02-29', () => {
    const grid = buildMonthGrid(new Date(2028, 1, 10, 10, 0))
    expect(grid.label).toBe('2028年2月')
    expect(grid.month).toBe(2)
    const list = days(grid)
    expect(list).toHaveLength(29)
    expect(list[list.length - 1]?.date).toBe('2028-02-29')
    expect(list[list.length - 1]?.day).toBe(29)
  })

  it('平年 2026-02 只有 28 天', () => {
    expect(days(buildMonthGrid(new Date(2026, 1, 10)))).toHaveLength(28)
  })

  it('isToday 只命中注入的今天', () => {
    const grid = buildMonthGrid(NOW)
    const list = days(grid)
    expect(list.filter((c) => c.isToday).map((c) => c.date)).toEqual(['2026-09-15'])
    expect(list.every((c) => c.isCurrentMonth)).toBe(true)
  })

  it('展示的月份与「今天」解耦：翻到别的月份时没有 isToday', () => {
    const view = shiftMonth(NOW, 1)
    const grid = buildMonthGrid(NOW, view)
    expect(grid.label).toBe('2026年10月')
    expect(days(grid).some((c) => c.isToday)).toBe(false)
    // 回到当月仍然命中今天
    expect(days(buildMonthGrid(NOW, shiftMonth(NOW, 0))).filter((c) => c.isToday)).toHaveLength(1)
  })

  it('shiftMonth 返回目标月 1 号，并跨年进位', () => {
    const same = shiftMonth(NOW, 0)
    expect(same.getFullYear()).toBe(2026)
    expect(same.getMonth()).toBe(8)
    expect(same.getDate()).toBe(1)

    const next = shiftMonth(NOW, 1)
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 9, 1])

    const overYear = shiftMonth(new Date(2026, 11, 20), 1)
    expect([overYear.getFullYear(), overYear.getMonth()]).toEqual([2027, 0])

    const backYear = shiftMonth(new Date(2026, 0, 5), -1)
    expect([backYear.getFullYear(), backYear.getMonth()]).toEqual([2025, 11])

    const longBack = shiftMonth(NOW, -14)
    expect([longBack.getFullYear(), longBack.getMonth()]).toEqual([2025, 6])
  })

  it('isViewingCurrentMonth 跨月与跨年都判否', () => {
    expect(isViewingCurrentMonth(shiftMonth(NOW, 0), NOW)).toBe(true)
    expect(isViewingCurrentMonth(shiftMonth(NOW, 1), NOW)).toBe(false)
    expect(isViewingCurrentMonth(new Date(2025, 8, 1), NOW)).toBe(false)
    expect(isViewingCurrentMonth(new Date(2026, 7, 1), NOW)).toBe(false)
  })

  it('countByDate 给出每天的活动次数，未出现的日期查不到', () => {
    const counts = countByDate(['2026-09-10', '2026-09-10', '2026-09-12'])
    expect(counts.get('2026-09-10')).toBe(2)
    expect(counts.get('2026-09-12')).toBe(1)
    expect(counts.has('2026-09-11')).toBe(false)
    expect(countByDate([]).size).toBe(0)
  })

  it('缺省取系统当前时间所在月', () => {
    const now = new Date()
    const grid = buildMonthGrid(now)
    expect(grid.year).toBe(now.getFullYear())
    expect(grid.month).toBe(now.getMonth() + 1)
  })
})
