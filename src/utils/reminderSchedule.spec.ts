import { describe, expect, it } from 'vitest'

import type { Todo } from '@/types/todo'
import { MAX_REMINDERS_PER_TODO } from '@/types/reminder'
import {
  collectDueReminders,
  formatReminderTime,
  isReminderMuted,
  localDateAt,
  markNotified,
  nextReminderSeq,
  pruneNotified,
  reminderSchedule,
  reminderTimingText,
} from './reminderSchedule'

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: '任务',
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

/** 2026-09-10 周四 */
const AT = (h: number, m = 0, d = 10) => new Date(2026, 8, d, h, m, 0)

describe('localDateAt', () => {
  it('把日期键 + 时刻拼成本地时间（月份不差 1）', () => {
    const d = localDateAt('2026-09-10', 9)!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8) // 9 月
    expect(d.getDate()).toBe(10)
    expect(d.getHours()).toBe(9)
  })

  it('非法日期键返回 null', () => {
    expect(localDateAt('232233-10-01', 9)).toBeNull()
    expect(localDateAt('2026-02-30', 9)).toBeNull()
    expect(localDateAt('', 9)).toBeNull()
  })
})

describe('reminderSchedule（默认策略 + 可改可关）', () => {
  it('有到期日：默认到期日当天 09:00 提醒，第二次是 1 小时后的催办', () => {
    const plan = reminderSchedule(todo({ id: '1', dueDate: '2026-09-10' }))

    expect(plan).toHaveLength(MAX_REMINDERS_PER_TODO)
    expect(plan[0]).toEqual(AT(9))
    expect(plan[1]).toEqual(AT(10))
  })

  it('用户改过 reminderAt：以它为准（可精确到分）', () => {
    const at = new Date(2026, 8, 10, 14, 30, 0)
    const plan = reminderSchedule(
      todo({ id: '1', dueDate: '2026-09-10', reminderAt: at.toISOString() }),
    )

    expect(plan[0]).toEqual(at)
    expect(plan[1]).toEqual(new Date(at.getTime() + 60 * 60 * 1000))
  })

  it('reminderAt 是脏值时退回默认策略（不让一条坏数据把提醒弄没）', () => {
    const plan = reminderSchedule(todo({ id: '1', dueDate: '2026-09-10', reminderAt: '不是时间' }))
    expect(plan[0]).toEqual(AT(9))
  })

  it('关掉提醒 / 已完成 / 已归档：都不再提醒', () => {
    expect(reminderSchedule(todo({ id: '1', dueDate: '2026-09-10', reminderOff: true }))).toEqual(
      [],
    )
    expect(reminderSchedule(todo({ id: '2', dueDate: '2026-09-10', status: 'completed' }))).toEqual(
      [],
    )
    expect(reminderSchedule(todo({ id: '3', dueDate: '2026-09-10', archived: true }))).toEqual([])
  })

  it('既没 dueDate 也没 reminderAt：不提醒（没有截止就谈不上到期）', () => {
    expect(reminderSchedule(todo({ id: '1' }))).toEqual([])
  })

  it('只有 reminderAt 没有 dueDate 也能提醒', () => {
    const at = new Date(2026, 8, 12, 8, 0, 0)
    expect(reminderSchedule(todo({ id: '1', reminderAt: at.toISOString() }))[0]).toEqual(at)
  })

  it('isReminderMuted 与 schedule 口径一致', () => {
    expect(isReminderMuted(todo({ id: '1', dueDate: '2026-09-10' }))).toBe(false)
    expect(isReminderMuted(todo({ id: '1', reminderOff: true }))).toBe(true)
    expect(isReminderMuted(todo({ id: '1', status: 'completed' }))).toBe(true)
    expect(isReminderMuted(todo({ id: '1', archived: true }))).toBe(true)
  })
})

describe('nextReminderSeq（次数上限）', () => {
  it('没通知过 → 第 1 次', () => {
    expect(nextReminderSeq({}, '1')).toBe(1)
  })

  it('通知过 1 次 → 第 2 次（催办）', () => {
    expect(nextReminderSeq({ 1: { count: 1, lastAt: AT(9).toISOString() } }, '1')).toBe(2)
  })

  it('达到上限（2 次）→ null，不再提醒', () => {
    expect(nextReminderSeq({ 1: { count: 2, lastAt: AT(10).toISOString() } }, '1')).toBeNull()
    expect(nextReminderSeq({ 1: { count: 9, lastAt: AT(10).toISOString() } }, '1')).toBeNull()
  })
})

