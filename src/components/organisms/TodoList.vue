<script setup lang="ts">
/**
 * 有机体组件：任务列表（连接 todoStore）
 * - 筛选 tab（全部/进行中/已完成/今日）+ 搜索
 * - 空状态 / 计数
 * - 1 分钟内可撤销的删除 Toast（展示剩余秒数，可点击恢复）
 * - **拖拽排序走 SortableJS（VueUse `useSortable`）**：同一套方案也用于仪表板卡片排序
 */

import { computed, onUnmounted, ref, watch } from 'vue'

import { useSortable } from '@vueuse/integrations/useSortable'
import type { SortableEvent } from 'sortablejs'

import type { TodoFilter, TodoListView, TodoPriority } from '@/types/todo'
import { useTagStore } from '@/stores/tagStore'
import { useTodoStore } from '@/stores/todoStore'
import { PRIORITY_ORDER } from '@/utils/priorityHelper'
import { priorityLabel } from '@/utils/priorityHelper'
import { resolveSortMove } from '@/utils/sortableMove'
import SearchBar from '@/components/molecules/SearchBar.vue'
import TodoItem from '@/components/molecules/TodoItem.vue'
import AiBreakdownDialog from '@/components/organisms/AiBreakdownDialog.vue'
import BaseButton from '@/components/atoms/BaseButton.vue'

const store = useTodoStore()
const tagStore = useTagStore()

/** 任务行的标签解析（分子层不碰 store，标签在这里解析好传下去） */
function tagsOf(todo: { tags: string[] }) {
  return tagStore.getTags(todo.tags)
}

/** 视图切换项（主列表 / 已归档 / 已隐藏） */
const viewTabs = computed<Array<{ key: TodoListView; label: string }>>(() => [
  { key: 'main', label: '任务' },
  { key: 'archived', label: `已归档 ${store.archivedCount}` },
  { key: 'snoozed', label: `已隐藏 ${store.snoozedCount}` },
])

const FILTER_TABS: Array<{ key: TodoFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'completed', label: '已完成' },
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
]

const PRIORITY_TABS: Array<{ key: TodoPriority; label: string }> = PRIORITY_ORDER.map((p) => ({
  key: p,
  label: priorityLabel(p),
}))

const filterLabel = computed(() => FILTER_TABS.find((t) => t.key === store.filter)?.label ?? '全部')

/** 撤销条剩余秒数展示（纯 UI，每秒刷新） */
const remainingSeconds = ref(0)
let ticker: ReturnType<typeof setInterval> | null = null

