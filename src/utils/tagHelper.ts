/**
 * 任务组织相关的纯函数（标签 / 归档 / Snooze）。
 *
 * 抽成纯函数的原因：这三件事都是「可见性与口径」的规则，最容易出现
 * 「列表隐藏了但统计还算」这类不一致，用纯函数钉住并单测比散在组件里可靠。
 */

import type { Tag, TagColor, TagInput } from '@/types/tag'
import { MAX_TAG_NAME_LENGTH, isTagColor } from '@/types/tag'
import type { Todo } from '@/types/todo'
import { addDays, startOfWeek, todayKey } from '@/utils/dateFormatter'

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

// ---- Snooze（稍后再做） ----

/** 是否处于 snooze 中：snoozedUntil 严格晚于今天（到期当天自动回归列表） */
export function isSnoozed(todo: Todo, today: string = todayKey()): boolean {
  return typeof todo.snoozedUntil === 'string' && todo.snoozedUntil > today
}

/** 是否今天到期回归（snoozedUntil 恰好是今天或更早，即已回到列表） */
export function isSnoozeDue(todo: Todo, today: string = todayKey()): boolean {
  return (
    typeof todo.snoozedUntil === 'string' && todo.snoozedUntil !== '' && todo.snoozedUntil <= today
  )
}

/** 设置 snooze 到某天 */
export function snoozeTodo(todo: Todo, until: string): Todo {
  return { ...todo, snoozedUntil: until }
}

/** 提前召回（清掉 snoozedUntil） */
export function unsnoozeTodo(todo: Todo): Todo {
  const { snoozedUntil: _snoozedUntil, ...rest } = todo
  return rest
}

/** Snooze 快捷选项 */
export interface SnoozeOption {
  key: 'tomorrow' | 'dayAfter' | 'nextMonday'
  label: string
  /** 目标日期键 YYYY-MM-DD */
  date: string
}

/**
 * Snooze 选项：明天 / 后天 / 下周一（严格晚于今天）。
 * 「下周一」取的是**下一个**周一：今天就是周一时给下周一（+7 天），而不是今天。
 */
export function snoozeOptions(now: Date = new Date()): SnoozeOption[] {
  const today = todayKey(now)
  const nextMondayBase = addDays(startOfWeek(now), 7)
  return [
    { key: 'tomorrow', label: '明天', date: addDays(today, 1) },
    { key: 'dayAfter', label: '后天', date: addDays(today, 2) },
    { key: 'nextMonday', label: '下周一', date: nextMondayBase },
  ]
}
