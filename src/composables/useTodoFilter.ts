import type { TodoPriority, Todo, TodoFilter, TodoStatus } from '@/types/todo'
import { isInCurrentWeek, todayKey } from '@/utils/dateFormatter'
import { PRIORITY_WEIGHT } from '@/utils/priorityHelper'

export interface TodoFilterQuery {
  filter: TodoFilter
  keyword: string
  /** 已选中的优先级（多选）；空数组或 undefined 表示不过滤 */
  priority?: TodoPriority[]
  /** 已选中的标签 id（多选）；空数组或 undefined 表示不过滤标签 */
  tags?: string[]
  /** 用于 today/week 筛选的日期键（默认今天） */
  today?: string
  /**
   * `filter: 'date'` 时按哪个日期筛（迷你月历点某天跳过来用这个）。
   * 与 today 分开：today 是「今天是哪天」的基准，date 是「用户想看哪天」的目标。
   */
  date?: string
}

/** 按状态过滤（不含 keyword） */
export function filterByStatus(
  todos: Todo[],
  filter: TodoFilter,
  today = todayKey(),
  date?: string,
): Todo[] {
  switch (filter) {
    case 'active':
      return todos.filter((t) => t.status === 'active')
    case 'completed':
      return todos.filter((t) => t.status === 'completed')
    case 'today':
      return todos.filter((t) => t.dueDate === today)
    case 'date':
      // 没给目标日期时退回今天，避免出现「筛出来是空但没人知道为什么」
      return todos.filter((t) => t.dueDate === (date ?? today))
    case 'week': {
      const base = new Date(`${today}T00:00:00`)
      return todos.filter((t) => t.dueDate && isInCurrentWeek(t.dueDate, base))
    }
    case 'all':
    default:
      return todos
  }
}

/** 关键字匹配：标题（大小写不敏感、忽略首尾空白） */
export function matchesKeyword(todo: Todo, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  return todo.title.toLowerCase().includes(kw)
}

/** 按优先级过滤（多选：命中任一已选优先级即保留；空数组不过滤） */
export function filterByPriority(todos: Todo[], priority?: TodoPriority[]): Todo[] {
  if (!priority || priority.length === 0) return todos
  const set = new Set(priority)
  return todos.filter((t) => set.has(t.priority))
}

/** 按标签过滤（多选：命中任一已选标签即保留；空数组不过滤） */
export function filterByTags(todos: Todo[], tags?: string[]): Todo[] {
  if (!tags || tags.length === 0) return todos
  const set = new Set(tags)
  return todos.filter((t) => t.tags.some((id) => set.has(id)))
}

/** 复合过滤：先按状态，再按优先级与标签，最后按关键字 */
export function filterTodos(todos: Todo[], query: TodoFilterQuery): Todo[] {
  const { filter, keyword, priority, tags, today, date } = query
  const byStatus = filterByStatus(todos, filter, today, date)
  return filterByTags(filterByPriority(byStatus, priority), tags).filter((t) =>
    matchesKeyword(t, keyword),
  )
}

/**
 * 任务排序：
 * 1. 状态：未完成(active) 在上，已完成(completed) 在下；
 * 2. 优先级：高 → 低；
 * 3. 截止日期：早 → 晚；无截止日期排在最后。
 * 返回新数组，不修改入参。
 */
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    // 状态：未完成在上，已完成在下
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1
    // 优先级：权重高者在前
    const w = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
    if (w !== 0) return w
    // 截止日期：都有日期则早者在前
    if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0
    // 有日期优先于无日期
    if (a.dueDate && !b.dueDate) return -1
    if (!a.dueDate && b.dueDate) return 1
    return 0
  })
}

/** 未完成数量 */
export function countActive(todos: Todo[]): number {
  return todos.filter((t) => t.status === 'active').length
}

/** 已完成数量 */
export function countCompleted(todos: Todo[]): number {
  return todos.filter((t) => t.status === 'completed').length
}

/** 校验一个值是否为合法状态 */
export function isTodoStatus(value: unknown): value is TodoStatus {
  return value === 'active' || value === 'completed'
}
