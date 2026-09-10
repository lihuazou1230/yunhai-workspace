<script setup lang="ts">
/**
 * 布局组件：默认布局（桌面端侧边栏 + 顶栏 + 内容区 + 移动端底部导航）
 *
 * 结构（对应规划里的布局图）：
 * ┌──────────┬──────────────────────────────────┐
 * │ Sidebar  │ 顶栏: 🔍 SearchBar   🌙 主题  ⚙ 设置 │
 * │ 👤 头像   ├──────────────────────────────────┤
 * │ 4 导航项  │        <router-view>             │
 * │ 🚪 退出   │   （keep-alive 保留各页状态）        │
 * └──────────┴──────────────────────────────────┘
 *
 * 三个实现要点：
 * - 顶栏搜索直接绑 todoStore.keyword：任务搜索全局可达，不用先进任务页
 * - **搜索词一出就往任务页带**：列表只在 /todos 渲染，留在仪表板输入等于"输入了却什么都看不到"，
 *   所以第一次输入（且当前不在任务页）就跳过去，用户立刻看到结果
 * - router-view 外套 keep-alive：切走再切回任务页，筛选条件与滚动位置都还在
 */

import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import SearchBar from '@/components/molecules/SearchBar.vue'
import ThemeToggle from '@/components/molecules/ThemeToggle.vue'
import MobileBottomNav from '@/components/organisms/MobileBottomNav.vue'
import SidebarNav from '@/components/organisms/SidebarNav.vue'
import { useLocalStorage } from '@/composables/useLocalStorage'
import { useTodoStore } from '@/stores/todoStore'

/** 侧边栏折叠状态（本地记忆） */
const SIDEBAR_COLLAPSED_KEY = 'smart-workspace:sidebar-collapsed'

const collapsed = useLocalStorage(SIDEBAR_COLLAPSED_KEY, false)
const route = useRoute()
const router = useRouter()
const todoStore = useTodoStore()

const pageTitle = computed(() => route.meta.title ?? '仪表板')

// 顶栏搜索是全局入口：在其他页面输入时把用户带到任务页，否则搜索结果无处可见。
// 已经在任务页时不做任何跳转（不打断当前操作），清空关键字也不跳。
watch(
  () => todoStore.keyword,
  (keyword) => {
    if (keyword.trim() && route.name !== 'todos') void router.push({ name: 'todos' })
  },
)
</script>

<template>
  <div class="flex min-h-screen">
    <SidebarNav :collapsed="collapsed" @toggle-collapse="collapsed = !collapsed" />

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 顶栏 -->
      <header
        class="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-md sm:px-6 dark:border-slate-800 dark:bg-slate-900/80"
      >
        <div class="w-full max-w-xs">
          <SearchBar v-model="todoStore.keyword" />
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
