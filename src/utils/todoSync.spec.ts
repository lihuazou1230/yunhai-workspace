import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Todo } from '@/types/todo'
import {
  decideLocalCache,
  diffTodos,
  enqueueOperation,
  enqueueOperations,
  isOnline,
  mergeTodos,
  migrationKey,
  snapshotTodos,
  todoSignature,
  uniqueById,
} from './todoSync'

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: '写周报',
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-09T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...overrides,
  }
}

describe('todoSignature', () => {
  it('内容相同则指纹相同', () => {
    expect(todoSignature(todo(), 0)).toBe(todoSignature(todo(), 0))
  })

  it('任一业务字段变化都会改变指纹', () => {
    const base = todoSignature(todo(), 0)
    expect(todoSignature(todo({ title: '写月报' }), 0)).not.toBe(base)
    expect(todoSignature(todo({ status: 'completed' }), 0)).not.toBe(base)
    expect(todoSignature(todo({ priority: 'high' }), 0)).not.toBe(base)
    expect(todoSignature(todo({ dueDate: '2026-09-10' }), 0)).not.toBe(base)
    expect(todoSignature(todo({ pinned: true }), 0)).not.toBe(base)
    expect(todoSignature(todo({ completedAt: '2026-09-10T00:00:00.000Z' }), 0)).not.toBe(base)
    expect(
      todoSignature(todo({ subtasks: [{ id: 's1', title: 'a', completed: false }] }), 0),
    ).not.toBe(base)
  })

  it('顺序变化也算变化（拖拽排序要能同步）', () => {
    expect(todoSignature(todo(), 1)).not.toBe(todoSignature(todo(), 0))
  })

  /**
   * 第六阶段新增的字段必须全部参与指纹。
   * 为什么单列一条：这些字段曾经漏在指纹之外，导致「只归档」「只 snooze」「只改标签」
   * 在差异检测里看不见 —— 本机永远不推送，A 设备归档的任务在 B 设备还是「进行中」。
   * 这条用例就是那次缺陷的回归保护：谁再把新字段漏掉，这里会立刻红。
   */
  it('归档 / 标签 / snooze / 提醒相关字段都参与指纹（漏掉就会同步不出去）', () => {
    const base = todoSignature(todo(), 0)

    expect(todoSignature(todo({ tags: ['work'] }), 0)).not.toBe(base)
    expect(todoSignature(todo({ archived: true }), 0)).not.toBe(base)
    expect(todoSignature(todo({ archivedAt: '2026-09-10T00:00:00.000Z' }), 0)).not.toBe(base)
    expect(todoSignature(todo({ snoozedUntil: '2026-09-20' }), 0)).not.toBe(base)
    expect(todoSignature(todo({ reminderAt: '2026-09-10T09:00:00.000Z' }), 0)).not.toBe(base)
    // 「关掉这条任务的提醒」同样是用户可见的改动，不参与指纹就会在别的设备上继续提醒
    expect(todoSignature(todo({ reminderOff: true }), 0)).not.toBe(base)
  })

  it('标签顺序不影响指纹（只是拖了顺序不该多推一次）', () => {
    expect(todoSignature(todo({ tags: ['a', 'b'] }), 0)).toBe(
      todoSignature(todo({ tags: ['b', 'a'] }), 0),
    )
  })
})

describe('diffTodos', () => {
  it('新增任务 → upsert', () => {
    const diff = diffTodos(new Map(), [todo()])
    expect(diff.upserts.map((u) => u.todo.id)).toEqual(['t1'])
    expect(diff.deletes).toEqual([])
  })

  it('内容未变 → 不产生任何操作（避免无意义写云端）', () => {
    const list = [todo(), todo({ id: 't2', title: '健身' })]
    const diff = diffTodos(snapshotTodos(list), list)
    expect(diff.upserts).toEqual([])
    expect(diff.deletes).toEqual([])
  })

  it('只推送变化的那一条', () => {
    const list = [todo(), todo({ id: 't2', title: '健身' })]
    const changed = [list[0], { ...list[1], status: 'completed' as const }]
    const diff = diffTodos(snapshotTodos(list), changed)
    expect(diff.upserts.map((u) => u.todo.id)).toEqual(['t2'])
    expect(diff.upserts[0].position).toBe(1)
  })

  it('任务被真正删除 → delete（软删除期间列表未变，因此不会误删）', () => {
    const diff = diffTodos(snapshotTodos([todo()]), [])
    expect(diff.deletes).toEqual(['t1'])
    expect(diff.upserts).toEqual([])
  })

  it('换序 → 位置变化的任务重新推送', () => {
    const a = todo()
    const b = todo({ id: 't2', title: '健身' })
    const diff = diffTodos(snapshotTodos([a, b]), [b, a])
    expect(diff.upserts.map((u) => u.todo.id).sort()).toEqual(['t1', 't2'])
  })
})

