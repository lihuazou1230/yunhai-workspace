/** 任务（Todo）领域类型 */

/** 任务状态 */
export type TodoStatus = 'active' | 'completed'

/** 任务优先级 */
export type TodoPriority = 'low' | 'medium' | 'high'

/** 列表筛选条件 */
export type TodoFilter = 'all' | 'active' | 'completed' | 'today' | 'week' | 'date'

/**
 * 列表视图（与「筛选 tab」是两条正交的轴）：
 * - main：主列表（排除归档与 snooze 中的任务）
 * - archived：归档视图（第六阶段 6.1）
 * - snoozed：「已隐藏」视图，看 snooze 中的任务并可提前召回
 */
export type TodoListView = 'main' | 'archived' | 'snoozed'

/** 优先级筛选：已选中的优先级集合；空数组表示不过滤（显示全部） */
export type PrioritySelection = TodoPriority[]

/** 子任务 */
export interface Subtask {
  id: string
  title: string
  completed: boolean
}

/** 单个任务 */
export interface Todo {
  id: string
  title: string
  status: TodoStatus
  priority: TodoPriority
  /** 截止日期，格式 YYYY-MM-DD（本地时区） */
  dueDate?: string
  /** 创建时间 ISO 字符串 */
  createdAt: string
  /** 完成时间 ISO 字符串 */
  completedAt?: string
  /** 置顶（今日聚焦/My Day） */
  pinned: boolean
  /** 子任务清单 */
  subtasks: Subtask[]
  /** 标签 id 列表（存 id 不存名字，改名时引用处自动生效） */
  tags: string[]
  /**
   * 已归档（第六阶段 6.1）。
   * 归档是「软状态」而非删除：列表可见性与统计口径排除它，但 completedAt 保留，
   * 所以历史记录不丢，随时可恢复。
   */
  archived?: boolean
  /** 归档时间 ISO 字符串 */
  archivedAt?: string
  /**
   * 稍后再做（Snooze）：在 this 日期（YYYY-MM-DD）之前不再出现在主列表与今日聚焦。
   * 与 dueDate 正交——dueDate 说「什么时候到期」，snoozedUntil 说「什么时候再让我看到它」。
   * 注意：snooze **不影响任何统计**（不算完成、不算删除、热力图不变化）。
   */
  snoozedUntil?: string
}

/** 新建任务入参 */
export type TodoInput = Pick<Todo, 'title' | 'priority' | 'dueDate'> & {
  /** 标签 id 列表（不传表示无标签） */
  tags?: string[]
}

/** 默认优先级（TodoForm 未选择时使用） */
export const DEFAULT_PRIORITY: TodoPriority = 'medium'

/** 撤销删除窗口（毫秒）：1 分钟 */
export const UNDO_DELETE_TIMEOUT = 60_000

/** 待撤销删除的任务（软删除队列项，1 分钟内可撤销，超时才真正移除） */
export interface PendingDelete {
  todo: Todo
  /** 过期时间戳（ms），超过后真正移除 */
  expiresAt: number
}
