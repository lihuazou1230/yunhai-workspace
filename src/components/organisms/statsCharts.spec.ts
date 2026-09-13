/**
 * 第八阶段 8.1 的四张新图：空状态、文案与「跟随主题」。
 *
 * 图表画布在 happy-dom 里没有 2D 上下文，所以这里**把 useECharts 换成捕获器**：
 * 直接把组件算出来的 option 拿在手里断言配色，比截图式断言稳得多，
 * 也正好能钉住验收里的「主题色/深浅色切换后图表配色跟随」。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

const captured = vi.hoisted(() => ({ option: null as null | (() => Record<string, unknown>) }))

vi.mock('@/composables/useECharts', () => ({
  useECharts: (_el: unknown, getOption: () => Record<string, unknown>) => {
    captured.option = getOption
    return { chart: ref(null), resize: vi.fn(), unsupported: ref(false) }
  },
}))

import StatsHourHeatmap from './StatsHourHeatmap.vue'
import StatsScatterChart from './StatsScatterChart.vue'
import StatsTagDonut from './StatsTagDonut.vue'
import StatsTrendChart from './StatsTrendChart.vue'
import { useThemeStore } from '@/stores/themeStore'
import { aggregateHourly, aggregateScatter, aggregateTagShare } from '@/utils/stats'
import type { DailyTrendPoint } from '@/types/statistics'
import type { Todo } from '@/types/todo'

/** 取出某张图的 series（option 是纯对象，直接按形状读） */
function series(index = 0): Record<string, unknown> {
  const option = captured.option?.() as { series: Record<string, unknown>[] }
  return option.series[index]
}

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: '任务',
    status: 'active',
    priority: 'medium',
    createdAt: new Date(2026, 8, 1, 9, 0).toISOString(),
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

const NOW = new Date(2026, 8, 15, 10, 0)

beforeEach(() => {
  setActivePinia(createPinia())
  captured.option = null
})

describe('StatsTrendChart', () => {
  const points: DailyTrendPoint[] = [
    { date: '2026-09-14', completed: 3, movingAvg: 3 },
    { date: '2026-09-15', completed: 1, movingAvg: 2 },
  ]

  it('有数据时画柱（当日完成）+ 线（移动平均）', () => {
    mount(StatsTrendChart, { props: { points, windowLabel: '本周一至今' } })
    expect(series(0)).toMatchObject({ type: 'bar', data: [3, 1] })
    expect(series(1)).toMatchObject({ type: 'line', data: [3, 2] })
    expect(String(series(1).name as string)).toContain('移动平均')
  })

  it('柱子颜色跟随主题色（切主题色后重算 option）', async () => {
    const themeStore = useThemeStore()
    mount(StatsTrendChart, { props: { points, windowLabel: '本周一至今' } })

    const lightPrimary = (series(0).itemStyle as Record<string, string>).color
    expect(lightPrimary).toBe(themeStore.primaryColor)

    themeStore.setColorName('rose')
    await nextTick()
    expect((series(0).itemStyle as Record<string, string>).color).toBe('#f43f5e')
  })

  it('深浅色切换后坐标轴文字跟着换色（深色下不再是深灰字）', async () => {
    const themeStore = useThemeStore()
    mount(StatsTrendChart, { props: { points, windowLabel: '本周一至今' } })
    const lightLabel = (captured.option?.() as { xAxis: { axisLabel: { color: string } } }).xAxis
      .axisLabel.color

    themeStore.setMode('dark')
    await nextTick()
    const darkLabel = (captured.option?.() as { xAxis: { axisLabel: { color: string } } }).xAxis
      .axisLabel.color

    expect(darkLabel).not.toBe(lightLabel)
  })

  it('窗口内没有任何完成时给空状态而不是空白图', () => {
    const wrapper = mount(StatsTrendChart, {
      props: {
        points: [{ date: '2026-09-15', completed: 0, movingAvg: 0 }],
        windowLabel: '本周一至今',
      },
    })
    expect(wrapper.text()).toContain('还没有完成记录')
    expect(wrapper.find('canvas').exists()).toBe(false)
  })
})

