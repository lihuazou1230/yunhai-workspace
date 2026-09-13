<script setup lang="ts">
/**
 * 有机体组件：统计卡片（ECharts 图表）
 * - 环形饼图：按优先级分布
 * - 顶部汇总：总数 / 完成率
 *
 * 第八阶段 8.1 起**只保留优先级环图**：原先那张「近 30 天完成趋势」柱状图
 * 已被统计页的 `StatsTrendChart`（每日柱 + 7 日移动平均、支持范围切换）取代，
 * 同一个数字在同一页出现两种画法只会互相打架，所以这里删掉而不是留着。
 */

import { computed, ref } from 'vue'

import { useTaskStatistics } from '@/composables/useStatistics'
import { useChartTheme } from '@/composables/useChartTheme'
import { useECharts } from '@/composables/useECharts'
import { priorityLabel } from '@/utils/priorityHelper'

const { statistics } = useTaskStatistics()
const { tokens } = useChartTheme()

/** 优先级配色：高=玫瑰、中=琥珀、低=石板灰（与列表里的优先级点同一套语义色） */
const PRIORITY_HEX: Record<string, string> = {
  high: '#f43f5e',
  medium: '#f59e0b',
  low: '#94a3b8',
}

const pieEl = ref<HTMLElement | null>(null)
const pieOption = computed(() => ({
  ...tokens.value.base,
  tooltip: {
    ...(tokens.value.base.tooltip as Record<string, unknown>),
    trigger: 'item',
    formatter: '{b}: {c}（{d}%）',
  },
  // 图例用小色点，减少视觉重量
  legend: {
    bottom: 0,
    icon: 'circle',
    itemWidth: 8,
    itemHeight: 8,
    textStyle: { color: tokens.value.label, fontSize: 11 },
  },
  series: [
    {
      name: '优先级',
      type: 'pie',
      radius: ['46%', '70%'],
      center: ['50%', '46%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 8, borderColor: 'transparent', borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontWeight: 'bold' } },
      data: statistics.value.byPriority.map((s) => ({
        name: priorityLabel(s.priority),
        value: s.total,
        itemStyle: { color: PRIORITY_HEX[s.priority] },
      })),
    },
  ],
}))

useECharts(pieEl, () => pieOption.value)
</script>

<template>
  <section class="card p-5" aria-label="任务统计">
    <header class="mb-4 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">📊 优先级分布</h2>
      <span class="text-xs text-slate-500 dark:text-slate-400">
        共 {{ statistics.total }} · 完成率 {{ statistics.completionRate }}%
      </span>
    </header>

    <div ref="pieEl" class="h-56 w-full"></div>
  </section>
</template>
