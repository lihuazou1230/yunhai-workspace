<script setup lang="ts">
/**
 * 有机体组件：完成时段热力图（第八阶段 8.1-2）
 * - ECharts heatmap：x = 0~23 时，y = 周一~周日，色深 = 该时段完成数
 * - 色阶由主题色派生（`useChartTheme.heat`），深浅色模式各一套，避免深色下发白
 * - 全页「一眼看出自己的高效时段」的洞察来源
 */

import { computed, ref } from 'vue'

import ChartEmpty from '@/components/molecules/ChartEmpty.vue'
import { useChartTheme } from '@/composables/useChartTheme'
import { useECharts } from '@/composables/useECharts'
import { HEATMAP_WEEKDAYS, toHeatmapSeriesData } from '@/utils/stats'
import type { HourlyHeatmap } from '@/types/statistics'

const props = defineProps<{ heatmap: HourlyHeatmap; rangeLabel: string }>()

const { tokens } = useChartTheme()
const el = ref<HTMLElement | null>(null)

const hasData = computed(() => props.heatmap.total > 0)
const hourLabels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}`)

/** 峰值时段（把「最高效时段」直接写成一句话，省得用户自己在格子里找） */
const peak = computed(() => {
  // 用两层普通循环而不是 forEach：闭包里给外层 let 变量赋值会让 TS 的控制流分析
  // 把变量窄化成 never（`Property 'value' does not exist on type 'never'`），
  // 平铺直叙反而既好读又好推类型
  let bestWeekday = -1
  let bestHour = -1
  let bestValue = 0
  props.heatmap.counts.forEach((row, weekday) => {
    row.forEach((value, hour) => {
      if (value > bestValue) {
        bestValue = value
        bestWeekday = weekday
        bestHour = hour
      }
    })
  })
  return bestValue > 0 ? { weekday: bestWeekday, hour: bestHour, value: bestValue } : null
})

const peakText = computed(() => {
  const p = peak.value
  if (!p) return ''
  return `高效时段：${HEATMAP_WEEKDAYS[p.weekday]} ${String(p.hour).padStart(2, '0')}:00（${p.value} 项）`
})

const option = computed(() => ({
  ...tokens.value.base,
  grid: { left: 44, right: 16, top: 12, bottom: 56 },
  tooltip: {
    ...(tokens.value.base.tooltip as Record<string, unknown>),
    formatter: (params: { value: [number, number, number] }) =>
      `${HEATMAP_WEEKDAYS[params.value[1]]} ${String(params.value[0]).padStart(2, '0')}:00 · 完成 ${params.value[2]} 项`,
  },
  xAxis: {
    type: 'category',
    data: hourLabels,
    splitArea: { show: false },
    axisLabel: { color: tokens.value.label, fontSize: 10, interval: 2 },
    axisLine: { lineStyle: { color: tokens.value.split } },
    axisTick: { show: false },
  },
  yAxis: {
    type: 'category',
    data: [...HEATMAP_WEEKDAYS],
    splitArea: { show: false },
    axisLabel: { color: tokens.value.label, fontSize: 10 },
    axisLine: { lineStyle: { color: tokens.value.split } },
    axisTick: { show: false },
  },
  visualMap: {
    min: 0,
    max: Math.max(1, props.heatmap.max),
    calculable: false,
    orient: 'horizontal',
    left: 'center',
    bottom: 0,
    itemWidth: 10,
    itemHeight: 80,
    textStyle: { color: tokens.value.subLabel, fontSize: 10 },
    inRange: { color: tokens.value.heat },
  },
  series: [
    {
      name: '完成时段',
      type: 'heatmap',
      data: toHeatmapSeriesData(props.heatmap),
      itemStyle: { borderColor: 'transparent', borderWidth: 2, borderRadius: 3 },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(15,23,42,0.25)' } },
    },
  ],
}))

useECharts(el, () => option.value)
</script>

<template>
  <section class="card p-5" aria-label="完成时段分布">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">🕒 完成时段分布</h2>
      <span class="text-xs text-slate-500 dark:text-slate-400">
        {{ peakText || `${rangeLabel} 24 小时 × 周一~周日` }}
      </span>
    </header>

    <ChartEmpty
      v-if="!hasData"
      icon="🕒"
      text="还没有完成记录，看不出你的高效时段——完成几条任务再回来"
    />
    <div v-else ref="el" class="h-64 w-full"></div>
  </section>
</template>
