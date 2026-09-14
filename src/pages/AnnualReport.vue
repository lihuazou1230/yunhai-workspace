<script setup lang="ts">
/**
 * 页面：年度报告（第八阶段 8.1-7）
 *
 * 类网易云年度总结：全年任务数 / 最高效月 / 最长连续 / 投入总时长……一键生成
 * **可以保存分享的竖版卡片**（canvas 自绘，见 utils/annualCard.ts）。
 *
 * 两个刻意的设计：
 * - **卡片按需生成**（点按钮才画）：canvas 是 720×1000×DPR 的位图，
 *   进页面就画会在低端机上换来一次无谓的卡顿。
 * - **生成不了就说清楚**（测试环境/老 WebView 没有 2D 上下文时给提示），
 *   而不是留一块空白让人以为坏了。
 */

import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/atoms/BaseButton.vue'
import UiIcon from '@/components/atoms/UiIcon.vue'
import PageHeader from '@/components/organisms/PageHeader.vue'
import { useAuthStore } from '@/stores/authStore'
import { useTagStore } from '@/stores/tagStore'
import { useThemeStore } from '@/stores/themeStore'
import { useTodoStore } from '@/stores/todoStore'
import { useWorkLog } from '@/composables/useWorkLog'
import {
  annualCardFileName,
  buildAnnualCardData,
  downloadAnnualCard,
  renderAnnualCard,
  ANNUAL_CARD_HEIGHT,
  ANNUAL_CARD_WIDTH,
} from '@/utils/annualCard'
import type { AnnualCardPalette } from '@/utils/annualCard'
import { computeAnnualReport, formatDateText, formatHoursText, reportYears } from '@/utils/stats'
import { darken, lighten } from '@/utils/themeColor'

const router = useRouter()
const todoStore = useTodoStore()
const tagStore = useTagStore()
const themeStore = useThemeStore()
const authStore = useAuthStore()
const { log } = useWorkLog()

const years = computed(() => reportYears(todoStore.visibleTodos, log.value))
const year = ref(years.value[0] ?? new Date().getFullYear())
const report = computed(() =>
  computeAnnualReport(todoStore.visibleTodos, log.value, tagStore.tags, year.value),
)

const cardData = computed(() =>
  buildAnnualCardData(report.value, { owner: authStore.displayName || undefined }),
)

/** 卡片配色跟随主题（主题色 + 深浅色）——和图表一个待遇 */
const palette = computed<AnnualCardPalette>(() =>
  themeStore.isDark
    ? {
        primary: lighten(themeStore.primaryColor, 0.12),
        bgFrom: '#0b1220',
        bgTo: '#111c33',
        panel: 'rgba(148,163,184,0.12)',
        text: '#f1f5f9',
        subText: '#94a3b8',
      }
    : {
        primary: darken(themeStore.primaryColor, 0.06),
        bgFrom: '#ffffff',
        bgTo: '#f1f5f9',
        panel: 'rgba(15,23,42,0.05)',
        text: '#0f172a',
        subText: '#64748b',
      },
)

const canvasEl = ref<HTMLCanvasElement | null>(null)
const generated = ref(false)
const failed = ref(false)

function generateCard() {
  const canvas = canvasEl.value
  if (!canvas) return
  const ok = renderAnnualCard(canvas, cardData.value, palette.value)
  generated.value = ok
  failed.value = !ok
}

function saveCard() {
  const canvas = canvasEl.value
  if (!canvas || !generated.value) return
  if (!downloadAnnualCard(canvas, annualCardFileName(year.value))) failed.value = true
}

/** 换年份/换主题后旧图就过期了：收起重画，避免"看到的是去年的卡" */
watch([year, palette], () => {
  generated.value = false
  failed.value = false
})

