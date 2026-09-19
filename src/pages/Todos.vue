<script setup lang="ts">
/**
 * 页面：任务（任务管理主战场）
 *
 * 长列表独立成页，不干扰首页；筛选条件、搜索词、滚动位置由 Pinia + keep-alive 保留，
 * 所以从仪表板切过来再切回去，条件不会丢。
 *
 * 自然语言添加任务已并入「知识库」页的 agent（工具回环里的 `task_crud(create)`），
 * 所以这一页只留手动表单：不再需要用户自备 API Key（BYOK 那条线已撤）。
 */

import PageHeader from '@/components/organisms/PageHeader.vue'
import TodoForm from '@/components/organisms/TodoForm.vue'
import TodoList from '@/components/organisms/TodoList.vue'
import { useTodoStore } from '@/stores/todoStore'

const store = useTodoStore()

function handleCreate(payload: Parameters<typeof store.addTodo>[0]) {
  store.addTodo(payload)
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="任务" subtitle="新建、筛选、子任务、批量操作与拖拽排序都在这一页" />

    <section class="card p-5" aria-label="新建任务">
      <TodoForm @create="handleCreate" />
    </section>

    <!-- 任务列表 -->
    <TodoList />
  </div>
</template>
