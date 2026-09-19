/**
 * 任务统计：聚合纯函数 + useTaskStatistics composable。
 * 纯函数便于单测（now 可注入），composable 连接 todoStore，供图表/热力图使用。
 */

import { computed } from 'vue'

import { useTodoStore } from '@/stores/todoStore'
import { addDays, toDateKey, todayKey } from '@/utils/dateFormatter'
import { PRIORITY_ORDER } from '@/utils/priorityHelper'
import type { Todo } from '@/types/todo'
import type { DailyStat, PriorityStat, TaskStatistics } from '@/types/statistics'

/** 近 N 天（含今天）的日期键列表，旧 -> 新 */
export function lastNDays(n: number, now: Date = new Date()): string[] {
  const today = todayKey(now)
  const days: string[] = []
  for (let i = n - 1; i >= 0; i--) days.push(addDays(today, -i))
  return days
}

/** 按优先级聚合：返回高 -> 中 -> 低 的总数与完成数 */
export function aggregateByPriority(todos: Todo[]): PriorityStat[] {
  return PRIORITY_ORDER.map((priority) => {
    const list = todos.filter((t) => t.priority === priority)
    return {
      priority,
      total: list.length,
      completed: list.filter((t) => t.status === 'completed').length,
    }
  })
}

/**
 * 近 N 天每日完成数聚合。
 * 将已完成任务按其 completedAt 归属到当天；范围外的日期键不计入，范围内无完成则为 0。
 */
export function aggregateDaily(todos: Todo[], days: number, now: Date = new Date()): DailyStat[] {
  const dateKeys = lastNDays(days, now)
  const counts = new Map<string, number>(dateKeys.map((d) => [d, 0]))

  for (const t of todos) {
    if (t.status !== 'completed' || !t.completedAt) continue
    const key = toDateKey(new Date(t.completedAt))
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return dateKeys.map((date) => ({ date, completed: counts.get(date) ?? 0 }))
}

/**
 * 热力图窗口（天，含今天）。
 * 对外表现是「星期横排、日期纵排」的一行一周日历，30 天 = 5~6 行，卡片高度才收得住；
 * 组件里的文案（"近 N 天…"）也读这个常量，避免口径与文案各说各话。
 */
export const HEATMAP_WINDOW_DAYS = 30

/** 汇总统计：总数、完成率、按优先级、近 HEATMAP_WINDOW_DAYS 天每日 */
export function computeStatistics(todos: Todo[], now: Date = new Date()): TaskStatistics {
  const total = todos.length
  const completed = todos.filter((t) => t.status === 'completed').length
  const active = total - completed
  return {
    total,
    completed,
    active,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    byPriority: aggregateByPriority(todos),
    daily: aggregateDaily(todos, HEATMAP_WINDOW_DAYS, now),
  }
}

/** 热力图单元：以日期对齐的 HEATMAP_WINDOW_DAYS 天色阶格 */
export interface HeatmapCell {
  /** YYYY-MM-DD；空位（对齐周一）为 null */
  date: string | null
  completed: number
  /** 0-4 强度级别（0 为空） */
  level: 0 | 1 | 2 | 3 | 4
}

/** 完成数 -> 强度级别（GitHub 式分档） */
export function heatmapLevel(completed: number): 0 | 1 | 2 | 3 | 4 {
  if (completed <= 0) return 0
  if (completed === 1) return 1
  if (completed === 2) return 2
  if (completed <= 4) return 3
  return 4
}

/** 日期键 -> 周内索引（周一=0 ... 周日=6） */
function weekdayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() // 0=日 ... 6=六
  return (dow + 6) % 7 // 0=一 ... 6=日
}

/**
 * 生成热力图矩阵：按周纵向排列（每周最多 7 格，周一为首）。
 * 首周会补前导空格，使第一个真实格落在周一列，便于对齐星期标签。
 */
export function buildHeatmapWeeks(daily: DailyStat[]): {
  weeks: (HeatmapCell | null)[][]
  leadingBlank: number
} {
  const first = daily[0]
  const leadingBlank = first ? weekdayIndex(first.date) : 0

  const cells: (HeatmapCell | null)[] = [
    ...Array.from({ length: leadingBlank }, () => null),
    ...daily.map((d) => ({
      date: d.date,
      completed: d.completed,
      level: heatmapLevel(d.completed),
    })),
  ]

  const weeks: (HeatmapCell | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  while (weeks[weeks.length - 1] && weeks[weeks.length - 1].length < 7) {
    weeks[weeks.length - 1].push(null)
  }

  return { weeks, leadingBlank }
}

/** 连接 todoStore 的任务统计数据（随任务变化自动更新） */
export function useTaskStatistics() {
  const store = useTodoStore()
  const statistics = computed<TaskStatistics>(() => computeStatistics(store.visibleTodos))
  const heatmap = computed(() => buildHeatmapWeeks(statistics.value.daily))
  return { statistics, heatmap }
}

// ---- 今日完成度（仪表板「完成度环形图」卡） ----

/** 今日完成度快照 */
export interface TodayProgress {
  /** 今日完成的任务数 */
  completedToday: number
  /** 今日到期但尚未完成的数量 */
  dueTodayActive: number
  /** 今日完成度 0~100：今日完成 ÷（今日完成 + 今日到期未完成） */
  rate: number
  /** 昨日完成数（用于涨跌对比） */
  completedYesterday: number
  /** 今日完成数相对昨日的涨跌百分比 */
  deltaPercent: number
  /** 今天是否有"该做的事"（没有到期任务且今天没完成任何事时为 false，UI 换文案） */
  hasTarget: boolean
}

/** 某天完成的任务数（按 completedAt 归属到当地日期） */
function completedOn(todos: Todo[], dateKey: string): number {
  return todos.filter(
    (t) =>
      t.status === 'completed' && t.completedAt && toDateKey(new Date(t.completedAt)) === dateKey,
  ).length
}

/** 完成数涨跌百分比：昨日为 0 时，今日有产出记 +100%，都为 0 记 0（避免除零与 Infinity） */
function completionTrend(today: number, yesterday: number): number {
  if (yesterday === 0) return today > 0 ? 100 : 0
  return ((today - yesterday) / yesterday) * 100
}

/**
 * 今日完成度：`今日完成 ÷（今日完成 + 今日到期未完成）`。
 * 分母刻意取"今天台面上的事"（做完的 + 该做没做的），既不重复计数，也不受历史任务量影响；
 * 今日没有到期任务且没完成任何事时 hasTarget 为 false，由 UI 换成"今日暂无到期任务"文案。
 */
export function computeTodayProgress(todos: Todo[], now: Date = new Date()): TodayProgress {
  const today = todayKey(now)
  const yesterday = addDays(today, -1)

  const completedToday = completedOn(todos, today)
  const completedYesterday = completedOn(todos, yesterday)
  const dueTodayActive = todos.filter((t) => t.status === 'active' && t.dueDate === today).length

  const denominator = completedToday + dueTodayActive
  const rate = denominator === 0 ? 0 : Math.round((completedToday / denominator) * 100)

  return {
    completedToday,
    dueTodayActive,
    rate,
    completedYesterday,
    deltaPercent: completionTrend(completedToday, completedYesterday),
    hasTarget: denominator > 0,
  }
}

/** 连接 todoStore 的今日完成度（随任务变化自动更新） */
export function useTodayProgress() {
  const store = useTodoStore()
  const progress = computed<TodayProgress>(() => computeTodayProgress(store.visibleTodos))
  return { progress }
}