describe('StatsHourHeatmap', () => {
  const todos = [
    todo({ id: 'a', status: 'completed', completedAt: new Date(2026, 8, 15, 9, 0).toISOString() }),
    todo({ id: 'b', status: 'completed', completedAt: new Date(2026, 8, 15, 9, 30).toISOString() }),
    todo({ id: 'c', status: 'completed', completedAt: new Date(2026, 8, 15, 21, 0).toISOString() }),
  ]
  const heatmap = aggregateHourly(todos, 'week', NOW)

  it('画出 7×24 的 heatmap，并给出峰值时段文案', () => {
    const wrapper = mount(StatsHourHeatmap, { props: { heatmap, rangeLabel: '本周' } })
    expect(series(0).type).toBe('heatmap')
    expect(series(0).data).toEqual([
      [9, 1, 2],
      [21, 1, 1],
    ])
    expect(wrapper.text()).toContain('高效时段：周二 09:00（2 项）')
  })

  it('空数据走占位', () => {
    const wrapper = mount(StatsHourHeatmap, {
      props: { heatmap: aggregateHourly([], 'week', NOW), rangeLabel: '本周' },
    })
    expect(wrapper.text()).toContain('还没有完成记录')
  })
})

describe('StatsTagDonut', () => {
  const TAGS = [{ id: 't1', name: '工作', color: 'sky' as const }]
  const items = aggregateTagShare(
    [
      todo({
        id: 'a',
        status: 'completed',
        completedAt: new Date(2026, 8, 15, 9, 0).toISOString(),
        tags: ['t1'],
      }),
      todo({
        id: 'b',
        status: 'completed',
        completedAt: new Date(2026, 8, 15, 10, 0).toISOString(),
      }),
    ],
    TAGS,
    'week',
    NOW,
  )

  it('环图用标签色，环心显示完成总数', () => {
    const wrapper = mount(StatsTagDonut, { props: { items, rangeLabel: '本周' } })
    const data = series(0).data as { name: string; value: number; itemStyle: { color: string } }[]
    expect(data).toHaveLength(2)
    expect(data.find((d) => d.name === '工作')?.itemStyle.color).toBe('#0ea5e9')
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).toContain('已完成')
  })

  it('没有带标签的完成记录时给空状态', () => {
    const wrapper = mount(StatsTagDonut, {
      props: { items: [], rangeLabel: '本周' },
    })
    expect(wrapper.text()).toContain('还没有带标签的完成记录')
  })
})

describe('StatsScatterChart', () => {
  const points = aggregateScatter(
    [
      todo({
        id: 'a',
        status: 'completed',
        completedAt: new Date(2026, 8, 15, 9, 0).toISOString(),
      }),
      todo({
        id: 'b',
        status: 'completed',
        completedAt: new Date(2026, 8, 14, 9, 0).toISOString(),
      }),
    ],
    { '2026-09-15': 8 * 3600, '2026-09-14': 4 * 3600 },
    'week',
    NOW,
  )

  it('X 轴是投入小时、Y 轴是完成数，并显示相关系数结论', () => {
    const wrapper = mount(StatsScatterChart, {
      props: { points, correlation: 1, rangeLabel: '本周' },
    })
    const data = series(0).data as number[][]
    expect(data.map((d) => [d[0], d[1]])).toEqual([
      [4, 1],
      [8, 1],
    ])
    expect(wrapper.text()).toContain('强正相关')
    expect(wrapper.text()).toContain('r = 1')
  })

  it('样本波动不足时不下结论', () => {
    const wrapper = mount(StatsScatterChart, {
      props: { points, correlation: null, rangeLabel: '本周' },
    })
    expect(wrapper.text()).toContain('暂不判断相关性')
  })

  it('没有可对照的数据时给空状态', () => {
    const wrapper = mount(StatsScatterChart, {
      props: { points: [], correlation: null, rangeLabel: '本周' },
    })
    expect(wrapper.text()).toContain('还没有可对照的数据')
  })
})
