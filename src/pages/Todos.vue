<script setup lang="ts">
/**
 * 页面：任务（任务管理主战场）
 *
 * 长列表独立成页，不干扰首页；筛选条件、搜索词、滚动位置由 Pinia + keep-alive 保留，
 * 所以从仪表板切过来再切回去，条件不会丢。
 *
 * 第六阶段 6.3：新建区上方加「AI 智能添加」入口（自然语言 → 预览确认 → 入库），
 * 未配置 Key 时只留一行去设置的引导。
 */

import AiTodoInput from '@/components/organisms/AiTodoInput.vue'
import TodoForm from '@/components/organisms/TodoForm.vue'
import TodoList from '@/components/organisms/TodoList.vue'
import { useTodoStore } from '@/stores/todoStore'

const store = useTodoStore()

function handleCreate(payload: Parameters<typeof store.addTodo>[0]) {
  store.addTodo(payload)
}
</script>

<template>
  <div class="space-y-5">
    <header>
      <h1 class="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">✅ 任务</h1>
      <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
        新建、筛选、搜索、子任务、批量操作与拖拽排序都在这一页
      </p>
    </header>

    <!-- AI 智能添加（自然语言 → 预览卡片 → 确认入库） -->
    <section class="card p-5" aria-label="AI 智能添加">
      <AiTodoInput @create="handleCreate" />
    </section>

    <!-- 新建任务 -->
    <section class="card p-5">
      <TodoForm @create="handleCreate" />
    </section>

    <!-- 任务列表 -->
    <TodoList />
  </div>
</template>
