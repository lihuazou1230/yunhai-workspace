<script setup lang="ts">
/**
 * 有机体组件：生产力热力图（近 90 天 GitHub 风格色阶图，纯 CSS Grid 渲染）
 * - 每周一列（周一对齐），7 行表示周一 ~ 周日
 * - 颜色强度 = 当日完成任务数（0-4 档）
 * - 顶部按月标注，左侧星期标签，底部图例
 *
 * 排版的关键约束（改坏过一次，别再踩）：
 * 1. **列轨道必须没有伸展余地**。`grid-auto-flow: column` 下隐式列是 auto 尺寸，
 *    而 grid 容器默认 `justify-content: normal` 会变成 stretch —— 于是 14 条轨道被
 *    均分卡片宽度（实测每条 33px），12px 的格子各自缩在轨道左边，列与列之间空出
 *    21px：一周七格读不出「一列」，月份标签也按 `col * 15px` 算，越往右偏得越远。
 *    这里的解法是给容器 `maxWidth`，并让行/列轨道都用 `minmax(0, 1fr)` + 容器
 *    `aspect-ratio`：格子由轨道决定，宽度一旦被 maxWidth 封顶，格子就是正方的。
 * 2. **月份标签、星期标签、格子共用同一套轨道**。月份行与格子网格同列（同一个
 *    `repeat(n, minmax(0,1fr))` + 同一个 maxWidth），星期列与格子网格同行
 *    （同一个 `repeat(7, minmax(0,1fr))` + 同一个 gap），因此对齐是结构性的，
 *    不靠 `col * (CELL + GAP)` 这类算术 —— 那种写法只要格子尺寸变了就会错位。
 * 3. 空数据走 `ChartEmpty`（与统计页另外三张图一致），而不是画 91 个空格子：
 *    全是 0 的日历只剩噪声，读者得不到任何信息。
 */

import { computed } from 'vue'

import ChartEmpty from '@/components/molecules/ChartEmpty.vue'
import { useTaskStatistics } from '@/composables/useStatistics'

const { heatmap } = useTaskStatistics()

/** 格子间距（px）：横竖必须一致，否则「周」这一列读不出来 */
const GAP = 4
/** 格子最大边长（px）：卡片再宽也不继续放大，避免热力图变成大棋盘 */
const MAX_CELL = 34

/** 行标签只标一/三/五/日（GitHub 惯例），其余行留空但仍占位以保证对齐 */
const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', '日']

const weekCount = computed(() => heatmap.value.weeks.length)

/** 网格最大宽度：weekCount 列 + (weekCount - 1) 个间距 */
const gridMaxWidth = computed(() => weekCount.value * MAX_CELL + (weekCount.value - 1) * GAP)

/**
 * 月份标注：按周列定位，仅在该周首个真实日期月份变化时标注。
 * `span` 覆盖到下一个月份标注之前，标签才有「这个月占几列」的含义，
 * 也让标签之间不会互相挤压。
 */
