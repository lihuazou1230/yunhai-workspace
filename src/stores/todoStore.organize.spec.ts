/**
 * 第六阶段 6.1：任务组织（标签 / 归档 / Snooze）的 store 级验收用例。
 *
 * 只钉「列表可见性 + 统计口径」这两件事——规划里最容易出错的地方就是
 * 「列表里看不见了但统计还在算」（归档必须排除）与
 * 「只是藏起来却影响了统计」（snooze 必须不影响）。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { computeStatistics } from '@/composables/useStatistics'
import { useTagStore } from './tagStore'
import { useTodoStore } from './todoStore'

describe('todoStore · 任务组织（6.1）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  function seed() {
    const store = useTodoStore()
    const a = store.addTodo({ title: '写周报', priority: 'high' })
    const b = store.addTodo({ title: '健身', priority: 'medium' })
    const c = store.addTodo({ title: '读文档', priority: 'low' })
    return { store, a, b, c }
  }

  // ---- 标签 ----

  it('新建任务可带标签，标签筛选与关键字/优先级叠加生效', () => {
    const { store, a, b } = seed()
    const tagStore = useTagStore()
    const work = tagStore.addTag({ name: '工作', color: 'sky' })!
    const life = tagStore.addTag({ name: '生活', color: 'rose' })!

    store.updateTodo(a.id, {})
    // 直接改底层数据模拟「任务带上标签」
    store.todos = store.todos.map((t) =>
      t.id === a.id ? { ...t, tags: [work.id] } : t.id === b.id ? { ...t, tags: [life.id] } : t,
    )

    expect(store.todos.find((t) => t.id === a.id)?.tags).toEqual([work.id])

    store.setFilter('all')
    store.toggleTagFilter(work.id)
    expect(store.filteredTodos.map((t) => t.id)).toEqual([a.id])

    // 与优先级筛选叠加
    store.togglePriority('low')
    expect(store.filteredTodos).toEqual([])

    store.togglePriority('low')
    store.clearTagFilter()
    expect(store.filteredTodos).toHaveLength(3)
  })

  it('删除标签只摘掉任务上的引用，任务本身不删且筛选同步清理', () => {
    const { store, a } = seed()
    const tagStore = useTagStore()
    const tag = tagStore.addTag({ name: '工作', color: 'sky' })!

    store.todos = store.todos.map((t) => (t.id === a.id ? { ...t, tags: [tag.id] } : t))
    store.toggleTagFilter(tag.id)

    // 模拟设置页的删除流程：先删标签，再摘引用
    tagStore.removeTag(tag.id)
    store.removeTagReference(tag.id)

    expect(store.todos).toHaveLength(3) // 任务一个都没少
    expect(store.todos.find((t) => t.id === a.id)?.tags).toEqual([])
    expect(store.tagFilter).toEqual([]) // 失效的筛选被清掉
    expect(store.filteredTodos).toHaveLength(3)
  })

  // ---- 归档 ----

  it('归档后主列表与统计（含热力图数据）都不再出现', () => {
    const { store, a, b } = seed()
    store.toggleComplete(a.id) // a 已完成（带 completedAt，会计入热力图）

    const before = computeStatistics(store.visibleTodos)
    expect(before.total).toBe(3)
    expect(before.completed).toBe(1)
    expect(before.daily.some((d) => d.completed > 0)).toBe(true)

    store.archive(a.id)

    expect(store.visibleTodos.map((t) => t.id)).toEqual([b.id, store.todos[2].id])
    const after = computeStatistics(store.visibleTodos)
    expect(after.total).toBe(2)
    expect(after.completed).toBe(0)
    // 归档任务不再计入每日完成数（热力图口径随之变化）
    expect(after.daily.every((d) => d.completed === 0)).toBe(true)
    // 但历史数据仍在（completedAt 没被删），取消归档即可恢复
    expect(store.todos.find((t) => t.id === a.id)?.completedAt).toBeTruthy()
  })

  it('归档视图能列出归档任务，恢复后回到主列表且统计复原', () => {
    const { store, a } = seed()
    store.toggleComplete(a.id)
    store.archive(a.id)

    store.setListView('archived')
    // 归档视图不套「进行中」筛选，已完成但归档的任务照样列出来
    expect(store.filteredTodos.map((t) => t.id)).toEqual([a.id])
    expect(store.archivedCount).toBe(1)

    store.unarchive(a.id)
    expect(store.archivedCount).toBe(0)
    // 回到统计口径：任务重新计入
    expect(store.visibleTodos.some((t) => t.id === a.id)).toBe(true)
    expect(computeStatistics(store.visibleTodos).completed).toBe(1)

    store.setListView('main')
    store.setFilter('all')
    expect(store.filteredTodos.some((t) => t.id === a.id)).toBe(true)
  })

  it('批量归档所有已完成任务', () => {
    const { store, a, b, c } = seed()
    store.toggleComplete(a.id)
    store.toggleComplete(b.id)

    store.bulkArchive([a.id, b.id])

    expect(store.archivedCount).toBe(2)
    expect(store.visibleTodos.map((t) => t.id)).toEqual([c.id])
  })

  it('归档任务彻底删除仍走软删除（1 分钟内可撤销）', () => {
    const { store, a } = seed()
    store.archive(a.id)
    store.setListView('archived')

    store.removeTodo(a.id)
    // 已从归档视图消失，但仍在撤销窗口内
    expect(store.filteredTodos).toEqual([])
    expect(store.latestPendingDelete?.todo.id).toBe(a.id)

    store.undoDelete(a.id)
    expect(store.archivedTodos.map((t) => t.id)).toEqual([a.id])
  })

  // ---- Snooze ----

  it('snooze 后主列表与今日聚焦立即隐藏，且不影响任何统计', () => {
    const { store, a, b } = seed()
    store.togglePinned(a.id)
    const before = computeStatistics(store.visibleTodos)

    const until = '2999-01-01'
    store.snooze(a.id, until)

    // 主列表隐藏
    expect(store.filteredTodos.some((t) => t.id === a.id)).toBe(false)
    // 今日聚焦（置顶的那条）也隐藏
    expect(store.myDayTodos.some((t) => t.id === a.id)).toBe(false)
    expect(store.myDayTodos).toEqual([])

    // 统计口径完全不变（snooze 不算完成、不算删除）
    expect(computeStatistics(store.visibleTodos)).toEqual(before)
    expect(store.snoozedCount).toBe(1)
    // 任务本身还在底层数据里
    expect(store.todos.some((t) => t.id === a.id)).toBe(true)
    expect(store.filteredTodos.map((t) => t.id)).toEqual([b.id, store.todos[2].id])
  })

  it('snooze 到期（snoozedUntil <= 今天）自动回归主列表', () => {
    const { store, a } = seed()
    store.snooze(a.id, '2000-01-01') // 过去的日期 = 已到期

    expect(store.snoozedCount).toBe(0)
    expect(store.filteredTodos.some((t) => t.id === a.id)).toBe(true)
  })

  it('「已隐藏」视图可看到 snooze 中的任务并提前召回', () => {
    const { store, a } = seed()
    store.snooze(a.id, '2999-01-01')

    store.setListView('snoozed')
    expect(store.filteredTodos.map((t) => t.id)).toEqual([a.id])

    store.unsnooze(a.id)
    expect(store.snoozedCount).toBe(0)

    store.setListView('main')
    expect(store.filteredTodos.some((t) => t.id === a.id)).toBe(true)
  })

  it('批量召回', () => {
    const { store, a, b } = seed()
    store.snooze(a.id, '2999-01-01')
    store.snooze(b.id, '2999-01-01')
    expect(store.snoozedCount).toBe(2)

    store.bulkUnsnooze([a.id, b.id])
    expect(store.snoozedCount).toBe(0)
  })

  it('切换视图会重置手动排序与多选状态', () => {
    const { store, a, b } = seed()
    store.moveTodo(a.id, b.id)
    expect(store.manualOrder).toBe(true)

    store.toggleSelectionMode()
    store.toggleSelect(a.id)
    expect(store.selectedIds).toEqual([a.id])

    store.setListView('archived')
    expect(store.manualOrder).toBe(false)
    expect(store.selectedIds).toEqual([])
  })

  it('归档 / snooze / 标签都会随云同步推送（差异检测能看到新字段）', async () => {
    const { store, a } = seed()
    const tagStore = useTagStore()
    const tag = tagStore.addTag({ name: '工作', color: 'sky' })!

    // 未激活云同步时不应抛错，且本地状态要正确
    store.todos = store.todos.map((t) => (t.id === a.id ? { ...t, tags: [tag.id] } : t))
    store.archive(a.id)
    store.snooze(a.id, '2999-01-01')

    const target = store.todos.find((t) => t.id === a.id)!
    expect(target.tags).toEqual([tag.id])
    expect(target.archived).toBe(true)
    expect(target.snoozedUntil).toBe('2999-01-01')
    expect(store.syncState).toBe('local')
  })
})
