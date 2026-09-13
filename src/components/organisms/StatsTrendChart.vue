<script setup lang="ts">
/**
 * 有机体组件：完成趋势柱线混合图（第八阶段 8.1-3）
 * - 柱：每日完成数
 * - 线：7 日移动平均（把「周末塌陷」这类周期性噪点抹平，趋势才看得出来）
 * - 数据与窗口由页面传入（`averageWindow` 只用于文案，不参与计算）
 */

import { computed, ref } from 'vue'

import ChartEmpty from '@/components/molecules/ChartEmpty.vue'
import { useChartTheme } from '@/composables/useChartTheme'
import { useECharts } from '@/composables/useECharts'
import type { DailyTrendPoint } from '@/types/statistics'

const props = withDefaults(
  defineProps<{
    points: DailyTrendPoint[]
    /** 窗口说明（如「本周一至今」），用于副标题 */
    windowLabel: string
    /** 移动平均窗口（仅用于文案） */
    averageWindow?: number
  }>(),
  { averageWindow: 7 },
)

const { tokens } = useChartTheme()
const el = ref<HTMLElement | null>(null)

const hasData = computed(() => props.points.some((p) => p.completed > 0))
const total = computed(() => props.points.reduce((sum, p) => sum + p.completed, 0))

/** 日期标签：`9/13` 这种最省横向空间；点太多时隔几个显示一个 */
const labels = computed(() =>
  props.points.map((p) => `${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8))}`),
)
const labelInterval = computed(() =>
  props.points.length > 21 ? 4 : props.points.length > 10 ? 1 : 0,
)

const option = computed(() => ({
  ...tokens.value.base,
  legend: {
    top: 0,
    right: 0,
    icon: 'circle',
    itemWidth: 8,
    itemHeight: 8,
    textStyle: { color: tokens.value.label, fontSize: 11 },
  },
  grid: { left: 34, right: 14, top: 30, bottom: 26 },
  xAxis: {
    type: 'category',
    data: labels.value,
    axisLabel: { color: tokens.value.label, fontSize: 10, interval: labelInterval.value },
    axisLine: { lineStyle: { color: tokens.value.split } },
    axisTick: { show: false },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    splitLine: { lineStyle: { color: tokens.value.split } },
    axisLabel: { color: tokens.value.label, fontSize: 10 },
  },
  series: [
    {
      name: '每日完成',
      type: 'bar',
      barMaxWidth: 12,
      itemStyle: { color: tokens.value.primary, borderRadius: [6, 6, 0, 0] },
      data: props.points.map((p) => p.completed),
    },
    {
      name: `${props.averageWindow} 日移动平均`,
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 2, color: tokens.value.accent },
      itemStyle: { color: tokens.value.accent },
      data: props.points.map((p) => p.movingAvg),
    },
  ],
}))

useECharts(el, () => option.value)
</script>

<template>
  <section class="card p-5" aria-label="完成趋势">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">📈 完成趋势</h2>
      <span class="text-xs text-slate-500 dark:text-slate-400">
        {{ windowLabel }} · 共 {{ total }} 项
      </span>
    </header>

    <ChartEmpty
      v-if="!hasData"
      icon="📈"
      :text="`${windowLabel}还没有完成记录——完成一条任务，这里立刻就有曲线`"
    />
    <div v-else ref="el" class="h-64 w-full"></div>
  </section>
</template>
