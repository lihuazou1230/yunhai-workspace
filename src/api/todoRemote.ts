/**
 * 任务云端读写（Supabase `public.todos` 表）
 *
 * 表结构（见 supabase/schema.sql）：
 * - 结构化查询字段单独成列：`title` / `completed` / `sort_order`
 * - 其余扩展字段进 `payload jsonb`（priority / dueDate / completedAt / pinned / subtasks / createdAt），
 *   以后加字段不用改表，前端加个 key 就能存
 * - `user_id` + RLS：`auth.uid() = user_id`，anon key 泄露也无法越权读写别人的数据
 *
 * 映射函数（toRemoteRow / fromRemoteRow）是纯函数，单独可测：
 * 云端数据可能来自旧版本客户端（字段缺失/类型不对），读取时必须做兜底，不能让一条脏数据把整个列表打挂。
 */

import type { Subtask, Todo, TodoPriority } from '@/types/todo'
import { SUPABASE_TABLES, requireSupabaseClient } from './supabase'

/** 云端一行 */
export interface RemoteTodoRow {
  id: string
  title: string
  completed: boolean
  payload: Record<string, unknown> | null
  sort_order: number
  created_at?: string | null
}

/** 写入云端的一行（含 user_id） */
export interface RemoteTodoInsert extends RemoteTodoRow {
  user_id: string
}

/** 任务 + 顺序位 */
export interface PositionedTodo {
  todo: Todo
  position: number
}

const PRIORITIES: readonly TodoPriority[] = ['low', 'medium', 'high']

/** 把未知值收敛成合法优先级 */
function toPriority(value: unknown): TodoPriority {
  return PRIORITIES.includes(value as TodoPriority) ? (value as TodoPriority) : 'medium'
}

/** 把未知值收敛成子任务数组（丢掉脏数据而不是整体崩掉） */
function toSubtasks(value: unknown): Subtask[] {
  if (!Array.isArray(value)) return []
  const result: Subtask[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id : ''
    const title = typeof raw.title === 'string' ? raw.title : ''
    if (!id || !title) continue
    result.push({ id, title, completed: raw.completed === true })
  }
  return result
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 本地任务 → 云端行 */
export function toRemoteRow(userId: string, { todo, position }: PositionedTodo): RemoteTodoInsert {
  return {
    id: todo.id,
    user_id: userId,
    title: todo.title,
    completed: todo.status === 'completed',
    sort_order: position,
    payload: {
      priority: todo.priority,
      dueDate: todo.dueDate ?? null,
      createdAt: todo.createdAt,
      completedAt: todo.completedAt ?? null,
      pinned: todo.pinned,
      subtasks: todo.subtasks,
      // 第六阶段：标签 / 归档 / snooze 都随 payload 同步（扩展字段，避免频繁改表）
      tags: todo.tags,
      archived: todo.archived === true,
      archivedAt: todo.archivedAt ?? null,
      snoozedUntil: todo.snoozedUntil ?? null,
    },
  }
}

/** payload.tags -> string[]（只保留非空字符串，去重） */
function toTagIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter((v): v is string => typeof v === 'string' && v !== '')
  return [...new Set(ids)]
}

/** 云端行 → 本地任务（字段缺失全部有兜底） */
export function fromRemoteRow(row: RemoteTodoRow): Todo {
  const payload = row.payload ?? {}
  const completed = row.completed === true
  const archivedAt = asOptionalString(payload.archivedAt)
  const snoozedUntil = asOptionalString(payload.snoozedUntil)
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title : '',
    status: completed ? 'completed' : 'active',
    priority: toPriority(payload.priority),
    dueDate: asOptionalString(payload.dueDate),
    createdAt: asOptionalString(payload.createdAt) ?? row.created_at ?? new Date().toISOString(),
    completedAt: completed ? asOptionalString(payload.completedAt) : undefined,
    pinned: payload.pinned === true,
    subtasks: toSubtasks(payload.subtasks),
    tags: toTagIds(payload.tags),
    // 只在真的归档时才写 archived，保持「未归档」的任务对象干净且往返一致
    ...(payload.archived === true ? { archived: true } : {}),
    ...(archivedAt ? { archivedAt } : {}),
    ...(snoozedUntil ? { snoozedUntil } : {}),
  }
}

/** 拉取当前用户的全部任务（按 sort_order 还原拖拽顺序） */
export async function fetchRemoteTodos(userId: string): Promise<Todo[]> {
  const client = requireSupabaseClient()
  const { data, error } = await client
    .from(SUPABASE_TABLES.todos)
    .select('id,title,completed,payload,sort_order,created_at')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return ((data ?? []) as RemoteTodoRow[]).map(fromRemoteRow)
}

/** 批量写入/更新（upsert：主键冲突则更新，配合 RLS 只能写自己的行） */
export async function pushRemoteTodos(
  userId: string,
  entries: readonly PositionedTodo[],
): Promise<void> {
  if (entries.length === 0) return
  const client = requireSupabaseClient()
  const rows = entries.map((entry) => toRemoteRow(userId, entry))
  const { error } = await client.from(SUPABASE_TABLES.todos).upsert(rows, { onConflict: 'id' })
  if (error) throw error
}

/** 批量删除（按 id，RLS 保证删不到别人的行） */
export async function deleteRemoteTodos(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const client = requireSupabaseClient()
  const { error } = await client
    .from(SUPABASE_TABLES.todos)
    .delete()
    .in('id', [...ids])
  if (error) throw error
}

/** 清空当前用户云端任务（一次性迁移前先腾空，避免重复数据） */
export async function clearRemoteTodos(userId: string): Promise<void> {
  const client = requireSupabaseClient()
  const { error } = await client.from(SUPABASE_TABLES.todos).delete().eq('user_id', userId)
  if (error) throw error
}
