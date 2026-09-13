/**
 * 统计页（第八阶段 8.1-5）：时间范围切换即时生效，且四张新图都在页面上。
 *
 * 页面里的图表在 happy-dom 下拿不到 canvas 上下文（useECharts 静默降级），
 * 所以这里断言的是**页面编排**：范围一切、顶部小结与各图拿到的数据一起变。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import Stats from './Stats.vue'
import { useTagStore } from '@/stores/tagStore'
import { useTodoStore } from '@/stores/todoStore'
import { addDays, todayKey } from '@/utils/dateFormatter'
import type { Todo } from '@/types/todo'

const ROUTES = [
  { path: '/stats', name: 'stats', component: Stats },
  { path: '/annual', name: 'annual', component: { template: '<div>年度报告</div>' } },
]

/** 完成于「某天 + 小时」的本地时间（用真实今天，页面里用的是真实时钟） */
function doneOn(dateKey: string, hour = 10, extra: Partial<Todo> = {}): Todo {
  const [y, m, d] = dateKey.split('-').map(Number)
  return {
    id: `${dateKey}-${hour}-${extra.id ?? ''}`,
    title: '任务',
    status: 'completed',
    priority: 'medium',
    createdAt: new Date(y, m - 1, d, 9, 0).toISOString(),
    completedAt: new Date(y, m - 1, d, hour, 0).toISOString(),
    pinned: false,
    subtasks: [],
    tags: [],
    ...extra,
  }
}

async function setup(todos: Todo[]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: ROUTES })
  await router.push('/stats')
  await router.isReady()

  const todoStore = useTodoStore()
  todoStore.todos = todos
  useTagStore().tags = [{ id: 't1', name: '工作', color: 'sky' }]

  const wrapper = mount(Stats, { global: { plugins: [pinia, router] } })
  await nextTick()
  return { wrapper, todoStore, router }
}

describe('Stats 页面', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('默认「本周」：只统计本周的完成记录', async () => {
    const today = todayKey()
    const { wrapper } = await setup([doneOn(today, 10), doneOn(addDays(today, -30), 10)])

    expect(wrapper.text()).toContain('本周完成 1 项')
    expect(wrapper.text()).toContain('本周一至今')
  })

  it('切到「全部」后小结与图表数据一起变（即时生效）', async () => {
    const today = todayKey()
    const { wrapper } = await setup([doneOn(today, 10), doneOn(addDays(today, -30), 10)])

    await wrapper.get('[data-testid="stats-range-all"]').trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('全部完成 2 项')
    expect(wrapper.text()).toContain('近 6 周')
    expect(wrapper.get('[data-testid="stats-range-all"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="stats-range-week"]').attributes('aria-pressed')).toBe('false')
  })

  it('四张新图 + 两张既有图都在页面上', async () => {
    const { wrapper } = await setup([doneOn(todayKey(), 10)])

    expect(wrapper.find('[aria-label="完成趋势"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="完成时段分布"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="标签占比"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="投入产出"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="任务统计"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="生产力热力图"]').exists()).toBe(true)
  })

  it('一条完成记录都没有时，各图走空状态占位而不是空白', async () => {
    const { wrapper } = await setup([])

    expect(wrapper.text()).toContain('本周完成 0 项')
    expect(wrapper.text()).toContain('还没有完成记录')
    expect(wrapper.text()).toContain('还没有带标签的完成记录')
  })

  it('可以从统计页跳到年度报告', async () => {
    const { wrapper, router } = await setup([])
    const button = wrapper.findAll('button').find((b) => b.text().includes('年度报告'))
    expect(button).toBeTruthy()

    await button!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('annual')
  })
})
