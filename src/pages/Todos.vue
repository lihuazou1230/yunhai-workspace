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

    <!--
      新建区：「AI 智能添加」与手动表单是**同一件事的两种入口**（一句话描述 vs 逐字段填），
      所以合成一张卡：上半句自然语言、下半句手动表单，中间一条极浅分割线。
      拆成两张同尺寸卡片时，用户会先看到两个几乎一样的输入框，第一反应是「我要填哪个」。
    -->
    <section class="card divide-y divide-slate-100 p-5 dark:divide-slate-800" aria-label="新建任务">
      <AiTodoInput class="pb-5" @create="handleCreate" />
      <TodoForm class="pt-5" @create="handleCreate" />
    </section>

    <!-- 任务列表 -->
    <TodoList />
  </div>
</template>
