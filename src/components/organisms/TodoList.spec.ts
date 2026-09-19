import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'
import Sortable from 'sortablejs'

import { useTodoStore } from '@/stores/todoStore'
import { toDateKey, todayKey } from '@/utils/dateFormatter'
import TodoList from './TodoList.vue'

/**
 * 组件要读 `route.query.focus`（从提醒通知跳过来时高亮那条任务），
 * 所以必须装一个 router —— 真实使用里它总是挂在 DefaultLayout 之下。
 */
async function mountWithStore() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/todos', name: 'todos', component: { template: '<div />' } }],
  })
  await router.push('/todos')
  await router.isReady()

  const store = useTodoStore()
  const wrapper = mount(TodoList, { global: { plugins: [pinia, router] } })
  return { wrapper, store, router }
}

/**
 * 需要断言「从提醒跳过来的定位行为」时用：先建 pinia 并塞数据，再带 focus 查询参数挂载。
 * 关键点：**数据必须塞给组件真正用的那个 pinia**，否则测试断言的 store 与组件读的 store
 * 是两套（localStorage 会让它们看起来像共享数据，一旦涉及运行时状态如 filter 就会露馅）。
 */
async function mountFocusWith(seed: (store: ReturnType<typeof useTodoStore>) => string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useTodoStore()
  const focusId = seed(store)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/todos', name: 'todos', component: { template: '<div />' } }],
  })
  await router.push({ path: '/todos', query: { focus: focusId } })
  await router.isReady()

  const wrapper = mount(TodoList, { global: { plugins: [pinia, router] } })
  await nextTick()
  return { wrapper, store }
}

