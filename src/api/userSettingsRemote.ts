/**
 * 账号级设置云端读写（Supabase `public.user_settings` 表，第九阶段）
 *
 * 表结构（见 supabase/schema.sql）：`(user_id, key)` 联合主键 + `value jsonb` + `updated_at`。
 * 一行一个 key 的代价是行数多，换来的是**冲突范围收敛**：
 * 手机上改主题、桌面上调卡片顺序，不会互相覆盖（整坨 JSON 才会）。
 *
 * 约定与 todoRemote 一致：出错就 throw（`PostgrestError`），由调用方（同步层）兜住并记状态。
 */

import { SUPABASE_TABLES, requireSupabaseClient } from './supabase'

/** 云端一行 */
export interface RemoteSettingRow {
  key: string
  value: unknown
  updated_at: string
}

/** 拉取结果：key -> { value, updatedAt } */
export type RemoteSettingsMap = Record<string, { value: unknown; updatedAt: string }>

/** 拉取当前用户的全部设置 */
export async function fetchRemoteSettings(userId: string): Promise<RemoteSettingsMap> {
  const client = requireSupabaseClient()
  const { data, error } = await client
    .from(SUPABASE_TABLES.userSettings)
    .select('key,value,updated_at')
    .eq('user_id', userId)

  if (error) throw error

  const map: RemoteSettingsMap = {}
  for (const row of (data ?? []) as RemoteSettingRow[]) {
    if (typeof row?.key !== 'string' || row.key === '') continue
    map[row.key] = { value: row.value, updatedAt: String(row.updated_at ?? '') }
  }
  return map
}

/** 拉取单个设置项（合并型键在推送前要先读云端做合并，见 useSyncedStorage） */
export async function fetchRemoteSetting(
  userId: string,
  key: string,
): Promise<{ value: unknown; updatedAt: string } | null> {
  const client = requireSupabaseClient()
  const { data, error } = await client
    .from(SUPABASE_TABLES.userSettings)
    .select('value,updated_at')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  const row = data as { value?: unknown; updated_at?: unknown }
  return { value: row.value, updatedAt: String(row.updated_at ?? '') }
}

/**
 * 写入/更新一个设置项。
 * @returns 云端返回的 `updated_at`（供同步层记录「我推上去的那一版」；拿不到时返回空串）
 */
export async function upsertRemoteSetting(
  userId: string,
  key: string,
  value: unknown,
): Promise<string> {
  const client = requireSupabaseClient()
  // `value: null` 会被 PostgREST 当成「不更新这一列」，所以显式包一层：
  // jsonb 里的 null 用字面量 'null' 表达（前端读回来仍是 null，语义一致）
  const { data, error } = await client
    .from(SUPABASE_TABLES.userSettings)
    .upsert({ user_id: userId, key, value: value ?? null }, { onConflict: 'user_id,key' })
    .select('updated_at')
    .maybeSingle()

  if (error) throw error
  return typeof data?.updated_at === 'string' ? data.updated_at : ''
}

/** 删除一个设置项（用户点「恢复默认」时用：删掉云端那一行，下次登录不会又把它拉回来） */
export async function deleteRemoteSetting(userId: string, key: string): Promise<void> {
  const client = requireSupabaseClient()
  const { error } = await client
    .from(SUPABASE_TABLES.userSettings)
    .delete()
    .eq('user_id', userId)
    .eq('key', key)
  if (error) throw error
}

/** 清空当前用户的全部设置（测试连接/重置账号数据用） */
export async function clearRemoteSettings(userId: string): Promise<void> {
  const client = requireSupabaseClient()
  const { error } = await client.from(SUPABASE_TABLES.userSettings).delete().eq('user_id', userId)
  if (error) throw error
}