function startTicker(expiresAt: number) {
  stopTicker()
  const update = () => {
    remainingSeconds.value = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
  }
  update()
  ticker = setInterval(update, 200)
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

// 撤销条出现时启动倒计时，消失时停止
function onPendingChange() {
  if (store.latestPendingDelete) {
    startTicker(store.latestPendingDelete.expiresAt)
  } else {
    stopTicker()
  }
}

onUnmounted(stopTicker)

function toggle(id: string) {
  store.toggleComplete(id)
}

function remove(id: string) {
  store.removeTodo(id)
  onPendingChange()
}

/** 子任务 */
function onToggleSubtask(todoId: string, subtaskId: string) {
  store.toggleSubtask(todoId, subtaskId)
}

function onAddSubtask(todoId: string, title: string) {
  store.addSubtask(todoId, title)
}

function onRemoveSubtask(todoId: string, subtaskId: string) {
  store.removeSubtask(todoId, subtaskId)
}

/** 置顶（今日聚焦） */
function onTogglePin(id: string) {
  store.togglePinned(id)
}

/** 多选 */
function onToggleSelect(id: string) {
  store.toggleSelect(id)
}

const selectedCount = computed(() => store.selectedIds.length)

// ---- 标签 / 归档 / Snooze（第六阶段 6.1） ----

/** 归档一条任务 */
function onArchive(id: string) {
  store.archive(id)
}

/** 取消归档 */
function onUnarchive(id: string) {
  store.unarchive(id)
}

/** 稍后再做 */
function onSnooze(id: string, until: string) {
  store.snooze(id, until)
}

/** 立即召回 */
function onUnsnooze(id: string) {
  store.unsnooze(id)
}

/** 彻底删除（复用软删除 + 撤销保护） */
function onPurge(id: string) {
  store.removeTodo(id)
  onPendingChange()
}

// ---- AI 拆解（第六阶段 6.3） ----
/** 拆解弹窗的目标任务 id（null = 关闭） */
const breakdownTodoId = ref<string | null>(null)
const breakdownTodo = computed(
  () => store.todos.find((t) => t.id === breakdownTodoId.value) ?? null,
)
const breakdownOpen = computed({
  get: () => breakdownTodoId.value !== null,
  set: (value: boolean) => {
    if (!value) breakdownTodoId.value = null
  },
})

function onAiBreakdown(id: string) {
  breakdownTodoId.value = id
}

/** 确认写入子任务（用户已在预览里勾选/编辑/删减过） */
function onBreakdownConfirm(todoId: string, titles: string[]) {
  titles.forEach((title) => store.addSubtask(todoId, title))
}

/** 批量归档当前选中的任务 */
function batchArchive() {
  store.bulkArchive(store.selectedIds)
}

/** 批量召回（已隐藏视图） */
function batchUnsnooze() {
  store.bulkUnsnooze(store.selectedIds)
}

/** 一键归档所有已完成任务（归档视图与主列表都用得上） */
function archiveAllCompleted() {
  const ids = store.visibleTodos.filter((t) => t.status === 'completed').map((t) => t.id)
  if (ids.length > 0) store.bulkArchive(ids)
}

/**
 * 拖拽排序（SortableJS / VueUse useSortable）。
 *
 * 两处关键处理：
 * 1. **自己还原 DOM**：SortableJS 拖完会直接改动真实 DOM，而列表的真源是 store。
 *    若不还原，Vue 的 keyed diff 会基于「它以为的旧顺序」去打补丁，节点可能错乱。
 *    做法是先把被拖的节点插回原位，再改 store，让 Vue 从一致状态重排。
 * 2. **索引 → id 的换算**交给纯函数 `resolveSortMove`（可单测），组件里只做接线。
 */
const listRef = ref<HTMLElement | null>(null)

function onSortUpdate(evt: SortableEvent) {
  const move = resolveSortMove(store.filteredTodos, evt.oldIndex, evt.newIndex)

  // 还原 DOM 到拖拽前顺序（见上）
  const item = evt.item
  const from = evt.from
  if (item && from && item.parentNode === from) {
    from.removeChild(item)
    from.insertBefore(item, from.children[evt.oldIndex ?? 0] ?? null)
  }

  if (move) store.moveTodo(move.movedId, move.targetId)
}

// list 只作为「当前顺序」的引用传给 useSortable；真正的重排由 onUpdate 里改 store 完成
// （所以这里传只读的 computed 也不会触发它内部的默认数组改写逻辑）。
useSortable(listRef, store.filteredTodos, {
  animation: 150,
  // 只有把手可拖，避免与行内按钮/子任务输入框的点击冲突
  handle: '.drag-handle',
  ghostClass: 'sortable-ghost',
  onUpdate: onSortUpdate,
})

function batchComplete() {
  store.bulkSetStatus(store.selectedIds, true)
}

function batchActive() {
  store.bulkSetStatus(store.selectedIds, false)
}

function batchDelete() {
  store.bulkRemove(store.selectedIds)
  onPendingChange()
}

function batchSetPriority(p: TodoPriority) {
  store.bulkSetPriority(store.selectedIds, p)
}

/** 撤销恢复的任务 id（触发对应项从右滑入动画；短暂保持后清除） */
const revealId = ref<string | null>(null)

function undo() {
  const p = store.latestPendingDelete
  if (p) {
    store.undoDelete(p.todo.id)
    revealId.value = p.todo.id
    setTimeout(() => {
      revealId.value = null
    }, 700)
  }
  onPendingChange()
}

/** 新建任务 id（触发对应项从左滑入动画；只标记新增项，初始已存在的不触发） */
const enterLeftId = ref<string | null>(null)
const knownIds = new Set(store.todos.map((t) => t.id))
let enterTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => store.todos,
  (list) => {
    for (const t of list) {
      if (!knownIds.has(t.id)) {
        knownIds.add(t.id)
        enterLeftId.value = t.id
        if (enterTimer) clearTimeout(enterTimer)
        enterTimer = setTimeout(() => {
          enterLeftId.value = null
        }, 700)
        break
      }
    }
  },
  { immediate: false },
)
</script>

