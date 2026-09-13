/**
 * 四张新图的 **option 是否真被 ECharts 接受**（SSR + SVG 渲染冒烟测试）。
 *
 * 为什么需要这一层：happy-dom 没有 canvas 2D 上下文，`useECharts` 在测试环境里一律降级，
 * 于是"option 拼错一个键"这种错误在单测里**永远暴露不出来**（页面照样不报错，只是图画不出来）。
 * 这里改用 ECharts 的 SSR 模式（`renderer: 'svg'` + `ssr: true`，不需要 canvas）把组件算出来的
 * option 真的渲染一遍：series 类型没注册、heatmap 数据维度不对、visualMap 缺失这类问题会直接抛错
 * 或渲染出空图。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

/** 捕获组件算出来的 option（同 statsCharts.spec.ts 的手法） */
const captured = vi.hoisted(() => ({ options: [] as (() => Record<string, unknown>)[] }))

/**
 * 只替换 `useECharts` 本身，**保留原模块的按需注册副作用**（importOriginal）——
 * 否则图表类型一个都没注册，ECharts 会安安静静地渲染出一张空图（正是这个冒烟测试要抓的东西）。
 */
vi.mock('@/composables/useECharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useECharts')>()
  return {
    ...actual,
    useECharts: (_el: unknown, getOption: () => Record<string, unknown>) => {
      captured.options.push(getOption)
      return { chart: ref(null), resize: vi.fn(), unsupported: ref(false) }
    },
  }
})

import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

// 应用里只注册了 CanvasRenderer（生产用 canvas 出图）；SSR 冒烟走 SVG 渲染器，需额外注册
echarts.use([SVGRenderer])

import StatsHourHeatmap from './StatsHourHeatmap.vue'
import StatsScatterChart from './StatsScatterChart.vue'
import StatsTagDonut from './StatsTagDonut.vue'
import StatsTrendChart from './StatsTrendChart.vue'
import { aggregateHourly, aggregateScatter, aggregateTagShare } from '@/utils/stats'
import type { Todo } from '@/types/todo'

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

function done(id: string, hour: number, tags: string[] = []): Todo {
  return todo({
    id,
    status: 'completed',
    completedAt: new Date(2026, 8, 15, hour, 0).toISOString(),
    tags,
  })
}

/** 用 SSR 把某个 option 渲染成 SVG 字符串；option 不合法时 ECharts 会抛错 */
function renderToSvg(option: Record<string, unknown>): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 320 })
  try {
    // SSR 必须关动画：ECharts 的入场动画从"零尺寸"起步，服务端渲染只会拿到第一帧（等于空图）
    chart.setOption({ ...option, animation: false })
    return chart.renderToSVGString()
  } finally {
    chart.dispose()
  }
}

describe('新图表的 option 能被 ECharts 真正渲染（SSR/SVG 冒烟）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    captured.options = []
  })

  it('趋势图：柱 + 折线都进 SVG', () => {
    mount(StatsTrendChart, {
      props: {
        points: [
          { date: '2026-09-14', completed: 3, movingAvg: 3 },
          { date: '2026-09-15', completed: 1, movingAvg: 2 },
        ],
        windowLabel: '本周一至今',
      },
    })

    const svg = renderToSvg(captured.options[0]())
    expect(svg).toContain('<svg')
    // 柱体与折线都画出来了（柱是 path，折线也是 path；这里只要求非空图形数量足够）
    expect(svg.match(/<path/g)?.length ?? 0).toBeGreaterThan(2)
  })

  it('时段热力图：heatmap + visualMap 能渲染（数据维度错了这里就会空白）', () => {
    const heatmap = aggregateHourly(
      [done('a', 9), done('b', 9), done('c', 21)],
      'week',
      new Date(2026, 8, 15, 10, 0),
    )
    mount(StatsHourHeatmap, { props: { heatmap, rangeLabel: '本周' } })

    const svg = renderToSvg(captured.options[0]())
    expect(svg).toContain('<svg')
    // 三个有数据的格子 = 三个矩形（色阶由 visualMap 提供）
    expect(svg.match(/<path|<rect/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('标签环图：饼图切片渲染出来了', () => {
    const items = aggregateTagShare(
      [done('a', 9, ['t1']), done('b', 10)],
      [{ id: 't1', name: '工作', color: 'sky' }],
      'week',
      new Date(2026, 8, 15, 10, 0),
    )
    mount(StatsTagDonut, { props: { items, rangeLabel: '本周' } })

    const svg = renderToSvg(captured.options[0]())
    expect(svg).toContain('<svg')
    expect(svg.match(/<path/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('投入产出散点：点渲染出来了', () => {
    const points = aggregateScatter(
      [done('a', 9), done('b', 10)],
      { '2026-09-15': 8 * 3600 },
      'week',
      new Date(2026, 8, 15, 10, 0),
    )
    mount(StatsScatterChart, { props: { points, correlation: 0.5, rangeLabel: '本周' } })

    const svg = renderToSvg(captured.options[0]())
    expect(svg).toContain('<svg')
    expect(svg.match(/<path|<circle/g)?.length ?? 0).toBeGreaterThan(0)
  })
})
