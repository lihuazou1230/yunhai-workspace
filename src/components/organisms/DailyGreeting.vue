<script setup lang="ts">
/**
 * 有机体组件：每日格言 + 时段问候（**仪表板页头**，不是独立卡片）
 *
 * 视觉规范定稿：格言**合并进页头问候区，不再单独占一张卡**——
 * 页头一行放「问候 + 日期 ｜ 格言」，把版面留给赚钱秒表/完成度/天气这些数据卡。
 *
 * - 按时段显示问候语（凌晨好 / 早上好 / 中午好 / 下午好 / 晚上好）
 * - **登录后带上用户名**：「早上好，张三，今天是 9月13日 星期日」；本地模式没有名字，就不硬塞称呼
 * - 每日一句：按日期哈希从本地 JSON 取句，同一天永远同一句
 * - 右上角带**当前时间**（第六阶段 6.4「时钟/日历」栏目：页头加当前时间）
 * - 每分钟 + 切回标签页时校准，跨零点后自动换成新的一天
 */

import { computed, ref } from 'vue'

import { useEventListener, useIntervalFn } from '@vueuse/core'

import { useAuthStore } from '@/stores/authStore'
import { todayKey } from '@/utils/dateFormatter'
import { formatDateLabel, greetingOf, quoteOfDay } from '@/utils/dailyQuote'

const authStore = useAuthStore()

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

/**
 * 问候语里的称呼。
 * - 只在**真登录**时出现：本地模式没有名字，硬写「本地访客」比不写更像报错
 * - 昵称上限是 20 字（见 utils/validation），页头一行塞不下那么长，超过就截断加省略号——
 *   问候语是 `shrink-0`，放任它变长会把右边的格言挤到没有位置
 */
const MAX_GREETING_NAME = 12
const salutation = computed(() => {
  if (!authStore.isAuthed) return ''
  const name = authStore.displayName.trim()
  if (!name) return ''
  const shown = name.length > MAX_GREETING_NAME ? `${name.slice(0, MAX_GREETING_NAME)}…` : name
  return `，${shown}`
})

/** 页头时钟：HH:mm:ss（秒也显示，让「现在几点」这个信息有活的观感） */
const clockText = computed(() => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = now.value
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})
</script>

<template>
  <!--
    页头问候区（非卡片）：两行结构——上行「问候 + 日期 + 当前时间」，下行整行的格言。

    为什么不是「一行放完」（原实现）：那句格言是 `flex-1`，而问候语是 `shrink-0`，
    于是 DOM 顺序决定了一个反直觉的结果——**先被分配宽度的问候语把剩余宽度算完后，
    格言只能在剩下的缝里排字**。1440px 下有 500px 空白，格言却挤在 ~300px 里折成两行
    （「…生成一张卡片，存下来或分享」那种断法）。两行结构没有这个博弈：
    格言拿满整行，想多长有多长，时钟与问候同行也自然对齐。
  -->
  <header class="space-y-1" aria-label="每日格言">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p class="text-base font-semibold text-slate-800 dark:text-slate-100">
        {{ greeting }}{{ salutation }}，今天是 {{ dateLabel }}
      </p>
      <p
        class="ml-auto shrink-0 font-mono text-sm font-medium tabular-nums text-slate-500 dark:text-slate-400"
        data-testid="header-clock"
        title="当前时间"
      >
        {{ clockText }}
      </p>
    </div>
    <p class="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
      「{{ quote.text }}」
      <span class="ml-1 text-xs text-slate-400 dark:text-slate-500">—— {{ quote.author }}</span>
    </p>
  </header>
</template>
