import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { TODO_STORAGE_KEY } from '@/stores/todoStore'
import type { Todo } from '@/types/todo'
import TodayProgressCard from './TodayProgressCard.vue'

/** 2026-09-08 是周二 */
function freezeTime(day = 8, hours = 10) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, day, hours, 0, 0))
}

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: '任务',
    status: 'active',
    priority: 'medium',
    createdAt: new Date(2026, 8, 8, 9, 0, 0).toISOString(),
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

function seed(todos: Todo[]) {
  window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos))
}

function mountCard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(TodayProgressCard, { global: { plugins: [pinia] } })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('TodayProgressCard', () => {
  it('展示今日完成度大数字与完成/待办明细', () => {
    freezeTime()
    seed([
      todo({
        id: 'a',
        status: 'completed',
        completedAt: new Date(2026, 8, 8, 9, 30, 0).toISOString(),
      }),
      todo({
        id: 'b',
        status: 'completed',
        completedAt: new Date(2026, 8, 8, 9, 45, 0).toISOString(),
      }),
      todo({ id: 'c', dueDate: '2026-09-08' }),
    ])
    const wrapper = mountCard()

    // 今日完成 2 /（2 + 1 待办）= 67%
    expect(wrapper.find('[data-testid="today-progress-rate"]').text()).toBe('67%')
    expect(wrapper.text()).toContain('今日完成 2 项')
    expect(wrapper.text()).toContain('待办 1 项')
  })

  it('今日无事时换成引导文案，不显示涨跌徽章', () => {
    freezeTime()
    seed([todo({ id: 'a', dueDate: '2026-09-20' })])
    const wrapper = mountCard()

    expect(wrapper.find('[data-testid="today-progress-rate"]').text()).toBe('0%')
    expect(wrapper.text()).toContain('今日暂无到期任务')
    expect(wrapper.find('[data-testid="today-progress-trend"]').exists()).toBe(false)
  })

  it('相对昨日完成数给出涨跌徽章', () => {
    freezeTime()
    seed([
      todo({
        id: 'y',
        status: 'completed',
        completedAt: new Date(2026, 8, 7, 9, 0, 0).toISOString(),
      }),
      todo({
        id: 't',
        status: 'completed',
        completedAt: new Date(2026, 8, 8, 9, 0, 0).toISOString(),
      }),
    ])
    const wrapper = mountCard()

    const trend = wrapper.find('[data-testid="today-progress-trend"]')
    expect(trend.exists()).toBe(true)
    // 今日 1 项 vs 昨日 1 项 => 持平
    expect(trend.text()).toContain('—')
  })

  it('无 canvas 环境（happy-dom）下图表降级但不影响数字渲染', () => {
    freezeTime()
    seed([todo({ id: 'a', dueDate: '2026-09-08' })])
    const wrapper = mountCard()

    expect(wrapper.find('[role="region"], section').exists()).toBe(true)
    expect(wrapper.find('[data-testid="today-progress-rate"]').exists()).toBe(true)
  })
})
