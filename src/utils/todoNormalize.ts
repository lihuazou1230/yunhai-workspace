/**
 * 本地任务数据归一化（脏数据兜底）。
 *
 * 为什么需要：localStorage 是本地唯一的数据源，但它是**可被手改的**，也可能残留旧版本格式
 * ——第 1 阶段的 `Todo` 只有 id/title/status/priority/dueDate/createdAt 六个字段，
 * `subtasks` / `tags` / `pinned` 是后面几个阶段才加上的。
 *
 * 而 `stores/todoStore.ts` 直接 `useLocalStorage<Todo[]>(...)` 之后就 `.filter(...)`，
 * 中间的 `as T` 只是编译期的谎话：一条 `'{"a":1}'` 或一个缺 `subtasks` 的旧记录，
 * 就能让任务页在渲染期抛 TypeError 白屏，「刷新也一样」——数据还在，页面进不去。
 *
 * 云端路径一直是有兜底的（`api/todoRemote.ts` 的 `toPriority` / `toSubtasks` / `toTagIds`），
 * 本地路径此前完全没有，这里补上同一套原则：
 * **能救的救**（缺字段补默认值、类型不对的收敛到合法值），**救不了的丢**
 * （没有 id 的记录既渲染不了也操作不了），绝不因为一条脏数据把整个列表打挂。
 */

import { DEFAULT_PRIORITY } from '@/types/todo'
import type { Subtask, Todo, TodoPriority, TodoStatus } from '@/types/todo'

const STATUSES: readonly TodoStatus[] = ['active', 'completed']
const PRIORITIES: readonly TodoPriority[] = ['low', 'medium', 'high']

/** 非空字符串才算有效；空白串与其它类型一律视为「没有」 */
function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** 收敛子任务数组：结构不完整的整条丢掉（少了 id 就没法去重/勾选） */
function normalizeSubtasks(value: unknown): Subtask[] {
  if (!Array.isArray(value)) return []
  const result: Subtask[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = asNonEmptyString(raw.id)
    const title = asNonEmptyString(raw.title)
    if (!id || !title) continue
    result.push({ id, title, completed: raw.completed === true })
  }
  return result
}

/** 收敛标签 id 数组：只保留非空字符串并去重（重复标签会让筛选结果重复） */
function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  for (const item of value) {
    const id = asNonEmptyString(item)
    if (id) ids.add(id)
  }
  return [...ids]
}

/**
 * 单条归一化；无法救活（不是对象 / 没有 id）时返回 null 表示丢弃。
 *
 * 注意 `title` 缺失时**不丢**——与云端 `fromRemoteRow` 的口径一致（回落空串），
 * 宁可显示一条空标题的任务，也不要静默删掉用户的数据。
 */
export function normalizeTodo(raw: unknown): Todo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const id = asNonEmptyString(source.id)
  if (!id) return null

  const dueDate = asNonEmptyString(source.dueDate)
  const completedAt = asNonEmptyString(source.completedAt)
  const archivedAt = asNonEmptyString(source.archivedAt)
  const reminderAt = asNonEmptyString(source.reminderAt)

  const todo: Todo = {
    id,
    title: typeof source.title === 'string' ? source.title : '',
    status: STATUSES.includes(source.status as TodoStatus)
      ? (source.status as TodoStatus)
      : 'active',
    priority: PRIORITIES.includes(source.priority as TodoPriority)
      ? (source.priority as TodoPriority)
      : DEFAULT_PRIORITY,
    // 创建时间缺失时给一个可解析的值：排序、热力图、Streak 都依赖它，
    // 留 undefined 会让 `new Date(undefined)` 变成 Invalid Date 一路传下去
    createdAt: asNonEmptyString(source.createdAt) ?? new Date().toISOString(),
    pinned: source.pinned === true,
    subtasks: normalizeSubtasks(source.subtasks),
    tags: normalizeTags(source.tags),
  }

  // 可选字段只在真有时才挂上去，保持「未归档/未设置」的任务对象干净（与云端一致）
  if (dueDate) todo.dueDate = dueDate
  if (completedAt) todo.completedAt = completedAt
  if (source.archived === true) todo.archived = true
  if (archivedAt) todo.archivedAt = archivedAt
  if (reminderAt) todo.reminderAt = reminderAt
  if (source.reminderOff === true) todo.reminderOff = true

  /*
    旧数据的 `snoozedUntil`（「已隐藏」时代的字段）到这里被**丢弃**：
    该机制已整体移除，归一化不再还原它。存量任务会因此重新出现在主列表里 ——
    这正是期望行为（一条被藏起来的任务本来就该被看见并重新安排），
    比按旧字段继续藏着更容易让用户理解发生了什么。
  */

  return todo
}

/**
 * 列表归一化：非数组一律当空列表（这正是白屏的元凶），逐条救援，并去掉重复 id
 * ——正常路径生成的 id 唯一，出现重复只能是数据被改坏，留着会让 v-for key 冲突。
 */
export function normalizeTodos(value: unknown): Todo[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: Todo[] = []
  for (const item of value) {
    const todo = normalizeTodo(item)
    if (!todo || seen.has(todo.id)) continue
    seen.add(todo.id)
    result.push(todo)
  }
  return result
}
