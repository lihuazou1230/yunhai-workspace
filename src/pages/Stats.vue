<script setup lang="ts">
/**
 * 页面：统计（第八阶段 8.1-5：可视化集中地）
 *
 * 时间范围（本周 / 本月 / 全部）一改，四张图与顶部小结**立刻**一起重算——
 * 全部聚合走 `utils/stats.ts` 的纯函数，页面只负责「拿 store 数据 → 传 props」，
 * 所以范围切换是纯计算，没有请求、没有 loading 态。
 *
 * 图表清单：
 * - 📈 完成趋势：每日柱 + 7 日移动平均线（窗口随范围；「全部」收敛到近 6 周）
 * - 🕒 完成时段分布：7×24 heatmap（高效时段）
 * - 🏷️ 标签占比：环形图（按首个标签归类，占比之和 = 100%）
 * - ⚖️ 投入产出：散点（赚钱秒表投入时长 × 当日完成数）
 * - 📊 优先级分布 + 🔥 90 天生产力热力图：第六阶段既有图表，保留在下方
 */

import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/atoms/BaseButton.vue'
import UiIcon from '@/components/atoms/UiIcon.vue'
import PageHeader from '@/components/organisms/PageHeader.vue'
import StatsRangeTabs from '@/components/molecules/StatsRangeTabs.vue'
import ProductivityHeatmap from '@/components/organisms/ProductivityHeatmap.vue'
import StatisticsCard from '@/components/organisms/StatisticsCard.vue'
import StatsHourHeatmap from '@/components/organisms/StatsHourHeatmap.vue'
import StatsScatterChart from '@/components/organisms/StatsScatterChart.vue'
import StatsTagDonut from '@/components/organisms/StatsTagDonut.vue'
import StatsTrendChart from '@/components/organisms/StatsTrendChart.vue'
import { useWorkLog } from '@/composables/useWorkLog'
import { useTagStore } from '@/stores/tagStore'
import { useTodoStore } from '@/stores/todoStore'
import {
  aggregateDailyTrend,
  aggregateHourly,
  aggregateScatter,
  aggregateTagShare,
  countCompletedInRange,
  pearsonCorrelation,
  trendStartKey,
} from '@/utils/stats'
import { STATS_RANGE_LABEL } from '@/types/statistics'
import type { StatsRange } from '@/types/statistics'

const router = useRouter()
const todoStore = useTodoStore()
const tagStore = useTagStore()
const { log } = useWorkLog()

const range = ref<StatsRange>('week')

/**
 * 「今天」的基准时间。
 * 显式读一下 `todoStore.today`（它由 store 的分钟级定时器推进）：
 * 页面被 keep-alive 缓存时，跨过零点后若不重算，图表的"今天"就会停在昨天。
 */
const now = computed<Date>(() => {
  void todoStore.today
  return new Date()
})

const rangeLabel = computed(() => STATS_RANGE_LABEL[range.value])
const completedInRange = computed(() =>
  countCompletedInRange(todoStore.visibleTodos, range.value, now.value),
)
const windowLabel = computed(() => {
  if (range.value === 'week') return '本周一至今'
  if (range.value === 'month') return '本月至今'
  return '近 6 周'
})

const trend = computed(() =>
  aggregateDailyTrend(todoStore.visibleTodos, trendStartKey(range.value, now.value), now.value),
)
const hourly = computed(() => aggregateHourly(todoStore.visibleTodos, range.value, now.value))
const tagShare = computed(() =>
  aggregateTagShare(todoStore.visibleTodos, tagStore.tags, range.value, now.value),
)
const scatter = computed(() =>
  aggregateScatter(todoStore.visibleTodos, log.value, range.value, now.value),
)
const correlation = computed(() => pearsonCorrelation(scatter.value))
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="统计"
      :subtitle="`${rangeLabel}完成 ${completedInRange} 项 · 趋势、时段、标签、投入产出四维分析`"
    >
      <template #actions>
        <StatsRangeTabs v-model="range" />
        <BaseButton variant="secondary" size="sm" @click="router.push({ name: 'annual' })">
          <UiIcon name="chart" class="h-4 w-4" />
          年度报告
        </BaseButton>
      </template>
    </PageHeader>

    <StatsTrendChart :points="trend" :window-label="windowLabel" />

    <div class="grid gap-4 xl:grid-cols-2">
      <StatsHourHeatmap :heatmap="hourly" :range-label="rangeLabel" />
      <StatsTagDonut :items="tagShare" :range-label="rangeLabel" />
      <StatsScatterChart :points="scatter" :correlation="correlation" :range-label="rangeLabel" />
      <StatisticsCard />
      <ProductivityHeatmap />
    </div>
  </div>
</template>
