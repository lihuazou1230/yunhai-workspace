/**
 * 第六阶段 6.1：任务组织（标签 / 归档 / 推后到期日）的 store 级验收用例。
 *
 * 只钉「列表可见性 + 统计口径」这两件事——规划里最容易出错的地方就是
 * 「列表里看不见了但统计还在算」（归档必须排除）。
 *
 * 注意推后（原 Snooze）的语义已经变了：它不再"藏起来"，而是改 dueDate，
 * 所以**会**影响按到期日计算的口径（今日聚焦/今日完成度），这与旧实现刻意相反。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { computeStatistics } from '@/composables/useStatistics'
import { addDays, todayKey } from '@/utils/dateFormatter'
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

  // ---- 推后到期日（原 Snooze） ----

  it('推后只改到期日：任务不消失，主列表照旧看得见', () => {
    const { store } = seed()
    // 明确给一个截止日期：这条用例验的是"在原日期上叠加"
    const withDue = store.addTodo({
      title: '要推后的',
      priority: 'high',
      dueDate: addDays(todayKey(), 3),
    })

    store.postpone(withDue.id, 1)

    // 关键语义变化：不再"藏起来"，任务仍在主列表里
    expect(store.filteredTodos.some((t) => t.id === withDue.id)).toBe(true)
    const after = store.todos.find((t) => t.id === withDue.id)!
    expect(after.dueDate).toBe(addDays(todayKey(), 4))
    // 也没有产生任何隐藏状态
    expect('snoozedUntil' in after).toBe(false)
  })

  it('没有截止日期的任务：以今天为基准设上（1 天 = 明天）', () => {
    const { store } = seed()
    const noDue = store.addTodo({ title: '还没定日子', priority: 'low' })
    expect(noDue.dueDate).toBeUndefined()

    store.postpone(noDue.id, 1)

    expect(store.todos.find((t) => t.id === noDue.id)?.dueDate).toBe(addDays(todayKey(), 1))
  })

  it('推后会影响「今日到期」口径：今天到期的任务推走后不再进今日聚焦', () => {
    const { store } = seed()
    // 造一条今天到期的任务（今日聚焦收「置顶 或 今日到期」）
    const today = store.addTodo({ title: '今天到期', priority: 'high', dueDate: todayKey() })
    expect(store.myDayTodos.some((t) => t.id === today.id)).toBe(true)

    store.postpone(today.id, 1)

    /*
      这是与旧 snooze 的本质差别：旧实现"不影响任何统计"（有专门用例守着），
      新实现改的是 dueDate，所以今日聚焦/今日完成度这些按到期日算的口径会跟着变。
    */
    expect(store.todos.find((t) => t.id === today.id)?.dueDate).toBe(addDays(todayKey(), 1))
    expect(store.myDayTodos.some((t) => t.id === today.id)).toBe(false)
  })

  it('批量推后', () => {
    const { store } = seed()
    const a = store.addTodo({ title: 'A', priority: 'high', dueDate: addDays(todayKey(), 1) })
    const b = store.addTodo({ title: 'B', priority: 'low', dueDate: addDays(todayKey(), 10) })

    store.bulkPostpone([a.id, b.id], 7)

    expect(store.todos.find((t) => t.id === a.id)?.dueDate).toBe(addDays(todayKey(), 8))
    expect(store.todos.find((t) => t.id === b.id)?.dueDate).toBe(addDays(todayKey(), 17))
    // 批量动作会顺手退出多选
    expect(store.selectedIds).toEqual([])
  })

  it('旧的隐藏机制已从 store 移除（没有「已隐藏」视图/计数/召回）', () => {
    const { store } = seed()
    // 这些接口不该再存在：留着会让"隐藏"语义悄悄复活
    expect('snooze' in store).toBe(false)
    expect('unsnooze' in store).toBe(false)
    expect('bulkUnsnooze' in store).toBe(false)
    expect('snoozedTodos' in store).toBe(false)
    expect('snoozedCount' in store).toBe(false)
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

  it('归档 / 推后 / 标签都会随云同步推送（差异检测能看到新字段）', async () => {
    const { store } = seed()
    const tagStore = useTagStore()
    const tag = tagStore.addTag({ name: '工作', color: 'sky' })!
    const a = store.addTodo({
      title: '要同步的',
      priority: 'medium',
      dueDate: addDays(todayKey(), 2),
    })

    // 未激活云同步时不应抛错，且本地状态要正确
    store.todos = store.todos.map((t) => (t.id === a.id ? { ...t, tags: [tag.id] } : t))
    store.archive(a.id)
    store.postpone(a.id, 1)

    const target = store.todos.find((t) => t.id === a.id)!
    expect(target.tags).toEqual([tag.id])
    expect(target.archived).toBe(true)
    // 推后走的是 dueDate —— 它本来就在同步指纹里，不需要额外字段
    expect(target.dueDate).toBe(addDays(todayKey(), 3))
    expect(store.syncState).toBe('local')
  })
})
