/**
 * 任务组织相关的纯函数（标签 / 归档 / 推后）。
 *
 * 抽成纯函数的原因：这几件事都是「可见性与口径」的规则，最容易出现
 * 「列表隐藏了但统计还算」这类不一致，用纯函数钉住并单测比散在组件里可靠。
 */

import type { Tag, TagColor, TagInput } from '@/types/tag'
import { MAX_TAG_NAME_LENGTH, isTagColor } from '@/types/tag'
import type { Todo } from '@/types/todo'
import { addDays, todayKey } from '@/utils/dateFormatter'
import { isValidDateKey } from '@/utils/validation'

// ---- 标签 ----

/** 生成标签 id（crypto 不可用时退化为时间戳 + 随机串） */
function createId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `tag-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 校验标签名：去空白后非空且不超长 */
export function isValidTagName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_TAG_NAME_LENGTH
}

/** 重名判断（忽略大小写与首尾空白），`exceptId` 用于改名时排除自己 */
export function isTagNameTaken(tags: readonly Tag[], name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase()
  return tags.some((t) => t.id !== exceptId && t.name.trim().toLowerCase() === key)
}

/** 构造新标签 */
export function createTag(input: TagInput): Tag {
  return { id: createId(), name: input.name.trim(), color: input.color }
}

/** 按 id 找标签 */
export function findTag(tags: readonly Tag[], id: string): Tag | undefined {
  return tags.find((t) => t.id === id)
}

/**
 * 把某个标签的引用从所有任务上摘掉——**任务本身不删**。
 * 这是「删除标签」的正确语义：标签没了，任务还在（只是少了一个分类）。
 */
export function stripTagFromTodos(todos: readonly Todo[], tagId: string): Todo[] {
  return todos.map((t) =>
    t.tags.includes(tagId) ? { ...t, tags: t.tags.filter((x) => x !== tagId) } : t,
  )
}

/** 按标签过滤（多选：命中任一标签即保留；空数组不过滤） */
export function filterByTag(todos: readonly Todo[], tagIds: readonly string[]): Todo[] {
  if (tagIds.length === 0) return [...todos]
  const set = new Set(tagIds)
  return todos.filter((t) => t.tags.some((id) => set.has(id)))
}

/** 清理任务上的标签引用：丢掉已不存在的标签 id（标签被删后残留的兜底） */
export function pruneTagRefs(todos: readonly Todo[], tags: readonly Tag[]): Todo[] {
  const alive = new Set(tags.map((t) => t.id))
  return todos.map((t) => {
    const next = t.tags.filter((id) => alive.has(id))
    return next.length === t.tags.length ? t : { ...t, tags: next }
  })
}

/** 标签色（未知色名兜底成 slate，避免脏数据把样式打成空白） */
export function safeTagColor(color: TagColor | string): TagColor {
  return isTagColor(color) ? color : 'slate'
}

// ---- 归档 ----

/** 是否已归档 */
export function isArchived(todo: Todo): boolean {
  return todo.archived === true
}

/**
 * 归档：标记 archived + 记录时间。
 * 刻意**不动 completedAt / status**——归档是软状态，历史记录要原样保留，
 * 取消归档后统计能立刻恢复原样。
 */
export function archiveTodo(todo: Todo, now: Date = new Date()): Todo {
  return { ...todo, archived: true, archivedAt: now.toISOString() }
}

/** 取消归档（清掉 archived 与 archivedAt） */
export function unarchiveTodo(todo: Todo): Todo {
  const { archived: _archived, archivedAt: _archivedAt, ...rest } = todo
  return { ...rest, archived: false }
}

// ---- 推后（原「稍后再做 / Snooze」） ----

/**
 * 推后 N 天：**只动 dueDate，不引入任何"隐藏"状态**。
 *
 * 语义（与旧实现的关键差别）：旧版 snooze 是「藏到某天为止」，任务会从列表消失；
 * 现在改为「把到期日往后挪」——任务**始终留在列表里**，只是换了一天到期。
 * 因此不再需要 snoozedUntil 字段、也不需要「已隐藏」视图与「召回」动作。
 *
 * 基准取**当前 dueDate**（用户要的是"把这件事往后挪"，不是"重新安排到某天"）；
 * 没有截止日期的任务以今天为基准，选「1 天」→ 明天。
 *
 * 兜底取 `max(dueDate + N, today + N)`：一条**逾期很久**的任务，`dueDate + N` 可能仍落在过去
 * （逾期一个月 + 推 1 天 = 还是逾期），那就等于没推。取较晚的那个保证「推了就有用」——
 * 代价是逾期任务执行「推后 1 周」会得到「今天 + 7」而不是「原日期 + 7」，
 * 而这恰恰是用户点这个动作时想要的语义。
 */
export function postponeTodo(todo: Todo, days: number, today: string = todayKey()): Todo {
  const step = Math.max(1, Math.trunc(days))
  const base = todo.dueDate && isValidDateKey(todo.dueDate) ? todo.dueDate : today
  const shifted = addDays(base, step)
  const floor = addDays(today, step)
  return { ...todo, dueDate: shifted < floor ? floor : shifted }
}

/** 推后快捷选项（与「新建任务」表单里的 1天/1周/1月 保持一致，用户不必学两套） */
export interface PostponeOption {
  key: 'day' | 'week' | 'month'
  label: string
  /** 推后的天数 */
  days: number
}

export const POSTPONE_OPTIONS: readonly PostponeOption[] = [
  { key: 'day', label: '1 天', days: 1 },
  { key: 'week', label: '1 周', days: 7 },
  { key: 'month', label: '1 月', days: 30 },
]
