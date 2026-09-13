import { describe, expect, it } from 'vitest'

import { addDays, todayKey } from './dateFormatter'
import {
  aggregateDailyTrend,
  aggregateHourly,
  aggregateScatter,
  aggregateTagShare,
  completedDateKey,
  computeAnnualReport,
  countCompletedInRange,
  eachDay,
  filterCompletedInRange,
  formatDateText,
  formatHoursText,
  formatMonthText,
  isInRange,
  longestStreakOfYear,
  movingAverage,
  pearsonCorrelation,
  rangeStartKey,
  reportYears,
  toHeatmapSeriesData,
  todoDurationHours,
  trendStartKey,
  UNTAGGED_ID,
} from './stats'
import type { WorkLog } from './workLog'
import type { Tag } from '@/types/tag'
import type { Todo } from '@/types/todo'

/** 2026-09-15 是周二；所在周为 2026-09-14（周一）~ 2026-09-20（周日） */
const NOW = new Date(2026, 8, 15, 10, 0)

/** NOW 之前 5 天（2026-09-10，上周四） */
const BEFORE_RANGE = '2026-09-10'

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: '任务',
    status: 'active',
    priority: 'medium',
    createdAt: new Date(2026, 8, 1, 9, 0).toISOString(),
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

/** 在 dateKey 的某个整点完成 */
function doneAt(id: string, dateKey: string, hour = 12, extra: Partial<Todo> = {}): Todo {
  const [y, m, d] = dateKey.split('-').map(Number)
  return todo({
    id,
    status: 'completed',
    completedAt: new Date(y, m - 1, d, hour, 0).toISOString(),
    ...extra,
  })
}

const TAGS: Tag[] = [
  { id: 't-work', name: '工作', color: 'sky' },
  { id: 't-life', name: '生活', color: 'emerald' },
]

describe('stats · 范围', () => {
  it('rangeStartKey：本周=周一、本月=1 日、全部=null', () => {
    expect(rangeStartKey('week', NOW)).toBe('2026-09-14')
    expect(rangeStartKey('month', NOW)).toBe('2026-09-01')
    expect(rangeStartKey('all', NOW)).toBeNull()
  })

  it('isInRange 含起点、排除未来', () => {
    expect(isInRange('2026-09-14', 'week', NOW)).toBe(true)
    expect(isInRange('2026-09-13', 'week', NOW)).toBe(false)
    expect(isInRange('2026-09-15', 'month', NOW)).toBe(true)
    expect(isInRange('2026-08-31', 'month', NOW)).toBe(false)
    expect(isInRange('2026-09-16', 'all', NOW)).toBe(false)
    expect(isInRange('2020-01-01', 'all', NOW)).toBe(true)
  })

  it('trendStartKey：全部收敛到近 6 周（42 天）', () => {
    expect(trendStartKey('week', NOW)).toBe('2026-09-14')
    expect(trendStartKey('month', NOW)).toBe('2026-09-01')
    expect(trendStartKey('all', NOW)).toBe(addDays(todayKey(NOW), -41))
  })

  it('eachDay 含首尾；起止颠倒返回空数组', () => {
    expect(eachDay('2026-09-14', '2026-09-16')).toEqual(['2026-09-14', '2026-09-15', '2026-09-16'])
    expect(eachDay('2026-09-14', '2026-09-14')).toEqual(['2026-09-14'])
    expect(eachDay('2026-09-16', '2026-09-14')).toEqual([])
  })
})

