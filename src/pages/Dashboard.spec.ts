/**
 * 仪表板布局（第六阶段 6.4）：卡片顺序 / 编辑模式 / 显隐 / 大小 / 月历跳转。
 *
 * 这些用例钉的是「规划里的可自定义布局到底成不成立」：
 * 默认是精选 bento，一进编辑模式就切等槽网格（变跨度卡片没法拖拽换位），
 * 以及卡片增删不能把用户存下来的顺序弄坏。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('@/composables/useAvatar', () => ({
  useAvatar: () => ({
    displayUrl: null,
    saving: { value: false },
    fallbackInitial: { value: '访客' },
    saveAvatar: vi.fn(),
    removeAvatar: vi.fn(),
    markImageFailed: vi.fn(),
    loadLocalAvatar: vi.fn(async () => {}),
    hasAvatar: { value: false },
    error: { value: '' },
    dispose: vi.fn(),
  }),
}))

import Dashboard from './Dashboard.vue'
import {
  DASHBOARD_CARD_IDS,
  DASHBOARD_HIDDEN_KEY,
  DASHBOARD_ORDER_KEY,
  useDashboardStore,
} from '@/stores/dashboardStore'
import { useTodoStore } from '@/stores/todoStore'

const ROUTES = [
  { path: '/', name: 'dashboard', component: Dashboard },
  { path: '/todos', name: 'todos', component: { template: '<div>任务页</div>' } },
  { path: '/settings', name: 'settings', component: { template: '<div />' } },
]

async function setup(path = '/') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: ROUTES })
  await router.push(path)
  await router.isReady()

  const dash = useDashboardStore()
  const todoStore = useTodoStore()

  const wrapper = mount(Dashboard, { global: { plugins: [pinia, router] } })
  await nextTick()
  return { wrapper, dash, todoStore, router }
}

/** 网格里当前渲染的卡片 id（按 DOM 顺序） */
function cardIds(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']): string[] {
  return wrapper
    .findAll('[data-testid^="dashboard-card-"]')
    .map((el) => el.attributes('data-card-id') ?? '')
    .filter((id) => id !== '')
}

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_AMAP_KEY', '')
})

