<script setup lang="ts">
/**
 * 有机体组件：桌面端左侧边栏（规格见规划「侧边栏样式规格」）
 *
 * - 容器：240px（`w-60`），与页面同底、无阴影、右侧 1px 分割线，可折叠成 icon rail
 * - 头像区：64px 圆形头像 + 姓名 + 一行小字（未登录时用姓名首字母 + 主题色兜底）
 * - 导航项：行高 44px、px-4、rounded-xl，默认灰字 / 悬停极浅灰 /
 *   **激活态为「主题色浅底 pill + 深色文字」，不是黑底反白**——底色跟随 themeStore 主题色
 * - 分组：上组=主导航 4 项；细分割线；下组=帮助 / 退出登录
 * - 不放同步状态角标：侧边栏是导航区，同步态属于「设置」页的信息（那里有完整状态 + 上次同步时间 + 手动同步）
 */

import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/atoms/BaseButton.vue'
import UiIcon from '@/components/atoms/UiIcon.vue'
import AvatarUpload from '@/components/organisms/AvatarUpload.vue'
import { PRIMARY_NAV_ITEMS } from '@/components/organisms/navItems'
import type { NavRouteName } from '@/components/organisms/navItems'
import { useAvatar } from '@/composables/useAvatar'
import { useAuthStore } from '@/stores/authStore'

defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ (e: 'toggle-collapse'): void }>()

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()

const avatarOpen = ref(false)
const helpOpen = ref(false)
const { displayUrl, fallbackInitial, markImageFailed, loadLocalAvatar } = useAvatar()

// 未登录时本地头像也要能显示（IndexedDB 里可能存过一张）
void loadLocalAvatar()

/** 导航项公共样式：行高 44px、px-4、rounded-xl */
const NAV_BASE_CLASS =
  'flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm transition-colors'
/** 默认态 + 悬停态（极浅灰底） */
const NAV_IDLE_CLASS =
  'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
/**
 * 激活态：主题色**浅底 pill + 深色文字**（浅色 pill 高亮，不是黑底反白）。
 * 底色走 CSS 变量，换主题色时高亮色自动联动。
 */
const NAV_ACTIVE_CLASS =
  'bg-[var(--el-color-primary-light-9)] font-medium text-[var(--el-color-primary-dark-2)]'

/**
 * 当前路由是否命中该项。
 * 自己算而不用 router-link 的 active-class：`active-class` 与 `hover:` 类同时命中时，
 * 谁生效取决于 Tailwind 输出顺序而非类名顺序，容易出现「悬停在激活项上底色被灰底盖掉」。
 */
function isActive(name: NavRouteName): boolean {
  return route.name === name
}

const identityHint = computed(() => {
  if (authStore.isAuthed) return authStore.email || '已登录'
  return authStore.isLocalMode ? '未配置 Supabase · 本地模式' : '未登录'
})

async function handleSignOut() {
  await authStore.signOut()
  // 本地任务缓存由 App.vue 监听登录态变化统一清理（deactivateCloud）
  await router.push({ name: 'login' })
}
</script>