<template>
  <section class="space-y-3">
    <!-- 视图切换：主列表 / 已归档 / 已隐藏（不新开路由，就地过滤切换） -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex gap-1" role="tablist" aria-label="任务视图">
        <BaseButton
          v-for="tab in viewTabs"
          :key="tab.key"
          size="sm"
          :variant="store.listView === tab.key ? 'primary' : 'secondary'"
          :data-testid="`todos-view-${tab.key}`"
          @click="store.setListView(tab.key)"
        >
          {{ tab.label }}
        </BaseButton>
      </div>

      <BaseButton
        v-if="store.listView === 'main' && store.completedCount > 0"
        size="sm"
        variant="ghost"
        data-testid="todos-archive-completed"
        @click="archiveAllCompleted"
      >
        归档所有已完成
      </BaseButton>
    </div>

    <!-- 工具栏：筛选 + 搜索 -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <!-- 完成状态筛选只在主列表有意义（归档/已隐藏视图看的是生命周期状态） -->
      <div v-if="store.listView === 'main'" class="flex gap-1" role="tablist" aria-label="任务筛选">
        <BaseButton
          v-for="tab in FILTER_TABS"
          :key="tab.key"
          size="sm"
          :variant="store.filter === tab.key ? 'primary' : 'secondary'"
          @click="store.setFilter(tab.key)"
        >
          {{ tab.label }}
        </BaseButton>
      </div>
      <span v-else class="text-sm font-medium text-slate-500 dark:text-slate-400">
        {{ store.listView === 'archived' ? '📦 已归档任务' : '💤 已隐藏任务（稍后再做）' }}
      </span>
      <div class="flex items-center gap-2">
        <div class="w-56">
          <SearchBar v-model="store.keyword" />
        </div>
        <BaseButton
          size="sm"
          :variant="store.selectionMode ? 'primary' : 'secondary'"
          @click="store.toggleSelectionMode()"
        >
          {{ store.selectionMode ? '退出多选' : '多选' }}
        </BaseButton>
      </div>
    </div>

    <!-- 优先级筛选（多选：高/中/低可同时选中；三者全选自动回到全部） -->
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-slate-400 dark:text-slate-500">优先级</span>
      <div class="flex gap-1" role="group" aria-label="优先级筛选">
        <BaseButton
          size="sm"
          :variant="store.priority.length === 0 ? 'primary' : 'secondary'"
          @click="store.clearPriority()"
        >
          全部
        </BaseButton>
        <BaseButton
          v-for="t in PRIORITY_TABS"
          :key="t.key"
          size="sm"
          :variant="store.priority.includes(t.key) ? 'primary' : 'secondary'"
          @click="store.togglePriority(t.key)"
        >
          {{ t.label }}
        </BaseButton>
      </div>
    </div>

    <!-- 标签筛选（多选：命中任一标签即保留） -->
    <div
      v-if="tagStore.tagCount > 0"
      class="flex flex-wrap items-center gap-2"
      data-testid="todos-tag-filter"
    >
      <span class="text-xs text-slate-400 dark:text-slate-500">标签</span>
      <div class="flex flex-wrap gap-1" role="group" aria-label="标签筛选">
        <BaseButton
          size="sm"
          :variant="store.tagFilter.length === 0 ? 'primary' : 'secondary'"
          @click="store.clearTagFilter()"
        >
          全部
        </BaseButton>
        <BaseButton
          v-for="tag in tagStore.tags"
          :key="tag.id"
          size="sm"
          :variant="store.tagFilter.includes(tag.id) ? 'primary' : 'secondary'"
          :data-testid="`todos-tag-filter-${tag.id}`"
          @click="store.toggleTagFilter(tag.id)"
        >
          {{ tag.name }}
        </BaseButton>
      </div>
    </div>

    <!-- 批量操作栏（多选模式） -->
    <div
      v-if="store.selectionMode"
      class="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--el-color-primary-light-7)] bg-[var(--el-color-primary-light-9)] px-3 py-2"
    >
      <span class="text-sm text-[var(--el-color-primary-dark-2)]">已选 {{ selectedCount }} 项</span>
      <div class="flex flex-wrap gap-1">
        <BaseButton size="sm" variant="primary" @click="batchComplete">完成</BaseButton>
        <BaseButton size="sm" variant="secondary" @click="batchActive">取消完成</BaseButton>
        <BaseButton size="sm" variant="danger" @click="batchDelete">删除</BaseButton>
        <BaseButton size="sm" variant="secondary" @click="batchSetPriority('high')">高</BaseButton>
        <BaseButton size="sm" variant="secondary" @click="batchSetPriority('medium')"
          >中</BaseButton
        >
        <BaseButton size="sm" variant="secondary" @click="batchSetPriority('low')">低</BaseButton>
        <!-- 视图相关批量动作：主列表批量归档，已隐藏视图批量召回 -->
        <BaseButton
          v-if="store.listView === 'main'"
          size="sm"
          variant="secondary"
          data-testid="batch-archive"
          @click="batchArchive"
        >
          归档
        </BaseButton>
        <BaseButton
          v-else-if="store.listView === 'snoozed'"
          size="sm"
          variant="secondary"
          data-testid="batch-unsnooze"
          @click="batchUnsnooze"
        >
          召回
        </BaseButton>
      </div>
      <BaseButton size="sm" variant="ghost" class="ml-auto" @click="store.toggleSelectionMode()">
        取消
      </BaseButton>
    </div>

    <!-- 撤销删除 Toast（1 分钟内可撤销，展示剩余秒数） -->
    <div
      v-if="store.latestPendingDelete"
      class="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
      role="status"
    >
      <span class="flex-1">
        已删除「{{ store.latestPendingDelete.todo.title }}」
        <span class="text-xs opacity-70">（{{ remainingSeconds }}s 后可撤销）</span>
      </span>
      <BaseButton size="sm" variant="secondary" @click="undo">撤销</BaseButton>
    </div>

    <!-- 计数 -->
    <p class="text-xs text-slate-400 dark:text-slate-500">
      {{ filterLabel }} · {{ store.filteredTodos.length }} 项
    </p>

    <!-- 列表（SortableJS 接管拖拽排序，ref 挂载容器） -->
    <ul v-if="store.filteredTodos.length > 0" ref="listRef" class="space-y-2">
      <TodoItem
        v-for="todo in store.filteredTodos"
        :key="todo.id"
        :todo="todo"
        show-due
        :show-subtasks="!store.selectionMode"
        :selectable="store.selectionMode"
        :selected="store.selectedIds.includes(todo.id)"
        :complete-slide="store.filter === 'active' && store.listView === 'main'"
        :reveal-from-right="todo.id === revealId"
        :enter-from-left="todo.id === enterLeftId"
        :draggable="!store.selectionMode && store.listView === 'main'"
        :todo-tags="tagsOf(todo)"
        :view="store.listView"
        @toggle="toggle"
        @remove="remove"
        @toggle-subtask="onToggleSubtask"
        @add-subtask="onAddSubtask"
        @remove-subtask="onRemoveSubtask"
        @toggle-pin="onTogglePin"
        @toggle-select="onToggleSelect"
        @archive="onArchive"
        @unarchive="onUnarchive"
        @snooze="onSnooze"
        @unsnooze="onUnsnooze"
        @purge="onPurge"
        @ai-breakdown="onAiBreakdown"
      />
    </ul>

    <!-- 空状态 -->
    <div
      v-else
      class="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 dark:border-slate-600 dark:text-slate-500"
      data-testid="todos-empty"
    >
      <template v-if="store.listView === 'archived'">📦 归档区是空的</template>
      <template v-else-if="store.listView === 'snoozed'">💤 没有被藏起来的任务</template>
      <template v-else>🎉 暂无任务，添加一个开始吧</template>
    </div>

    <!-- AI 拆解弹窗（放在列表之外，避免被列表项的动画/拖拽容器影响） -->
    <AiBreakdownDialog
      v-model="breakdownOpen"
      :todo="breakdownTodo"
      @confirm="onBreakdownConfirm"
    />
  </section>
</template>