describe('collectDueReminders（扫描 + 补发）', () => {
  it('还没到点：不提醒', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    expect(collectDueReminders(list, {}, AT(8, 59))).toEqual([])
  })

  it('刚好到点：提醒（边界含等号）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const due = collectDueReminders(list, {}, AT(9))

    expect(due).toHaveLength(1)
    expect(due[0].todoId).toBe('1')
    expect(due[0].seq).toBe(1)
    expect(due[0].overdueMs).toBe(0)
  })

  it('电脑合盖一晚：第二天打开把错过的补上（过期几小时仍然发）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const due = collectDueReminders(list, {}, AT(21)) // 当天 21 点才打开

    expect(due).toHaveLength(1)
    expect(due[0].seq).toBe(1)
    expect(due[0].overdueMs).toBe(12 * 60 * 60 * 1000)
  })

  it('过期超过 24 小时的不再补发（否则导入历史数据会弹一堆）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-08' })]
    expect(collectDueReminders(list, {}, AT(12, 0, 10))).toEqual([])
  })

  it('已通知过就不再重复：第 1 次发过、时间到第 2 次才再发', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const notified = { 1: { count: 1, lastAt: AT(9).toISOString() } }

    // 09:30 还在窗口内但已通知过第 1 次，第 2 次（10:00）还没到
    expect(collectDueReminders(list, notified, AT(9, 30))).toEqual([])
    // 10:00 到了 → 第 2 次催办
    const second = collectDueReminders(list, notified, AT(10))
    expect(second).toHaveLength(1)
    expect(second[0].seq).toBe(2)
  })

  it('两次都发完后彻底安静（防骚扰上限）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const notified = { 1: { count: 2, lastAt: AT(10).toISOString() } }
    expect(collectDueReminders(list, notified, AT(23))).toEqual([])
  })

  it('多任务按计划时间升序返回', () => {
    const list = [
      todo({ id: 'late', dueDate: '2026-09-10', reminderAt: AT(11).toISOString() }),
      todo({ id: 'early', dueDate: '2026-09-10' }), // 09:00
    ]
    const due = collectDueReminders(list, {}, AT(12))
    expect(due.map((d) => d.todoId)).toEqual(['early', 'late'])
  })

  it('关掉提醒的任务不参与扫描；已完成/已归档的也不参与', () => {
    const list = [
      todo({ id: 'off', dueDate: '2026-09-10', reminderOff: true }),
      todo({ id: 'done', dueDate: '2026-09-10', status: 'completed' }),
      todo({ id: 'archived', dueDate: '2026-09-10', archived: true }),
    ]
    expect(collectDueReminders(list, {}, AT(12))).toEqual([])
  })

  it('记录的 lastAt 不早于本次计划时间时不重复入队（多标签页并发的兜底）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    // 记了 1 次，但 lastAt 就是本次计划时间 → 说明这次已经发过
    const notified = { 1: { count: 1, lastAt: AT(9).toISOString() } }
    // 第二次的时间点还没到，所以这里应当为空（验证不会把第 1 次再发一遍）
    expect(collectDueReminders(list, notified, AT(9, 30))).toEqual([])
  })

  it('另一处已写过更晚的 lastAt（时钟回拨 / 多标签页）时不再重复补发', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    // 第 2 次催办的计划时间是 10:00，但记录里已有 11:00 的发送痕迹（系统时间被调过，
    // 或另一个标签页刚写过）→ 认定这条已经提醒过，宁可少发一次也不骚扰用户
    const notified = { 1: { count: 1, lastAt: AT(11).toISOString() } }
    expect(collectDueReminders(list, notified, AT(12))).toEqual([])
  })
})

describe('markNotified / pruneNotified', () => {
  it('markNotified 累加次数并记录时间，不修改入参', () => {
    const before = {}
    const after = markNotified(before, '1', AT(9))

    expect(after['1']).toEqual({ count: 1, lastAt: AT(9).toISOString() })
    expect(before).toEqual({})

    const twice = markNotified(after, '1', AT(10))
    expect(twice['1'].count).toBe(2)
  })

  it('pruneNotified 丢掉已不存在的任务标记（标记只增不减会撑爆 localStorage）', () => {
    const notified = {
      1: { count: 1, lastAt: AT(9).toISOString() },
      2: { count: 2, lastAt: AT(10).toISOString() },
    }
    const pruned = pruneNotified(notified, [todo({ id: '2' })])

    expect(Object.keys(pruned)).toEqual(['2'])
  })
})

describe('文案', () => {
  it('reminderTimingText：未来显示「N 小时后」，过去显示「已超时 N 分」', () => {
    expect(reminderTimingText(AT(10), AT(9))).toBe('1 小时后')
    expect(reminderTimingText(AT(10, 30), AT(9))).toBe('1 小时 30 分后')
    expect(reminderTimingText(AT(9), AT(9, 30))).toBe('已超时 30 分')
  })

  it('formatReminderTime：MM月DD日 HH:mm（个位数补零）', () => {
    expect(formatReminderTime(AT(9, 5))).toBe('9月10日 09:05')
  })
})
