<script setup lang="ts">
/**
 * 有机体组件：任务列表（连接 todoStore）
 * - 筛选 tab（全部/进行中/已完成/今日）+ 搜索
 * - 空状态 / 计数
 * - 1 分钟内可撤销的删除 Toast（展示剩余秒数，可点击恢复）
 * - **拖拽排序走 SortableJS（VueUse `useSortable`）**：同一套方案也用于仪表板卡片排序
 */

import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useSortable } from '@vueuse/integrations/useSortable'
import type { SortableEvent } from 'sortablejs'

import type { TodoFilter, TodoListView, TodoPriority } from '@/types/todo'
import { useTagStore } from '@/stores/tagStore'
import { useTodoStore } from '@/stores/todoStore'
import { PRIORITY_ORDER } from '@/utils/priorityHelper'
import { priorityLabel } from '@/utils/priorityHelper'
import { resolveSortMove } from '@/utils/sortableMove'
import { formatShortDate } from '@/utils/dateFormatter'
import { flipMove } from '@/utils/flipMove'
import SearchBar from '@/components/molecules/SearchBar.vue'
import TodoItem from '@/components/molecules/TodoItem.vue'
import BaseButton from '@/components/atoms/BaseButton.vue'

const store = useTodoStore()

/**
 * 用户是否正在用筛选/搜索条件。
 *
 * 决定空状态该说「还没有任务」还是「没有符合条件的」：明明有任务、只是被筛掉了，
 * 却提示「🎉 暂无任务，添加一个开始吧」，等于谎报数据丢失，
 * 很容易让人重复录入或以为任务没了。
 */
const hasFilterCriteria = computed(
  () =>
    store.keyword.trim() !== '' ||
    store.priority.length > 0 ||
    store.tagFilter.length > 0 ||
    store.filter !== 'active',
)
const tagStore = useTagStore()
const route = useRoute()

/** 任务行的标签解析（分子层不碰 store，标签在这里解析好传下去） */
function tagsOf(todo: { tags: string[] }) {
  return tagStore.getTags(todo.tags)
}

