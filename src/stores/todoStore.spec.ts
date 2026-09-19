import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import { useTodoStore, TODO_STORAGE_KEY } from './todoStore'
import { UNDO_DELETE_TIMEOUT } from '@/types/todo'
import { todayKey } from '@/utils/dateFormatter'

function seedTodos() {
  const store = useTodoStore()
  const a = store.addTodo({ title: '写周报', priority: 'high', dueDate: '2026-09-10' })
  const b = store.addTodo({ title: '健身', priority: 'low' })
  store.toggleComplete(b.id)
  return { store, a, b }
}

describe('todoStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useRealTimers()
  })

  it('addTodo 生成默认字段', () => {
    const store = useTodoStore()
    const todo = store.addTodo({ title: '  写周报  ', priority: 'high' })
    expect(todo.title).toBe('写周报')
    expect(todo.status).toBe('active')
    expect(todo.pinned).toBe(false)
    expect(todo.subtasks).toEqual([])
    expect(todo.id).toBeTruthy()
    expect(store.totalCount).toBe(1)
  })

  /**
   * 本地存储是「不可信输入」：用户可以手改，也可能残留旧版本格式。
   * 回归的是这条高危：`liveTodos` 直接 `todos.value.filter(...)`，
   * 只要解析出来的不是数组就会在渲染期抛 TypeError —— 任务页白屏，刷新也一样。
   */
  describe('本地存储脏数据', () => {
    it('存储不是数组时按空列表处理，不抛错', () => {
      localStorage.setItem(TODO_STORAGE_KEY, '{"a":1}')

      const store = useTodoStore()

      expect(store.filteredTodos).toEqual([])
      expect(store.totalCount).toBe(0)
    })

    it("存储是字面量 'null' 时不抛错", () => {
      localStorage.setItem(TODO_STORAGE_KEY, 'null')

      const store = useTodoStore()

      expect(store.filteredTodos).toEqual([])
    })

    it('旧版本缺字段的记录被补齐（否则 TodoItem 读 subtasks/tags 会炸）', () => {
      // 第 1 阶段的 Todo 只有 id/title/status/priority/dueDate/createdAt
      localStorage.setItem(
        TODO_STORAGE_KEY,
        JSON.stringify([
          {
            id: 'old-1',
            title: '旧任务',
            status: 'active',
            priority: 'medium',
            createdAt: '2026-09-01T00:00:00.000Z',
          },
        ]),
      )

      const store = useTodoStore()
      const [todo] = store.filteredTodos

      expect(todo.title).toBe('旧任务')
      expect(todo.subtasks).toEqual([])
      expect(todo.tags).toEqual([])
      expect(todo.pinned).toBe(false)
    })

    it('没有 id 的垃圾记录被丢掉，合法记录保留', () => {
      localStorage.setItem(
        TODO_STORAGE_KEY,
        JSON.stringify([{ title: '垃圾' }, { id: 'ok', title: '好的' }]),
      )

      const store = useTodoStore()

      expect(store.filteredTodos.map((t) => t.id)).toEqual(['ok'])
    })
  })

  it('updateTodo 合并部分字段', () => {
    const store = useTodoStore()
    const { a } = seedTodos()
    store.updateTodo(a.id, { title: '写月度周报', priority: 'low' })
    const updated = store.todos.find((t) => t.id === a.id)
    expect(updated?.title).toBe('写月度周报')
    expect(updated?.priority).toBe('low')
    expect(updated?.dueDate).toBe('2026-09-10')
  })

  it('toggleComplete 切换状态并记录/清除完成时间', () => {
    const store = useTodoStore()
    const { a } = seedTodos()
    store.toggleComplete(a.id)
    expect(store.todos.find((t) => t.id === a.id)?.status).toBe('completed')
    expect(store.todos.find((t) => t.id === a.id)?.completedAt).toBeTruthy()
    store.toggleComplete(a.id)
    expect(store.todos.find((t) => t.id === a.id)?.status).toBe('active')
    expect(store.todos.find((t) => t.id === a.id)?.completedAt).toBeUndefined()
  })

  it('filteredTodos 支持状态过滤', () => {
    const store = useTodoStore()
    seedTodos()
    store.setFilter('all')
    expect(store.filteredTodos).toHaveLength(2)
    store.setFilter('completed')
    expect(store.filteredTodos).toHaveLength(1)
    expect(store.filteredTodos[0].title).toBe('健身')
  })

  it('filteredTodos 支持关键字搜索', () => {
    const store = useTodoStore()
    seedTodos()
    store.setKeyword(' 周报 ')
    expect(store.filteredTodos).toHaveLength(1)
    expect(store.filteredTodos[0].title).toBe('写周报')
  })

  it('togglePriority 多选按优先级过滤，三者全选自动清空', () => {
    const store = useTodoStore()
    store.addTodo({ title: '高优', priority: 'high' })
    store.addTodo({ title: '低优', priority: 'low' })
    store.addTodo({ title: '中优', priority: 'medium' })
    expect(store.filteredTodos).toHaveLength(3)

    store.togglePriority('high')
    expect(store.priority).toEqual(['high'])
    expect(store.filteredTodos.map((t) => t.title)).toEqual(['高优'])

    // 多选：再加 low，同时命中 high/low
    store.togglePriority('low')
    expect(store.priority).toEqual(['high', 'low'])
    expect(store.filteredTodos).toHaveLength(2)

    // 再选中 medium -> 三者全选 -> 自动清空（全部）
    store.togglePriority('medium')
    expect(store.priority).toEqual([])
    expect(store.filteredTodos).toHaveLength(3)

    // 先选中再取消
    store.togglePriority('high')
    store.togglePriority('high')
    expect(store.priority).toEqual([])

    // clearPriority
    store.togglePriority('medium')
    store.clearPriority()
    expect(store.priority).toEqual([])
  })

  it('计数 getters 正确', () => {
    const store = useTodoStore()
    seedTodos()
    expect(store.totalCount).toBe(2)
    expect(store.activeCount).toBe(1)
    expect(store.completedCount).toBe(1)
  })

  it('filteredTodos 按优先级高→低、同优先级截止早→晚排序', () => {
    const store = useTodoStore()
    store.addTodo({ title: '低-无日期', priority: 'low' })
    store.addTodo({ title: '高-早', priority: 'high', dueDate: '2026-09-05' })
    store.addTodo({ title: '中-早', priority: 'medium', dueDate: '2026-09-10' })
    store.addTodo({ title: '高-晚', priority: 'high', dueDate: '2026-09-20' })
    const titles = store.filteredTodos.map((t) => t.title)
    expect(titles).toEqual(['高-早', '高-晚', '中-早', '低-无日期'])
  })

  it('removeTodo 软删除：进入撤销队列，立即可撤销', () => {
    const store = useTodoStore()
    const { a, b } = seedTodos()
    store.removeTodo(a.id)
    // 进入撤销队列，可见列表已隐藏
    expect(store.pendingDeletes).toHaveLength(1)
    expect(store.latestPendingDelete?.todo.id).toBe(a.id)
    expect(store.visibleTodos.map((t) => t.id)).toEqual([b.id])
    // 软删除期间不落盘：todos 底层仍保留
    expect(store.todos.some((t) => t.id === a.id)).toBe(true)

    // 撤销恢复
    store.undoDelete(a.id)
    expect(store.pendingDeletes).toHaveLength(0)
    expect(store.visibleTodos.map((t) => t.id)).toContain(a.id)
  })

  it('undoDelete 后不再自动超时删除', async () => {
    vi.useFakeTimers()
    const store = useTodoStore()
    const { a } = seedTodos()
    store.removeTodo(a.id)

    // 撤销，取消定时器
    store.undoDelete(a.id)
    vi.advanceTimersByTime(60_000 + 100)
    expect(store.todos.some((t) => t.id === a.id)).toBe(true)
    expect(store.pendingDeletes).toHaveLength(0)
  })

  it('removeTodo 超时 60 秒后真正删除并落盘', async () => {
    vi.useFakeTimers()
    const store = useTodoStore()
    const { a, b } = seedTodos()
    store.removeTodo(a.id)
    await nextTick()

    vi.advanceTimersByTime(59_999)
    expect(store.todos.some((t) => t.id === a.id)).toBe(true)

    vi.advanceTimersByTime(1)
    expect(store.todos.some((t) => t.id === a.id)).toBe(false)
    expect(store.pendingDeletes).toHaveLength(0)
    expect(store.visibleTodos.map((t) => t.id)).toEqual([b.id])

    // 落盘后 localStorage 不含该任务
    await nextTick()
    const raw = localStorage.getItem(TODO_STORAGE_KEY)
    const persisted = JSON.parse(raw!) as { id: string }[]
    expect(persisted.some((t) => t.id === a.id)).toBe(false)
  })

  it('持久化：软删除不落盘，任务仍在 localStorage', async () => {
    const store = useTodoStore()
    const { a } = seedTodos()
    await nextTick()

    store.removeTodo(a.id)
    await nextTick()
    // 软删除窗口内任务仍保留在 localStorage
    const persisted = JSON.parse(localStorage.getItem(TODO_STORAGE_KEY)!) as { id: string }[]
    expect(persisted).toHaveLength(2)
    expect(persisted.some((t) => t.id === a.id)).toBe(true)
  })

  it('重复 removeTodo 同一任务幂等', () => {
    const store = useTodoStore()
    const { a } = seedTodos()
    store.removeTodo(a.id)
    store.removeTodo(a.id)
    expect(store.pendingDeletes).toHaveLength(1)
  })

  it('定时器已经清掉后再撤销（用户点了第二次）：不抛错，队列也不会凭空多一条', () => {
    const store = useTodoStore()
    const { a } = seedTodos()
    store.removeTodo(a.id)
    // 真删会顺手清掉定时器：此后 UI 上残留的「撤销」如果再被点到，必须是无害的空操作
    store.commitDelete(a.id)
    expect(store.pendingDeletes).toEqual([])

    expect(() => store.undoDelete(a.id)).not.toThrow()
    expect(store.pendingDeletes).toEqual([])
    expect(store.todos.some((t) => t.id === a.id)).toBe(false)
  })

  it('撤销删除窗口恰好是 UNDO_DELETE_TIMEOUT（60 秒）：窗口内可恢复，过期后连同撤销入口一起消失', async () => {
    vi.useFakeTimers()
    const store = useTodoStore()
    const { a, b } = seedTodos()

    store.removeTodo(a.id)
    await nextTick()

    // 撤销条上的倒计时读的就是 expiresAt，它必须等于「现在 + 窗口长度」
    const pending = store.latestPendingDelete!
    expect(pending.todo.id).toBe(a.id)
    expect(pending.expiresAt - Date.now()).toBe(UNDO_DELETE_TIMEOUT)
    expect(UNDO_DELETE_TIMEOUT).toBe(60_000) // 规划口径：1 分钟

    // 差 1 毫秒到期：仍然算「窗口内」，撤销必须成功
    vi.advanceTimersByTime(UNDO_DELETE_TIMEOUT - 1)
    store.undoDelete(a.id)
    expect(store.visibleTodos.map((t) => t.id)).toEqual([a.id, b.id])
    expect(store.latestPendingDelete).toBeNull()

    // 再删一次，这次把窗口走满
    store.removeTodo(a.id)
    vi.advanceTimersByTime(UNDO_DELETE_TIMEOUT - 1)
    // 窗口内只是「从列表里藏起来」，底层数据与撤销入口都还在
    expect(store.visibleTodos.some((t) => t.id === a.id)).toBe(false)
    expect(store.latestPendingDelete?.todo.id).toBe(a.id)

    vi.advanceTimersByTime(1)
    // 到期：真正删除；撤销入口同时消失，避免用户对着一条不存在的数据点「撤销」
    expect(store.todos.some((t) => t.id === a.id)).toBe(false)
    expect(store.pendingDeletes).toEqual([])
    expect(store.latestPendingDelete).toBeNull()
    expect(store.visibleTodos.map((t) => t.id)).toEqual([b.id])
  })

  it('默认筛选为进行中（active）', () => {
    const store = useTodoStore()
    expect(store.filter).toBe('active')
  })

  it('crypto.randomUUID 不可用（非安全上下文 / 老浏览器）时退化为本地 id，且不撞号', () => {
    vi.stubGlobal('crypto', {})
    const store = useTodoStore()

    const a = store.addTodo({ title: 'A', priority: 'medium' })
    const b = store.addTodo({ title: 'B', priority: 'medium' })

    expect(a.id).toMatch(/^todo-\d+-[a-z0-9]+$/)
    // 同毫秒内连加两条不能撞 id：撞了会让删除/编辑误伤另一条任务
    expect(b.id).not.toBe(a.id)
    vi.unstubAllGlobals()
  })

  it('addTodo 只在用户真的设过提醒时才写 reminderAt / reminderOff（否则存储与云同步 payload 平白变胖）', () => {
    const store = useTodoStore()

    const plain = store.addTodo({ title: '默认提醒', priority: 'medium', dueDate: '2026-09-20' })
    expect('reminderAt' in plain).toBe(false)
    expect('reminderOff' in plain).toBe(false)

    const custom = store.addTodo({
      title: '自定义提醒',
      priority: 'medium',
      reminderAt: '2026-09-20T07:30',
    })
    expect(custom.reminderAt).toBe('2026-09-20T07:30')
    expect('reminderOff' in custom).toBe(false)

    const off = store.addTodo({ title: '关掉提醒', priority: 'medium', reminderOff: true })
    expect(off.reminderOff).toBe(true)
    expect('reminderAt' in off).toBe(false)
  })

  it('removeTodo 传了不存在的 id：空操作，不污染撤销队列', () => {
    const store = useTodoStore()
    const { a } = seedTodos()

    store.removeTodo('not-exist')

    // 撤销条上不能出现一条「点了撤销也没用」的鬼记录
    expect(store.pendingDeletes).toEqual([])
    expect(store.latestPendingDelete).toBeNull()
    expect(store.todos.map((t) => t.id)).toContain(a.id)
  })

  it('flushPendingDeletes 立即把软删除的任务全部真删（组件销毁 / 退出登录前调用）', async () => {
    const store = useTodoStore()
    const { a, b } = seedTodos()
    store.removeTodo(a.id)
    store.removeTodo(b.id)
    await nextTick()
    expect(store.pendingDeletes).toHaveLength(2)

    store.flushPendingDeletes()

    // 不用等满 1 分钟：队列与底层数据同时清干净，不能留下「已真删但还在撤销条上」
    expect(store.pendingDeletes).toEqual([])
    expect(store.todos).toEqual([])
    expect(store.visibleTodos).toEqual([])
  })

  it('setFilterDate：从归档视图点某天也能回到主列表，并按该日期筛选', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: '当天的事', priority: 'high', dueDate: '2026-09-20' })
    const b = store.addTodo({ title: '别的事', priority: 'low', dueDate: '2026-09-21' })
    store.setListView('archived')

    store.setFilterDate('2026-09-20')

    // 不切回主列表的话，用户会看到一个空的归档视图，以为任务丢了
    expect(store.listView).toBe('main')
    expect(store.filter).toBe('date')
    expect(store.filterDate).toBe('2026-09-20')
    expect(store.manualOrder).toBe(false)
    expect(store.filteredTodos.map((t) => t.id)).toEqual([a.id])
    expect(store.filteredTodos.map((t) => t.id)).not.toContain(b.id)
  })

  it('setFilterDate 会清掉多选状态（换了筛选口径，之前选中的任务可能已经不在列表里）', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: 'A', priority: 'low' })
    store.toggleSelectionMode()
    store.toggleSelect(a.id)

    store.setFilterDate('2026-09-20')

    expect(store.selectedIds).toEqual([])
    expect(store.selectionMode).toBe(true)
  })

  it('子任务操作传了不存在的任务 id 时不动任何数据', () => {
    const store = useTodoStore()
    const t = store.addTodo({ title: '母任务', priority: 'medium' })
    store.addSubtask(t.id, '子1')
    const before = JSON.parse(JSON.stringify(store.todos)) as unknown

    store.addSubtask('not-exist', '孤儿子任务')
    store.addSubtask(t.id, '   ')
    store.toggleSubtask('not-exist', 'whatever')
    store.toggleSubtask(t.id, 'not-exist')
    store.removeSubtask('not-exist', 'whatever')

    // 空白标题、陌生 id 都不该写进列表（空白子任务会渲染成一条点不到的空行）
    expect(store.todos).toEqual(before)
  })

  it('多选：再点一次取消选中，getSelectedTodos 只返回选中的任务', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: 'A', priority: 'low' })
    const b = store.addTodo({ title: 'B', priority: 'medium' })

    store.toggleSelect(a.id)
    store.toggleSelect(b.id)
    expect(store.getSelectedTodos().map((t) => t.id)).toEqual([a.id, b.id])

    store.toggleSelect(a.id)
    expect(store.selectedIds).toEqual([b.id])
    expect(store.getSelectedTodos().map((t) => t.id)).toEqual([b.id])
  })

  it('bulkSetStatus 只动选中的任务，且已经是目标状态的不会被重写（完成时间要留住）', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: 'A', priority: 'low' })
    const b = store.addTodo({ title: 'B', priority: 'low' })
    const c = store.addTodo({ title: 'C', priority: 'low' })
    store.toggleComplete(a.id)
    const completedAt = store.todos.find((t) => t.id === a.id)?.completedAt

    store.bulkSetStatus([a.id, b.id], true)

    expect(store.todos.find((t) => t.id === a.id)?.completedAt).toBe(completedAt) // 没被覆盖成「现在」
    expect(store.todos.find((t) => t.id === b.id)?.status).toBe('completed')
    expect(store.todos.find((t) => t.id === c.id)?.status).toBe('active') // 没选中的不许动
  })

  it('bulkSetStatus(false) 把选中的任务恢复为进行中并清掉完成时间', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: 'A', priority: 'low' })
    const b = store.addTodo({ title: 'B', priority: 'low' })
    store.toggleComplete(a.id)
    store.toggleComplete(b.id)

    store.bulkSetStatus([b.id], false)

    expect(store.todos.find((t) => t.id === b.id)?.status).toBe('active')
    expect(store.todos.find((t) => t.id === b.id)?.completedAt).toBeUndefined()
    expect(store.completedCount).toBe(1) // 统计口径跟着变（只剩 a 是完成）
  })

  it('moveTodo 传未知 id 或拖到原位时什么都不做（也不会悄悄打开手动排序）', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: 'A', priority: 'low' })
    const b = store.addTodo({ title: 'B', priority: 'low' })
    const before = store.todos.map((t) => t.id)

    store.moveTodo('not-exist', b.id)
    store.moveTodo(a.id, 'not-exist')
    store.moveTodo(a.id, a.id)

    expect(store.todos.map((t) => t.id)).toEqual(before)
    // 一次都没真正拖动，就不该进入「手动排序」而关掉自动排序
    expect(store.manualOrder).toBe(false)
  })

  it('手动排序后列表不再自动重排（拖拽结果必须被尊重）', () => {
    const store = useTodoStore()
    const high = store.addTodo({ title: '高优', priority: 'high' })
    const low = store.addTodo({ title: '低优', priority: 'low' })
    // 自动排序时高优在前
    expect(store.filteredTodos.map((t) => t.title)).toEqual(['高优', '低优'])

    // 把高优拖到低优之后：手动顺序必须压过优先级排序
    store.moveTodo(high.id, low.id)

    expect(store.manualOrder).toBe(true)
    expect(store.filteredTodos.map((t) => t.title)).toEqual(['低优', '高优'])
  })

  it('toggleTagFilter 再点一次取消该标签的筛选（多选轴与优先级互不干扰）', () => {
    const store = useTodoStore()
    store.addTodo({ title: 'A', priority: 'low' })

    store.toggleTagFilter('tag-1')
    store.toggleTagFilter('tag-2')
    expect(store.tagFilter).toEqual(['tag-1', 'tag-2'])
    expect(store.manualOrder).toBe(false)

    store.toggleTagFilter('tag-1')
    expect(store.tagFilter).toEqual(['tag-2'])
  })
})

