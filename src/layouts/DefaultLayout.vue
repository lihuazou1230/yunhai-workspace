<script setup lang="ts">
/**
 * 布局组件：默认布局（桌面端侧边栏 + 顶栏 + 内容区 + 移动端底部导航）
 *
 * 结构（对应规划里的布局图）：
 * ┌──────────┬──────────────────────────────────┐
 * │ Sidebar  │ 顶栏: 🔍 聚合搜索   🌙 主题  ⚙ 设置 │
 * │ 👤 头像   ├──────────────────────────────────┤
 * │ 4 导航项  │        <router-view>             │
 * │ 🚪 退出   │   （keep-alive 保留各页状态）        │
 * └──────────┴──────────────────────────────────┘
 *
 * 三个实现要点：
 * - 顶栏搜索直接绑 todoStore.keyword：任务搜索全局可达，不用先进任务页
 * - 第六阶段 6.4 把顶栏搜索升级为**聚合搜索**：就地出任务结果 + 一键跳搜索引擎。
 *   因此去掉了原来「一输入就跳任务页」的行为——那不是用户要的（正打字就被搬走），
 *   而是当时「留在仪表板看不到结果」的权宜之计；有了结果弹层，问题从根上解决了
 * - 第六阶段 6.5 顶栏加**提醒铃铛**（应用内兜底），并让 `document.title` 带上待处理条数：
 *   标题是「切到别的标签页时唯一还看得见」的字样，所以它才是提醒的最后一层
 * - router-view 外套 keep-alive：切走再切回任务页，筛选条件与滚动位置都还在
 */

import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ThemeToggle from '@/components/molecules/ThemeToggle.vue'
import UiIcon from '@/components/atoms/UiIcon.vue'
import AggregateSearch from '@/components/molecules/AggregateSearch.vue'
import ReminderBell from '@/components/molecules/ReminderBell.vue'
import MobileBottomNav from '@/components/organisms/MobileBottomNav.vue'
import SidebarNav from '@/components/organisms/SidebarNav.vue'
import { useLocalStorage } from '@/composables/useLocalStorage'
import { useSyncedStorage } from '@/composables/useSyncedStorage'
import { useReminder } from '@/composables/useReminder'
import { matchesKeyword } from '@/composables/useTodoFilter'
import { useTodoStore } from '@/stores/todoStore'
import { SEARCH_ENGINE_KEY, SEARCH_RESULT_LIMIT } from '@/types/search'
import type { SearchEngineId } from '@/types/search'
import { safeSearchEngine } from '@/utils/searchEngine'
import { isTauri, shouldShowBottomNav } from '@/utils/platform'

/** 侧边栏折叠状态（本地记忆） */
const SIDEBAR_COLLAPSED_KEY = 'smart-workspace:sidebar-collapsed'

/**
 * 桌面版默认收起成「纯图标活动栏」（VS Code Activity Bar 风格）：
 * 桌面窗口最窄也有 900px，紧凑一点信息密度更高；点一下即可展开，选择会被记住。
 * 浏览器版维持展开（平板上把它当主入口用）。
 */
const collapsed = useLocalStorage(SIDEBAR_COLLAPSED_KEY, isTauri())
const route = useRoute()
const router = useRouter()
const todoStore = useTodoStore()

/** 桌面版不渲染移动端底部导航（窗口最窄 900px，底部导航既占地方又「移动端感」十足） */
const showBottomNav = shouldShowBottomNav()

/** 搜索引擎选择（第九阶段起跟账号走；脏值收敛为百度） */
const engineStored = useSyncedStorage<string>(SEARCH_ENGINE_KEY, 'baidu')
const engine = computed<SearchEngineId>(() => safeSearchEngine(engineStored.value))

const pageTitle = computed(() => route.meta.title ?? '仪表板')

/** 顶栏弹层里的任务结果：按关键字过滤，只取前几条（再多就该去任务页了） */
const searchResults = computed(() => {
  const keyword = todoStore.keyword
  if (!keyword.trim()) return []
  return todoStore.visibleTodos
    .filter((t) => matchesKeyword(t, keyword))
    .slice(0, SEARCH_RESULT_LIMIT)
})

