/**
 * 连续打卡（Streak）与周目标统计（纯函数，now / weekGoal 可注入便于测试）
 *
 * 口径约定（这里写清楚，避免以后各页面各算一套）：
 * - `current`：从今天往前数连续「有完成」的天数。**今天还没完成不算断**——
 *   直接改从昨天起算（当天还没过完，不该因为上午没做事就把坚持了很久的纪录清零）。
 * - `best`：只看近 90 天，避免远古的一串记录长期压着当前目标、也省掉全量回溯的开销。
 * - `bestWeekday`：近 90 天内完成数最多的星期几；**并列时取更靠前的星期**（周一优先，
 *   即数组从前到后第一个最大值），这样同样的数据永远给出同样的答案。
 */

import { addDays, endOfWeek, startOfWeek, toDateKey, todayKey } from './dateFormatter'
import type { Todo } from '@/types/todo'

/** 最佳纪录 / 最佳星期的统计窗口（天） */
export const STREAK_WINDOW_DAYS = 90

/** 周目标默认值（与 dashboardStore 的持久化默认值保持一致） */
export const DEFAULT_WEEK_GOAL = 20

/** 星期名：周一起（与 dateFormatter.startOfWeek 的「周一为一周起点」口径一致） */
export const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** 连续打卡与周目标快照 */
export interface StreakInfo {
  /** 当前连续天数（今天无完成时顺延到昨天起算，见文件头注释） */
  current: number
  /** 近 90 天内的最长连续天数 */
  best: number
  /** 近 90 天完成最多的星期几；窗口内没有任何完成时为 ''（占位文案交给 UI 决定） */
  bestWeekday: string
  /** 本周（周一 ~ 周日）完成数 */
  weekCompleted: number
  /** 周目标（个） */
  weekGoal: number
  /** 周目标完成率 0~100（已封顶，超额完成不显示 120%） */
  weekRate: number
  /** 是否已达成本周目标 */
  goalReached: boolean
}

/**
 * 周目标钳制：非法值（NaN / 无穷 / 0 / 负数 / 小数）统一落到 >= 1 的整数。
 * 目标为 0 会让完成率永远除零，所以这里是「兜底」而不是「校验后报错」。
 */
export function clampWeekGoal(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

/** dateKey -> 星期索引（周一=0 ... 周日=6） */
function weekdayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

/** 某天完成的任务数（按 completedAt 归到本地日期） */
export function countCompletedOn(todos: readonly Todo[], dateKey: string): number {
  return todos.filter(
    (t) =>
      t.status === 'completed' && t.completedAt && toDateKey(new Date(t.completedAt)) === dateKey,
  ).length
}

/**
 * 按本地日期归集完成数。
 * 连续天数是从今天往前逐日回看的，用 Map 查是 O(1)（比每天都 filter 一遍全部任务便宜）；
 * 同一张表还能直接给 bestWeekday 按星期累加，不必再遍历一次。
 */
function completionCounts(todos: readonly Todo[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const todo of todos) {
    if (todo.status !== 'completed' || !todo.completedAt) continue
    const key = toDateKey(new Date(todo.completedAt))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * 汇总连续打卡与周目标。
 * @param options.now      今天的基准（缺省取系统当前时间）
 * @param options.weekGoal 周目标（缺省 20；非法值经 clampWeekGoal 兜底）
 */
export function computeStreak(
  todos: readonly Todo[],
  options: { now?: Date; weekGoal?: number } = {},
): StreakInfo {
  const now = options.now ?? new Date()
  const weekGoal = clampWeekGoal(options.weekGoal ?? DEFAULT_WEEK_GOAL)
  const counts = completionCounts(todos)
  const today = todayKey(now)

  // current：今天有完成就从今天起算；今天还没有完成则从昨天起算（当天未过完，不算断档）
  let cursor = (counts.get(today) ?? 0) > 0 ? today : addDays(today, -1)
  let current = 0
  while ((counts.get(cursor) ?? 0) > 0) {
    current++
    cursor = addDays(cursor, -1)
  }

  // best / bestWeekday：窗口 = 今天往前数 90 天（含今天），一次扫描同时算出两者
  const byWeekday: number[] = WEEKDAY_NAMES.map(() => 0)
  let best = 0
  let run = 0
  for (let i = STREAK_WINDOW_DAYS - 1; i >= 0; i--) {
    const key = addDays(today, -i)
    const done = counts.get(key) ?? 0
    if (done > 0) {
      run++
      if (run > best) best = run
      byWeekday[weekdayIndex(key)] += done
    } else {
      run = 0
    }
  }

  const maxByWeekday = Math.max(...byWeekday)
  // 并列时取更靠前的星期：indexOf 返回第一个最大值的下标，天然满足「周一优先」
  const bestWeekday = maxByWeekday > 0 ? WEEKDAY_NAMES[byWeekday.indexOf(maxByWeekday)] : ''

  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  let weekCompleted = 0
  for (const [key, count] of counts) {
    if (key >= weekStart && key <= weekEnd) weekCompleted += count
  }

  return {
    current,
    best,
    bestWeekday,
    weekCompleted,
    weekGoal,
    weekRate: Math.min(100, Math.round((weekCompleted / weekGoal) * 100)),
    goalReached: weekCompleted >= weekGoal,
  }
}
