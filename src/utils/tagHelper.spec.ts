import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Todo } from '@/types/todo'
import {
  POSTPONE_OPTIONS,
  archiveTodo,
  createTag,
  filterByTag,
  findTag,
  isArchived,
  isTagNameTaken,
  isValidTagName,
  postponeTodo,
  pruneTagRefs,
  safeTagColor,
  stripTagFromTodos,
  unarchiveTodo,
} from './tagHelper'

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: '任务',
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

describe('标签纯函数', () => {
  it('标签名校验：非空且不超长', () => {
    expect(isValidTagName('工作')).toBe(true)
    expect(isValidTagName(' 工作 ')).toBe(true)
    expect(isValidTagName('')).toBe(false)
    expect(isValidTagName('   ')).toBe(false)
    expect(isValidTagName('一'.repeat(12))).toBe(true)
    expect(isValidTagName('一'.repeat(13))).toBe(false)
  })

  it('重名判断忽略大小写与首尾空白，改名时可排除自己', () => {
    const tags = [
      { id: 'a', name: 'Work', color: 'sky' as const },
      { id: 'b', name: '生活', color: 'rose' as const },
    ]
    expect(isTagNameTaken(tags, 'work')).toBe(true)
    expect(isTagNameTaken(tags, ' 生活 ')).toBe(true)
    expect(isTagNameTaken(tags, '学习')).toBe(false)
    // 改自己的名字不该被自己挡住
    expect(isTagNameTaken(tags, 'work', 'a')).toBe(false)
  })

  it('createTag 去空白并生成 id', () => {
    const tag = createTag({ name: '  工作  ', color: 'violet' })
    expect(tag.name).toBe('工作')
    expect(tag.color).toBe('violet')
    expect(tag.id.length).toBeGreaterThan(0)
    expect(createTag({ name: 'a', color: 'sky' }).id).not.toBe(tag.id)
  })

  it('findTag / safeTagColor（未知色名兜底 slate）', () => {
    const tags = [{ id: 'a', name: '工作', color: 'sky' as const }]
    expect(findTag(tags, 'a')?.name).toBe('工作')
    expect(findTag(tags, 'zzz')).toBeUndefined()
    expect(safeTagColor('rose')).toBe('rose')
    expect(safeTagColor('不存在的色')).toBe('slate')
  })

  it('删除标签只摘引用，任务本身不删', () => {
    const list = [
      todo({ id: '1', tags: ['t1', 't2'] }),
      todo({ id: '2', tags: ['t2'] }),
      todo({ id: '3', tags: [] }),
    ]
    const next = stripTagFromTodos(list, 't2')

    expect(next).toHaveLength(3) // 任务一个都没少
    expect(next[0].tags).toEqual(['t1'])
    expect(next[1].tags).toEqual([])
    // 未受影响的任务保持原引用（不做无意义的重建）
    expect(next[2]).toBe(list[2])
  })

  it('按标签过滤：多选命中任一即保留，空数组不过滤', () => {
    const list = [todo({ id: '1', tags: ['a'] }), todo({ id: '2', tags: ['b'] }), todo({ id: '3' })]
    expect(filterByTag(list, []).map((t) => t.id)).toEqual(['1', '2', '3'])
    expect(filterByTag(list, ['a']).map((t) => t.id)).toEqual(['1'])
    expect(filterByTag(list, ['a', 'b']).map((t) => t.id)).toEqual(['1', '2'])
    expect(filterByTag(list, ['zzz'])).toEqual([])
  })

  it('pruneTagRefs 清掉已不存在的标签残留', () => {
    const list = [todo({ id: '1', tags: ['alive', 'dead'] }), todo({ id: '2', tags: ['alive'] })]
    const next = pruneTagRefs(list, [{ id: 'alive', name: '在', color: 'sky' }])

    expect(next[0].tags).toEqual(['alive'])
    expect(next[1]).toBe(list[1])
  })
})

describe('归档纯函数', () => {
  it('归档保留 status / completedAt，只加软状态标记', () => {
    const original = todo({
      id: '1',
      status: 'completed',
      completedAt: '2026-09-05T10:00:00.000Z',
    })
    const archived = archiveTodo(original, new Date('2026-09-10T08:00:00.000Z'))

    expect(archived.archived).toBe(true)
    expect(archived.archivedAt).toBe('2026-09-10T08:00:00.000Z')
    // 历史记录原样保留 —— 取消归档后统计能立刻恢复
    expect(archived.status).toBe('completed')
    expect(archived.completedAt).toBe('2026-09-05T10:00:00.000Z')
    expect(isArchived(archived)).toBe(true)
    expect(isArchived(original)).toBe(false)
  })

  it('取消归档清掉 archived 与 archivedAt 两个字段', () => {
    const archived = archiveTodo(todo({ id: '1' }), new Date('2026-09-10T08:00:00.000Z'))
    const restored = unarchiveTodo(archived)

    expect(restored.archived).toBe(false)
    expect('archivedAt' in restored).toBe(false)
  })
})

