<script setup lang="ts">
/**
 * 有机体组件：生产力热力图（近 90 天 GitHub 风格色阶图，纯 CSS Grid 渲染）
 * - 每周一列（周一对齐），7 行表示周一 ~ 周日
 * - 颜色强度 = 当日完成任务数（0-4 档）
 * - 顶部按月标注，左侧星期标签，底部图例
 */

import { computed } from 'vue'

import { useTaskStatistics } from '@/composables/useStatistics'

const { heatmap } = useTaskStatistics()

/** 单元格尺寸（px）与间距（px），用于月份标签对齐与占位 */
const CELL = 12
const GAP = 3

const WEEK_LABELS: Array<{ index: number; label: string }> = [
  { index: 0, label: '一' },
  { index: 2, label: '三' },
  { index: 4, label: '五' },
  { index: 6, label: '日' },
]

/** 月份标签：按周列定位，仅在该周首个真实日期月份变化时标注 */
const monthMarks = computed(() => {
  const marks: Array<{ col: number; text: string }> = []
  let lastMonth = -1
  heatmap.value.weeks.forEach((week, col) => {
    const first = week.find((c) => c && c.date)
    if (!first?.date) return
    const m = Number(first.date.slice(5, 7))
    if (m !== lastMonth) {
      marks.push({ col, text: `${m}月` })
      lastMonth = m
    }
  })
  return marks
})

function cellClass(level: number): string {
  // 色阶走 emerald（与默认强调色一致，单一绿色系保持克制）
  switch (level) {
    case 1:
      return 'bg-emerald-200 dark:bg-emerald-900/70'
    case 2:
      return 'bg-emerald-300 dark:bg-emerald-700'
    case 3:
      return 'bg-emerald-500 dark:bg-emerald-500'
    case 4:
      return 'bg-emerald-700 dark:bg-emerald-300'
    case 0:
    default:
      return 'bg-slate-200 dark:bg-slate-700/50'
  }
}

const legendLevels = [0, 1, 2, 3, 4]

/**
 * 把「周 × 7 天」的二维结构摊平成一维。
 * 配合容器的 `grid-auto-flow: column` + `grid-template-rows: repeat(7, …)`，
 * 一维顺序会按**列优先**填充——正好还原成 GitHub 的「一周一列」。
 */
const flatCells = computed(() => heatmap.value.weeks.flat())
</script>

<template>
  <section class="card p-5" aria-label="生产力热力图">
    <header class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">🔥 生产力热力图</h2>
      <span class="text-xs text-slate-500 dark:text-slate-400">近 90 天每日完成数</span>
    </header>

    <div class="flex gap-1.5">
      <!-- 左侧星期标签（含顶部月份占位：顶部高度 = 月份行 h-4 + mb-1 = 20px） -->
      <div class="flex flex-col">
        <div class="h-5"></div>
        <div
          class="flex flex-col gap-[3px] text-[10px] leading-none text-slate-400 dark:text-slate-500"
        >
          <template v-for="i in 7" :key="i">
            <span v-if="WEEK_LABELS.some((l) => l.index === i - 1)" class="h-3 pr-1 text-right">
              {{ WEEK_LABELS.find((l) => l.index === i - 1)?.label }}
            </span>
            <span v-else class="h-3"></span>
          </template>
        </div>
      </div>

      <!-- 月份标签 + 周列格 -->
      <div class="min-w-0 flex-1 overflow-x-auto">
        <div class="relative mb-1 h-4 text-[10px] leading-none text-slate-400 dark:text-slate-500">
          <span
            v-for="m in monthMarks"
            :key="m.col"
            class="absolute"
            :style="{ left: `${m.col * (CELL + GAP)}px` }"
          >
            {{ m.text }}
          </span>
        </div>
        <!-- 单个 CSS Grid 容器：列优先填充 = 一周一列（规划要求用 CSS Grid 渲染） -->
        <div
          class="grid gap-[3px]"
          :style="{ gridTemplateRows: `repeat(7, ${CELL}px)`, gridAutoFlow: 'column' }"
        >
          <span
            v-for="(cell, i) in flatCells"
            :key="i"
            class="rounded-[3px]"
            :class="cell ? cellClass(cell.level) : ''"
            :style="{ width: `${CELL}px`, height: `${CELL}px` }"
            :title="cell ? `${cell.date} 完成 ${cell.completed}` : undefined"
          ></span>
        </div>
      </div>
    </div>

    <!-- 图例 -->
    <div class="mt-3 flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
      <span>少</span>
      <span
        v-for="level in legendLevels"
        :key="level"
        :class="cellClass(level)"
        class="block rounded-[3px]"
        :style="{ width: `${CELL}px`, height: `${CELL}px` }"
      ></span>
      <span>多</span>
    </div>
  </section>
</template>