describe('stats · 完成任务归集', () => {
  it('completedDateKey 只认「已完成 + 合法时间戳」', () => {
    expect(completedDateKey(doneAt('a', '2026-09-15'))).toBe('2026-09-15')
    expect(completedDateKey(todo({ id: 'b' }))).toBeNull()
    expect(completedDateKey(todo({ id: 'c', status: 'completed' }))).toBeNull()
    expect(
      completedDateKey(todo({ id: 'd', status: 'completed', completedAt: 'not-a-date' })),
    ).toBeNull()
  })

  it('filterCompletedInRange / countCompletedInRange 按范围与完成时间筛选', () => {
    const todos = [
      doneAt('a', '2026-09-15'),
      doneAt('b', BEFORE_RANGE),
      doneAt('c', '2026-08-20'),
      todo({ id: 'd' }),
    ]
    expect(countCompletedInRange(todos, 'week', NOW)).toBe(1)
    expect(countCompletedInRange(todos, 'month', NOW)).toBe(2)
    expect(countCompletedInRange(todos, 'all', NOW)).toBe(3)
    expect(filterCompletedInRange(todos, 'all', NOW).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('todoDurationHours：创建→完成的小时数；时钟倒挂/缺失返回 null', () => {
    const created = new Date(2026, 8, 15, 9, 0)
    const finished = new Date(2026, 8, 15, 12, 30)
    expect(
      todoDurationHours(
        todo({
          id: 'a',
          status: 'completed',
          createdAt: created.toISOString(),
          completedAt: finished.toISOString(),
        }),
      ),
    ).toBe(3.5)
    // 完成时间早于创建时间（时钟被改）不算样本
    expect(
      todoDurationHours(
        todo({
          id: 'b',
          status: 'completed',
          createdAt: finished.toISOString(),
          completedAt: created.toISOString(),
        }),
      ),
    ).toBeNull()
    expect(todoDurationHours(todo({ id: 'c' }))).toBeNull()
  })
})

describe('stats · 标签占比', () => {
  it('按首个标签归类，占比之和为 100', () => {
    const items = aggregateTagShare(
      [
        doneAt('a', '2026-09-15', 10, { tags: ['t-work'] }),
        doneAt('b', '2026-09-15', 11, { tags: ['t-work', 't-life'] }), // 双标签只算首个
        doneAt('c', '2026-09-15', 12, { tags: ['t-life'] }),
        doneAt('d', '2026-09-15', 13),
      ],
      TAGS,
      'week',
      NOW,
    )
    expect(items[0]).toMatchObject({ name: '工作', completed: 2, share: 50 })
    // 后两项都是 1 项，排序在中文本地化下依赖 ICU，这里只断言集合（并列的名次不是契约）
    expect(
      items
        .slice(1)
        .map((i) => i.name)
        .sort(),
    ).toEqual(['生活', '无标签'].sort())
    expect(items.filter((i) => i.id === UNTAGGED_ID)[0].color).toBeNull()
    expect(items.reduce((sum, i) => sum + i.share, 0)).toBe(100)
  })

  it('平均耗时只统计有样本的条目，无样本为 null', () => {
    const inRange = new Date(2026, 8, 14, 9, 0).toISOString()
    const items = aggregateTagShare(
      [
        todo({
          id: 'a',
          status: 'completed',
          createdAt: inRange,
          completedAt: new Date(2026, 8, 14, 12, 0).toISOString(),
          tags: ['t-work'],
        }),
        // 这条没有 createdAt 样本（时钟倒挂）
        todo({
          id: 'b',
          status: 'completed',
          createdAt: new Date(2026, 8, 14, 13, 0).toISOString(),
          completedAt: new Date(2026, 8, 14, 12, 0).toISOString(),
          tags: ['t-work'],
        }),
      ],
      TAGS,
      'week',
      NOW,
    )
    expect(items[0].avgHours).toBe(3)
    expect(items[0].completed).toBe(2)

    const untagged = aggregateTagShare(
      [doneAt('c', '2026-09-15', 12, { tags: [] })],
      TAGS,
      'week',
      NOW,
    )
    // createdAt 是 09-01 09:00，completedAt 是 09-15 12:00 → 有样本
    expect(untagged[0].avgHours).not.toBeNull()
  })

  it('标签被删掉但任务还留着 id 时给兜底文案而不是空名字', () => {
    const items = aggregateTagShare(
      [doneAt('a', '2026-09-15', 12, { tags: ['gone'] })],
      TAGS,
      'week',
      NOW,
    )
    expect(items[0].name).toBe('已删除标签')
    expect(items[0].color).toBeNull()
  })

  it('范围内没有完成记录时返回空数组（页面走空状态）', () => {
    expect(aggregateTagShare([doneAt('a', BEFORE_RANGE)], TAGS, 'week', NOW)).toEqual([])
  })
})

describe('stats · 完成时段', () => {
  it('按本地小时与星期落格，并给出峰值', () => {
    const heatmap = aggregateHourly(
      [
        doneAt('a', '2026-09-15', 9),
        doneAt('b', '2026-09-15', 9),
        doneAt('c', '2026-09-15', 21),
        doneAt('d', BEFORE_RANGE, 9), // 范围外
      ],
      'week',
      NOW,
    )
    expect(heatmap.total).toBe(3)
    expect(heatmap.max).toBe(2)
    expect(heatmap.counts[1][9]).toBe(2) // 周二 09:00
    expect(heatmap.counts[1][21]).toBe(1)
    expect(heatmap.counts[1][10]).toBe(0)
  })

  it('toHeatmapSeriesData 跳过 0 值格并输出 [小时, 星期, 数]', () => {
    const heatmap = aggregateHourly([doneAt('a', '2026-09-15', 9)], 'week', NOW)
    expect(toHeatmapSeriesData(heatmap)).toEqual([[9, 1, 1]])
  })

  it('空数据：max 0、total 0、没有数据点', () => {
    const heatmap = aggregateHourly([], 'week', NOW)
    expect(heatmap).toMatchObject({ max: 0, total: 0 })
    expect(toHeatmapSeriesData(heatmap)).toEqual([])
    expect(heatmap.counts).toHaveLength(7)
    expect(heatmap.counts[0]).toHaveLength(24)
  })
})

describe('stats · 趋势与移动平均', () => {
  it('movingAverage 在起点用已有项（曲线不断头）', () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5])
    expect(movingAverage([2, 4], 7)).toEqual([2, 3])
    expect(movingAverage([], 3)).toEqual([])
    // 窗口非法值收敛到 1
    expect(movingAverage([1, 5], 0)).toEqual([1, 5])
  })

  it('aggregateDailyTrend 逐日补零，并把移动平均一起返回', () => {
    const points = aggregateDailyTrend(
      [doneAt('a', '2026-09-15', 9), doneAt('b', '2026-09-15', 10), doneAt('c', '2026-09-14', 9)],
      '2026-09-14',
      NOW,
      2,
    )
    expect(points.map((p) => p.date)).toEqual(['2026-09-14', '2026-09-15'])
    expect(points.map((p) => p.completed)).toEqual([1, 2])
    expect(points.map((p) => p.movingAvg)).toEqual([1, 1.5])
  })

  it('起点晚于今天时返回空数组', () => {
    expect(aggregateDailyTrend([], '2026-09-20', NOW)).toEqual([])
  })

  it('范围外的完成不计入趋势窗口', () => {
    const points = aggregateDailyTrend([doneAt('a', BEFORE_RANGE)], '2026-09-14', NOW)
    expect(points.reduce((sum, p) => sum + p.completed, 0)).toBe(0)
  })
})

