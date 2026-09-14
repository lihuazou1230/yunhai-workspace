<script setup lang="ts">
/**
 * 有机体组件：连续打卡 + 周目标（仪表板里合并成一张卡）
 * - **纯展示**：StreakInfo 由父级用 computeStreak 算好传进来，这里不碰 store
 * - 周目标直接卡上改：`v-model:week-goal`，改动即时生效（不用回车），非法输入钳到 1
 * - 进度条沿用赚钱秒表的细条样式，颜色换成主题色（跟随用户在设置里换的主题）
 */

import { computed } from 'vue'

import { DEFAULT_WEEK_GOAL, clampWeekGoal } from '@/utils/streak'
import type { StreakInfo } from '@/utils/streak'

const props = defineProps<{ info: StreakInfo }>()

/** 周目标双向绑定（父级 v-model:week-goal）；没接 v-model 时也能本地改，单独放进仪表板不会变砖 */
const weekGoal = defineModel<number>('weekGoal', { default: DEFAULT_WEEK_GOAL })

/** 输入框是字符串语义，这里换算成数字并钳制后回写（0 / 负数 / 非数字都落到 1） */
const goalInput = computed({
  get: () => String(weekGoal.value),
  set: (raw: string) => {
    weekGoal.value = clampWeekGoal(Number(raw))
  },
})

const progressWidth = computed(() => `${props.info.weekRate}%`)
</script>

<template>
  <section class="card flex flex-col p-5" aria-label="连续打卡与周目标">
    <header class="flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-500 dark:text-slate-400">连续打卡</h2>
      <span
        v-if="info.goalReached"
        class="rounded-full bg-[var(--el-color-primary-light-9)] px-2 py-0.5 text-[11px] font-medium text-[var(--el-color-primary)]"
        data-testid="streak-goal-reached"
      >
        达标 🎉
      </span>
    </header>

    <!--
      主指标：连续天数。火焰只是点缀，数据本身用 tabular-nums 防抖。
      纵向用 `my-auto` 吸收卡片被同排邻居撑高的那部分——否则多余的高度会全堆在底部，
      卡片看起来像是「内容没写完」。
    -->
    <div class="my-auto pt-4">
      <div class="flex items-baseline gap-2">
        <span class="text-2xl leading-none" aria-hidden="true">🔥</span>
        <p
          class="text-3xl font-bold tabular-nums tracking-tight text-slate-800 dark:text-slate-100"
          data-testid="streak-current"
        >
          连续 {{ info.current }} 天
        </p>
      </div>

      <p
        class="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400"
        data-testid="streak-summary"
      >
        本周完成
        <span class="font-medium text-slate-700 dark:text-slate-200">{{ info.weekCompleted }}</span>
        个
        <!-- 近 90 天一条记录都没有时不硬凑一个「最佳日」出来 -->
        <template v-if="info.bestWeekday"> · 最佳日{{ info.bestWeekday }}</template>
        <template v-else> · 近 90 天暂无记录</template>
      </p>
      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
        近 90 天最长连续 <span class="font-medium tabular-nums">{{ info.best }}</span> 天
      </p>
    </div>

    <!--
      周目标：进度条 + 目标值就地可改。
      原来这里同时有「本周进度 5 / 12 个」和右上角的「42%」，加上输入框里的 12，同一个数字出现三次；
      现在只留一条：左边是「本周完成 N 个」，右边是进度百分比，目标值就是那个输入框本身。
    -->
    <div class="mt-4">
      <div class="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <label class="flex items-center gap-1 text-slate-500 dark:text-slate-400">
          本周目标
          <input
            v-model="goalInput"
            data-testid="streak-goal-input"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            aria-label="本周目标（个）"
            class="w-12 rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-center text-xs tabular-nums text-slate-700 outline-none transition-colors focus:border-[var(--el-color-primary)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          />
          个
        </label>
        <span class="tabular-nums text-slate-500 dark:text-slate-400" data-testid="streak-rate"
          >{{ info.weekRate }}%</span
        >
      </div>

      <div
        class="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        :aria-valuenow="info.weekRate"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`本周目标完成 ${info.weekRate}%`"
      >
        <div
          data-testid="streak-progress-bar"
          class="h-full rounded-full bg-[var(--el-color-primary)] transition-all duration-500 ease-out"
          :style="{ width: progressWidth }"
        ></div>
      </div>
    </div>
  </section>
</template>
