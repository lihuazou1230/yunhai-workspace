<script setup lang="ts">
/**
 * 有机体组件：今日聚焦（My Day）
 * - 汇聚「置顶」+「今日到期」的任务单独成列
 * - 复用 TodoItem：完成/置顶/子任务
 */

import { useTagStore } from '@/stores/tagStore'
import { useTodoStore } from '@/stores/todoStore'
import TodoItem from '@/components/molecules/TodoItem.vue'

const store = useTodoStore()
const tagStore = useTagStore()

/** 任务行的标签解析（与 TodoList 同一套做法：分子层不碰 store） */
function tagsOf(todo: { tags: string[] }) {
  return tagStore.getTags(todo.tags)
}

function toggle(id: string) {
  store.toggleComplete(id)
}

function onTogglePin(id: string) {
  store.togglePinned(id)
}

function onArchive(id: string) {
  store.archive(id)
}

/** 推后到期日（天数由 TodoItem 的菜单给出） */
function onPostpone(id: string, days: number) {
  store.postpone(id, days)
}

function onToggleSubtask(todoId: string, subtaskId: string) {
  store.toggleSubtask(todoId, subtaskId)
}

function onAddSubtask(todoId: string, title: string) {
  store.addSubtask(todoId, title)
}

function onRemoveSubtask(todoId: string, subtaskId: string) {
  store.removeSubtask(todoId, subtaskId)
}
</script>

<template>
  <section class="card p-5" aria-label="今日聚焦">
    <header class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">🎯 今日聚焦</h2>
      <span class="text-xs text-slate-500 dark:text-slate-400"
        >{{ store.myDayTodos.length }} 项</span
      >
    </header>

    <ul v-if="store.myDayTodos.length > 0" class="space-y-2">
      <TodoItem
        v-for="todo in store.myDayTodos"
        :key="todo.id"
        :todo="todo"
        show-due
        :todo-tags="tagsOf(todo)"
        @toggle="toggle"
        @toggle-pin="onTogglePin"
        @toggle-subtask="onToggleSubtask"
        @add-subtask="onAddSubtask"
        @remove-subtask="onRemoveSubtask"
        @archive="onArchive"
        @postpone="onPostpone"
      />
    </ul>

    <div
      v-else
      class="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400 dark:border-slate-600 dark:text-slate-500"
    >
      暂无今日聚焦任务<br />
      <span class="text-xs">将任务「置顶」或设置为今天到期，即可加入这里</span>
    </div>
  </section>
</template>
