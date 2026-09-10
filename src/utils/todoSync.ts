/**
 * 同步相关的纯函数：指纹、差异、合并、离线队列、缓存归属判定
 *
 * 为什么把这些放在 utils 而不是直接写进 store：
 * 1. 「这次改动该推送哪些任务」是最容易出错、也最值得单测的部分，写在 store 里就只能靠整店测试覆盖；
 * 2. 纯函数没有网络、没有 Pinia，可以直接把边界情况（新增/修改/删除/换序/重复）一次算清。
 */

import type { Todo } from '@/types/todo'

/** 同步状态（UI 用它显示角标与提示） */
export type SyncState = 'local' | 'syncing' | 'synced' | 'offline'

/** 本地任务缓存的主人：某个 userId / 'guest'（本地模式）/ null（全新安装） */
export type CacheOwner = string | 'guest' | null

/** 待同步的写操作类型 */
export type SyncOperationType = 'upsert' | 'delete'

/** 一条待同步操作 */
export interface SyncOperation {
  todoId: string
  type: SyncOperationType
}

/** 一次差异计算的结果 */
export interface TodoDiff {
  /** 需要写入云端的任务（带顺序位，拖拽排序才能跨设备保序） */
  upserts: Array<{ todo: Todo; position: number }>
  /** 需要在云端删除的任务 id */
  deletes: string[]
}

/** 迁移标记的 localStorage 前缀（每个账号一份，保证「一次性迁移」） */
export const MIGRATION_KEY_PREFIX = 'smart-workspace:migrated:'

/** 某个账号的迁移标记 key */
export function migrationKey(userId: string): string {
  return `${MIGRATION_KEY_PREFIX}${userId}`
}

/**
 * 单条任务的指纹：内容 + 顺序位。
 * 内容或位置任一变化就与云端不一致，需要重新推送。
 *
 * ⚠️ **新增可同步字段时必须同步加到这里**，否则「只改该字段」的动作算不出差异，
 * 本机不会推送、其它设备也就永远看不到。第六阶段新增的
 * 标签 / 归档 / snooze / 提醒 四个字段就是这么补进来的——它们的共同点是
 * 都不会改动 title/status 等老字段，漏一个就等于那个功能不参与云同步。
 */
export function todoSignature(todo: Todo, position: number): string {
  return JSON.stringify([
    todo.title,
    todo.status,
    todo.priority,
    todo.dueDate ?? '',
    todo.createdAt,
    todo.completedAt ?? '',
    todo.pinned ? 1 : 0,
    todo.subtasks.map((s) => [s.id, s.title, s.completed ? 1 : 0]),
    // 第六阶段：标签（排序后比较，标签顺序本身没有语义）/ 归档 / snooze / 提醒
    [...todo.tags].sort(),
    todo.archived ? 1 : 0,
    todo.archivedAt ?? '',
    todo.snoozedUntil ?? '',
    todo.reminderAt ?? '',
    todo.reminderOff ? 1 : 0,
    position,
  ])
}

/** 给当前列表拍一份「已同步」快照（id → 指纹） */
export function snapshotTodos(todos: readonly Todo[]): Map<string, string> {
  const snapshot = new Map<string, string>()
  todos.forEach((todo, index) => snapshot.set(todo.id, todoSignature(todo, index)))
  return snapshot
}

/**
 * 算出「与上次已同步状态」的差异。
 * @param previous 上次已同步快照（id → 指纹）
 * @param next 当前列表
 */
export function diffTodos(previous: ReadonlyMap<string, string>, next: readonly Todo[]): TodoDiff {
  const upserts: Array<{ todo: Todo; position: number }> = []
  const seen = new Set<string>()

  next.forEach((todo, position) => {
    seen.add(todo.id)
    if (previous.get(todo.id) !== todoSignature(todo, position)) {
      upserts.push({ todo, position })
    }
  })

  const deletes: string[] = []
  for (const id of previous.keys()) {
    if (!seen.has(id)) deletes.push(id)
  }

  return { upserts, deletes }
}

/**
 * 合并本地与远端任务（迁移用）：按 id 去重，**本地优先**——
 * 迁移的语义是「把自己设备上已有的数据搬上云」，本地刚编辑过的内容不该被旧云端数据盖掉；
 * 远端独有的任务（此前在别的设备上加的）保留，两边都不丢。
 */
export function mergeTodos(local: readonly Todo[], remote: readonly Todo[]): Todo[] {
  const byId = new Map<string, Todo>()
  for (const todo of remote) byId.set(todo.id, todo)
  for (const todo of local) byId.set(todo.id, todo)

  const localIds = new Set(local.map((t) => t.id))
  // 顺序：先本地顺序，再补上远端独有的（保持两端观感一致）
  return [...local, ...remote.filter((t) => !localIds.has(t.id))].map((t) => byId.get(t.id) as Todo)
}

/**
 * 把一条操作并入离线队列：同一任务只保留最后一次写（last-write-wins），
 * 避免离线期间反复拖动/编辑同一个任务攒出几十条重复操作。
 */
export function enqueueOperation(
  queue: readonly SyncOperation[],
  operation: SyncOperation,
): SyncOperation[] {
  const rest = queue.filter((op) => op.todoId !== operation.todoId)
  return [...rest, operation]
}

/** 批量并入（顺序敏感，逐个 coalesce） */
export function enqueueOperations(
  queue: readonly SyncOperation[],
  operations: readonly SyncOperation[],
): SyncOperation[] {
  return operations.reduce<SyncOperation[]>((acc, op) => enqueueOperation(acc, op), [...queue])
}

/** 按 id 去重（保留后者），用于「队列里的 upsert 需要拿最新任务内容」的场景 */
export function uniqueById(todos: readonly Todo[]): Todo[] {
  const byId = new Map<string, Todo>()
  for (const todo of todos) byId.set(todo.id, todo)
  return [...byId.values()]
}

/** 本地缓存的处理决策 */
export type CacheDecision =
  /** 本地是游客数据（或全新安装）→ 保留并作为迁移来源 */
  | 'keep-local'
  /** 本地缓存就是当前账号的 → 云端为准，直接覆盖 */
  | 'adopt-remote'
  /** 本地缓存属于另一个账号 → 必须清掉，防止 A 的任务被推进 B 的账号 */
  | 'wipe-foreign'

/**
 * 决定激活云同步时如何处理本地缓存。
 * 这是数据安全上最关键的一个开关：弄错就会把上个账号的任务推到新账号里。
 */
export function decideLocalCache(owner: CacheOwner, userId: string): CacheDecision {
  if (!owner || owner === 'guest') return 'keep-local'
  if (owner === userId) return 'adopt-remote'
  return 'wipe-foreign'
}

/** 是否联网（无 navigator 时按在线处理，避免测试环境误判为离线） */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}
