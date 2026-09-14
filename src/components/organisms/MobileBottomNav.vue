<script setup lang="ts">
/**
 * 有机体组件：移动端底部导航（lg 以下显示）
 *
 * 第五阶段：从「首页/设置抽屉」改为 4 个路由 Tab，
 * 与桌面端侧边栏的导航项一一对应（同一份 NAV_ITEMS 数据源，避免两处改不同步）。
 *
 * 第九阶段后的工艺修正：
 * - 图标改自绘 SVG（见 NavIcon）——emoji 在 16px 下是四套不同的彩色位图，
 *   且不吃 currentColor，激活态只能靠文字变色，图标本身永远不变
 * - 触控高度按 48px 起（iOS HIG 44pt 的下限 + 中文标签一行的高度），
 *   并补 `pb-[env(safe-area-inset-bottom)]`：带 Home 指示条的机型上不会被压住
 * - 激活态加一条 2px 顶边指示条，色彩不是唯一线索（色觉障碍用户同样读得出来）
 */

import UiIcon from '@/components/atoms/UiIcon.vue'
import { NAV_ITEMS } from '@/components/organisms/navItems'

const ACTIVE_CLASS = 'text-[var(--el-color-primary)]'
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-slate-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden dark:border-slate-700 dark:bg-slate-900/90"
    aria-label="底部导航"
  >
    <router-link
      v-for="item in NAV_ITEMS"
      :key="item.name"
      :to="{ name: item.name }"
      class="relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 py-1.5 text-[11px] text-slate-500 transition-colors dark:text-slate-400"
      :active-class="item.name === 'dashboard' ? '' : ACTIVE_CLASS"
      :exact-active-class="ACTIVE_CLASS"
      :data-testid="`bottom-nav-${item.name}`"
    >
      <UiIcon :name="item.iconName" size="h-[22px] w-[22px]" />
      <span class="leading-none">{{ item.label }}</span>
    </router-link>
  </nav>
</template>
