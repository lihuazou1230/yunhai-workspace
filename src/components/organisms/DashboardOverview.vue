<script setup lang="ts">
/**
 * 有机体组件：任务概览（仪表板卡片）
 *
 * 三个数字徽章 + 一句引导，回答「我总共攒了多少事、还剩多少没干」。
 * 数据全部来自 todoStore 的现成 getters（已排除归档与软删除中的任务）。
 */

import BaseBadge from '@/components/atoms/BaseBadge.vue'
import { useTodoStore } from '@/stores/todoStore'

const store = useTodoStore()
</script>

<template>
  <section class="card flex h-full flex-col gap-3 p-5" aria-label="任务概览">
    <h2 class="text-sm font-semibold text-slate-500 dark:text-slate-400">任务概览</h2>

    <div class="flex flex-wrap gap-2">
      <BaseBadge tone="info" size="sm">全部 {{ store.totalCount }}</BaseBadge>
      <BaseBadge tone="warning" size="sm">进行中 {{ store.activeCount }}</BaseBadge>
      <BaseBadge tone="success" size="sm">已完成 {{ store.completedCount }}</BaseBadge>
      <BaseBadge v-if="store.archivedCount > 0" size="sm"
        >已归档 {{ store.archivedCount }}</BaseBadge
      >
    </div>

    <p class="text-xs text-slate-400 dark:text-slate-500">
      全部任务按优先级与截止日期排序，去「任务」页可筛选、搜索与批量操作。
    </p>

    <router-link
      :to="{ name: 'todos' }"
      data-testid="dashboard-goto-todos"
      class="mt-auto text-sm font-medium text-[var(--el-color-primary)] underline-offset-2 hover:underline"
    >
      查看全部任务 →
    </router-link>
  </section>
</template>
