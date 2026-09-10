import { describe, expect, it } from 'vitest'

import { addDays, todayKey } from './dateFormatter'
import {
  DEFAULT_WEEK_GOAL,
  WEEKDAY_NAMES,
  clampWeekGoal,
  computeStreak,
  countCompletedOn,
} from './streak'
import type { Todo } from '@/types/todo'

/** 2026-09-15 是周二，所在周为 2026-09-14（周一）~ 2026-09-20（周日） */
const NOW = new Date(2026, 8, 15, 10, 0)

const TODAY = todayKey(NOW)

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

/** 造一条「在 dateKey 当天完成」的任务（completedAt 用当天的本地中午，避免时区把日期推偏） */
function doneOn(id: string, dateKey: string): Todo {
  const [y, m, d] = dateKey.split('-').map(Number)
  return todo({
    id,
    status: 'completed',
    completedAt: new Date(y, m - 1, d, 12, 0).toISOString(),
  })
}

/** 从 dateKey 起连续 n 天，每天一条完成记录 */
function doneRun(prefix: string, startKey: string, n: number): Todo[] {
  return Array.from({ length: n }, (_, i) => doneOn(`${prefix}${i}`, addDays(startKey, i)))
}

describe('streak', () => {
  it('countCompletedOn 只数「当天完成」的任务', () => {
    const todos = [
      doneOn('a', '2026-09-15'),
      doneOn('b', '2026-09-15'),
      doneOn('c', '2026-09-14'),
      todo({ id: 'd' }), // 进行中
      todo({ id: 'e', status: 'completed' }), // 已完成但没有 completedAt
    ]
    expect(countCompletedOn(todos, '2026-09-15')).toBe(2)
    expect(countCompletedOn(todos, '2026-09-14')).toBe(1)
    expect(countCompletedOn(todos, '2026-09-13')).toBe(0)
  })

  it('今天有完成：连续天数从今天算起', () => {
    const todos = doneRun('a', '2026-09-13', 3) // 09-13（周日）~ 09-15（今天）
    const info = computeStreak(todos, { now: NOW })

    // 09-13（周日）不在本周（09-14 ~ 09-20）内，只算 09-14、09-15 两条
    expect(info.current).toBe(3)
    expect(info.best).toBe(3)
    expect(info.weekCompleted).toBe(2)
  })

  it('今天还没完成：顺延到昨天起算（当天未过完不算断档）', () => {
    const todos = [doneOn('a', '2026-09-13'), doneOn('b', '2026-09-14')]
    const info = computeStreak(todos, { now: NOW })

    expect(info.current).toBe(2)
    expect(info.weekCompleted).toBe(1)
  })

  it('今天与昨天都没有完成：连续天数归零', () => {
    const todos = [doneOn('a', '2026-09-13'), doneOn('b', '2026-09-12')]
    expect(computeStreak(todos, { now: NOW }).current).toBe(0)
    expect(computeStreak(todos, { now: NOW }).best).toBe(2)
  })

  it('中间断一天：连续天数停在缺口处', () => {
    const todos = [
      doneOn('a', '2026-09-15'),
      doneOn('b', '2026-09-14'),
      // 09-13 空缺
      doneOn('c', '2026-09-12'),
      doneOn('d', '2026-09-11'),
      doneOn('e', '2026-09-10'),
    ]
    const info = computeStreak(todos, { now: NOW })

    expect(info.current).toBe(2)
    expect(info.best).toBe(3)
  })

  it('同一天完成多条只算一天（不断档也不叠加）', () => {
    const todos = [doneOn('a', '2026-09-15'), doneOn('b', '2026-09-15'), doneOn('c', '2026-09-14')]
    const info = computeStreak(todos, { now: NOW })

    expect(info.current).toBe(2)
    expect(info.best).toBe(2)
  })

  it('best 只看近 90 天：窗口外的长连击不算数', () => {
    const oldStart = addDays(TODAY, -100)
    const todos = [...doneRun('old', oldStart, 5), ...doneRun('new', addDays(TODAY, -2), 3)]
    const info = computeStreak(todos, { now: NOW })

    expect(info.current).toBe(3)
    expect(info.best).toBe(3) // 窗口外那段 5 天不参与
  })

  it('best 记录窗口内不相邻今天的最长连击', () => {
    const todos = doneRun('x', addDays(TODAY, -24), 5)
    const info = computeStreak(todos, { now: NOW })

    expect(info.best).toBe(5)
    expect(info.current).toBe(0)
  })

  it('bestWeekday 取完成数最多的星期几', () => {
    const todos = [
      doneOn('a', '2026-09-14'), // 周一
      doneOn('b', '2026-09-14'),
      doneOn('c', '2026-09-14'),
      doneOn('d', '2026-09-15'), // 周二
    ]
    expect(computeStreak(todos, { now: NOW }).bestWeekday).toBe('周一')
    expect(WEEKDAY_NAMES).toContain(computeStreak(todos, { now: NOW }).bestWeekday)
  })

  it('bestWeekday 并列时取更靠前的星期（周一优先）', () => {
    const todos = [
      doneOn('a', '2026-09-15'), // 周二 ×2
      doneOn('b', '2026-09-15'),
      doneOn('c', '2026-09-14'), // 周一 ×2
      doneOn('d', '2026-09-14'),
    ]
    expect(computeStreak(todos, { now: NOW }).bestWeekday).toBe('周一')
  })

  it('周边界：周日属于当周，下周一不算上一周', () => {
    const sunday = new Date(2026, 8, 20, 10, 0) // 2026-09-20 周日
    const weekEndTodos = [doneOn('a', '2026-09-20'), doneOn('b', '2026-09-21')]
    expect(computeStreak(weekEndTodos, { now: sunday }).weekCompleted).toBe(1)
    expect(computeStreak(weekEndTodos, { now: sunday }).current).toBe(1)

    // 到了下周一（09-21）：09-20 已经属于上一周，本周只有 09-21
    const monday = new Date(2026, 8, 21, 10, 0)
    expect(computeStreak(weekEndTodos, { now: monday }).weekCompleted).toBe(1)
    expect(computeStreak(weekEndTodos, { now: monday }).current).toBe(2)
  })

  it('没有任何任务时全部为 0，且不给出误导性的「最佳星期」', () => {
    const info = computeStreak([], { now: NOW })

    expect(info).toEqual({
      current: 0,
      best: 0,
      bestWeekday: '',
      weekCompleted: 0,
      weekGoal: DEFAULT_WEEK_GOAL,
      weekRate: 0,
      goalReached: false,
    })
  })

  it('完成率四舍五入并封顶 100', () => {
    const weekTodos = doneRun('w', '2026-09-14', 5)

    const low = computeStreak([doneOn('a', '2026-09-14')], { now: NOW, weekGoal: 3 })
    expect(low.weekRate).toBe(33)

    const over = computeStreak(weekTodos, { now: NOW, weekGoal: 2 })
    expect(over.weekRate).toBe(100)
    expect(over.goalReached).toBe(true)

    const half = computeStreak(weekTodos, { now: NOW, weekGoal: 10 })
    expect(half.weekRate).toBe(50)
    expect(half.goalReached).toBe(false)
  })

  it('达标判定用「本周完成数 >= 周目标」', () => {
    expect(computeStreak([], { now: NOW, weekGoal: 1 }).goalReached).toBe(false)
    expect(
      computeStreak(doneRun('w', '2026-09-14', 1), { now: NOW, weekGoal: 1 }).goalReached,
    ).toBe(true)
    expect(
      computeStreak(doneRun('w', '2026-09-14', 3), { now: NOW, weekGoal: 3 }).goalReached,
    ).toBe(true)
  })

  it('clampWeekGoal 把非法目标兜到 >= 1 的整数', () => {
    expect(clampWeekGoal(0)).toBe(1)
    expect(clampWeekGoal(-5)).toBe(1)
    expect(clampWeekGoal(Number.NaN)).toBe(1)
    expect(clampWeekGoal(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampWeekGoal(3.7)).toBe(3)
    expect(clampWeekGoal(20)).toBe(20)
  })

  it('传入非法周目标也不会除零', () => {
    const info = computeStreak(doneRun('w', '2026-09-14', 2), { now: NOW, weekGoal: 0 })
    expect(info.weekGoal).toBe(1)
    expect(info.weekRate).toBe(100)
  })
})
