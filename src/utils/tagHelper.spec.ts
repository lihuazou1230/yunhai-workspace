import { describe, expect, it } from 'vitest'

import type { Todo } from '@/types/todo'
import {
  archiveTodo,
  createTag,
  filterByTag,
  findTag,
  isArchived,
  isSnoozeDue,
  isSnoozed,
  isTagNameTaken,
  isValidTagName,
  pruneTagRefs,
  safeTagColor,
  snoozeOptions,
  snoozeTodo,
  stripTagFromTodos,
  unarchiveTodo,
  unsnoozeTodo,
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

describe('Snooze 纯函数', () => {
  const today = '2026-09-10'

  it('snoozedUntil 严格晚于今天才算「隐藏中」，到期当天自动回归', () => {
    expect(isSnoozed(todo({ id: '1', snoozedUntil: '2026-09-11' }), today)).toBe(true)
    expect(isSnoozed(todo({ id: '2', snoozedUntil: today }), today)).toBe(false)
    expect(isSnoozed(todo({ id: '3', snoozedUntil: '2026-09-09' }), today)).toBe(false)
    expect(isSnoozed(todo({ id: '4' }), today)).toBe(false)
    expect(isSnoozed(todo({ id: '5', snoozedUntil: '' }), today)).toBe(false)
  })

  it('isSnoozeDue 标记「今天到期回归」', () => {
    expect(isSnoozeDue(todo({ id: '1', snoozedUntil: today }), today)).toBe(true)
    expect(isSnoozeDue(todo({ id: '2', snoozedUntil: '2026-09-11' }), today)).toBe(false)
    expect(isSnoozeDue(todo({ id: '3' }), today)).toBe(false)
  })

  it('snooze / 召回互逆', () => {
    const snoozed = snoozeTodo(todo({ id: '1' }), '2026-09-15')
    expect(snoozed.snoozedUntil).toBe('2026-09-15')

    const recalled = unsnoozeTodo(snoozed)
    expect('snoozedUntil' in recalled).toBe(false)
  })

  it('快捷选项：明天 / 后天 / 下周一（严格晚于今天）', () => {
    // 2026-09-10 是周四
    const options = snoozeOptions(new Date(2026, 8, 10))
    expect(options.map((o) => [o.key, o.date])).toEqual([
      ['tomorrow', '2026-09-11'],
      ['dayAfter', '2026-09-12'],
      ['nextMonday', '2026-09-14'],
    ])
  })

  it('今天就是周一时，「下周一」给下一周而不是今天', () => {
    // 2026-09-14 是周一
    const options = snoozeOptions(new Date(2026, 8, 14))
    expect(options.find((o) => o.key === 'nextMonday')?.date).toBe('2026-09-21')
  })
})