describe('mergeTodos（迁移时本地优先，远端独有保留）', () => {
  it('同 id 冲突时本地覆盖远端', () => {
    const local = todo({ title: '本地最新' })
    const remote = todo({ title: '云端旧值' })
    expect(mergeTodos([local], [remote])).toEqual([local])
  })

  it('远端独有任务被保留并排在本地之后', () => {
    const local = todo({ id: 'local' })
    const remote = todo({ id: 'remote' })
    expect(mergeTodos([local], [remote]).map((t) => t.id)).toEqual(['local', 'remote'])
  })

  it('本地为空时就是远端原样', () => {
    const remote = [todo({ id: 'r1' }), todo({ id: 'r2' })]
    expect(mergeTodos([], remote)).toEqual(remote)
  })
})

describe('离线队列', () => {
  it('同一任务只保留最后一次操作（last-write-wins）', () => {
    let queue = enqueueOperation([], { todoId: 't1', type: 'upsert' })
    queue = enqueueOperation(queue, { todoId: 't1', type: 'upsert' })
    queue = enqueueOperation(queue, { todoId: 't1', type: 'delete' })
    expect(queue).toEqual([{ todoId: 't1', type: 'delete' }])
  })

  it('不同任务的操作都保留，并按入队顺序排列', () => {
    const queue = enqueueOperations(
      [],
      [
        { todoId: 't1', type: 'upsert' },
        { todoId: 't2', type: 'delete' },
        { todoId: 't1', type: 'upsert' },
      ],
    )
    expect(queue).toEqual([
      { todoId: 't2', type: 'delete' },
      { todoId: 't1', type: 'upsert' },
    ])
  })

  it('uniqueById 同 id 保留后者', () => {
    const merged = uniqueById([todo({ title: '旧' }), todo({ title: '新' })])
    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe('新')
  })
})

describe('本地缓存归属判定（防止跨账号串数据）', () => {
  it('全新安装 / 游客数据 → 保留，作为一次性迁移的来源', () => {
    expect(decideLocalCache(null, 'u1')).toBe('keep-local')
    expect(decideLocalCache('guest', 'u1')).toBe('keep-local')
  })

  it('缓存就是当前账号的 → 以云端为准', () => {
    expect(decideLocalCache('u1', 'u1')).toBe('adopt-remote')
  })

  it('缓存属于别的账号 → 必须清掉', () => {
    expect(decideLocalCache('u2', 'u1')).toBe('wipe-foreign')
  })
})

describe('migrationKey', () => {
  it('按账号隔离迁移标记', () => {
    expect(migrationKey('u1')).toBe('smart-workspace:migrated:u1')
    expect(migrationKey('u1')).not.toBe(migrationKey('u2'))
  })
})

describe('isOnline', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('跟随 navigator.onLine（浏览器断网时同步进入离线降级）', () => {
    expect(isOnline()).toBe(true)

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    expect(isOnline()).toBe(false)

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    expect(isOnline()).toBe(true)
  })

  it('没有 navigator 时按在线处理（SSR / 纯函数单测环境不误判为离线）', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isOnline()).toBe(true)
  })
})

describe('子任务参与同步指纹', () => {
  it('子任务勾选状态变化就改变指纹（完成的子步骤必须能同步到云端）', () => {
    const undone = todo({ subtasks: [{ id: 's1', title: 'a', completed: false }] })
    const done = todo({ subtasks: [{ id: 's1', title: 'a', completed: true }] })

    expect(todoSignature(done, 0)).not.toBe(todoSignature(undone, 0))
    // 指纹里存 1/0 而不是 true/false，跨设备比较时不会因为布尔序列化差异误判
    expect(todoSignature(done, 0)).toContain('[["s1","a",1]]')
    expect(diffTodos(snapshotTodos([undone]), [done]).upserts[0].todo.id).toBe('t1')
  })
})
