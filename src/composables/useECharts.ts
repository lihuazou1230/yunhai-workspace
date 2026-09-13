/**
 * ECharts 生命周期封装（按需注册，未使用不打包对应图表类型）。
 * - onMounted 初始化并设置首个 option
 * - option 变化时自动 setOption
 * - 窗口 resize 自动重绘
 * - onBeforeUnmount 销毁实例
 * - 初始化失败（如测试环境无 canvas）时静默降级，不阻塞页面
 */

import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  // 图表类型：饼（优先级/标签占比）、柱（趋势）、折线（移动平均）、散点（投入产出）、热力（时段分布）
  PieChart,
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  // 时段热力图的色阶图例
  VisualMapComponent,
  CanvasRenderer,
])

export type ChartInstance = ReturnType<typeof echarts.init>

/** 探测当前环境是否具备可用于渲染的 2D canvas 上下文（happy-dom 等测试环境返回 false） */
function supports2dCanvas(): boolean {
  try {
    if (typeof document === 'undefined') return false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext && canvas.getContext('2d')
    return ctx !== null && ctx !== undefined
  } catch {
    return false
  }
}

export function useECharts(
  elRef: Ref<HTMLElement | null>,
  getOption: () => echarts.EChartsCoreOption,
) {
  const chart = shallowRef<ChartInstance | null>(null)
  /** 初始化失败/环境不支持标记（测试环境无 canvas 等场景） */
  const unsupported = shallowRef(false)

  function rebuild() {
    if (!chart.value) return
    chart.value.setOption(getOption(), true)
  }

  function resize() {
    chart.value?.resize()
  }

  onMounted(() => {
    if (!elRef.value || !supports2dCanvas()) {
      unsupported.value = true
      return
    }
    try {
      chart.value = echarts.init(elRef.value)
      chart.value.setOption(getOption(), true)
      window.addEventListener('resize', resize)
    } catch {
      unsupported.value = true
      chart.value = null
    }
  })

  watch(getOption, () => rebuild(), { flush: 'post' })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', resize)
    chart.value?.dispose()
    chart.value = null
  })

  return { chart, resize, unsupported }
}