describe('stats · 投入产出散点', () => {
  const workLog: WorkLog = {
    '2026-09-14': 8 * 3600,
    '2026-09-15': 4 * 3600,
    '2026-09-11': 6 * 3600,
  }

  it('日期取「有完成」∪「有投入」，两端都为 0 的天跳过', () => {
    const todos = [doneAt('a', '2026-09-15'), doneAt('b', '2026-09-13')]

    // 本周（09-14 起）：只有 09-14（只投入）与 09-15（两者都有）
    expect(
      aggregateScatter(todos, workLog, 'week', NOW).map((p) => [p.date, p.hours, p.completed]),
    ).toEqual([
      ['2026-09-14', 8, 0],
      ['2026-09-15', 4, 1],
    ])

    // 本月：把 09-11（只投入）与 09-13（只完成，投入 0）也纳入——这正是散点图要区分的两类日子
    expect(
      aggregateScatter(todos, workLog, 'month', NOW).map((p) => [p.date, p.hours, p.completed]),
    ).toEqual([
      ['2026-09-11', 6, 0],
      ['2026-09-13', 0, 1],
      ['2026-09-14', 8, 0],
      ['2026-09-15', 4, 1],
    ])
  })

  it('「全部」窗口收敛到近 180 天', () => {
    const old = addDays(todayKey(NOW), -200)
    const points = aggregateScatter([], { ...workLog, [old]: 3600 }, 'all', NOW)
    expect(points.map((p) => p.date)).not.toContain(old)
  })

  it('没有任何数据时返回空数组', () => {
    expect(aggregateScatter([], {}, 'week', NOW)).toEqual([])
  })
})

describe('stats · 相关系数', () => {
  it('完全正相关为 1，完全负相关为 -1，保留两位小数', () => {
    expect(
      pearsonCorrelation([
        { date: '2026-09-14', hours: 1, completed: 1 },
        { date: '2026-09-15', hours: 2, completed: 2 },
      ]),
    ).toBe(1)
    expect(
      pearsonCorrelation([
        { date: '2026-09-14', hours: 1, completed: 5 },
        { date: '2026-09-15', hours: 2, completed: 1 },
      ]),
    ).toBe(-1)
  })

  it('样本不足 2 或某一维没有波动时返回 null（那种 r 是假的）', () => {
    expect(pearsonCorrelation([])).toBeNull()
    expect(pearsonCorrelation([{ date: '2026-09-15', hours: 1, completed: 3 }])).toBeNull()
    expect(
      pearsonCorrelation([
        { date: '2026-09-14', hours: 8, completed: 1 },
        { date: '2026-09-15', hours: 8, completed: 4 },
      ]),
    ).toBeNull()
  })
})

