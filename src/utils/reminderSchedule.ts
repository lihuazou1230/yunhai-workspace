/**
 * 提醒调度（纯函数，第六阶段 6.5）。
 *
 * 抽成纯函数的原因：提醒最容易出的两个问题——**重复提醒**（同一任务反复弹）
 * 与**错过不补**（电脑合盖一晚上，第二天什么都不提醒）——都取决于这里的边界判断。
 * 纯函数 + 可注入 now，才能把这些边界一个个钉住。
 */

import { REMINDER_DEFAULT_HOUR, REMINDER_SNOOZE_MS, MAX_REMINDERS_PER_TODO } from '@/types/reminder'
import type { DueReminder, NotifiedMap } from '@/types/reminder'
import type { Todo } from '@/types/todo'
import { isValidDateKey } from '@/utils/validation'

/** `YYYY-MM-DD` + 时:分 -> 本地 Date（月份从 0 开始的那点坑在这里一次填平） */
export function localDateAt(dateKey: string, hour: number, minute = 0): Date | null {
  if (!isValidDateKey(dateKey)) return null
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute, 0, 0)
}

/**
 * 这条任务的提醒时间点（升序，最多 MAX_REMINDERS_PER_TODO 个）。
 *
 * 策略（规划口径）：
 * - 用户设了 `reminderAt` → 以它为准
 * - 否则 `dueDate` 当天 09:00
 * - 第二次是**超时 1 小时催办**（这就是「每条任务最多 2 次」的来源）
 * - 没有 dueDate 也没有 reminderAt → 不提醒（没有截止时间就没有「到期」可言）
 * - `reminderOff` 或已完成 → 不提醒
 */
export function reminderSchedule(todo: Todo): Date[] {
  if (todo.reminderOff === true) return []
  if (todo.status === 'completed') return []
  // 归档任务不再打扰用户（与列表/统计的口径保持一致）
  if (todo.archived === true) return []

  const explicit = typeof todo.reminderAt === 'string' ? new Date(todo.reminderAt) : null
  const first =
    explicit && !Number.isNaN(explicit.getTime())
      ? explicit
      : todo.dueDate
        ? localDateAt(todo.dueDate, REMINDER_DEFAULT_HOUR)
        : null

  if (!first) return []

  const plan: Date[] = [first]
  while (plan.length < MAX_REMINDERS_PER_TODO) {
    plan.push(new Date(plan[plan.length - 1].getTime() + REMINDER_SNOOZE_MS))
  }
  return plan
}

/** 某任务当前应该发第几次提醒（已通知次数 + 1），越界返回 null */
export function nextReminderSeq(notified: NotifiedMap, todoId: string): number | null {
  const count = notified[todoId]?.count ?? 0
  return count >= MAX_REMINDERS_PER_TODO ? null : count + 1
}

/**
 * 算出这一轮该提醒哪些任务。
 *
 * 关键取舍：**只要某次提醒到点了、且还没通知过，就发**（哪怕已经过期几小时）——
 * 这就是「补发」的来源。电脑合盖一晚，第二天打开时会一次性把错过的补上，
 * 而不是因为「最佳时机已过」就永远静默。
 *
 * @param todos 全部任务（调用方一般传 visibleTodos）
 * @param notified 已通知标记
 * @param now 当前时间
 * @param windowMs 只补发这个时间窗内的（默认 24 小时；再久的提醒补了也是噪音）
 */
export function collectDueReminders(
  todos: readonly Todo[],
  notified: NotifiedMap,
  now: Date = new Date(),
  windowMs = 24 * 60 * 60 * 1000,
): DueReminder[] {
  const nowMs = now.getTime()
  const due: DueReminder[] = []

  for (const todo of todos) {
    const seq = nextReminderSeq(notified, todo.id)
    if (seq === null) continue

    const plan = reminderSchedule(todo)
    const at = plan[seq - 1]
    if (!at) continue

    const atMs = at.getTime()
    // 还没到点
    if (atMs > nowMs) continue
    // 过期太久的当成「早已翻篇」，不再打扰（也避免导入历史数据时弹一堆）
    if (nowMs - atMs > windowMs) continue

    // 同一次提醒重复入队：上面 nextReminderSeq 已经保证「通知过就往下走」，
    // 这里再挡一层「记录的 lastAt 早于本次计划时间」的边界（时钟回拨/多标签页并发）
    const last = notified[todo.id]?.lastAt
    if (last && new Date(last).getTime() >= atMs) continue

    due.push({
      todoId: todo.id,
      title: todo.title,
      at,
      overdueMs: nowMs - atMs,
      seq,
    })
  }

  return due.sort((a, b) => a.at.getTime() - b.at.getTime())
}

/** 写回已通知记录（不修改入参） */
export function markNotified(notified: NotifiedMap, todoId: string, at: Date): NotifiedMap {
  const prev = notified[todoId]
  return {
    ...notified,
    [todoId]: { count: (prev?.count ?? 0) + 1, lastAt: at.toISOString() },
  }
}

/**
 * 清理已通知标记：只保留仍然存在、且还可能再提醒的任务。
 * 不做清理的话，删掉的任务会永远留在 localStorage 里（标记只增不减）。
 */
export function pruneNotified(notified: NotifiedMap, todos: readonly Todo[]): NotifiedMap {
  const alive = new Set(todos.map((t) => t.id))
  return Object.fromEntries(Object.entries(notified).filter(([id]) => alive.has(id)))
}

/** 提醒时机文案：距到期还有多久 / 已超时多久 */
export function reminderTimingText(at: Date, now: Date = new Date()): string {
  const diff = at.getTime() - now.getTime()
  const absMinutes = Math.round(Math.abs(diff) / 60_000)
  const hours = Math.floor(absMinutes / 60)
  const minutes = absMinutes % 60
  const span = hours > 0 ? `${hours} 小时${minutes > 0 ? ` ${minutes} 分` : ''}` : `${minutes} 分`

  if (diff <= 0) return `已超时 ${span}`
  return `${span}后`
}

/** 提醒时间展示：MM月DD日 HH:mm */
export function formatReminderTime(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** 该任务的提醒是否已被用户关掉（含已完成/已归档） */
export function isReminderMuted(todo: Todo): boolean {
  return todo.reminderOff === true || todo.status === 'completed' || todo.archived === true
}