<template>
  <aside
    data-testid="sidebar"
    class="sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white/80 backdrop-blur-md transition-[width] lg:flex dark:border-slate-800 dark:bg-slate-900/80"
    :class="collapsed ? 'w-16' : 'w-60'"
  >
    <!-- 品牌（折叠时只留图标） -->
    <div class="flex items-center gap-2.5 px-3 pt-4">
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--el-color-primary)] text-[15px] leading-none text-white"
        aria-hidden="true"
      >
        🧭
      </span>
      <span
        v-if="!collapsed"
        class="truncate text-sm font-bold tracking-tight text-slate-800 dark:text-slate-100"
      >
        云海工作台
      </span>
    </div>

    <!-- 头像区：64px 圆形头像 + 姓名 + 一行小字 -->
    <div class="flex items-center gap-3 px-3 py-4">
      <button
        type="button"
        data-testid="sidebar-avatar"
        class="relative shrink-0 overflow-hidden rounded-full ring-2 ring-[var(--el-color-primary)]/30 transition-transform hover:scale-105 focus-visible:ring-[var(--el-color-primary)]"
        :class="collapsed ? 'h-9 w-9' : 'h-14 w-14'"
        :title="authStore.isAuthed ? '更换头像' : '设置本地头像'"
        aria-label="更换头像"
        @click="avatarOpen = true"
      >
        <img
          v-if="displayUrl"
          :src="displayUrl"
          alt="用户头像"
          class="h-full w-full object-cover"
          @error="markImageFailed"
        />
        <span
          v-else
          class="flex h-full w-full items-center justify-center bg-[var(--el-color-primary)] text-lg font-semibold text-white"
        >
          {{ fallbackInitial }}
        </span>
      </button>

      <div v-if="!collapsed" class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
          {{ authStore.displayName }}
        </p>
        <p class="mt-0.5 truncate text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {{ identityHint }}
        </p>
      </div>
    </div>

    <!-- 上组：主导航 4 项 -->
    <nav class="mt-1 flex-1 space-y-1 px-2" aria-label="主导航">
      <router-link
        v-for="item in PRIMARY_NAV_ITEMS"
        :key="item.name"
        :to="{ name: item.name }"
        :class="[NAV_BASE_CLASS, isActive(item.name) ? NAV_ACTIVE_CLASS : NAV_IDLE_CLASS]"
        :aria-current="isActive(item.name) ? 'page' : undefined"
        :title="item.label"
        :data-testid="`sidebar-nav-${item.name}`"
      >
        <!-- 图标描边走 currentColor，激活态由行本身的文字色带动（见 NAV_ACTIVE_CLASS） -->
        <UiIcon :name="item.iconName" class="shrink-0" />
        <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
      </router-link>
    </nav>

    <!--
      下组：账号 / 帮助 / 折叠。
      三行**同一套规格**（40px 高、20px 图标、14px 文字、gap-3）：它们同属「侧边栏级动作」，
      体量本就该一致——之前把「帮助」压成 12px 小字，反而让这一组看起来是两个不相干的列表。
      图标全部走 UiIcon 自绘 SVG：🚪 在 Windows 上是一块橙色方块、❓ 是彩色问号、
      « 是全角标点，三者混在一起和上面 1.6px 描边的导航图标完全不是一套笔触。
    -->
    <div
      data-testid="sidebar-footer"
      class="space-y-0.5 border-t border-slate-200/80 p-2 dark:border-slate-800"
    >
      <BaseButton
        v-if="authStore.isAuthed"
        data-testid="sidebar-sign-out"
        variant="ghost"
        size="sm"
        class="min-h-[40px] w-full justify-start gap-3 rounded-xl px-3 text-sm"
        @click="handleSignOut"
      >
        <UiIcon name="log-out" class="shrink-0" />
        <span v-if="!collapsed">退出登录</span>
      </BaseButton>
      <router-link
        v-else
        :to="{ name: 'login' }"
        data-testid="sidebar-sign-in"
        :class="[NAV_BASE_CLASS, NAV_IDLE_CLASS, 'min-h-[40px]']"
      >
        <!-- 登录用的是同一枚「门 + 箭头」，方向感一致；语义差别由文案承担 -->
        <UiIcon name="log-out" class="shrink-0" />
        <span v-if="!collapsed">登录 / 注册</span>
      </router-link>

      <BaseButton
        data-testid="sidebar-help"
        variant="ghost"
        size="sm"
        class="min-h-[40px] w-full justify-start gap-3 rounded-xl px-3 text-sm"
        @click="helpOpen = true"
      >
        <UiIcon name="help" class="shrink-0" />
        <span v-if="!collapsed">使用帮助</span>
      </BaseButton>

      <BaseButton
        data-testid="sidebar-collapse"
        variant="ghost"
        size="sm"
        class="min-h-[40px] w-full justify-start gap-3 rounded-xl px-3 text-sm"
        :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="emit('toggle-collapse')"
      >
        <UiIcon :name="collapsed ? 'chevron-right' : 'chevron-left'" class="shrink-0" />
        <span v-if="!collapsed">收起侧边栏</span>
      </BaseButton>
    </div>
  </aside>

  <!--
    头像弹窗必须放在 <aside> **外面**（同级根节点，Vue 3 支持多根）：
    aside 上有 `backdrop-blur-md`，而带 backdrop-filter 的元素会成为
    `position: fixed` 后代的包含块 —— 弹窗留在里面时，遮罩/弹窗会被限制在
    240px 宽的侧边栏内，看起来就是"弹窗出现在侧边栏里"而不是页面中央。

    （替代方案是给 el-dialog 加 append-to-body 把节点传送到 body，
    但那样弹窗内容会脱离组件树，测试里就查不到内部节点了。）
    帮助弹窗同理，放在同一层。
  -->
  <AvatarUpload v-model="avatarOpen" />

  <el-dialog v-model="helpOpen" title="使用帮助" width="460px">
    <ul class="space-y-2 text-sm text-slate-600 dark:text-slate-300">
      <li>· 顶栏搜索是全局入口：任何页面输入关键字都会带到任务页看结果</li>
      <li>· 任务页支持筛选、优先级、子任务、拖拽排序与批量操作</li>
      <li>· 仪表板「今日聚焦」自动收拢置顶与今日到期的任务</li>
      <li>· 主题色 / 圆角 / 密度在「设置 → 外观自定义」里实时调整并持久化</li>
      <li>· 断网时改动存在本地队列，恢复网络后自动同步到云端</li>
    </ul>
  </el-dialog>
</template>
