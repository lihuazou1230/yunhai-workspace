<script setup lang="ts">
/**
 * 有机体组件：投入产出散点图（第八阶段 8.1-4）
 *
 * X = 当日计薪时长（小时，来自赚钱秒表的投入日志），Y = 当日完成数。
 * 全项目独一份的**跨模块联动分析**——把「今天忙了 8 小时」和「今天完成了 3 件事」
 * 放在同一张图上，才谈得上"时间花得值不值"。
 *
 * 相关系数为 null（样本不足或某一维无波动）时不显示结论句，只显示样本天数：
 * 那种情况下算出来的 r 是假的，宁可不显示。
 */

import { computed, ref } from 'vue'

import ChartEmpty from '@/components/molecules/ChartEmpty.vue'
import { useChartTheme } from '@/composables/useChartTheme'
import { useECharts } from '@/composables/useECharts'
import { formatDateText } from '@/utils/stats'
import type { ScatterPoint } from '@/types/statistics'

const props = defineProps<{
  points: ScatterPoint[]
  /** 皮尔逊相关系数（null = 样本不足或不适用） */
  correlation: number | null
  rangeLabel: string
}>()

const { tokens } = useChartTheme()
const el = ref<HTMLElement | null>(null)

const hasData = computed(() => props.points.length > 0)

/** 有投入也有产出的天数（比总样本更能说明相关性可信度） */
const pairedDays = computed(() => props.points.filter((p) => p.hours > 0 && p.completed > 0).length)

const insight = computed(() => {
  if (!hasData.value) return ''
  const scale = `${props.points.length} 天样本`
  if (props.correlation === null) return `${scale} · 数据波动不足，暂不判断相关性`
  const strength =
    Math.abs(props.correlation) >= 0.7 ? '强' : Math.abs(props.correlation) >= 0.4 ? '中等' : '弱'
  const direction = props.correlation >= 0 ? '正' : '负'
  return `${scale} · 投入与产出呈${strength}${direction}相关（r = ${props.correlation}）`
})

const option = computed(() => ({
  ...tokens.value.base,
  grid: { left: 40, right: 18, top: 22, bottom: 44 },
  tooltip: {
    ...(tokens.value.base.tooltip as Record<string, unknown>),
    formatter: (params: { value: [number, number, string] }) =>
      `${formatDateText(params.value[2])}<br/>投入 ${params.value[0]} 小时 · 完成 ${params.value[1]} 项`,
  },
  xAxis: {
    type: 'value',
    name: '投入(小时)',
    nameGap: 8,
    nameTextStyle: { color: tokens.value.subLabel, fontSize: 10 },
    min: 0,
    splitLine: { lineStyle: { color: tokens.value.split } },
    axisLabel: { color: tokens.value.label, fontSize: 10 },
    axisLine: { lineStyle: { color: tokens.value.split } },
  },
  yAxis: {
    type: 'value',
    name: '完成(项)',
    nameTextStyle: { color: tokens.value.subLabel, fontSize: 10 },
    min: 0,
    minInterval: 1,
    splitLine: { lineStyle: { color: tokens.value.split } },
    axisLabel: { color: tokens.value.label, fontSize: 10 },
  },
  series: [
    {
      name: '投入产出',
      type: 'scatter',
      symbolSize: 11,
      itemStyle: { color: tokens.value.primary, opacity: 0.72 },
      emphasis: { itemStyle: { opacity: 1 } },
      data: props.points.map((p) => [p.hours, p.completed, p.date]),
    },
  ],
}))

useECharts(el, () => option.value)
</script>

<template>
  <section class="card p-5" aria-label="投入产出">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">⚖️ 投入产出</h2>
      <span class="text-xs text-slate-500 dark:text-slate-400">
        {{ rangeLabel }} · {{ pairedDays }} 天既有投入又有产出
      </span>
    </header>

    <ChartEmpty
      v-if="!hasData"
      icon="⚖️"
      text="还没有可对照的数据——开着赚钱秒表工作一会儿，或先完成几条任务"
    />
    <template v-else>
      <div ref="el" class="h-56 w-full"></div>
      <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">{{ insight }}</p>
    </template>
  </section>
</template>
