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
 * 两个实现要点：
 * - 顶栏搜索直接绑 todoStore.keyword：任务搜索全局可达，不用先进任务页
 * - 第六阶段 6.4 把顶栏搜索升级为**聚合搜索**：就地出任务结果 + 一键跳搜索引擎。
 *   因此去掉了原来「一输入就跳任务页」的行为——那不是用户要的（正打字就被搬走），
 *   而是当时「留在仪表板看不到结果」的权宜之计；有了结果弹层，问题从根上解决了
 * - router-view 外套 keep-alive：切走再切回任务页，筛选条件与滚动位置都还在
 */

import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ThemeToggle from '@/components/molecules/ThemeToggle.vue'
import AggregateSearch from '@/components/molecules/AggregateSearch.vue'
import MobileBottomNav from '@/components/organisms/MobileBottomNav.vue'
import SidebarNav from '@/components/organisms/SidebarNav.vue'
import { useLocalStorage } from '@/composables/useLocalStorage'
import { matchesKeyword } from '@/composables/useTodoFilter'
import { useTodoStore } from '@/stores/todoStore'
import { SEARCH_ENGINE_KEY, SEARCH_RESULT_LIMIT } from '@/types/search'
import type { SearchEngineId } from '@/types/search'
import { safeSearchEngine } from '@/utils/searchEngine'

/** 侧边栏折叠状态（本地记忆） */
const SIDEBAR_COLLAPSED_KEY = 'smart-workspace:sidebar-collapsed'

const collapsed = useLocalStorage(SIDEBAR_COLLAPSED_KEY, false)
const route = useRoute()
const router = useRouter()
const todoStore = useTodoStore()

/** 搜索引擎选择（本地记忆；脏值收敛为百度） */
const engineStored = useLocalStorage<string>(SEARCH_ENGINE_KEY, 'baidu')
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
</script>

<template>
  <div class="flex min-h-screen">
    <SidebarNav :collapsed="collapsed" @toggle-collapse="collapsed = !collapsed" />

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 顶栏 -->
      <header
        class="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-md sm:px-6 dark:border-slate-800 dark:bg-slate-900/80"
      >
        <div class="w-full max-w-sm">
          <AggregateSearch
            v-model="todoStore.keyword"
            :results="searchResults"
            :engine="engine"
            @update:engine="engineStored = $event"
            @select-todo="onSelectTodo"
          />
        </div>
        <h1
          class="ml-auto hidden text-sm font-semibold text-slate-700 sm:block dark:text-slate-200"
        >
          {{ pageTitle }}
        </h1>
        <!-- 顶栏右侧：主题切换 + 设置入口（视觉规范：顶部搜索居左，右侧 ThemeToggle + 设置） -->
        <div class="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <router-link
            :to="{ name: 'settings' }"
            data-testid="header-settings"
            class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/60 text-slate-600 transition-colors hover:border-[var(--el-color-primary-light-5)] hover:text-[var(--el-color-primary)] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
            title="设置"
            aria-label="设置"
          >
            <span class="text-base leading-none">⚙</span>
          </router-link>
        </div>
      </header>

      <!-- 内容区：keep-alive 保留各页状态（筛选条件、滚动位置） -->
      <main class="flex-1 px-4 py-6 pb-24 sm:px-6 lg:pb-8">
        <router-view v-slot="{ Component }">
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>

      <MobileBottomNav />
    </div>
  </div>
</template>
