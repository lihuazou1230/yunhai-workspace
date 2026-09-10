import { describe, expect, it } from 'vitest'

import {
  aggregateByPriority,
  aggregateDaily,
  buildHeatmapWeeks,
  computeStatistics,
  computeTodayProgress,
  heatmapLevel,
  lastNDays,
} from './useStatistics'

import type { Todo } from '@/types/todo'

/** 固定"现在"，保证日期计算确定性 */
const NOW = new Date(2026, 8, 8, 10, 0, 0) // 2026-09-08

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: partial.title ?? '任务',
    status: 'active',
    priority: 'medium',
    createdAt: new Date().toISOString(),
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

describe('lastNDays', () => {
  it('返回含今天、旧到新的 N 天日期键', () => {
    expect(lastNDays(3, NOW)).toEqual(['2026-09-06', '2026-09-07', '2026-09-08'])
  })

  it('跨月正确进位', () => {
    const oct = new Date(2026, 9, 2, 12, 0, 0) // 2026-10-02
    expect(lastNDays(3, oct)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
  })
})

describe('aggregateByPriority', () => {
  it('按 高->中->低 排序，并统计总完成数', () => {
    const todos: Todo[] = [
      todo({ id: 'a', priority: 'high', status: 'completed' }),
      todo({ id: 'b', priority: 'high' }),
      todo({ id: 'c', priority: 'medium' }),
    ]
    const stats = aggregateByPriority(todos)
    expect(stats.map((s) => s.priority)).toEqual(['high', 'medium', 'low'])
    const high = stats[0]
    expect(high.total).toBe(2)
    expect(high.completed).toBe(1)
    expect(stats[1]).toMatchObject({ priority: 'medium', total: 1, completed: 0 })
  })
})

describe('aggregateDaily', () => {
  it('按 completedAt 归属到对应日期', () => {
    const todos: Todo[] = [
      todo({ id: 'a', status: 'completed', completedAt: '2026-09-07T09:00:00' }),
      todo({ id: 'b', status: 'completed', completedAt: '2026-09-07T18:00:00' }),
      todo({ id: 'c', status: 'completed', completedAt: '2026-09-05T09:00:00' }),
    ]
    const daily = aggregateDaily(todos, 5, NOW)
    expect(daily).toHaveLength(5)
    const byDate = Object.fromEntries(daily.map((d) => [d.date, d.completed]))
    expect(byDate).toEqual({
      '2026-09-04': 0,
      '2026-09-05': 1,
      '2026-09-06': 0,
      '2026-09-07': 2,
      '2026-09-08': 0,
    })
  })

  it('只统计已完成任务，未完成与范围外日期不计入', () => {
    const todos: Todo[] = [
      todo({ id: 'a', status: 'completed', completedAt: '2026-08-01T09:00:00' }), // 范围外
      todo({ id: 'b', status: 'active', completedAt: '2026-09-06T09:00:00' }), // 未完成，忽略
    ]
    const daily = aggregateDaily(todos, 5, NOW)
    expect(daily.every((d) => d.completed === 0)).toBe(true)
  })
})

describe('computeStatistics', () => {
  it('计算总数、完成数与完成率', () => {
    const todos: Todo[] = [
      todo({ id: 'a', status: 'completed', completedAt: '2026-09-07T09:00:00' }),
      todo({ id: 'b' }),
    ]
    const stats = computeStatistics(todos, NOW)
    expect(stats.total).toBe(2)
    expect(stats.completed).toBe(1)
    expect(stats.active).toBe(1)
    expect(stats.completionRate).toBe(50)
    expect(stats.daily).toHaveLength(90)
  })

  it('空列表完成率为 0', () => {
    const stats = computeStatistics([], NOW)
    expect(stats.completionRate).toBe(0)
    expect(stats.daily).toHaveLength(90)
  })
})

describe('heatmapLevel', () => {
  it('分档正确', () => {
    expect(heatmapLevel(0)).toBe(0)
    expect(heatmapLevel(1)).toBe(1)
    expect(heatmapLevel(2)).toBe(2)
    expect(heatmapLevel(3)).toBe(3)
    expect(heatmapLevel(4)).toBe(3)
    expect(heatmapLevel(5)).toBe(4)
    expect(heatmapLevel(10)).toBe(4)
  })
})

describe('buildHeatmapWeeks', () => {
  it('每周对齐并补齐 7 格，last 周不足补 null', () => {
    const daily = [
      { date: '2026-09-06', completed: 1 },
      { date: '2026-09-07', completed: 0 },
      { date: '2026-09-08', completed: 3 },
    ]
    const { weeks } = buildHeatmapWeeks(daily)
    expect(weeks.every((w) => w.length === 7)).toBe(true)

    // 所有非空格的日期与完成数一一对应
    const flat = weeks.flat().filter((c): c is NonNullable<typeof c> => c !== null)
    expect(flat.map((c) => c.date)).toEqual(['2026-09-06', '2026-09-07', '2026-09-08'])
    expect(flat.map((c) => c.completed)).toEqual([1, 0, 3])
    expect(flat[2].level).toBe(3)
  })

  it('真实首日前会出现前导空格以对齐周一', () => {
    const daily = [{ date: '2026-09-08', completed: 1 }]
    const { weeks, leadingBlank } = buildHeatmapWeeks(daily)
    expect(leadingBlank).toBeGreaterThanOrEqual(1)
    // 第一格为空格
    expect(weeks[0][0]).toBeNull()
    // 首个非空格必是真实日期
    expect(weeks[0].find((c) => c !== null)).toMatchObject({ date: '2026-09-08' })
  })
})

describe('computeTodayProgress（今日完成度）', () => {
  /** NOW = 2026-09-08 10:00（周二）；昨天为 2026-09-07 */
  const at = (day: number, hours = 10, minutes = 0) =>
    new Date(2026, 8, day, hours, minutes, 0).toISOString()

  function completed(id: string, completedAt: string, dueDate?: string): Todo {
    return todo({ id, status: 'completed', completedAt, dueDate })
  }

  it('完成度 = 今日完成 ÷（今日完成 + 今日到期未完成）', () => {
    const todos = [
      completed('a', at(8, 9)),
      completed('b', at(8, 9, 30)),
      todo({ id: 'c', dueDate: '2026-09-08' }), // 今日到期未完成
      todo({ id: 'd', dueDate: '2026-09-09' }), // 明天到期，不计入
    ]
    const progress = computeTodayProgress(todos, NOW)
    expect(progress.completedToday).toBe(2)
    expect(progress.dueTodayActive).toBe(1)
    expect(progress.rate).toBe(67) // 2/3
    expect(progress.hasTarget).toBe(true)
  })

  it('分母为 0（今日无事）时完成度为 0 且 hasTarget 为 false', () => {
    const progress = computeTodayProgress([todo({ id: 'a', dueDate: '2026-09-20' })], NOW)
    expect(progress.rate).toBe(0)
    expect(progress.completedToday).toBe(0)
    expect(progress.hasTarget).toBe(false)
  })

  it('只统计今天的完成数，昨天/明天的完成不算', () => {
    const todos = [completed('a', at(7, 23)), completed('b', at(9, 9)), completed('c', at(8, 9))]
    const progress = computeTodayProgress(todos, NOW)
    expect(progress.completedToday).toBe(1)
    expect(progress.completedYesterday).toBe(1)
  })

  it('涨跌：与昨日完成数对比，昨日为 0 而今日有产出算 +100%', () => {
    const onlyYesterday = computeTodayProgress([completed('a', at(7, 9))], NOW)
    expect(onlyYesterday.deltaPercent).toBe(-100)

    const onlyToday = computeTodayProgress([completed('a', at(8, 9))], NOW)
    expect(onlyToday.deltaPercent).toBe(100)

    const bothSame = computeTodayProgress([completed('a', at(7, 9)), completed('b', at(8, 9))], NOW)
    expect(bothSame.deltaPercent).toBe(0)
  })

  it('涨跌：成倍增长时按比例计算', () => {
    const todos = [
      completed('y1', at(7, 9)),
      completed('y2', at(7, 9)),
      completed('t1', at(8, 9)),
      completed('t2', at(8, 9)),
      completed('t3', at(8, 9)),
    ]
    // 昨日 2 项、今日 3 项 => +50%
    expect(computeTodayProgress(todos, NOW).deltaPercent).toBe(50)
  })

  it('今日无产出且昨日也无产出时涨跌为 0（持平）', () => {
    expect(computeTodayProgress([], NOW).deltaPercent).toBe(0)
  })
})
