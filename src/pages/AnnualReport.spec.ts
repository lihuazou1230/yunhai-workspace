/**
 * 年度报告页（第八阶段 8.1-7）：全年关键数字、年份切换、分享卡生成与降级提示。
 *
 * happy-dom 没有 canvas 2D 上下文，所以「生成卡片」这条路径在这里**必然失败**——
 * 正好用来钉住降级提示：宁可明说"当前环境不支持"，也不要留一块空白让人以为坏了。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import AnnualReport from './AnnualReport.vue'
import { useTodoStore } from '@/stores/todoStore'
import { WORKLOG_STORAGE_KEY } from '@/utils/workLog'
import type { Todo } from '@/types/todo'

const ROUTES = [
  { path: '/stats', name: 'stats', component: { template: '<div>统计页</div>' } },
  { path: '/annual', name: 'annual', component: AnnualReport },
]

function doneAt(id: string, dateKey: string, hour = 10): Todo {
  const [y, m, d] = dateKey.split('-').map(Number)
  return {
    id,
    title: '任务',
    status: 'completed',
    priority: 'medium',
    createdAt: new Date(y, m - 1, d, 9, 0).toISOString(),
    completedAt: new Date(y, m - 1, d, hour, 0).toISOString(),
    pinned: false,
    subtasks: [],
    tags: [],
  }
}

async function setup(todos: Todo[], workLog: Record<string, number> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: ROUTES })
  await router.push('/annual')
  await router.isReady()

  window.localStorage.setItem(WORKLOG_STORAGE_KEY, JSON.stringify(workLog))
  useTodoStore().todos = todos

  const wrapper = mount(AnnualReport, { global: { plugins: [pinia, router] } })
  await nextTick()
  return { wrapper, router }
}

describe('年度报告页', () => {
  const thisYear = new Date().getFullYear()

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('汇总全年的完成数 / 产出天数 / 连续天数 / 投入时长', async () => {
    const { wrapper } = await setup(
      [
        doneAt('a', `${thisYear}-03-02`, 10),
        doneAt('b', `${thisYear}-03-02`, 15),
        doneAt('c', `${thisYear}-03-03`, 10),
      ],
      { [`${thisYear}-03-02`]: 8 * 3600 },
    )

    expect(wrapper.text()).toContain(`${thisYear} 年度报告`)
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('2 天')
    expect(wrapper.text()).toContain('8 小时')
    expect(wrapper.text()).toContain('3 月')
  })

  it('该年没有数据时给整页空状态，不显示分享卡', async () => {
    const { wrapper } = await setup([])
    expect(wrapper.text()).toContain('还没有可统计的数据')
    expect(wrapper.find('canvas').exists()).toBe(false)
  })

  it('有跨年数据时能切年份，数字跟着换', async () => {
    const { wrapper } = await setup([doneAt('a', `${thisYear - 1}-05-05`, 10)])

    // 默认选中今年（今年没数据 → 空状态）
    expect(wrapper.text()).toContain('还没有可统计的数据')

    const lastYear = wrapper.findAll('button').find((b) => b.text() === String(thisYear - 1))
    expect(lastYear).toBeTruthy()
    await lastYear!.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain(`${thisYear - 1} 年度报告`)
    expect(wrapper.text()).not.toContain('还没有可统计的数据')
    expect(wrapper.text()).toContain('5 月')
  })

  it('生成卡片：canvas 不可用时给出明确提示而不是空白', async () => {
    const { wrapper } = await setup([doneAt('a', `${thisYear}-03-02`, 10)])

    const generate = wrapper.findAll('button').find((b) => b.text().includes('生成卡片'))
    expect(generate).toBeTruthy()
    await generate!.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('当前环境不支持 canvas 绘图')
  })

  it('未生成时不显示「保存为图片」按钮', async () => {
    const { wrapper } = await setup([doneAt('a', `${thisYear}-03-02`, 10)])
    expect(wrapper.findAll('button').some((b) => b.text().includes('保存为图片'))).toBe(false)
  })

  it('可以返回统计页', async () => {
    const { wrapper, router } = await setup([])
    const back = wrapper.findAll('button').find((b) => b.text().includes('返回统计'))
    await back!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('stats')
  })
})