describe('todoStore · 阶段4扩展', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useRealTimers()
  })

  it('子任务：增删切换', () => {
    const store = useTodoStore()
    const t = store.addTodo({ title: '母任务', priority: 'medium' })
    store.addSubtask(t.id, '子1')
    store.addSubtask(t.id, '子2')
    expect(store.todos[0].subtasks).toHaveLength(2)
    const subId = store.todos[0].subtasks[0].id
    store.toggleSubtask(t.id, subId)
    expect(store.todos[0].subtasks[0].completed).toBe(true)
    store.removeSubtask(t.id, subId)
    expect(store.todos[0].subtasks).toHaveLength(1)
  })

  it('置顶：togglePinned 并进入今日聚焦', () => {
    const store = useTodoStore()
    const t = store.addTodo({ title: '普通', priority: 'medium' })
    store.togglePinned(t.id)
    expect(store.todos[0].pinned).toBe(true)
    expect(store.myDayTodos.map((x) => x.id)).toContain(t.id)
  })

  /**
   * 回归：「置顶」必须**看得见**。
   *
   * 之前 myDayTodos 直接沿用 visibleTodos 的顺序（按优先级/到期日），
   * 于是点了置顶之后今日聚焦里什么都没变 —— 用户以为没生效（pinned 其实已落库）。
   * 用一个优先级最低、也没到期的任务来钉这条：它本来排在最后，置顶后必须跑到最前。
   */
  it('置顶项排到今日聚焦最前面（不是只改个字段）', () => {
    const store = useTodoStore()
    // 两条今天到期（都会进今日聚焦），其中一条优先级最低 → 默认排序里它在后面
    const high = store.addTodo({ title: '高', priority: 'high', dueDate: todayKey() })
    const low = store.addTodo({ title: '低', priority: 'low', dueDate: todayKey() })
    expect(store.myDayTodos.map((x) => x.id)).toEqual([high.id, low.id])

    store.togglePinned(low.id)

    expect(store.myDayTodos[0].id).toBe(low.id)
    // 取消置顶后回到原顺序
    store.togglePinned(low.id)
    expect(store.myDayTodos.map((x) => x.id)).toEqual([high.id, low.id])
  })

  it('今日聚焦：今日到期任务进入', () => {
    const store = useTodoStore()
    const t = store.addTodo({ title: '今天到期', priority: 'medium', dueDate: todayKey() })
    expect(store.myDayTodos.map((x) => x.id)).toContain(t.id)
  })

  it('多选与批量：完成/恢复/改优先级/删除', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: 'a', priority: 'medium' })
    const b = store.addTodo({ title: 'b', priority: 'low' })

    store.toggleSelect(a.id)
    store.toggleSelect(b.id)
    expect(store.selectedIds).toHaveLength(2)

    store.bulkSetStatus(store.selectedIds, true)
    expect(store.todos.every((t) => t.status === 'completed')).toBe(true)
    expect(store.selectedIds).toHaveLength(0)

    store.toggleSelect(a.id)
    store.bulkSetPriority(store.selectedIds, 'high')
    expect(store.todos.find((t) => t.id === a.id)?.priority).toBe('high')

    store.toggleSelect(b.id)
    store.bulkRemove(store.selectedIds)
    expect(store.pendingDeletes).toHaveLength(1)
  })

  it('moveTodo 重排并开启手动排序（拖拽落到目标位置）', () => {
    const store = useTodoStore()
    const a = store.addTodo({ title: 'a', priority: 'low' })
    const b = store.addTodo({ title: 'b', priority: 'high' })
    store.moveTodo(a.id, b.id)
    // 原 [a, b]，把 a 拖到 b 的位置 -> [b, a]
    expect(store.todos.map((t) => t.id)).toEqual([b.id, a.id])
    expect(store.manualOrder).toBe(true)
  })
})