describe('TodoList', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('渲染 store 中的任务', async () => {
    const { wrapper, store } = await mountWithStore()
    store.addTodo({ title: '任务甲', priority: 'high' })
    store.addTodo({ title: '任务乙', priority: 'low' })
    await nextTick()

    const liText = wrapper
      .findAll('li')
      .map((li) => li.text())
      .join(' | ')
    expect(liText).toContain('任务甲')
    expect(liText).toContain('任务乙')
  })

  it('拖拽走 SortableJS 的 fallback 模式（Tauri 窗口里原生 HTML5 拖放会被系统级 drag-drop 吃掉）', async () => {
    const { wrapper, store } = await mountWithStore()
    store.addTodo({ title: '任务甲', priority: 'high' })
    store.addTodo({ title: '任务乙', priority: 'low' })
    await nextTick()

    const instance = Sortable.get(wrapper.find('ul').element as HTMLElement)
    expect(instance).toBeDefined()
    expect(instance?.options.forceFallback).toBe(true)
    expect(instance?.options.fallbackOnBody).toBe(true)
    // 列表依旧只认把手，避免与行内按钮/子任务输入框抢事件
    expect(instance?.options.handle).toBe('.drag-handle')
  })

  it('新建任务从左滑入（anim-enter-left）', async () => {
    const { wrapper, store } = await mountWithStore()
    store.addTodo({ title: '新任务', priority: 'high' })
    await nextTick()
    const li = wrapper.find('li')
    expect(li.classes()).toContain('anim-enter-left')
  })

  it('空状态提示', async () => {
    const { wrapper } = await mountWithStore()
    expect(wrapper.text()).toContain('暂无任务')
  })

  it('切换筛选 tab 过滤列表', async () => {
    const { wrapper, store } = await mountWithStore()
    store.addTodo({ title: '未完成甲', priority: 'medium' })
    const b = store.addTodo({ title: '已完成乙', priority: 'medium' })
    store.toggleComplete(b.id)
    await nextTick()

    // 点击“已完成”
    const completedBtn = wrapper.findAll('button').find((btn) => btn.text() === '已完成')
    expect(completedBtn).toBeTruthy()
    await completedBtn!.trigger('click')
    await nextTick()

    const liText = wrapper
      .findAll('li')
      .map((li) => li.text())
      .join(' | ')
    expect(liText).toContain('已完成乙')
    expect(liText).not.toContain('未完成甲')
  })

  it('点击本周筛选只显示本周截止的任务', async () => {
    const { wrapper, store } = await mountWithStore()
    const today = todayKey()
    // 本周内（用今天作为本周代表）
    store.addTodo({ title: '本周内任务', priority: 'medium', dueDate: today })
    // 上月同日（肯定不在本周）
    const prevMonth = new Date()
    prevMonth.setMonth(prevMonth.getMonth() - 1)
    const prevKey = toDateKey(prevMonth)
    store.addTodo({ title: '上月任务', priority: 'medium', dueDate: prevKey })
    await nextTick()

    const weekBtn = wrapper.findAll('button').find((btn) => btn.text() === '本周')
    expect(weekBtn).toBeTruthy()
    await weekBtn!.trigger('click')
    await nextTick()

    const liText = wrapper
      .findAll('li')
      .map((li) => li.text())
      .join(' | ')
    expect(liText).toContain('本周内任务')
    expect(liText).not.toContain('上月任务')
  })

  it('搜索关键字过滤', async () => {
    const { wrapper, store } = await mountWithStore()
    store.addTodo({ title: '写周报', priority: 'medium' })
    store.addTodo({ title: '健身', priority: 'low' })
    await nextTick()
    await wrapper.find('input[placeholder*="搜索任务"]').setValue('健身')
    await nextTick()

    const liText = wrapper
      .findAll('li')
      .map((li) => li.text())
      .join(' | ')
    expect(liText).toContain('健身')
    expect(liText).not.toContain('写周报')
  })

  it('优先级按钮可多选，三者全选自动回到全部', async () => {
    const { wrapper, store } = await mountWithStore()
    store.addTodo({ title: '高优甲', priority: 'high' })
    store.addTodo({ title: '低优乙', priority: 'low' })
    await nextTick()

    const btn = (label: string) => wrapper.findAll('button').find((b) => b.text() === label)
    await btn('高')!.trigger('click')
    await nextTick()
    // 选中态走主题色变量（primary）
    expect(btn('高')!.classes()).toContain('bg-[var(--el-color-primary)]')

    // 多选：再点低，两个都选中（grep 全部任务仍显示两类）
    await btn('低')!.trigger('click')
    await nextTick()
    expect(btn('低')!.classes()).toContain('bg-[var(--el-color-primary)]')

    const liText = wrapper
      .findAll('li')
      .map((li) => li.text())
      .join(' | ')
    expect(liText).toContain('高优甲')
    expect(liText).toContain('低优乙')

    // 再选中中 -> 三者全选 -> 自动清空（全部），按钮均不高亮
    await btn('中')!.trigger('click')
    await nextTick()
    expect(store.priority).toEqual([])
    expect(btn('高')!.classes()).not.toContain('bg-indigo-600')
    expect(btn('低')!.classes()).not.toContain('bg-indigo-600')
  })

  it('点击行尾圆钮调用 toggleComplete', async () => {
    const { wrapper, store } = await mountWithStore()
    const a = store.addTodo({ title: '任务', priority: 'medium' })
    await nextTick()
    await wrapper.find('li button[aria-label="标记为已完成"]').trigger('click')
    // 完成是一条「先礼花、再滑出」的完整动画（见 TodoItem 的 .anim-slide-left），
    // 总共约 1.1s 后才 emit；这里推进到它之后
    vi.advanceTimersByTime(1200)
    await nextTick()
    expect(store.todos.find((t) => t.id === a.id)?.status).toBe('completed')
  })

  it('删除后出现撤销 Toast，点击撤销恢复', async () => {
    const { wrapper, store } = await mountWithStore()
    const a = store.addTodo({ title: '待删除', priority: 'medium' })
    await nextTick()

    await wrapper.find('li button[aria-label="删除任务"]').trigger('click')
    vi.advanceTimersByTime(700)
    await nextTick()

    // Toast 出现
    expect(wrapper.text()).toContain('已删除「待删除」')
    expect(store.pendingDeletes).toHaveLength(1)

    // 点击撤销
    const undoBtn = wrapper.findAll('button').find((btn) => btn.text() === '撤销')
    expect(undoBtn).toBeTruthy()
    await undoBtn!.trigger('click')
    await nextTick()

    expect(store.pendingDeletes).toHaveLength(0)
    expect(store.visibleTodos.some((t) => t.id === a.id)).toBe(true)
    expect(wrapper.text()).not.toContain('已删除')
  })

  it('删除软隐藏、撤销条出现并可恢复（1 分钟窗口）', async () => {
    const { wrapper, store } = await mountWithStore()
    const a = store.addTodo({ title: '将被删除', priority: 'medium' })
    await nextTick()
    store.removeTodo(a.id)
    await nextTick()

    // 软删除：可见列表隐藏，但底层仍保留
    expect(store.visibleTodos).toHaveLength(0)
    expect(store.todos.some((t) => t.id === a.id)).toBe(true)
    // 撤销条仍显示
    expect(wrapper.text()).toContain('已删除「将被删除」')

    // 撤销恢复
    store.undoDelete(a.id)
    await nextTick()
    expect(store.visibleTodos.some((t) => t.id === a.id)).toBe(true)
    expect(wrapper.text()).not.toContain('已删除')
  })

  // ---- 从提醒通知跳过来（第六阶段 6.5） ----

  it('带 focus 查询参数时高亮目标任务', async () => {
    const { wrapper, store } = await mountFocusWith((s) => {
      s.addTodo({ title: '被提醒的任务', priority: 'high' })
      return s.todos[0].id
    })
    const id = store.todos[0].id

    const li = wrapper.find(`[data-testid="todo-item-${id}"]`)
    expect(li.exists()).toBe(true)
    expect(li.attributes('data-highlighted')).toBe('true')
  })

  it('目标任务被当前筛选挡住时自动放宽到「全部」并高亮（否则用户会以为点了没反应）', async () => {
    const { wrapper, store } = await mountFocusWith((s) => {
      const done = s.addTodo({ title: '已经做完的任务', priority: 'low' })
      s.toggleComplete(done.id)
      // 默认筛选是「进行中」，这条已完成的任务本来不在列表里
      expect(s.filter).toBe('active')
      expect(s.filteredTodos.some((t) => t.id === done.id)).toBe(false)
      return done.id
    })

    const id = store.todos[0].id
    expect(store.filter).toBe('all')
    const li = wrapper.find(`[data-testid="todo-item-${id}"]`)
    expect(li.exists()).toBe(true)
    expect(li.attributes('data-highlighted')).toBe('true')
  })

  it('没有 focus 参数时不改动用户的筛选条件', async () => {
    const { store } = await mountWithStore()
    store.setFilter('completed')
    await nextTick()

    expect(store.filter).toBe('completed')
  })

  /**
   * 回归：空状态文案原来看的是「列表为空」，不看为什么为空。
   * 于是「有任务、只是被搜掉/筛掉了」也会显示「🎉 暂无任务，添加一个开始吧」——
   * 在数据明明还在的情况下谎报「任务没了」，很容易让人重复录入。
   */
  it('有任务但被搜索/筛选滤空时，文案是「没有符合当前条件」而不是「暂无任务」', async () => {
    const { wrapper, store } = await mountWithStore()
    store.addTodo({ title: '写周报', priority: 'high' })
    await nextTick()

    // 1) 搜索无命中
    store.keyword = '不存在的关键字'
    await nextTick()
    expect(wrapper.find('[data-testid="todos-empty"]').text()).toContain('没有符合当前条件')

    // 2) 优先级筛选排除掉（只有 high，改看 low）—— 关键字仍在，先清掉
    store.keyword = ''
    store.priority = ['low']
    await nextTick()
    expect(wrapper.find('[data-testid="todos-empty"]').text()).toContain('没有符合当前条件')

    // 3) 标签筛选排除掉
    store.priority = []
    store.tagFilter = ['tag-x']
    await nextTick()
    expect(wrapper.find('[data-testid="todos-empty"]').text()).toContain('没有符合当前条件')

    // 4) 切换筛选 tab（默认 active，切到 completed 而任务未完成）
    store.tagFilter = []
    store.setFilter('completed')
    await nextTick()
    expect(wrapper.find('[data-testid="todos-empty"]').text()).toContain('没有符合当前条件')
  })
})
