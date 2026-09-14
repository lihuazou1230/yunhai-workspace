<script setup lang="ts">
/**
 * 有机体组件：页面头部（各页共用）
 *
 * 抽出来的原因：5 个页面各写一遍 `<h1 class="text-xl font-bold tracking-tight …">`
 * 加一行副标题，靠复制粘贴保持一致——只要有一处改了字号或颜色，站内就会出现
 * 两套「页面标题」，而这类不一致恰恰是最容易被眼睛抓到、又最难自查的。
 *
 * 三个刻意的取舍：
 * - **不在标题上方加任何形式的「眉标」**（如「今日概览」）：标题自己会说话，
 *   多一行小字只会把视觉重量从真正的标题上分走；分区感交给卡片标题去承担
 * - 标题里的装饰性 emoji 不鼓励：emoji 是彩色位图，不跟主题色，放在 h1 里
 *   会和旁边的主色强调互相打架（要图标请传 `#icon` 插槽，用自绘 SVG）
 * - 副标题限一行 `truncate`：中文长句会把右侧操作区挤掉，宁可截断也不换行挤压布局
 */

withDefaults(
  defineProps<{
    /** 页面标题 */
    title: string
    /** 副标题（一句话说清这一页能做什么；不传则不渲染） */
    subtitle?: string
  }>(),
  { subtitle: '' },
)
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
    <div class="min-w-0">
      <h1
        class="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100"
      >
        <slot name="icon" />
        <span class="truncate">{{ title }}</span>
      </h1>
      <p
        v-if="subtitle"
        class="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-slate-500 dark:text-slate-400"
      >
        {{ subtitle }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
