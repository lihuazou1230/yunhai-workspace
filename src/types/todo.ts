/** 任务（Todo）领域类型 */

/** 任务状态 */
export type TodoStatus = 'active' | 'completed'

/** 任务优先级 */
export type TodoPriority = 'low' | 'medium' | 'high'

/** 列表筛选条件 */
export type TodoFilter = 'all' | 'active' | 'completed' | 'today' | 'week' | 'date'

/**
 * 列表视图（与「筛选 tab」是两条正交的轴）：
 * - main：主列表（排除归档）
 * - archived：归档视图（第六阶段 6.1）
 */
export type TodoListView = 'main' | 'archived'

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
   * 自定义提醒时间（ISO 时间戳，第六阶段 6.5）。
   *
   * **刻意不自动写入**：默认提醒时间（到期日 09:00）完全可由 dueDate 推导出来，
   * 写进每条任务只会让存储与云同步 payload 平白变胖。所以这里的语义是「用户改过」：
   * 为空时走默认策略（见 utils/reminderSchedule.ts），有值时以它为准。
   */
  reminderAt?: string
  /** 关掉这条任务的提醒（规划要求「用户可改可关」） */
  reminderOff?: boolean
}

/** 新建任务入参 */
export type TodoInput = Pick<Todo, 'title' | 'priority' | 'dueDate'> & {
  /** 标签 id 列表（不传表示无标签） */
  tags?: string[]
  /** 自定义提醒时间 ISO（不传 = 走默认策略：到期日当天 09:00） */
  reminderAt?: string
  /** 关掉这条任务的提醒 */
  reminderOff?: boolean
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
