<script setup lang="ts">
/**
 * 分子组件：图表空状态占位。
 *
 * 为什么统一抽一个：第八阶段四张新图 + 年度报告都要求「空数据必须有占位」，
 * 各写一遍就会出现四种深浅不一的"暂无数据"。这里保持同一个虚线框 + 一句
 * **明确告诉用户怎么才有数据**的文案（比"暂无数据"有用得多）。
 */

withDefaults(
  defineProps<{
    /** 说明文案 */
    text?: string
    /** 图标（emoji） */
    icon?: string
  }>(),
  { text: '暂无数据', icon: '📭' },
)
</script>

<template>
  <div
    class="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 px-6 text-center dark:border-slate-700"
  >
    <span class="text-2xl" aria-hidden="true">{{ icon }}</span>
    <p class="max-w-xs text-xs leading-relaxed text-slate-400 dark:text-slate-500">
      <slot>{{ text }}</slot>
    </p>
  </div>
</template>