describe('推后到期日（原 Snooze）', () => {
  const today = '2026-09-10'

  it('在当前 dueDate 上叠加，而不是从今天算', () => {
    const t = todo({ id: '1', dueDate: '2026-09-20' })
    expect(postponeTodo(t, 1, today).dueDate).toBe('2026-09-21')
    expect(postponeTodo(t, 7, today).dueDate).toBe('2026-09-27')
    expect(postponeTodo(t, 30, today).dueDate).toBe('2026-10-20')
  })

  it('没有截止日期时以今天为基准设上（不是"推后但仍无日期"）', () => {
    expect(postponeTodo(todo({ id: '2' }), 1, today).dueDate).toBe('2026-09-11')
    expect(postponeTodo(todo({ id: '3' }), 7, today).dueDate).toBe('2026-09-17')
  })

  it('过期的任务也保证"推了就有用"：结果必定落在未来', () => {
    const overdue = todo({ id: '4', dueDate: '2026-08-10' }) // 逾期约一个月

    // +1 天：叠加值（8/11）仍在过去 → 取「今天 + 1」
    expect(postponeTodo(overdue, 1, today).dueDate).toBe('2026-09-11')

    // +40 天：叠加值（9/19）已经在未来，但它比「今天 + 40」早，
    // 仍取较晚的那个 —— 否则"推后 40 天"对逾期任务等于只推了 9 天
    expect(postponeTodo(overdue, 40, today).dueDate).toBe('2026-10-20')

    // 有日期且未逾期时就是纯粹叠加，不受兜底影响
    expect(postponeTodo(todo({ id: '4b', dueDate: '2026-09-20' }), 7, today).dueDate).toBe(
      '2026-09-27',
    )
  })

  it('非法的 dueDate 当成没有日期（以今天为基准）', () => {
    expect(postponeTodo(todo({ id: '5', dueDate: '不是日期' }), 1, today).dueDate).toBe(
      '2026-09-11',
    )
    expect(postponeTodo(todo({ id: '6', dueDate: '' }), 1, today).dueDate).toBe('2026-09-11')
  })

  it('天数兜底：0 / 负数 / 小数都收敛成"至少推 1 天"', () => {
    const t = todo({ id: '7', dueDate: '2026-09-20' })
    expect(postponeTodo(t, 0, today).dueDate).toBe('2026-09-21')
    expect(postponeTodo(t, -5, today).dueDate).toBe('2026-09-21')
    expect(postponeTodo(t, 1.7, today).dueDate).toBe('2026-09-21')
  })

  it('只改 dueDate，不引入任何"隐藏"字段（旧 snoozedUntil 机制已移除）', () => {
    const after = postponeTodo(todo({ id: '8', dueDate: '2026-09-20' }), 1, today)
    expect('snoozedUntil' in after).toBe(false)
    expect(after.status).toBe('active')
  })

  it('快捷选项与新建表单的 1天/1周/1月 保持一致', () => {
    expect(POSTPONE_OPTIONS.map((o) => [o.key, o.days])).toEqual([
      ['day', 1],
      ['week', 7],
      ['month', 30],
    ])
  })
})

describe('标签 id 生成的兜底（crypto 不可用时）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('crypto 整个缺失时退化成时间戳 + 随机串，同一毫秒内也不撞 id', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0))
    // 老 Safari / http 内网访问（非安全上下文）里没有 globalThis.crypto
    vi.stubGlobal('crypto', undefined)

    const a = createTag({ name: '  工作  ', color: 'sky' })
    const b = createTag({ name: '生活', color: 'rose' })

    expect(a.id.startsWith(`tag-${Date.now()}-`)).toBe(true)
    expect(a.id).toMatch(/^tag-\d+-[a-z0-9]{1,8}$/)
    // 连续建两个标签必须拿到不同 id，否则列表的 :key 会互相顶掉
    expect(b.id).not.toBe(a.id)
    // 走兜底路径同样要保留「去空白」等业务语义
    expect(a.name).toBe('工作')
    expect(b.color).toBe('rose')
  })

  it('crypto 存在但没有 randomUUID 时也走兜底（并非所有实现都带这个方法）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0))
    vi.stubGlobal('crypto', { getRandomValues: () => new Uint8Array(1) })

    expect(createTag({ name: '工作', color: 'sky' }).id).toMatch(/^tag-\d+-[a-z0-9]{1,8}$/)
  })
})
