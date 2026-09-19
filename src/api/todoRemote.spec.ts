import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Todo } from '@/types/todo'
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
  clearRemoteTodos,
  deleteRemoteTodos,
  fetchRemoteTodos,
  fromRemoteRow,
  pushRemoteTodos,
  toRemoteRow,
} from './todoRemote'

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: '写周报',
    status: 'active',
    priority: 'high',
    dueDate: '2026-09-10',
    createdAt: '2026-09-09T00:00:00.000Z',
    pinned: true,
    subtasks: [{ id: 's1', title: '收集数据', completed: true }],
    tags: [],
    ...overrides,
  }
}

/** 可链式调用、可 await 的查询构造器桩（supabase 的查询构造器本身就是 thenable） */
interface QueryStub {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>
}

function queryStub(
  result: { data?: unknown; error?: unknown } = { data: [], error: null },
): QueryStub {
  const builder = {} as QueryStub
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.in = vi.fn(chain)
  builder.delete = vi.fn(chain)
  builder.upsert = vi.fn(async () => result)
  builder.then = (resolve) => Promise.resolve(result).then(resolve)
  return builder
}

describe('任务行映射', () => {
  it('本地任务 → 云端行：结构化字段成列，扩展字段进 payload', () => {
    const row = toRemoteRow('u1', { todo: todo(), position: 3 })
    expect(row).toEqual({
      id: 't1',
      user_id: 'u1',
      title: '写周报',
      completed: false,
      sort_order: 3,
      payload: {
        priority: 'high',
        dueDate: '2026-09-10',
        createdAt: '2026-09-09T00:00:00.000Z',
        completedAt: null,
        pinned: true,
        subtasks: [{ id: 's1', title: '收集数据', completed: true }],
        // 第六阶段：标签 / 归档 / 提醒 一并进 payload
        tags: [],
        archived: false,
        archivedAt: null,
        reminderAt: null,
        reminderOff: false,
      },
    })
  })

  it('标签 / 归档 / 提醒 随 payload 往返（云同步口径一致）', () => {
    // 提醒字段是回归重点：todoSignature 认得它们（改了会触发推送），
    // 但 payload 曾漏掉这两个 key，导致「推送发了、内容却没有」的静默丢失。
    const original = todo({
      tags: ['tag-a', 'tag-b'],
      archived: true,
      archivedAt: '2026-09-11T02:00:00.000Z',
      reminderAt: '2026-09-12T09:30:00.000Z',
      reminderOff: true,
    })
    const restored = fromRemoteRow(toRemoteRow('u1', { todo: original, position: 0 }))

    expect(restored.tags).toEqual(['tag-a', 'tag-b'])
    expect(restored.archived).toBe(true)
    expect(restored.archivedAt).toBe('2026-09-11T02:00:00.000Z')
    expect(restored.reminderAt).toBe('2026-09-12T09:30:00.000Z')
    expect(restored.reminderOff).toBe(true)
    expect(restored).toEqual(original)
  })

  it('「关掉提醒」也走云端：reminderOff=true 必须进 payload（否则换设备后会重新响）', () => {
    const row = toRemoteRow('u1', { todo: todo({ reminderOff: true }), position: 0 })

    // 显式断言 payload 里两个 key 的存在与取值，而不只是看往返结果
    expect(row.payload).toHaveProperty('reminderOff', true)
    expect(row.payload).toHaveProperty('reminderAt', null)
  })

  it('旧客户端没写 tags/archived 时兜底为空数组与「未归档」', () => {
    const restored = fromRemoteRow({
      id: 't10',
      title: '旧数据',
      completed: false,
      sort_order: 0,
      payload: { priority: 'low' },
    })
    expect(restored.tags).toEqual([])
    expect(restored.archived).toBeUndefined()
    expect(restored.archivedAt).toBeUndefined()
    expect(restored.reminderAt).toBeUndefined()
    expect(restored.reminderOff).toBeUndefined()
  })

  it('已完成任务 completed 列为 true', () => {
    const row = toRemoteRow('u1', {
      todo: todo({ status: 'completed', completedAt: '2026-09-10T01:00:00.000Z' }),
      position: 0,
    })
    expect(row.completed).toBe(true)
    expect(row.payload?.completedAt).toBe('2026-09-10T01:00:00.000Z')
  })

  it('云端行 → 本地任务：往返一致', () => {
    const original = todo()
    const restored = fromRemoteRow(toRemoteRow('u1', { todo: original, position: 0 }))
    expect(restored).toEqual(original)
  })

  it('云端脏数据全部有兜底（旧版本客户端写入的缺字段行）', () => {
    const restored = fromRemoteRow({
      id: 't9',
      title: '旧任务',
      completed: true,
      payload: {
        priority: 'urgent', // 非法优先级 → medium
        subtasks: [{ id: 'ok' }, 'garbage', { id: 's2', title: '有效', completed: 1 }],
        dueDate: '',
      },
      sort_order: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    })

    expect(restored).toMatchObject({
      id: 't9',
      title: '旧任务',
      status: 'completed',
      priority: 'medium',
      dueDate: undefined,
      pinned: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    // 只有结构完整的子任务被保留，completed 非 true 一律按未完成
    expect(restored.subtasks).toEqual([{ id: 's2', title: '有效', completed: false }])
  })

  it('payload 为 null 也不崩', () => {
    const restored = fromRemoteRow({
      id: 't1',
      title: '',
      completed: false,
      payload: null,
      sort_order: 0,
    })
    expect(restored.priority).toBe('medium')
    expect(restored.subtasks).toEqual([])
    expect(restored.status).toBe('active')
  })

  it('没有截止日期时写 null（jsonb 里必须显式清空，不能整个键消失）', () => {
    const row = toRemoteRow('u1', { todo: todo({ dueDate: undefined }), position: 0 })

    // 键消失与值为 null 在「云端为准」的覆盖语义下是两回事：前者会让旧日期残留
    expect(row.payload).toHaveProperty('dueDate', null)
    expect(Object.keys(row.payload ?? {})).toContain('dueDate')
  })

  it('云端 title 不是字符串（旧版本写入 null）时回落空串，不把 null 塞进任务模型', () => {
    const restored = fromRemoteRow({
      id: 't1',
      title: null as unknown as string,
      completed: false,
      payload: {},
      sort_order: 0,
    })

    // 模板里直接插值 null 会渲染成 "null"
    expect(restored.title).toBe('')
  })

  it('子任务的 id/title 不是字符串时整条丢掉（脏数据不能进 UI）', () => {
    const restored = fromRemoteRow({
      id: 't1',
      title: '任务',
      completed: false,
      sort_order: 0,
      payload: {
        subtasks: [
          { id: 3, title: '数字 id' },
          { id: 's2', title: 5 },
          { id: 's3', title: '正常', completed: true },
        ],
      },
    })

    // 少了 id 就没法去重/切换完成态，宁可丢掉这一条，也不能让列表出现不可操作的行
    expect(restored.subtasks).toEqual([{ id: 's3', title: '正常', completed: true }])
  })
})

describe('云端读写', () => {
  beforeEach(() => {
    holder.client = null
  })

  it('拉取：按 user_id 过滤并按 sort_order 排序', async () => {
    const builder = queryStub({
      data: [
        {
          id: 't1',
          title: 'A',
          completed: false,
          payload: { priority: 'low' },
          sort_order: 0,
          created_at: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 't2',
          title: 'B',
          completed: true,
          payload: { priority: 'high' },
          sort_order: 1,
          created_at: '2026-09-02T00:00:00.000Z',
        },
      ],
      error: null,
    })
    const from = vi.fn(() => builder)
    holder.client = { from }

    const todos = await fetchRemoteTodos('u1')

    expect(from).toHaveBeenCalledWith('todos')
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(builder.order).toHaveBeenCalledWith('sort_order', { ascending: true })
    expect(todos.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(todos[1].status).toBe('completed')
  })

  it('拉取失败时抛错', async () => {
    holder.client = {
      from: vi.fn(() => queryStub({ data: null, error: { message: 'permission denied' } })),
    }
    await expect(fetchRemoteTodos('u1')).rejects.toMatchObject({ message: 'permission denied' })
  })

  it('云端返回 data 为 null（表刚建好 / RLS 拦掉全部行）时按空列表处理', async () => {
    // data 为 null 而 error 也为 null 是 supabase 的合法返回，
    // 直接 .map 会抛 TypeError，把「云端还没有任务」误报成同步故障
    holder.client = { from: vi.fn(() => queryStub({ data: null, error: null })) }

    await expect(fetchRemoteTodos('u1')).resolves.toEqual([])
  })

  it('写入 / 删除 / 清空失败都抛错（调用方据此保留离线队列，下次重试）', async () => {
    holder.client = {
      from: vi.fn(() => queryStub({ data: null, error: { message: 'upsert failed' } })),
    }
    await expect(pushRemoteTodos('u1', [{ todo: todo(), position: 0 }])).rejects.toMatchObject({
      message: 'upsert failed',
    })

    holder.client = {
      from: vi.fn(() => queryStub({ data: null, error: { message: 'delete failed' } })),
    }
    await expect(deleteRemoteTodos(['t1'])).rejects.toMatchObject({ message: 'delete failed' })
    await expect(clearRemoteTodos('u1')).rejects.toMatchObject({ message: 'delete failed' })
  })

  it('推送：upsert 到 todos 表并带 user_id', async () => {
    const builder = queryStub()
    holder.client = { from: vi.fn(() => builder) }

    await pushRemoteTodos('u1', [{ todo: todo(), position: 0 }])

    expect(builder.upsert).toHaveBeenCalledTimes(1)
    const [rows, options] = builder.upsert.mock.calls[0] as unknown as [
      Array<{ user_id: string }>,
      unknown,
    ]
    expect(rows[0].user_id).toBe('u1')
    expect(options).toEqual({ onConflict: 'id' })
  })

  it('空列表不发请求（离线队列清空后不产生无意义往返）', async () => {
    const from = vi.fn()
    holder.client = { from }

    await pushRemoteTodos('u1', [])
    await deleteRemoteTodos([])

    expect(from).not.toHaveBeenCalled()
  })

  it('删除：按 id 批量删', async () => {
    const builder = queryStub()
    holder.client = { from: vi.fn(() => builder) }

    await deleteRemoteTodos(['t1', 't2'])
    expect(builder.in).toHaveBeenCalledWith('id', ['t1', 't2'])
  })

  it('清空：按 user_id 删除（迁移前腾空云端）', async () => {
    const builder = queryStub()
    holder.client = { from: vi.fn(() => builder) }

    await clearRemoteTodos('u1')
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('未配置 Supabase 时抛引导错误', async () => {
    await expect(fetchRemoteTodos('u1')).rejects.toBeInstanceOf(SupabaseUnavailableError)
    await expect(pushRemoteTodos('u1', [{ todo: todo(), position: 0 }])).rejects.toBeInstanceOf(
      SupabaseUnavailableError,
    )
    await expect(deleteRemoteTodos(['t1'])).rejects.toBeInstanceOf(SupabaseUnavailableError)
  })
})