/**
 * 选中某条任务：跳到任务页去看它。
 * 关键字已经在 store 里，任务页的列表会自带同样的过滤条件，所以直接切页即可。
 */
function onSelectTodo() {
  if (route.name !== 'todos') void router.push({ name: 'todos' })
}

// ---- 提醒（第六阶段 6.5）：应用内兜底 + 标题计数 ----
const {
  pending: pendingReminders,
  missed: missedReminders,
  pendingCount,
  dismiss,
  clearMissed,
} = useReminder({
  // 必须传**含归档**的列表：liveTodos 只排除「软删除中」的，不含归档/筛选口径。
  // - 归档任务不会提醒：collectDueReminders 自己会跳过 archived
  // - 但它的「已通知」标记要留着：传 visibleTodos（排除归档）时，归档任务的标记会被
  //   当成「任务已不存在」清掉，用户取消归档后又会重新响一遍（最多两次）
  todos: () => todoStore.liveTodos,
  onOpenTodo: openTodo,
  onWxPusherError: (message) => ElMessage.warning(message),
})

/**
 * 跳到某条任务：带上 focus 查询参数，任务页会把它高亮出来。
 * 关键字清掉——否则列表可能正好把这条过滤没了，用户会觉得"点了没反应"。
 */
function openTodo(todoId: string) {
  todoStore.setKeyword('')
  void router.push({ name: 'todos', query: { focus: todoId } })
}

/**
 * 标题带待办计数。
 * 路由的 afterEach 也会写标题，但两者都从 `route.meta.title` 推导，所以这里再写一次
 * 只是把计数前缀补上（最终状态一致，不会互相打脸）。
 */
watch(
  [pendingCount, pageTitle],
  ([count, title]) => {
    if (typeof document === 'undefined') return
    const base = title ? `${title} · 云海工作台` : '云海工作台'
    document.title = count > 0 ? `(${count}) 待办 · ${base}` : base
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex min-h-screen">
    <SidebarNav :collapsed="collapsed" @toggle-collapse="collapsed = !collapsed" />

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 顶栏 -->
      <header
        class="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 py-2.5 backdrop-blur-md sm:px-6 dark:border-slate-800 dark:bg-slate-900/80"
      >
        <div class="w-full max-w-md">
          <AggregateSearch
            v-model="todoStore.keyword"
            :results="searchResults"
            :engine="engine"
            @update:engine="engineStored = $event"
            @select-todo="onSelectTodo"
          />
        </div>
        <!--
          当前页名：侧边栏已经高亮了所在分区，这里只需一行小字做定位，
          不必再抢视觉重量（页内 h1 才是这一屏的标题）。
        -->
        <h1 class="ml-auto hidden text-sm font-medium text-slate-500 sm:block dark:text-slate-400">
          {{ pageTitle }}
        </h1>
        <!-- 顶栏右侧：提醒铃铛 + 主题切换 + 设置入口（视觉规范：搜索居左，右侧为图标区） -->
        <div class="flex shrink-0 items-center gap-1.5">
          <ReminderBell
            :reminders="pendingReminders"
            :missed="missedReminders"
            @dismiss="dismiss"
            @clear-missed="clearMissed"
            @open-todo="openTodo"
          />
          <ThemeToggle />
          <router-link
            :to="{ name: 'settings' }"
            data-testid="header-settings"
            class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/60 text-slate-600 transition-colors hover:border-[var(--el-color-primary-light-5)] hover:text-[var(--el-color-primary)] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
            title="设置"
            aria-label="设置"
          >
            <!-- 自绘齿轮：顶栏三个控件统一 1.6px 描边 / 圆角端点，emoji 在这个尺寸下会显脏 -->
            <UiIcon name="settings" class="h-[18px] w-[18px]" />
          </router-link>
        </div>
      </header>

      <!-- 内容区：keep-alive 保留各页状态（筛选条件、滚动位置） -->
      <main class="flex-1 px-4 py-6 pb-28 sm:px-6 sm:py-8 lg:pb-12">
        <router-view v-slot="{ Component }">
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>

      <MobileBottomNav v-if="showBottomNav" />
    </div>
  </div>
</template>
