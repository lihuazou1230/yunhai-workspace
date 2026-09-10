<script setup lang="ts">
/**
 * 页面：仪表板（打开即看「今天赚了多少、干了多少、外面天气」）
 *
 * 布局按视觉规范「合并后的 Dashboard 布局（定稿版）」：
 * - 页头（非卡片）：时段问候 + 日期 ｜ 每日格言 —— 格言合并进页头，不再单独占卡
 * - 三列 bento：赚钱秒表（深绿 C 位卡，跨 2 行）→ 完成度环形 → 天气
 * - 右列两行空档预留给第六阶段的「迷你月历」与「Streak/周目标卡」
 * - 底部通栏：今日聚焦 MyDay + 任务概览
 *
 * 任务增删改与列表搬到 /todos，统计图表搬到 /stats——首页只留「一眼看清」的内容。
 */

import { computed } from 'vue'

import DailyGreeting from '@/components/organisms/DailyGreeting.vue'
import EarningsClock from '@/components/organisms/EarningsClock.vue'
import MyDay from '@/components/organisms/MyDay.vue'
import TodayProgressCard from '@/components/organisms/TodayProgressCard.vue'
import WeatherWidget from '@/components/organisms/WeatherWidget.vue'
import BaseBadge from '@/components/atoms/BaseBadge.vue'
import { useTodoStore } from '@/stores/todoStore'

const store = useTodoStore()

interface SummaryItem {
  label: string
  value: number
  tone: 'info' | 'warning' | 'success'
}

const summary = computed<SummaryItem[]>(() => [
  { label: '全部', value: store.totalCount, tone: 'info' },
  { label: '进行中', value: store.activeCount, tone: 'warning' },
  { label: '已完成', value: store.completedCount, tone: 'success' },
])
</script>

<template>
  <div class="space-y-5">
    <!-- 页头：问候 + 日期 ｜ 格言（合并进页头，不单独占卡） -->
    <DailyGreeting />

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <!-- 赚钱秒表：深绿 C 位卡，跨 2 行 -->
      <EarningsClock class="lg:row-span-2" />
      <TodayProgressCard />
      <WeatherWidget />

      <!-- 第二行右侧两列：第六阶段的「迷你月历」与「Streak/周目标卡」落位于此，此处先由今日聚焦占位 -->
      <MyDay class="lg:col-span-2" />

      <!-- 底部通栏：任务概览 -->
      <section class="card flex flex-col gap-3 p-5 lg:col-span-3" aria-label="任务统计">
        <h2 class="text-sm font-semibold text-slate-500 dark:text-slate-400">任务概览</h2>
        <div class="flex flex-wrap gap-2">
          <BaseBadge v-for="item in summary" :key="item.label" :tone="item.tone" size="sm">
            {{ item.label }} {{ item.value }}
          </BaseBadge>
        </div>
        <p class="text-xs text-slate-400 dark:text-slate-500">
          全部任务按优先级与截止日期排序，去「任务」页可筛选、搜索与批量操作。
        </p>
        <router-link
          :to="{ name: 'todos' }"
          data-testid="dashboard-goto-todos"
          class="text-sm font-medium text-[var(--el-color-primary)] underline-offset-2 hover:underline"
        >
          查看全部任务 →
        </router-link>
      </section>
    </div>
  </div>
</template>