describe('仪表板 · 卡片布局', () => {
  it('默认按精选布局渲染全部卡片，顺序与清单一致', async () => {
    const { wrapper } = await setup()

    expect(cardIds(wrapper)).toEqual([...DASHBOARD_CARD_IDS])
    // 默认是精选 bento：赚钱秒表跨 2 行
    expect(wrapper.find('[data-testid="dashboard-card-earnings"]').classes()).toContain(
      'lg:row-span-2',
    )
    // 编辑工具条默认不出现
    expect(wrapper.find('[data-testid="dashboard-hide-earnings"]').exists()).toBe(false)
  })

  it('点「编辑布局」进入编辑模式：切等槽网格 + 出现每卡工具条', async () => {
    const { wrapper, dash } = await setup()

    await wrapper.find('[data-testid="dashboard-edit-layout"]').trigger('click')
    await nextTick()

    expect(dash.customized).toBe(true)
    expect(wrapper.find('[data-testid="dashboard-grid"]').classes()).toContain('xl:grid-cols-3')
    expect(wrapper.find('[data-testid="dashboard-hide-earnings"]').exists()).toBe(true)
    // 等槽模式下不再跨行
    expect(wrapper.find('[data-testid="dashboard-card-earnings"]').classes()).not.toContain(
      'lg:row-span-2',
    )

    await wrapper.find('[data-testid="dashboard-finish-editing"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="dashboard-hide-earnings"]').exists()).toBe(false)
  })

  it('隐藏卡片后它从网格消失，可从「已隐藏」一键放回', async () => {
    const { wrapper, dash } = await setup()
    await wrapper.find('[data-testid="dashboard-edit-layout"]').trigger('click')
    await nextTick()

    await wrapper.find('[data-testid="dashboard-hide-weather"]').trigger('click')
    await nextTick()

    expect(cardIds(wrapper)).not.toContain('weather')
    expect(dash.hidden).toEqual(['weather'])
    // 隐藏不动 order：位置留给它
    expect(dash.order).toContain('weather')

    const hiddenPanel = wrapper.find('[data-testid="dashboard-hidden-cards"]')
    expect(hiddenPanel.text()).toContain('天气')

    await wrapper.find('[data-testid="dashboard-restore-weather"]').trigger('click')
    await nextTick()

    expect(cardIds(wrapper)).toContain('weather')
    expect(dash.hidden).toEqual([])
    // 回到原位（不是被甩到末尾）
    expect(cardIds(wrapper).indexOf('weather')).toBe(dash.order.indexOf('weather'))
  })

  it('调卡片大小：三档写入 store，并体现在最小区块高度上', async () => {
    const { wrapper, dash } = await setup()
    await wrapper.find('[data-testid="dashboard-edit-layout"]').trigger('click')
    await nextTick()

    await wrapper.find('[data-testid="dashboard-size-weather-small"]').trigger('click')
    await nextTick()

    expect(dash.sizeOf('weather')).toBe('small')
    expect(wrapper.find('[data-testid="dashboard-card-weather"]').classes()).toContain(
      'min-h-[120px]',
    )

    await wrapper.find('[data-testid="dashboard-size-weather-large"]').trigger('click')
    await nextTick()
    expect(dash.sizeOf('weather')).toBe('large')
    expect(wrapper.find('[data-testid="dashboard-card-weather"]').classes()).toContain(
      'min-h-[300px]',
    )
  })

  it('顺序按 store 的 order 渲染（拖拽后的结果直接反映到页面）', async () => {
    const { wrapper, dash } = await setup()

    dash.moveCard('link-dock', 'earnings')
    await nextTick()

    expect(cardIds(wrapper)[0]).toBe('link-dock')
    expect(dash.customized).toBe(true)
  })

  it('恢复默认：顺序、隐藏、尺寸、自定义标记一起回到出厂状态', async () => {
    const { wrapper, dash } = await setup()
    await wrapper.find('[data-testid="dashboard-edit-layout"]').trigger('click')
    await nextTick()

    dash.moveCard('link-dock', 'earnings')
    dash.toggleHidden('weather')
    dash.setCardSize('streak', 'large')
    await nextTick()

    await wrapper.find('[data-testid="dashboard-reset-layout"]').trigger('click')
    await nextTick()

    expect(dash.order).toEqual([...DASHBOARD_CARD_IDS])
    expect(dash.hidden).toEqual([])
    expect(dash.sizeOf('streak')).toBe('medium')
    expect(dash.customized).toBe(false)
    expect(cardIds(wrapper)).toEqual([...DASHBOARD_CARD_IDS])
  })

  it('全部卡片被隐藏时给出兜底提示（不是一片空白）', async () => {
    const { wrapper, dash } = await setup()
    await wrapper.find('[data-testid="dashboard-edit-layout"]').trigger('click')
    await nextTick()

    for (const id of DASHBOARD_CARD_IDS) dash.toggleHidden(id)
    await nextTick()

    expect(cardIds(wrapper)).toEqual([])
    expect(wrapper.find('[data-testid="dashboard-empty"]').exists()).toBe(true)
  })

  it('持久化：刷新后顺序 / 显隐 / 尺寸都还在', async () => {
    const { dash } = await setup()
    dash.moveCard('overview', 'earnings')
    dash.toggleHidden('countdown')
    dash.setCardSize('my-day', 'small')
    await nextTick()
    await nextTick()

    // 模拟刷新：读 localStorage 的值应当是刚写下的
    expect(JSON.parse(localStorage.getItem(DASHBOARD_ORDER_KEY)!)[0]).toBe('overview')
    expect(JSON.parse(localStorage.getItem(DASHBOARD_HIDDEN_KEY)!)).toEqual(['countdown'])
    expect(JSON.parse(localStorage.getItem('smart-workspace:dashboard-sizes')!)['my-day']).toBe(
      'small',
    )
  })
})

describe('仪表板 · 迷你月历联动', () => {
  it('点月历某天 → 按该日期筛选并跳到任务页', async () => {
    const { wrapper, todoStore, router } = await setup()
    const target = new Date()
    const key = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(
      target.getDate(),
    ).padStart(2, '0')}`

    const dayCell = wrapper.find(`[data-testid="cal-day-${key}"]`)
    expect(dayCell.exists()).toBe(true)
    await dayCell.trigger('click')
    await flushPromises()

    expect(todoStore.filter).toBe('date')
    expect(todoStore.filterDate).toBe(key)
    expect(router.currentRoute.value.name).toBe('todos')
  })

  it('月历圆点只标在有任务的日期上', async () => {
    const { wrapper, todoStore } = await setup()
    const today = new Date()
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`

    expect(wrapper.find(`[data-testid="cal-dot-${key}"]`).exists()).toBe(false)

    todoStore.addTodo({ title: '今天的事', priority: 'high', dueDate: key })
    await nextTick()

    expect(wrapper.find(`[data-testid="cal-dot-${key}"]`).exists()).toBe(true)
  })
})

describe('仪表板 · Streak 卡与周目标', () => {
  it('周目标从 store 读入，卡上改了会写回 store', async () => {
    const { wrapper, dash } = await setup()

    expect(dash.weekGoal).toBe(20)
    expect(wrapper.text()).toContain('本周目标')

    const input = wrapper.find('[data-testid="streak-goal-input"]')
    expect(input.exists()).toBe(true)
    await input.setValue('35')
    await input.trigger('change')
    await nextTick()
    await nextTick()

    expect(dash.weekGoal).toBe(35)
  })
})
