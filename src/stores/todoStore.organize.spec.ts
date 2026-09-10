/**
 * 第六阶段 6.1：任务组织（标签 / 归档 / Snooze）的 store 级验收用例。
 *
 * 只钉「列表可见性 + 统计口径」这两件事——规划里最容易出错的地方就是
 * 「列表里看不见了但统计还在算」（归档必须排除）与
 * 「只是藏起来却影响了统计」（snooze 必须不影响）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { computeStatistics } from '@/composables/useStatistics'
import { useTagStore } from './tagStore'
import { useTodoStore } from './todoStore'

/** 近 90 天每日完成数求和 = 热力图上的总格子数（只关心数字，不关心哪一天） */
function dailyCompleted(stats: ReturnType<typeof computeStatistics>): number {
  return stats.daily.reduce((sum, day) => sum + day.completed, 0)
}

describe('todoStore · 任务组织（6.1）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('删标签只摘引用：任务 id 与任务自身的业务字段一个都不许变', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: '写周报', priority: 'high', dueDate: '2026-09-20' })
    const b = store.addTodo({ title: '健身', priority: 'low' })
    const c = store.addTodo({ title: '读文档', priority: 'medium' })
    const tagStore = useTagStore()
    const work = tagStore.addTag({ name: '工作', color: 'sky' })!
    const life = tagStore.addTag({ name: '生活', color: 'rose' })!

    // a 同时挂两个标签，b 挂另一个，c 不挂 —— 删 work 时只该动 a 的 tags
    store.todos = store.todos.map((t) =>
      t.id === a.id
        ? { ...t, tags: [work.id, life.id] }
        : t.id === b.id
          ? { ...t, tags: [life.id] }
          : t,
    )
    const before = new Map(store.todos.map((t) => [t.id, { ...t, tags: [...t.tags] }]))

    // 设置页的真实流程：先删标签，再让 todoStore 摘引用
    tagStore.removeTag(work.id)
    store.removeTagReference(work.id)

    // 任务一个都没少，id 也原样（标签是引用，不是任务的宿主）
    expect(store.todos.map((t) => t.id)).toEqual([a.id, b.id, c.id])
    // a 只少了被删的那个标签，其余字段（标题/优先级/截止日/状态）逐字一致
    expect(store.todos.find((t) => t.id === a.id)).toEqual({
      ...before.get(a.id)!,
      tags: [life.id],
    })
    // 没引用过该标签的任务必须**原对象**级别的相等（连引用都不该被重建）
    expect(store.todos.find((t) => t.id === b.id)).toEqual(before.get(b.id))
    expect(store.todos.find((t) => t.id === c.id)).toEqual(before.get(c.id))
    // 标签表里确实少了一个，任务侧的其它标签引用仍然有效
    expect(tagStore.tags.map((t) => t.id)).toEqual([life.id])
    expect(store.tagFilter).toEqual([])
  })

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

  it('归档 / 恢复是一道生命周期开关：列表与统计数字逐项先减后还原', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: '做方案', priority: 'high' })
    const b = store.addTodo({ title: '开会', priority: 'medium' })
    store.addTodo({ title: '读文档', priority: 'low' })
    store.toggleComplete(a.id)
    store.toggleComplete(b.id)
    // 用「全部」筛选，否则进行中的默认筛选会把已完成任务藏起来，看不出归档的差别
    store.setFilter('all')

    const baseline = computeStatistics(store.visibleTodos)
    expect(baseline.total).toBe(3)
    expect(baseline.completed).toBe(2)
    expect(baseline.active).toBe(1)
    expect(baseline.completionRate).toBe(67)
    expect(baseline.byPriority).toEqual([
      { priority: 'high', total: 1, completed: 1 },
      { priority: 'medium', total: 1, completed: 1 },
      { priority: 'low', total: 1, completed: 0 },
    ])
    expect(dailyCompleted(baseline)).toBe(2)

    store.archive(a.id)

    const archived = computeStatistics(store.visibleTodos)
    expect(archived.total).toBe(2)
    expect(archived.completed).toBe(1)
    expect(archived.active).toBe(1)
    expect(archived.completionRate).toBe(50)
    // 高优先级那一档整体归零：归档必须从聚合口径里彻底消失
    expect(archived.byPriority[0]).toEqual({ priority: 'high', total: 0, completed: 0 })
    // 热力图（近 90 天每日完成数）也跟着掉一格，而不是「列表看不见了但还在算」
    expect(dailyCompleted(archived)).toBe(1)

    expect(store.archivedCount).toBe(1)
    expect(store.totalCount).toBe(2)
    expect(store.filteredTodos.map((t) => t.id)).not.toContain(a.id)

    store.unarchive(a.id)

    // 恢复后统计逐项还原（归档没动 status/completedAt，历史数据完整保留）
    expect(computeStatistics(store.visibleTodos)).toEqual(baseline)
    expect(store.archivedCount).toBe(0)
    expect(store.filteredTodos.map((t) => t.id)).toContain(a.id)
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

  it('snooze 到期自动回归：跨过后按新日期重算，但「时钟自己走」不会让缓存失效', () => {
    // 用假时钟推进「今天」，真实等待在这里既慢又不可靠
    vi.useFakeTimers()
    const NOW = new Date(2026, 8, 15, 9, 0, 0) // 2026-09-15
    vi.setSystemTime(NOW)

    const store = useTodoStore()
    const a = store.addTodo({ title: '交房租', priority: 'high' })
    const b = store.addTodo({ title: '健身', priority: 'low' })
    store.togglePinned(a.id) // 置顶 → 同时进「今日聚焦」
    // 统计一律显式传 NOW：跨天会让「近 90 天」的日期键整体平移，
    // 这里要断言的是「哪些任务计入」，不是「今天是几号」
    const baseline = computeStatistics(store.visibleTodos, NOW)

    store.snooze(a.id, '2026-09-16') // 藏到明天

    // 藏起来期间：主列表与今日聚焦都看不到，撤销线索只剩「已隐藏」计数
    expect(store.filteredTodos.map((t) => t.id)).toEqual([b.id])
    expect(store.myDayTodos.some((t) => t.id === a.id)).toBe(false)
    expect(store.snoozedCount).toBe(1)
    // 但统计口径一动不动（snooze 只是「晚点做」，既不算完成也不算删除）
    expect(computeStatistics(store.visibleTodos, NOW)).toEqual(baseline)
    expect(store.todos.some((t) => t.id === a.id)).toBe(true)

    // 跨到 snoozedUntil 当天
    vi.setSystemTime(new Date(2026, 8, 16, 9, 0, 0))
    // 「今天」是 store 里的响应式状态，由 App.vue 定时/回前台校准 —— 校准后
    // 已到期的任务自动回归，**不需要**任何任务写入来触发重算（曾经需要，那是个坑）。
    store.refreshToday()

    expect(store.snoozedCount).toBe(0)
    expect(store.filteredTodos.map((t) => t.id)).toContain(a.id)
    expect(store.myDayTodos.some((t) => t.id === a.id)).toBe(true)
    // 回归不改变统计口径（snooze 只是「晚点做」，既不算完成也不算删除）
    expect(computeStatistics(store.visibleTodos, NOW)).toEqual(baseline)
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