describe('stats · 年度报告', () => {
  const workLog: WorkLog = {
    '2026-09-14': 8 * 3600,
    '2026-09-15': 4 * 3600,
    '2025-12-31': 3600,
  }

  it('全年完成数 / 产出天数 / 日均 / 最高效月 / 最猛的一天', () => {
    const report = computeAnnualReport(
      [
        doneAt('a', '2026-03-02', 9, { tags: ['t-work'] }),
        doneAt('b', '2026-03-02', 15, { tags: ['t-work'] }),
        doneAt('c', '2026-03-02', 16),
        doneAt('d', '2026-09-15', 10, { tags: ['t-life'] }),
        doneAt('e', '2025-12-31', 10), // 去年的记录不算
        todo({ id: 'f', createdAt: new Date(2026, 2, 1, 9, 0).toISOString() }),
      ],
      workLog,
      TAGS,
      2026,
    )
    expect(report.completed).toBe(4)
    expect(report.activeDays).toBe(2)
    expect(report.avgPerActiveDay).toBe(2)
    expect(report.bestMonth).toEqual({ month: 3, completed: 3 })
    expect(report.busiestDay).toEqual({ date: '2026-03-02', completed: 3 })
    expect(report.topTag).toEqual({ name: '工作', completed: 2 })
    expect(report.hasData).toBe(true)
  })

  it('投入总时长只算该年，并统计有投入的天数', () => {
    const report = computeAnnualReport([], workLog, TAGS, 2026)
    expect(report.workSeconds).toBe(12 * 3600)
    expect(report.workDays).toBe(2)
    // 只有投入、没有完成时也算「有数据」（页面上能看到投入总时长）
    expect(report.hasData).toBe(true)
  })

  it('该年新建任务的完成率', () => {
    const report = computeAnnualReport(
      [
        todo({
          id: 'a',
          createdAt: new Date(2026, 0, 5).toISOString(),
          status: 'completed',
          completedAt: new Date(2026, 0, 6).toISOString(),
        }),
        todo({ id: 'b', createdAt: new Date(2026, 0, 7).toISOString() }),
        todo({ id: 'c', createdAt: new Date(2025, 0, 7).toISOString() }), // 去年建的，不进分母
      ],
      {},
      TAGS,
      2026,
    )
    expect(report.created).toBe(2)
    expect(report.completionRate).toBe(50)
  })

  it('完全空白的一年：各项为 0 / null，hasData 为 false', () => {
    const report = computeAnnualReport([], {}, TAGS, 2026)
    expect(report).toMatchObject({
      completed: 0,
      created: 0,
      completionRate: 0,
      activeDays: 0,
      avgPerActiveDay: 0,
      bestMonth: null,
      longestStreak: 0,
      busiestDay: null,
      workSeconds: 0,
      workDays: 0,
      topTag: null,
      hasData: false,
    })
  })

  it('最长连续完成天数按整年逐日回看（跨月不断档）', () => {
    const counts = new Map<string, number>([
      ['2026-01-30', 1],
      ['2026-01-31', 2],
      ['2026-02-01', 1],
      ['2026-03-01', 1],
      ['2026-03-02', 1],
    ])
    expect(longestStreakOfYear(counts, 2026)).toBe(3)
    expect(longestStreakOfYear(new Map(), 2026)).toBe(0)
  })

  it('reportYears 汇总有数据的年份，倒序，且总包含今年', () => {
    const years = reportYears(
      [doneAt('a', '2024-05-05'), doneAt('b', '2026-09-15'), todo({ id: 'c' })],
      { '2025-01-01': 60 },
      NOW,
    )
    expect(years).toEqual([2026, 2025, 2024])
  })

  it('reportYears 忽略非法年份，并受 limit 限制', () => {
    const years = reportYears([], { 'not-a-key': 1, '1960-01-01': 1, '2025-01-01': 1 }, NOW, 1)
    expect(years).toEqual([2026])
  })
})

describe('stats · 文案', () => {
  it('月份/日期文案', () => {
    expect(formatMonthText(3)).toBe('3 月')
    expect(formatDateText('2026-03-02')).toBe('3 月 2 日')
  })

  it('时长文案分档（100 小时以上取整）', () => {
    expect(formatHoursText(0)).toBe('0 小时')
    expect(formatHoursText(-5)).toBe('0 小时')
    expect(formatHoursText(Number.NaN)).toBe('0 小时')
    expect(formatHoursText(8.5 * 3600)).toBe('8.5 小时')
    expect(formatHoursText(312.4 * 3600)).toBe('312 小时')
  })
})
