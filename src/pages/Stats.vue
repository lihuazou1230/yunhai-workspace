<script setup lang="ts">
/**
 * 页面：统计（可视化集中展示）
 * 优先级分布饼图 + 近 30 天完成趋势圆角柱状图 + 近 90 天生产力热力图
 */

import ProductivityHeatmap from '@/components/organisms/ProductivityHeatmap.vue'
import StatisticsCard from '@/components/organisms/StatisticsCard.vue'
</script>

<template>
  <div class="space-y-5">
    <header>
      <h1 class="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">📊 统计</h1>
      <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
        优先级分布、完成趋势与近 90 天生产力热力图（随任务数据实时更新）
      </p>
    </header>

    <div class="grid gap-4 xl:grid-cols-2">
      <StatisticsCard />
      <ProductivityHeatmap />
    </div>
  </div>
</template>
