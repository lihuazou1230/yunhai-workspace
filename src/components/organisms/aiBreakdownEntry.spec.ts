import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { Todo } from '@/types/todo'
import TodoItem from '@/components/molecules/TodoItem.vue'
import TodoList from '@/components/organisms/TodoList.vue'
import { useTodoStore } from '@/stores/todoStore'

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: '写周报',
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...overrides,
  }
}

/**
 * 回归：未配置 AI Key 时「AI 拆解」入口仍显示 —— 点进去只有一句
 * 「还没配置 AI API Key」的纯文本、也没有去设置页的链接，等于死路。
 * （「一句话添加」那条路径早就做了同样的隐藏。）
 */
describe('AI 拆解入口的显隐', () => {
  it('TodoItem：默认仍显示（不传 prop 时保持既有行为）', async () => {
    const wrapper = mount(TodoItem, { props: { todo: makeTodo() } })
    await wrapper.find('[data-testid="todo-more"]').trigger('click')

    expect(wrapper.find('[data-testid="todo-ai-breakdown"]').exists()).toBe(true)
  })

  it('TodoItem：hideAiBreakdown 时不渲染，且不会把整块菜单带没', async () => {
    const wrapper = mount(TodoItem, {
      props: { todo: makeTodo(), hideAiBreakdown: true },
    })
    await wrapper.find('[data-testid="todo-more"]').trigger('click')

    expect(wrapper.find('[data-testid="todo-ai-breakdown"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="todo-archive"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="todo-postpone"]').exists()).toBe(true)
  })

  it('TodoList：未配置 Key（默认空存储）时入口不出现', async () => {
    localStorage.clear()
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/todos', name: 'todos', component: { template: '<div />' } }],
    })
    await router.push('/todos')
    await router.isReady()

    const store = useTodoStore()
    store.addTodo({ title: '写周报', priority: 'medium' })
    await nextTick()

    const wrapper = mount(TodoList, { global: { plugins: [pinia, router] } })
    await wrapper.find('[data-testid="todo-more"]').trigger('click')

    expect(wrapper.find('[data-testid="todo-ai-breakdown"]').exists()).toBe(false)
  })
})
