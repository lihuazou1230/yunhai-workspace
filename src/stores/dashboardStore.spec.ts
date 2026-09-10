import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import {
  DASHBOARD_CARD_IDS,
  DASHBOARD_CUSTOMIZED_KEY,
  DASHBOARD_HIDDEN_KEY,
  DASHBOARD_ORDER_KEY,
  DASHBOARD_SIZES_KEY,
  DASHBOARD_WEEK_GOAL_KEY,
  DEFAULT_CARD_SIZE,
  reconcileOrder,
  useDashboardStore,
} from './dashboardStore'
import type { DashboardCardSize } from './dashboardStore'

const DEFAULT_ORDER: string[] = [...DASHBOARD_CARD_IDS]

function readStored<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  return raw === null ? null : (JSON.parse(raw) as T)
}

/** 用同一份 localStorage 重新建一个 store，模拟「刷新页面」 */
function remountStore() {
  setActivePinia(createPinia())
  return useDashboardStore()
}

describe('dashboardStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('默认值：周目标 20、精选默认顺序、未自定义、无隐藏、尺寸按 medium', () => {
    const store = useDashboardStore()

    expect(store.weekGoal).toBe(20)
    expect(store.order).toEqual(DEFAULT_ORDER)
    expect(store.customized).toBe(false)
    expect(store.hidden).toEqual([])
    expect(store.sizes).toEqual({})
    expect(store.sizeOf('weather')).toBe(DEFAULT_CARD_SIZE)
    expect(store.visibleCards).toEqual(DEFAULT_ORDER)
  })

  it('reconcileOrder 丢掉未知 id、去重，并把缺失的卡片追加到末尾', () => {
    // 期望值从 DASHBOARD_CARD_IDS 推导，而不是写死清单：以后新增卡片不必回来改这条用例
    const result = reconcileOrder(['weather', 'ghost', 'earnings'])
    expect(result).toHaveLength(DASHBOARD_CARD_IDS.length)
    expect(result).not.toContain('ghost')
    expect(result.slice(0, 2)).toEqual(['weather', 'earnings']) // 认识的卡片保持相对顺序、排在最前
    expect(result.slice(2)).toEqual(
      DASHBOARD_CARD_IDS.filter((id) => id !== 'weather' && id !== 'earnings'),
    ) // 其余卡片追加到末尾，一个不少

    // 重复项只保留第一次出现的位置
    expect(reconcileOrder(['link-dock', 'link-dock', 'weather'])[0]).toBe('link-dock')
    expect(reconcileOrder(['link-dock', 'link-dock', 'weather'])).toHaveLength(
      DASHBOARD_CARD_IDS.length,
    )
    // 空顺序 / 只有幽灵 id = 完全回落到默认顺序
    expect(reconcileOrder([])).toEqual(DEFAULT_ORDER)
    expect(reconcileOrder(['ghost'])).toEqual(DEFAULT_ORDER)
  })

  it('读盘时对齐老版本的顺序，并顺手把纠正后的结果写回', async () => {
    localStorage.setItem(DASHBOARD_ORDER_KEY, JSON.stringify(['weather', 'ghost', 'earnings']))
    const store = useDashboardStore()

    expect(store.order).toHaveLength(DASHBOARD_CARD_IDS.length)
    expect(store.order.slice(0, 2)).toEqual(['weather', 'earnings']) // 老顺序被保留
    expect(store.order).not.toContain('ghost')
    expect([...store.order].sort()).toEqual([...DASHBOARD_CARD_IDS].sort()) // 一张卡都没丢

    await nextTick()
    expect(readStored<string[]>(DASHBOARD_ORDER_KEY)).toEqual(store.order)
  })

  it('外部直接写坏 order 也会被立刻纠正（不会丢卡片）', () => {
    const store = useDashboardStore()
    store.order = ['ghost', 'streak']

    expect(store.order).toEqual(['streak', ...DASHBOARD_CARD_IDS.filter((id) => id !== 'streak')])
  })

  it('setWeekGoal 正常赋值，并把垃圾输入钳到 >= 1', () => {
    const store = useDashboardStore()

    store.setWeekGoal(30)
    expect(store.weekGoal).toBe(30)

    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      store.setWeekGoal(20)
      store.setWeekGoal(bad)
      expect(store.weekGoal).toBe(1)
    }

    store.setWeekGoal(2.9)
    expect(store.weekGoal).toBe(2)
  })

  it('setWeekGoal 持久化，重新挂载后仍然是用户设的值', async () => {
    useDashboardStore().setWeekGoal(15)
    await nextTick()

    expect(readStored<number>(DASHBOARD_WEEK_GOAL_KEY)).toBe(15)
    expect(remountStore().weekGoal).toBe(15)
  })

  it('读盘时纠正在存储里被改坏的周目标', () => {
    localStorage.setItem(DASHBOARD_WEEK_GOAL_KEY, '0')
    expect(useDashboardStore().weekGoal).toBe(1)
  })

  it('toggleHidden 切换隐藏，但不动 order（取消隐藏能回到原处）', () => {
    const store = useDashboardStore()

    store.toggleHidden('weather')
    expect(store.hidden).toEqual(['weather'])
    expect(store.order).toEqual(DEFAULT_ORDER) // 位置保留
    expect(store.visibleCards).toEqual(DEFAULT_ORDER.filter((id) => id !== 'weather'))

    store.toggleHidden('weather')
    expect(store.hidden).toEqual([])
    expect(store.visibleCards).toEqual(DEFAULT_ORDER)
  })

  it('toggleHidden 忽略未知 id', () => {
    const store = useDashboardStore()
    store.toggleHidden('ghost')
    expect(store.hidden).toEqual([])
  })

  it('读盘时丢掉已下线卡片的隐藏记录', () => {
    localStorage.setItem(DASHBOARD_HIDDEN_KEY, JSON.stringify(['ghost', 'weather', 'ghost']))
    expect(useDashboardStore().hidden).toEqual(['weather'])
  })

  it('setCardSize 写入尺寸，未知 id 与非法尺寸被忽略', () => {
    const store = useDashboardStore()

    store.setCardSize('weather', 'large')
    expect(store.sizeOf('weather')).toBe('large')
    expect(store.sizes).toEqual({ weather: 'large' })

    store.setCardSize('weather', 'huge' as DashboardCardSize)
    expect(store.sizeOf('weather')).toBe('large') // 非法尺寸不生效

    store.setCardSize('ghost', 'small')
    expect(store.sizes).toEqual({ weather: 'large' })
    expect(store.sizeOf('ghost')).toBe(DEFAULT_CARD_SIZE)
  })

  it('尺寸持久化，重新挂载后仍生效', async () => {
    useDashboardStore().setCardSize('mini-calendar', 'small')
    await nextTick()

    expect(readStored<Record<string, string>>(DASHBOARD_SIZES_KEY)).toEqual({
      'mini-calendar': 'small',
    })
    expect(remountStore().sizeOf('mini-calendar')).toBe('small')
  })

  it('moveCard 往后拖：落点就是目标原本的索引（与 moveTodo 同一套语义）', () => {
    const store = useDashboardStore()

    store.moveCard('earnings', 'link-dock')
    expect(store.order.indexOf('earnings')).toBe(DEFAULT_ORDER.indexOf('link-dock'))
    expect(store.order).toHaveLength(DASHBOARD_CARD_IDS.length)
    expect(new Set(store.order).size).toBe(DASHBOARD_CARD_IDS.length)
    expect(store.customized).toBe(true)
  })

  it('moveCard 往前拖：插到目标原本的索引上，两卡在此过程中互换', () => {
    const store = useDashboardStore()
    const targetIdx = DEFAULT_ORDER.indexOf('weather')

    store.moveCard('link-dock', 'weather')
    expect(store.order[targetIdx]).toBe('link-dock')
    expect(store.order[targetIdx + 1]).toBe('weather')
  })

  it('相邻两卡互换（与 todoStore.moveTodo 的既有行为一致）', () => {
    const store = useDashboardStore()
    const [first, second] = DEFAULT_ORDER

    store.moveCard(first, second)
    expect(store.order.slice(0, 2)).toEqual([second, first])
  })

  it('moveCard 忽略未知 id，原地不动时不产生任何变化', () => {
    const store = useDashboardStore()

    store.moveCard('ghost', 'earnings')
    store.moveCard('earnings', 'ghost')
    store.moveCard('earnings', 'earnings')
    expect(store.order).toEqual(DEFAULT_ORDER)
    expect(store.customized).toBe(false)
  })

  it('隐藏 / 改尺寸都会把 layout 标记为已自定义', () => {
    const store = useDashboardStore()

    store.toggleHidden('overview')
    expect(store.customized).toBe(true)

    store.resetLayout()
    store.setCardSize('overview', 'large')
    expect(store.customized).toBe(true)
  })

  it('resetLayout 恢复出厂布局', async () => {
    const store = useDashboardStore()
    store.moveCard('link-dock', 'earnings')
    store.toggleHidden('weather')
    store.setCardSize('streak', 'large')

    store.resetLayout()

    expect(store.order).toEqual(DEFAULT_ORDER)
    expect(store.customized).toBe(false)
    expect(store.hidden).toEqual([])
    expect(store.sizes).toEqual({})
    expect(store.sizeOf('streak')).toBe(DEFAULT_CARD_SIZE)

    await nextTick()
    expect(readStored<string[]>(DASHBOARD_ORDER_KEY)).toEqual(DEFAULT_ORDER)
    expect(readStored<string[]>(DASHBOARD_HIDDEN_KEY)).toEqual([])
    expect(readStored<boolean>(DASHBOARD_CUSTOMIZED_KEY)).toBe(false)
  })

  it('隐藏状态跨实例保留（刷新页面不丢）', async () => {
    useDashboardStore().toggleHidden('my-day')
    await nextTick()

    expect(remountStore().hidden).toEqual(['my-day'])
    expect(remountStore().visibleCards).not.toContain('my-day')
  })
})
