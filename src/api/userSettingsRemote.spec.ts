import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SupabaseUnavailableError } from './supabase'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('./supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./supabase')>()
  return {
    ...actual,
    requireSupabaseClient: () => {
      if (!holder.client) throw new actual.SupabaseUnavailableError()
      return holder.client
    },
  }
})

import {
  clearRemoteSettings,
  deleteRemoteSetting,
  fetchRemoteSetting,
  fetchRemoteSettings,
  upsertRemoteSetting,
} from './userSettingsRemote'

/** 可链式调用、可 await 的查询构造器桩（与 todoRemote.spec 同一套手法） */
function queryStub(result: { data?: unknown; error?: unknown } = { data: [], error: null }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.delete = vi.fn(chain)
  builder.upsert = vi.fn(chain)
  builder.maybeSingle = vi.fn(async () => result)
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return builder
}

/** 记录调用参数的 supabase 客户端桩 */
function clientWith(builder: unknown) {
  const from = vi.fn(() => builder)
  return { from, fromCalls: from }
}

beforeEach(() => {
  holder.client = null
})

describe('fetchRemoteSettings', () => {
  it('把行列表收成 key -> { value, updatedAt }', async () => {
    const builder = queryStub({
      data: [
        {
          key: 'smart-workspace:theme',
          value: { mode: 'dark' },
          updated_at: '2026-09-13T01:00:00Z',
        },
        { key: 'smart-workspace:tags', value: [{ id: 't1' }], updated_at: '2026-09-13T02:00:00Z' },
      ],
      error: null,
    })
    holder.client = clientWith(builder)

    const map = await fetchRemoteSettings('u1')
    expect(map).toEqual({
      'smart-workspace:theme': { value: { mode: 'dark' }, updatedAt: '2026-09-13T01:00:00Z' },
      'smart-workspace:tags': { value: [{ id: 't1' }], updatedAt: '2026-09-13T02:00:00Z' },
    })
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('脏行（缺 key / key 为空串）直接丢掉，不让一行脏数据毁掉整次拉取', async () => {
    holder.client = clientWith(
      queryStub({
        data: [
          { value: 1, updated_at: 'x' },
          { key: '', value: 2 },
          { key: 'ok', value: 3, updated_at: 'y' },
        ],
        error: null,
      }),
    )
    const map = await fetchRemoteSettings('u1')
    expect(Object.keys(map)).toEqual(['ok'])
  })

  it('data 为 null 时返回空表（新账号第一次登录就是这种情况）', async () => {
    holder.client = clientWith(queryStub({ data: null, error: null }))
    expect(await fetchRemoteSettings('u1')).toEqual({})
  })

  it('查询报错时抛出（由同步层兜住并记状态）', async () => {
    holder.client = clientWith(queryStub({ data: null, error: { message: 'boom' } }))
    await expect(fetchRemoteSettings('u1')).rejects.toEqual({ message: 'boom' })
  })

  it('未配置 Supabase 时抛 SupabaseUnavailableError', async () => {
    await expect(fetchRemoteSettings('u1')).rejects.toBeInstanceOf(SupabaseUnavailableError)
  })
})

describe('upsertRemoteSetting', () => {
  it('按 (user_id,key) 冲突更新，并取回云端 updated_at', async () => {
    const builder = queryStub({ data: { updated_at: '2026-09-13T03:00:00Z' }, error: null })
    const client = clientWith(builder)
    holder.client = client

    const updatedAt = await upsertRemoteSetting('u1', 'smart-workspace:theme', { mode: 'light' })
    expect(updatedAt).toBe('2026-09-13T03:00:00Z')
    expect(builder.upsert).toHaveBeenCalledWith(
      { user_id: 'u1', key: 'smart-workspace:theme', value: { mode: 'light' } },
      { onConflict: 'user_id,key' },
    )
    expect(client.fromCalls).toHaveBeenCalledWith('user_settings')
  })

  it('value 为 null 时也照样写（空数组/空对象的边界）', async () => {
    const builder = queryStub({ data: null, error: null })
    holder.client = clientWith(builder)
    await upsertRemoteSetting('u1', 'k', null)
    expect(builder.upsert).toHaveBeenCalledWith(
      { user_id: 'u1', key: 'k', value: null },
      expect.anything(),
    )
  })

  it('云端没回 updated_at 时返回空串（同步层据此不写 meta，下次仍会拉）', async () => {
    holder.client = clientWith(queryStub({ data: {}, error: null }))
    expect(await upsertRemoteSetting('u1', 'k', 1)).toBe('')
  })

  it('写入报错时抛出', async () => {
    holder.client = clientWith(queryStub({ data: null, error: { message: 'rls' } }))
    await expect(upsertRemoteSetting('u1', 'k', 1)).rejects.toEqual({ message: 'rls' })
  })
})

describe('fetchRemoteSetting（单键读取）', () => {
  it('按 user_id + key 定位，返回值与时间戳', async () => {
    const builder = queryStub({
      data: { value: { mode: 'dark' }, updated_at: '2026-09-13T04:00:00Z' },
      error: null,
    })
    holder.client = clientWith(builder)

    // 合并型键（投入日志）推送前要先读云端做合并，靠的就是这个单键查询
    await expect(fetchRemoteSetting('u1', 'smart-workspace:worklog')).resolves.toEqual({
      value: { mode: 'dark' },
      updatedAt: '2026-09-13T04:00:00Z',
    })
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(builder.eq).toHaveBeenCalledWith('key', 'smart-workspace:worklog')
  })

  it('云端没有这一行时返回 null', async () => {
    holder.client = clientWith(queryStub({ data: null, error: null }))
    expect(await fetchRemoteSetting('u1', 'k')).toBeNull()
  })

  it('查询报错时抛出', async () => {
    holder.client = clientWith(queryStub({ data: null, error: { message: 'nope' } }))
    await expect(fetchRemoteSetting('u1', 'k')).rejects.toEqual({ message: 'nope' })
  })
})

describe('deleteRemoteSetting / clearRemoteSettings', () => {
  it('删除单个键：按 user_id + key 定位', async () => {
    const builder = queryStub({ data: null, error: null })
    holder.client = clientWith(builder)

    await deleteRemoteSetting('u1', 'smart-workspace:theme')
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(builder.eq).toHaveBeenCalledWith('key', 'smart-workspace:theme')
  })

  it('清空：只按 user_id 删（RLS 保证删不到别人的）', async () => {
    const builder = queryStub({ data: null, error: null })
    holder.client = clientWith(builder)

    await clearRemoteSettings('u1')
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('删除报错时抛出', async () => {
    holder.client = clientWith(queryStub({ data: null, error: { message: 'nope' } }))
    await expect(deleteRemoteSetting('u1', 'k')).rejects.toEqual({ message: 'nope' })
  })
})
