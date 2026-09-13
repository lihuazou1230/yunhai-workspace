import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

import TodoList from './TodoList.vue'
import { useTodoStore } from '@/stores/todoStore'

/**
 * 回归：批量删除后只能撤销**一条**。
 *
 * 多选删除会把 N 条一起塞进软删除队列，而撤销条只认队尾那一条：
 * 文案写「已删除「最后一条」」，点撤销也只回来一条 ——
 * 其余几条 60 秒后静默真删，界面上再没有任何入口能救回来。
 */
async function mountList() {
  localStorage.clear()
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/todos', name: 'todos', component: { template: '<div />' } }],
  })
  await router.push('/todos')
  await router.isReady()

  // 组件必须用**同一个** pinia，否则断言的是另一套 store
  const store = useTodoStore()
  const wrapper = mount(TodoList, { global: { plugins: [pinia, router] } })
  return { wrapper, store }
}

function undoBar(wrapper: VueWrapper) {
  return wrapper.findAll('[role="status"]').find((w) => w.text().includes('已删除')) ?? null
}

describe('TodoList · 批量撤销删除', () => {
  it('删两条后撤销条说清条数，一次撤销全部恢复', async () => {
    const { wrapper, store } = await mountList()
    const a = store.addTodo({ title: '写周报', priority: 'low' })
    const b = store.addTodo({ title: '健身', priority: 'low' })
    await nextTick()

    store.removeTodo(a.id)
    store.removeTodo(b.id)
    await nextTick()

    expect(store.pendingDeletes).toHaveLength(2)
    const bar = undoBar(wrapper)
    expect(bar).not.toBeNull()
    expect(bar?.text()).toContain('已删除 2 项')

    await bar?.find('button').trigger('click')

    // 两条都必须回来，且队列清空
    expect(store.pendingDeletes).toEqual([])
    expect(store.todos.map((t) => t.title).sort()).toEqual(['写周报', '健身'].sort())
    expect(undoBar(wrapper)).toBeNull()
  })

  it('只删一条时文案仍是任务标题（不显示「已删除 1 项」）', async () => {
    const { wrapper, store } = await mountList()
    const a = store.addTodo({ title: '写周报', priority: 'low' })
    await nextTick()

    store.removeTodo(a.id)
    await nextTick()

    const bar = undoBar(wrapper)
    expect(bar?.text()).toContain('已删除「写周报」')
    expect(bar?.text()).not.toContain('1 项')
  })
})
