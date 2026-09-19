import { describe, expect, it } from 'vitest'

import { normalizeTodo, normalizeTodos } from './todoNormalize'

/** 一条合法任务的最小形态 */
function validTodo(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: '写周报',
    status: 'active',
    priority: 'high',
    createdAt: '2026-09-09T00:00:00.000Z',
    pinned: true,
    subtasks: [{ id: 's1', title: '收集数据', completed: true }],
    tags: ['tag-a'],
    ...overrides,
  }
}

describe('normalizeTodo', () => {
  it('合法任务原样通过（可选字段只在有时才挂上）', () => {
    const todo = normalizeTodo(validTodo({ dueDate: '2026-09-10' }))

    expect(todo).toEqual({
      id: 't1',
      title: '写周报',
      status: 'active',
      priority: 'high',
      createdAt: '2026-09-09T00:00:00.000Z',
      pinned: true,
      subtasks: [{ id: 's1', title: '收集数据', completed: true }],
      tags: ['tag-a'],
      dueDate: '2026-09-10',
    })
  })

  it('补齐缺失字段（这是第 1 阶段旧数据升上来的真实形态）', () => {
    // 第 1 阶段的 Todo 只有 id/title/status/priority/dueDate/createdAt
    const todo = normalizeTodo({
      id: 'old-1',
      title: '旧任务',
      status: 'active',
      priority: 'medium',
      createdAt: '2026-09-01T00:00:00.000Z',
    })

    expect(todo).not.toBeNull()
    // 缺的富字段必须补齐，否则 TodoItem 的 subtasks.length / tagsOf 会在渲染期抛错
    expect(todo?.pinned).toBe(false)
    expect(todo?.subtasks).toEqual([])
    expect(todo?.tags).toEqual([])
  })

  it('非法 status / priority 收敛到合法值', () => {
    const todo = normalizeTodo(validTodo({ status: 'done', priority: 'urgent' }))

    expect(todo?.status).toBe('active')
    expect(todo?.priority).toBe('medium')
  })

  it('subtasks 里结构不完整的整条丢掉，completed 非 true 一律按未完成', () => {
    const todo = normalizeTodo(
      validTodo({
        subtasks: [
          { id: 'ok', title: '有效', completed: 1 },
          { id: 'no-title' },
          { title: '没有 id' },
          'garbage',
          null,
        ],
      }),
    )

    expect(todo?.subtasks).toEqual([{ id: 'ok', title: '有效', completed: false }])
  })

  it('tags 去掉非字符串/空串并去重', () => {
    const todo = normalizeTodo(validTodo({ tags: ['a', '', '  ', 'a', 5, null, 'b'] }))

    expect(todo?.tags).toEqual(['a', 'b'])
  })

  it('createdAt 缺失或不可解析时给一个合法的 ISO 时间（否则日期相关计算会得 Invalid Date）', () => {
    const todo = normalizeTodo(validTodo({ createdAt: '' }))

    expect(todo?.createdAt).toBeTruthy()
    expect(Number.isNaN(new Date(todo?.createdAt ?? '').getTime())).toBe(false)
  })

  it('空白字符串的可选字段视为「没有」而不是空串', () => {
    const todo = normalizeTodo(
      validTodo({ dueDate: '   ', reminderAt: null, archivedAt: undefined }),
    )

    expect(todo).not.toHaveProperty('dueDate')
    expect(todo).not.toHaveProperty('reminderAt')
    expect(todo).not.toHaveProperty('archivedAt')
  })

  it('旧数据里的 snoozedUntil（隐藏机制）在归一化时被丢弃', () => {
    // 该机制已整体移除：存量任务会因此重新出现在主列表里，而不是继续被藏着
    const todo = normalizeTodo(validTodo({ snoozedUntil: '2026-09-20' }))
    expect(todo).not.toHaveProperty('snoozedUntil')
  })

  it('归档 / 提醒开关按严格 true 还原', () => {
    const todo = normalizeTodo(
      validTodo({
        archived: true,
        archivedAt: '2026-09-11T02:00:00.000Z',
        reminderAt: '2026-09-12T01:00:00.000Z',
        reminderOff: true,
      }),
    )

    expect(todo?.archived).toBe(true)
    expect(todo?.archivedAt).toBe('2026-09-11T02:00:00.000Z')
    expect(todo?.reminderAt).toBe('2026-09-12T01:00:00.000Z')
    expect(todo?.reminderOff).toBe(true)
  })

  it('archived/reminderOff 非 true 时不写入该键（保持对象干净）', () => {
    const todo = normalizeTodo(validTodo({ archived: 'yes', reminderOff: 1 }))

    expect(todo).not.toHaveProperty('archived')
    expect(todo).not.toHaveProperty('reminderOff')
  })

  it('没有 id / 不是对象 → 丢弃（既渲染不了也操作不了）', () => {
    expect(normalizeTodo({ title: '无 id' })).toBeNull()
    expect(normalizeTodo({ id: '   ', title: ' 空白 id' })).toBeNull()
    expect(normalizeTodo(null)).toBeNull()
    expect(normalizeTodo('字符串')).toBeNull()
    expect(normalizeTodo(42)).toBeNull()
    expect(normalizeTodo([])).toBeNull()
  })

  it('title 缺失不丢弃，回落空串（与云端 fromRemoteRow 口径一致，不静默删用户数据）', () => {
    const todo = normalizeTodo({ id: 't9', title: null })

    expect(todo).not.toBeNull()
    expect(todo?.title).toBe('')
  })
})

describe('normalizeTodos', () => {
  it('非数组一律当空列表（白屏元凶就是这个）', () => {
    expect(normalizeTodos({ a: 1 })).toEqual([])
    expect(normalizeTodos('null')).toEqual([])
    expect(normalizeTodos(null)).toEqual([])
    expect(normalizeTodos(undefined)).toEqual([])
    expect(normalizeTodos(123)).toEqual([])
  })

  it('逐条救援：坏的丢掉，好的留下', () => {
    const result = normalizeTodos([validTodo(), { title: '无 id' }, null, validTodo({ id: 't2' })])

    expect(result.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('重复 id 只保留第一条（重复会让 v-for key 冲突）', () => {
    const result = normalizeTodos([validTodo({ title: '先来的' }), validTodo({ title: '后来的' })])

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('先来的')
  })

  it('空数组原样返回', () => {
    expect(normalizeTodos([])).toEqual([])
  })
})
