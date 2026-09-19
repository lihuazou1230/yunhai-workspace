<script setup lang="ts">
/**
 * 有机体组件：生产力热力图（近 HEATMAP_WINDOW_DAYS 天 GitHub 风格色阶图，纯 CSS Grid 渲染）
 * - **星期横向、日期纵向**：一行 = 一周，7 列 = 周一 ~ 周日，日期沿纵向推进
 * - 颜色强度 = 当日完成任务数（0-4 档）
 * - 左侧日期轴（每周一行首日期，换月那一行加重），下方图例
 * - 窗口口径（30 天）来自 `HEATMAP_WINDOW_DAYS`，文案也读它，别在模板里写死天数
 *
 * 排版的关键约束（转置时改坏过一次，别再踩）：
 * 1. **轨道尺寸必须正好等于格子尺寸**。隐式轨道是 auto 尺寸，而 grid 容器默认
 *    `justify-content: normal` 会变成 stretch —— 于是轨道被均分容器宽度（实测：
 *    12px 的格子被摊进 33px 的轨道，列间空出 21px），一周读不出「一行」。
 *    这里的解法是让日历块的宽度由外层定死（`w-[…]`），行/列轨道都用
 *    `minmax(0, 1fr)`，再用 `aspect-ratio: 7 / 周数` 把高度锁成与宽度同比：
 *    轨道只剩「均分」一种可能，格子自然是正方的。
 * 2. **星期表头、日期轴、格子共用同一套轨道**。表头与格子同列（同一个
 *    `repeat(7, minmax(0,1fr))` + 同一个 gap），日期轴与格子同行（同一个
 *    `repeat(周数, minmax(0,1fr))` + 同一个 gap），所以对齐是结构性的，
 *    不靠 `col * (CELL + GAP)` 这类算术 —— 那种写法只要格子尺寸变了就会错位。
 * 3. 空数据走 `ChartEmpty`（与统计页另外三张图一致），而不是画一片空格子：
 *    全是 0 的日历只剩噪声，读者得不到任何信息。
 */

import { computed } from 'vue'

import ChartEmpty from '@/components/molecules/ChartEmpty.vue'
import { HEATMAP_WINDOW_DAYS, useTaskStatistics } from '@/composables/useStatistics'

const { heatmap } = useTaskStatistics()

/** 空状态文案：天数跟着窗口常量走 */
const emptyText = computed(
  () => `近 ${HEATMAP_WINDOW_DAYS} 天还没有完成记录——完成任务后这里就会亮起来`,
)

/** 格子间距（px）：横竖必须一致，否则「一行 = 一周」读不出来 */
const GAP = 4

/** 星期表头：横向 7 列，与列轨道一一对应 */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const weekCount = computed(() => heatmap.value.weeks.length)

/**
 * 日期轴：一周一行，取该行首个真实日期标 `M/D`。
 * 换月的那一行加重 —— 纵向才看得出月份推进到哪儿。行内跨月是常态，
 * 标在「本月首次出现的那一行」是这类日历的惯例（误差最多 3 天）。
 */