function switchYear(next: number) {
  year.value = next
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="`${year} 年度报告`"
      subtitle="全年完成数、最高效月、最长连续与投入总时长——生成一张卡片，存下来或分享"
    >
      <template #actions>
        <div
          v-if="years.length > 1"
          role="group"
          aria-label="报告年份"
          class="inline-flex items-center gap-1 rounded-xl bg-slate-100/70 p-1 dark:bg-slate-800/70"
        >
          <button
            v-for="y in years"
            :key="y"
            type="button"
            class="rounded-lg px-3 py-1.5 text-xs transition-colors"
            :class="
              y === year
                ? 'bg-[var(--el-color-primary-light-9)] font-medium text-[var(--el-color-primary-dark-2)]'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            "
            :aria-pressed="y === year"
            @click="switchYear(y)"
          >
            {{ y }}
          </button>
        </div>
        <BaseButton variant="secondary" size="sm" @click="router.push({ name: 'stats' })">
          <UiIcon name="chevron-left" class="h-4 w-4" />
          返回统计
        </BaseButton>
      </template>
    </PageHeader>

    <section v-if="!report.hasData" class="card p-8 text-center">
      <p class="text-3xl">🗓️</p>
      <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">
        {{ year }} 年还没有可统计的数据——完成几条任务，或开着赚钱秒表工作一段时间。
      </p>
    </section>

    <template v-else>
      <!-- 数据概览 -->
      <section class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div class="card p-4">
          <p class="text-xs text-slate-500 dark:text-slate-400">全年完成</p>
          <p class="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
            {{ report.completed }}
            <span class="text-sm font-normal">件</span>
          </p>
          <p class="mt-1 text-xs text-slate-400 dark:text-slate-500">
            新建 {{ report.created }} 件 · 完成率 {{ report.completionRate }}%
          </p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-slate-500 dark:text-slate-400">有产出的日子</p>
          <p class="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
            {{ report.activeDays }}
            <span class="text-sm font-normal">天</span>
          </p>
          <p class="mt-1 text-xs text-slate-400 dark:text-slate-500">
            日均 {{ report.avgPerActiveDay }} 件
          </p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-slate-500 dark:text-slate-400">最长连续完成</p>
          <p class="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
            {{ report.longestStreak }}
            <span class="text-sm font-normal">天</span>
          </p>
          <p class="mt-1 text-xs text-slate-400 dark:text-slate-500">
            最高效月：{{ report.bestMonth ? `${report.bestMonth.month} 月` : '—' }}
          </p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-slate-500 dark:text-slate-400">投入总时长</p>
          <p class="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
            {{ formatHoursText(report.workSeconds) }}
          </p>
          <p class="mt-1 text-xs text-slate-400 dark:text-slate-500">
            计薪 {{ report.workDays }} 天 · 最常用标签 {{ report.topTag?.name ?? '—' }}
          </p>
        </div>
      </section>

      <!-- 分享卡 -->
      <section class="card p-5">
        <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">🖼️ 分享卡片</h2>
          <div class="flex items-center gap-2">
            <BaseButton size="sm" @click="generateCard">
              {{ generated ? '重新生成' : '生成卡片' }}
            </BaseButton>
            <BaseButton v-if="generated" variant="secondary" size="sm" @click="saveCard">
              ⬇️ 保存为图片
            </BaseButton>
          </div>
        </header>

        <p v-if="failed" class="mb-3 text-xs text-rose-500">
          当前环境不支持 canvas 绘图，请在桌面浏览器里生成。
        </p>
        <p v-else-if="!generated" class="text-xs text-slate-400 dark:text-slate-500">
          卡片尺寸 {{ ANNUAL_CARD_WIDTH }}×{{ ANNUAL_CARD_HEIGHT }}（2
          倍图导出），配色跟随当前主题色与深浅模式。
        </p>

        <!-- v-show 而不是 v-if：canvas 必须一直在 DOM 里，否则第一次点「生成」时 ref 还是 null -->
        <div
          v-show="generated"
          class="mx-auto w-full max-w-sm overflow-hidden rounded-2xl shadow-lg"
        >
          <canvas ref="canvasEl" class="block w-full" aria-label="年度报告分享卡"></canvas>
        </div>
      </section>

      <!-- 明细 -->
      <section class="card p-5">
        <h2 class="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">📌 细枝末节</h2>
        <ul class="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <li>
            · 最猛的一天：{{
              report.busiestDay
                ? `${formatDateText(report.busiestDay.date)}（${report.busiestDay.completed} 件）`
                : '—'
            }}
          </li>
          <li>
            · 最常用标签：
            {{ report.topTag ? `${report.topTag.name}（${report.topTag.completed} 件）` : '—' }}
          </li>
          <li>· 截至今天，投入日志共记录 {{ report.workDays }} 个计薪日</li>
        </ul>
      </section>
    </template>
  </div>
</template>
