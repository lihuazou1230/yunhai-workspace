<script setup lang="ts">
/**
 * 分子组件：统计时间范围切换（本周 / 本月 / 全部）。
 *
 * 用按钮组而不是 el-radio-group：三个短选项、要的就是「一眼看出当前选中」，
 * 自绘 pill 用主题色浅底（与侧边栏激活态同一套视觉语言），也省掉一个 Element 组件的引入。
 */

import { STATS_RANGES, STATS_RANGE_LABEL } from '@/types/statistics'
import type { StatsRange } from '@/types/statistics'

const props = defineProps<{ modelValue: StatsRange }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: StatsRange): void }>()

const ACTIVE_CLASS =
  'bg-[var(--el-color-primary-light-9)] font-medium text-[var(--el-color-primary-dark-2)]'
const IDLE_CLASS = 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
</script>

<template>
  <div
    role="group"
    aria-label="统计时间范围"
    class="inline-flex items-center gap-1 rounded-xl bg-slate-100/70 p-1 dark:bg-slate-800/70"
  >
    <button
      v-for="range in STATS_RANGES"
      :key="range"
      type="button"
      :data-testid="`stats-range-${range}`"
      :aria-pressed="props.modelValue === range"
      class="rounded-lg px-3 py-1.5 text-xs transition-colors"
      :class="props.modelValue === range ? ACTIVE_CLASS : IDLE_CLASS"
      @click="emit('update:modelValue', range)"
    >
      {{ STATS_RANGE_LABEL[range] }}
    </button>
  </div>
</template>
