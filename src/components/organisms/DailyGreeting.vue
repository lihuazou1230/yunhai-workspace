<script setup lang="ts">
/**
 * 有机体组件：每日格言 + 时段问候（**仪表板页头**，不是独立卡片）
 *
 * 视觉规范定稿：格言**合并进页头问候区，不再单独占一张卡**——
 * 页头一行放「问候 + 日期 ｜ 格言」，把版面留给赚钱秒表/完成度/天气这些数据卡。
 *
 * - 按时段显示问候语（凌晨好 / 早上好 / 中午好 / 下午好 / 晚上好）
 * - 每日一句：按日期哈希从本地 JSON 取句，同一天永远同一句
 * - 右上角带**当前时间**（第六阶段 6.4「时钟/日历」栏目：页头加当前时间）
 * - 每分钟 + 切回标签页时校准，跨零点后自动换成新的一天
 */

import { computed, ref } from 'vue'

import { useEventListener, useIntervalFn } from '@vueuse/core'

import { todayKey } from '@/utils/dateFormatter'
import { formatDateLabel, greetingOf, quoteOfDay } from '@/utils/dailyQuote'

const now = ref(new Date())

function refresh() {
  now.value = new Date()
}

// 每分钟校准；切回标签页立即校准（若跨过零点，问候语与格言都会更新）
useIntervalFn(refresh, 60_000, { immediate: false })
useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh()
})

const greeting = computed(() => greetingOf(now.value))
const dateLabel = computed(() => formatDateLabel(now.value))
const quote = computed(() => quoteOfDay(todayKey(now.value)))

/** 页头时钟：HH:mm:ss（秒也显示，让「现在几点」这个信息有活的观感） */
const clockText = computed(() => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = now.value
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})
</script>

<template>
  <!-- 页头问候区（非卡片）：桌面端一行「问候 ｜ 格言」+ 右侧当前时间，移动端换行叠放 -->
  <header class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3" aria-label="每日格言">
    <p class="shrink-0 text-base font-semibold text-slate-800 dark:text-slate-100">
      {{ greeting }}，今天是 {{ dateLabel }}
    </p>
    <p class="min-w-0 flex-1 text-sm text-slate-500 dark:text-slate-400">
      <span class="mr-2 hidden text-slate-300 sm:inline dark:text-slate-600">｜</span>「{{
        quote.text
      }}」
      <span class="ml-1 text-xs text-slate-400 dark:text-slate-500">—— {{ quote.author }}</span>
    </p>
    <p
      class="shrink-0 font-mono text-sm font-medium tabular-nums text-slate-500 dark:text-slate-400"
      data-testid="header-clock"
      :title="'当前时间'"
    >
      {{ clockText }}
    </p>
  </header>
</template>
