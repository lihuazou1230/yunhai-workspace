<script setup lang="ts">
/**
 * 有机体组件：标签占比环形图（第八阶段 8.1-1）
 *
 * 让标签系统从「组织工具」变成「分析维度」：谁占的时间/精力多，一眼可见。
 * 归类口径是**任务的第一个标签**（见 TagShareItem 注释），所以占比之和恰好 100%；
 * 环心用 HTML 叠一层总数（比 ECharts 的 graphic 好排版，也能吃 CSS 主题变量）。
 */

import { computed, ref } from 'vue'

import ChartEmpty from '@/components/molecules/ChartEmpty.vue'
import { useChartTheme } from '@/composables/useChartTheme'
import { useECharts } from '@/composables/useECharts'
import { TAG_COLOR_HEX } from '@/types/tag'
import type { TagShareItem } from '@/types/statistics'

const props = defineProps<{ items: TagShareItem[]; rangeLabel: string }>()

const { tokens } = useChartTheme()
const el = ref<HTMLElement | null>(null)

const hasData = computed(() => props.items.length > 0)
const total = computed(() => props.items.reduce((sum, item) => sum + item.completed, 0))

/** name -> 该项（tooltip 里要补「平均耗时」，而 ECharts 只把 name/value/percent 回传） */
const byName = computed(() => new Map(props.items.map((item) => [item.name, item])))

function colorOf(item: TagShareItem): string {
  return item.color ? TAG_COLOR_HEX[item.color] : tokens.value.empty
}

const option = computed(() => ({
  ...tokens.value.base,
  tooltip: {
    ...(tokens.value.base.tooltip as Record<string, unknown>),
    trigger: 'item',
    formatter: (params: { name: string; value: number; percent: number }) => {
      const item = byName.value.get(params.name)
      const avg =
        item?.avgHours === null || item?.avgHours === undefined ? '—' : `${item.avgHours} 小时`
      return `${params.name}<br/>完成 ${params.value} 项 · 占比 ${params.percent}%<br/>平均耗时 ${avg}`
    },
  },
  legend: {
    bottom: 0,
    icon: 'circle',
    itemWidth: 8,
    itemHeight: 8,
    textStyle: { color: tokens.value.label, fontSize: 11 },
  },
  series: [
    {
      name: '标签占比',
      type: 'pie',
      radius: ['52%', '74%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
      label: { show: false },
      emphasis: { scale: true, scaleSize: 4 },
      data: props.items.map((item) => ({
        name: item.name,
        value: item.completed,
        itemStyle: { color: colorOf(item) },
      })),
    },
  ],
}))

useECharts(el, () => option.value)
</script>

<template>
  <section class="card p-5" aria-label="标签占比">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">🏷️ 标签占比</h2>
      <span class="text-xs text-slate-500 dark:text-slate-400"
        >{{ rangeLabel }} · 按首个标签归类</span
      >
    </header>

    <ChartEmpty
      v-if="!hasData"
      icon="🏷️"
      text="还没有带标签的完成记录——给任务打上标签，就能看出时间花在哪类事情上"
    />
    <div v-else class="relative">
      <div ref="el" class="h-64 w-full"></div>
      <div
        class="pointer-events-none absolute inset-x-0 top-[44%] flex -translate-y-1/2 flex-col items-center"
      >
        <span class="text-2xl font-bold text-slate-800 dark:text-slate-100">{{ total }}</span>
        <span class="text-[11px] text-slate-400 dark:text-slate-500">已完成</span>
      </div>
    </div>
  </section>
</template>