const rowLabels = computed(() => {
  let lastMonth = -1
  return heatmap.value.weeks.map((week) => {
    const first = week.find((c) => c && c.date)
    if (!first?.date) return { text: '', monthStart: false }
    const [, m, d] = first.date.split('-').map(Number)
    const monthStart = m !== lastMonth
    lastMonth = m
    return { text: `${m}/${d}`, monthStart }
  })
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
 * 配合容器的 `grid-auto-flow: row` + 7 列显式轨道，一维顺序会按**行优先**填充
 * ——正好还原成「一行 = 一周」。
 */
const flatCells = computed(() => heatmap.value.weeks.flat())

/** 右侧汇总：口径就是这张图本身，不引入第二套统计来源 */
const doneTotal = computed(() => flatCells.value.reduce((sum, c) => sum + (c?.completed ?? 0), 0))
const activeDays = computed(() => flatCells.value.filter((c) => c && c.completed > 0).length)
const bestDay = computed(() =>
  flatCells.value.reduce((max, c) => Math.max(max, c?.completed ?? 0), 0),
)
/** 日均按窗口内的真实天数算，别写死 90 */
const trackedDays = computed(() => flatCells.value.filter((c) => c).length)
const perDay = computed(() =>
  trackedDays.value === 0 ? '0.0' : (doneTotal.value / trackedDays.value).toFixed(1),
)
const hasData = computed(() => activeDays.value > 0)
</script>

<template>
  <section class="card p-5" aria-label="生产力热力图">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">🔥 生产力热力图</h2>
      <span class="text-xs text-slate-500 dark:text-slate-400"
        >近 {{ HEATMAP_WINDOW_DAYS }} 天每日完成数</span
      >
    </header>

    <ChartEmpty v-if="!hasData" icon="🔥" :text="emptyText" />

    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <!-- 日历块：宽度决定格子尺寸与高度（grow 到 280px 封顶 ≈ 31px 格子）。
             30 天 = 5~6 行，卡片高度由它决定；多出来的宽度留给两栏之间的呼吸 -->
        <div class="min-w-[168px] max-w-[280px] shrink grow basis-[185px] max-sm:basis-[160px]">
          <div class="grid" :style="{ gridTemplateColumns: 'auto minmax(0, 1fr)' }">
            <!-- 星期（横向表头）：与格子同列轨道 -->
            <div
              class="col-start-2 row-start-1 mb-1.5 grid text-[11px] leading-none text-slate-500 dark:text-slate-400"
              :style="{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: `${GAP}px` }"
            >
              <span v-for="label in WEEKDAY_LABELS" :key="label" class="text-center">
                {{ label }}
              </span>
            </div>

            <!-- 日期轴（纵向）：与格子同行轨道，换月那一行加重 -->
            <div
              class="col-start-1 row-start-2 grid pr-2 text-[11px] leading-none"
              :style="{ gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))`, gap: `${GAP}px` }"
            >
              <span
                v-for="(row, i) in rowLabels"
                :key="i"
                class="text-right tabular-nums"
                :class="
                  row.monthStart
                    ? 'font-medium text-slate-700 dark:text-slate-200'
                    : 'text-slate-500 dark:text-slate-400'
                "
                aria-hidden="true"
              >
                {{ row.text }}
              </span>
            </div>

            <!-- 格子：一行 = 一周（行优先填充）；aspect-ratio 保证格子是正方的 -->
            <div
              class="col-start-2 row-start-2 grid"
              data-testid="heatmap-grid"
              :style="{
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))`,
                gridAutoFlow: 'row',
                gap: `${GAP}px`,
                aspectRatio: `7 / ${weekCount}`,
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

        <!-- 图注区：贴右成栏（与页头右侧的说明同一根右轴），统计在上、图例贴底 -->
        <div
          class="flex w-[280px] shrink-0 flex-col justify-between gap-6 self-stretch max-sm:w-full max-sm:max-w-[220px]"
        >
          <dl
            class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs max-sm:flex max-sm:flex-wrap max-sm:gap-x-5"
          >
            <div
              class="flex items-baseline justify-between gap-3 max-sm:justify-start max-sm:gap-1.5"
            >
              <dt class="text-slate-500 dark:text-slate-400">完成</dt>
              <dd class="font-medium tabular-nums text-slate-700 dark:text-slate-200">
                {{ doneTotal }} 项
              </dd>
            </div>
            <div
              class="flex items-baseline justify-between gap-3 max-sm:justify-start max-sm:gap-1.5"
            >
              <dt class="text-slate-500 dark:text-slate-400">有记录</dt>
              <dd class="font-medium tabular-nums text-slate-700 dark:text-slate-200">
                {{ activeDays }} 天
              </dd>
            </div>
            <div
              class="flex items-baseline justify-between gap-3 max-sm:justify-start max-sm:gap-1.5"
            >
              <dt class="text-slate-500 dark:text-slate-400">单日最多</dt>
              <dd class="font-medium tabular-nums text-slate-700 dark:text-slate-200">
                {{ bestDay }} 项
              </dd>
            </div>
            <div
              class="flex items-baseline justify-between gap-3 max-sm:justify-start max-sm:gap-1.5"
            >
              <dt class="text-slate-500 dark:text-slate-400">日均</dt>
              <dd class="font-medium tabular-nums text-slate-700 dark:text-slate-200">
                {{ perDay }} 项
              </dd>
            </div>
          </dl>

          <div class="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>少</span>
            <span
              v-for="level in legendLevels"
              :key="level"
              :class="cellClass(level)"
              class="block h-3 w-3 rounded-[4px]"
            ></span>
            <span>多</span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