const monthMarks = computed(() => {
  const marks: Array<{ col: number; text: string; span: number }> = []
  let lastMonth = -1
  heatmap.value.weeks.forEach((week, col) => {
    const first = week.find((c) => c && c.date)
    if (!first?.date) return
    const m = Number(first.date.slice(5, 7))
    if (m !== lastMonth) {
      marks.push({ col, text: `${m}月`, span: 1 })
      lastMonth = m
    }
  })
  marks.forEach((mark, i) => {
    const next = marks[i + 1]
    mark.span = (next ? next.col : weekCount.value) - mark.col
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
 * 配合容器的 `grid-auto-flow: column` + `grid-template-rows: repeat(7, minmax(0,1fr))`，
 * 一维顺序会按**列优先**填充——正好还原成 GitHub 的「一周一列」。
 */
const flatCells = computed(() => heatmap.value.weeks.flat())

/** 右侧汇总：口径就是这张图本身，不引入第二套统计来源 */
const doneTotal = computed(() => flatCells.value.reduce((sum, c) => sum + (c?.completed ?? 0), 0))
const activeDays = computed(() => flatCells.value.filter((c) => c && c.completed > 0).length)
const bestDay = computed(() =>
  flatCells.value.reduce((max, c) => Math.max(max, c?.completed ?? 0), 0),
)
const hasData = computed(() => activeDays.value > 0)
</script>

<template>
  <section class="card p-5" aria-label="生产力热力图">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">🔥 生产力热力图</h2>
      <span class="text-xs text-slate-500 dark:text-slate-400">近 90 天每日完成数</span>
    </header>

    <ChartEmpty v-if="!hasData" icon="🔥" text="近 90 天还没有完成记录——完成任务后这里就会亮起来" />

    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <!-- 日历：月份行 / 星期列 / 格子网格，三层共用同一套轨道 -->
        <div class="min-w-[280px] flex-1">
          <div class="grid" :style="{ gridTemplateColumns: 'auto minmax(0, 1fr)' }">
            <!-- 月份：与格子同列轨道，标签按 span 占据自己那几列 -->
            <div
              class="col-start-2 row-start-1 mb-1.5 grid text-[11px] leading-none text-slate-500 dark:text-slate-400"
              :style="{
                gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
                gap: `${GAP}px`,
                width: '100%',
                maxWidth: `${gridMaxWidth}px`,
              }"
            >
              <span
                v-for="m in monthMarks"
                :key="m.col"
                :style="{ gridColumn: `${m.col + 1} / span ${m.span}` }"
              >
                {{ m.text }}
              </span>
            </div>

            <!-- 星期：与格子同行轨道，行高完全一致 -->
            <div
              class="col-start-1 row-start-2 grid pr-2 text-[11px] leading-none text-slate-500 dark:text-slate-400"
              :style="{ gridTemplateRows: `repeat(7, minmax(0, 1fr))`, gap: `${GAP}px` }"
            >
              <span
                v-for="i in 7"
                :key="i"
                class="flex items-center justify-end"
                aria-hidden="true"
              >
                {{ WEEKDAY_LABELS[i - 1] }}
              </span>
            </div>

            <!-- 格子：列优先填充 = 一周一列；maxWidth + aspect-ratio 保证格子是正方的 -->
            <div
              class="col-start-2 row-start-2 grid"
              data-testid="heatmap-grid"
              :style="{
                gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(7, minmax(0, 1fr))`,
                gridAutoFlow: 'column',
                gap: `${GAP}px`,
                aspectRatio: `${weekCount} / 7`,
                width: '100%',
                maxWidth: `${gridMaxWidth}px`,
              }"
            >
              <span
                v-for="(cell, i) in flatCells"
                :key="i"
                class="rounded-[4px]"
                :class="cell ? cellClass(cell.level) : ''"
                :title="cell ? `${cell.date} 完成 ${cell.completed}` : undefined"
              ></span>
            </div>
          </div>
        </div>

        <!-- 汇总：描述这张图本身，纯文字不加容器（卡片里再套卡片是错的） -->
        <dl
          class="flex w-[150px] shrink-0 flex-col gap-1.5 text-xs max-sm:w-full max-sm:flex-row max-sm:flex-wrap max-sm:gap-x-5"
        >
          <div
            class="flex items-baseline justify-between gap-2 max-sm:justify-start max-sm:gap-1.5"
          >
            <dt class="text-slate-500 dark:text-slate-400">完成</dt>
            <dd class="font-medium tabular-nums text-slate-700 dark:text-slate-200">
              {{ doneTotal }} 项
            </dd>
          </div>
          <div
            class="flex items-baseline justify-between gap-2 max-sm:justify-start max-sm:gap-1.5"
          >
            <dt class="text-slate-500 dark:text-slate-400">有记录</dt>
            <dd class="font-medium tabular-nums text-slate-700 dark:text-slate-200">
              {{ activeDays }} 天
            </dd>
          </div>
          <div
            class="flex items-baseline justify-between gap-2 max-sm:justify-start max-sm:gap-1.5"
          >
            <dt class="text-slate-500 dark:text-slate-400">单日最多</dt>
            <dd class="font-medium tabular-nums text-slate-700 dark:text-slate-200">
              {{ bestDay }} 项
            </dd>
          </div>
        </dl>
      </div>

      <!-- 图例 -->
      <div class="mt-4 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        <span>少</span>
        <span
          v-for="level in legendLevels"
          :key="level"
          :class="cellClass(level)"
          class="block h-3 w-3 rounded-[4px]"
        ></span>
        <span>多</span>
      </div>
    </template>
  </section>
</template>
