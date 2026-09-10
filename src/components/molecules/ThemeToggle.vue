<script setup lang="ts">
/**
 * 分子组件：明暗模式切换按钮（跟随主题 Store）
 */

import { useTheme } from '@/composables/useTheme'

const { isDark, toggleDark } = useTheme()
</script>

<template>
  <button
    type="button"
    class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/60 text-slate-600 transition-colors hover:border-[var(--el-color-primary-light-5)] hover:text-[var(--el-color-primary)] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
    :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
    @click="toggleDark"
  >
    <!-- 深色：月亮 -->
    <svg v-if="isDark" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
    <!-- 浅色：太阳 -->
    <svg v-else class="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8" />
      <path
        d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  </button>
</template>