/** 视图切换项（主列表 / 已归档） */
const viewTabs = computed<Array<{ key: TodoListView; label: string }>>(() => [
  { key: 'main', label: '任务' },
  { key: 'archived', label: `已归档 ${store.archivedCount}` },
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

const filterLabel = computed(() => {
  if (store.filter === 'date') {
    return store.filterDate ? `${formatShortDate(store.filterDate)}（选中日期）` : '指定日期'
  }
  return FILTER_TABS.find((t) => t.key === store.filter)?.label ?? '全部'
})

/**
 * 筛选 tab 列表：`date` 是「迷你月历点进来的临时视图」，不是常驻 tab，
 * 所以只在它真的生效时才插进来——否则会多出一个平时点不到、含义又说不清的按钮。
 */
const filterTabs = computed<Array<{ key: TodoFilter; label: string }>>(() => {
  if (store.filter !== 'date' || !store.filterDate) return FILTER_TABS
  return [...FILTER_TABS, { key: 'date', label: formatShortDate(store.filterDate) }]
})

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
  if (store.pendingDeletes.length === 0) {
    stopTicker()
    return
  }
  // 倒计时跟随**最早到期**的那一条：批量删除时各条到期时刻不同，
  // 只跟队尾会让用户以为"还有时间"，而最早那条其实已经被真删了
  const earliest = Math.min(...store.pendingDeletes.map((p) => p.expiresAt))
  startTicker(earliest)
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

/**
 * 置顶（今日聚焦）。
 *
 * 走 FLIP：置顶会把这一行重排到列表最前，直接改 store 的话视觉上是"突然出现在上方"。
 * `flipMove` 会先记下它当前的位置、等 DOM 更新后再从原位置补一段位移动画过去。
 * 取消置顶时该行会往下走，同样适用（位置差为负，方向自然反过来）。
 */
function onTogglePin(id: string) {
  void flipMove(`[data-testid="todo-item-${id}"]`, () => store.togglePinned(id), nextTick)
}

/** 多选 */
function onToggleSelect(id: string) {
  store.toggleSelect(id)
}

const selectedCount = computed(() => store.selectedIds.length)

// ---- 标签 / 归档 / 推后（第六阶段 6.1） ----

/** 归档一条任务 */
function onArchive(id: string) {
  store.archive(id)
}

/** 取消归档 */
function onUnarchive(id: string) {
  store.unarchive(id)
}

/** 推后到期日（天数由子组件给出，日期规则在 store 的纯函数里） */
function onPostpone(id: string, days: number) {
  store.postpone(id, days)
}

/** 彻底删除（复用软删除 + 撤销保护） */
function onPurge(id: string) {
  store.removeTodo(id)
  onPendingChange()
}

// ---- 从提醒通知跳过来：高亮并滚动到那条任务（第六阶段 6.5） ----
// 通知点击后由 DefaultLayout 跳到 /todos?focus=<id>；这里消费这个参数。
// 用查询参数而不是 store 状态：刷新/分享链接也能复现同一个定位。
const focusId = ref<string | null>(null)

watch(
  () => route.query.focus,
  (value) => {
    focusId.value = typeof value === 'string' && value ? value : null
  },
  { immediate: true },
)

/**
 * 定位到目标任务。
 *
 * 一律把筛选放宽到「全部」并清掉关键字：点提醒通知的意图就是「带我去看这条」，
 * 如果目标恰好被当前筛选挡住（最常见的是「进行中」筛选 + 一条已完成的任务），
 * 用户会以为点了没反应。宁可多切一次筛选，也不要让定位落空。
 */
watch(
  focusId,
  async (id) => {
    if (!id) return

    store.setFilter('all')
    store.setKeyword('')
    await nextTick()

    listRef.value?.querySelector<HTMLElement>(`[data-testid="todo-item-${id}"]`)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  },
  { immediate: true },
)

/** 批量归档当前选中的任务 */
function batchArchive() {
  store.bulkArchive(store.selectedIds)
}

/** 批量推后到期日 1 天（多选场景下最常用的粒度） */
function batchPostpone() {
  store.bulkPostpone(store.selectedIds, 1)
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
  /**
   * 同仪表板卡片：**必须走 SortableJS 自己的 fallback 拖拽**。
   * Tauri 窗口默认开着系统级 drag-drop（`dragDropEnabled: true`），Windows 上前端原生 HTML5 拖放会被它吃掉，
   * 而 SortableJS 在 Chromium 下默认依赖原生拖放 —— 表现就是网页里能拖、桌面窗口里拖不动。
   * fallback 只用指针事件，不产生原生拖放会话；细节与实测结论见 Dashboard.vue 里同一处注释。
   */
  forceFallback: true,
  fallbackOnBody: true,
  /**
   * `watchElement`：列表是 v-if 渲染的（没任务时根本没有 <ul>）。
   * 默认只在挂载那一刻建实例，空列表进页面后再新建任务，拖拽就永远不会初始化——
   * 打开 watchElement 后元素出现/消失会自动重挂（原实现漏了这个边界）。
   */
  watchElement: true,
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
  const queue = [...store.pendingDeletes]
  if (queue.length === 0) return

  // 一次撤销**全部**：批量删除会把 N 条一起塞进队列，只恢复队尾那一条的话，
  // 其余几条会在 60 秒后静默真删，用户再没有入口能救回来。
  store.undoAllDeletes()
  // 多条同时滑入会很吵，动画只跟随最后删除的那条（也就是撤销条上显示的那条）
  revealId.value = queue[queue.length - 1].todo.id
  setTimeout(() => {
    revealId.value = null
  }, 700)
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
  <section class="space-y-4">
    <!--
      工具栏分三层，按「用户此刻在回答哪个问题」排：
      1. 看哪个列表（任务 / 已归档）——切换视图，属于导航级
      2. 看哪些状态的（全部 / 进行中 / 已完成 / 今日 / 本周）——主筛选，最常用
      3. 更细的收窄（优先级 / 标签）+ 搜索与多选——次要，视觉上压一级

      之前这四行用的是同一个 `BaseButton secondary`，四行长得一模一样，
      既分不出主次，也看不出点哪行会发生什么（改的是视图、筛选还是搜索）。
    -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <!-- 视图切换：分段控件（等同 tablist），与筛选 chip 在形态上明确区分 -->
      <div
        class="flex w-full gap-1 rounded-xl bg-slate-100 p-1 sm:w-auto dark:bg-slate-800/70"
        role="tablist"
        aria-label="任务视图"
      >
        <button
          v-for="tab in viewTabs"
          :key="tab.key"
          type="button"
          role="tab"
          :aria-selected="store.listView === tab.key"
          class="min-h-[36px] flex-1 rounded-lg px-3 text-xs font-medium transition-colors sm:flex-none"
          :class="
            store.listView === tab.key
              ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          "
          :data-testid="`todos-view-${tab.key}`"
          @click="store.setListView(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <!--
        窄屏把所有工具压在一行会互相挤（搜索框被压到只剩几十像素），
        所以 <sm 拆两行、sm 起合成一行；顺序上搜索永远紧跟视图切换。
      -->
      <div class="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        <div class="min-w-[9rem] flex-1 sm:w-56 sm:flex-none">
          <SearchBar v-model="store.keyword" />
        </div>

        <BaseButton
          v-if="store.listView === 'main' && store.completedCount > 0"
          size="sm"
          variant="ghost"
          class="text-slate-500 dark:text-slate-400"
          data-testid="todos-archive-completed"
          @click="archiveAllCompleted"
        >
          归档所有已完成
        </BaseButton>

        <BaseButton
          size="sm"
          :variant="store.selectionMode ? 'primary' : 'ghost'"
          class="text-slate-500 dark:text-slate-400"
          @click="store.toggleSelectionMode()"
        >
          {{ store.selectionMode ? '退出多选' : '多选' }}
        </BaseButton>
      </div>
    </div>

    <!-- 完成状态筛选只在主列表有意义（归档视图看的是生命周期状态） -->
    <div
      v-if="store.listView === 'main'"
      class="flex flex-wrap items-center gap-1"
      role="tablist"
      aria-label="任务筛选"
    >
      <BaseButton
        v-for="tab in filterTabs"
        :key="tab.key"
        size="sm"
        :variant="store.filter === tab.key ? 'primary' : 'secondary'"
        @click="store.setFilter(tab.key)"
      >
        {{ tab.label }}
      </BaseButton>
    </div>
    <p v-else class="text-[13px] font-medium text-slate-600 dark:text-slate-300">已归档任务</p>

    <!--
      细分筛选：标签文字用 --app-label-w 固定宽度，
      四行/两行的标签左边缘因此对齐（标签宽度不一致时，chip 会各自起跳，整块看起来是散的）。
    -->
    <div class="space-y-2">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span class="w-10 shrink-0 text-xs text-slate-500 dark:text-slate-400">优先级</span>
        <div class="flex flex-wrap gap-1" role="group" aria-label="优先级筛选">
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

      <div
        v-if="tagStore.tagCount > 0"
        class="flex flex-wrap items-center gap-x-2 gap-y-2"
        data-testid="todos-tag-filter"
      >
        <span class="w-10 shrink-0 text-xs text-slate-500 dark:text-slate-400">标签</span>
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
        <!-- 视图相关批量动作：主列表才有（归档视图看的是生命周期，不提供批量改期） -->
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
          v-if="store.listView === 'main'"
          size="sm"
          variant="secondary"
          data-testid="batch-postpone"
          @click="batchPostpone"
        >
          推后 1 天
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
        <!-- 批量删除时要说清"删了几条"：只说一条会让用户以为其余的已经撤销了 -->
        <template v-if="store.pendingDeletes.length > 1">
          已删除 {{ store.pendingDeletes.length }} 项
        </template>
        <template v-else>已删除「{{ store.latestPendingDelete.todo.title }}」</template>
        <span class="text-xs opacity-70">（{{ remainingSeconds }}s 后可撤销）</span>
      </span>
      <BaseButton size="sm" variant="secondary" @click="undo">撤销</BaseButton>
    </div>

    <!-- 计数：一行小字，和列表同属「当前筛选的结果」 -->
    <p class="pt-1 text-xs text-slate-500 dark:text-slate-400">
      {{ filterLabel }} · <span class="tabular-nums">{{ store.filteredTodos.length }} 项</span>
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
        :highlighted="todo.id === focusId"
        @toggle="toggle"
        @remove="remove"
        @toggle-subtask="onToggleSubtask"
        @add-subtask="onAddSubtask"
        @remove-subtask="onRemoveSubtask"
        @toggle-pin="onTogglePin"
        @toggle-select="onToggleSelect"
        @archive="onArchive"
        @unarchive="onUnarchive"
        @postpone="onPostpone"
        @purge="onPurge"
      />
    </ul>

    <!-- 空状态 -->
    <div
      v-else
      class="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 dark:border-slate-600 dark:text-slate-500"
      data-testid="todos-empty"
    >
      <template v-if="store.listView === 'archived'">📦 归档区是空的</template>
      <template v-else-if="hasFilterCriteria">🔍 没有符合当前条件的任务</template>
      <template v-else>🎉 暂无任务，添加一个开始吧</template>
    </div>
  </section>
</template>
