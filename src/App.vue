<script setup lang="ts">
/**
 * 根组件（第五阶段：路由骨架 + 用户系统接线）
 *
 * 职责收窄为五件事，页面内容全部搬进 pages/：
 * 1. 挂 el-config-provider（密度）+ 运行时主题 CSS 变量（themeVars）
 * 2. 恢复会话（authStore.init）——main.ts 里已 await 过一次，这里是 HMR/兜底
 * 3. **登录态 → 云同步接线**：登录后 activateCloud（含旧数据一次性迁移），
 *    登出后 deactivateCloud（清掉本地缓存，避免下一个登录者看到别人的任务）
 * 4. **同步状态 → Toast**：断网提示一次、恢复提示一次、迁移完成提示一次
 * 5. **壁纸**（第六阶段 6.4）：把用户选的纯色/渐变/图片铺在最底层；
 *    卡片本身是不透明白底，所以壁纸再花也不会影响可读性
 */

import { onBeforeUnmount, onMounted, watch } from 'vue'

import { useEventListener, useIntervalFn } from '@vueuse/core'

import TitleBar from '@/components/organisms/TitleBar.vue'
import { useAuthStore } from '@/stores/authStore'
import { useCountdownStore } from '@/stores/countdownStore'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useLinkStore } from '@/stores/linkStore'
import { useReminderStore } from '@/stores/reminderStore'
import { useTagStore } from '@/stores/tagStore'
import { useThemeStore, THEME_STORAGE_KEY } from '@/stores/themeStore'
import { useTodoStore } from '@/stores/todoStore'
import { useWallpaperStore } from '@/stores/wallpaperStore'
import { useEarnings } from '@/composables/useEarnings'
import { useTheme } from '@/composables/useTheme'
import { useSyncNotifications } from '@/composables/useSyncNotifications'
import {
  activateSettingsSync,
  deactivateSettingsSync,
  retrySettingsSync,
} from '@/composables/useSyncedStorage'
import { useWorkLog } from '@/composables/useWorkLog'
import { defaultDensity, isExternalHttpUrl, isTauri, openExternal } from '@/utils/platform'

const themeStore = useThemeStore()
// 主题：深色类、系统偏好监听，以及运行时 CSS 变量（变量直接写到 <html> 上，见 useTheme）
useTheme()

const authStore = useAuthStore()
const todoStore = useTodoStore()
const wallpaperStore = useWallpaperStore()

/**
 * 预先实例化所有「跟账号走」的 store / composable（第九阶段）。
 *
 * 同步层是按 key 注册的，而 Pinia store 与 composable 都是**懒创建**的：
 * 不在这里点一遍，登录后第一次全量拉取就会漏掉"当前页面还没用到"的那些键
 * （典型：直接进设置页时，快捷导航 LinkDock 还没挂载 → 链接列表不同步）。
 * 这些都是单例，实例化本身没有额外开销。
 */
useTagStore()
useLinkStore()
useCountdownStore()
useDashboardStore()
useReminderStore()
useWorkLog()
// autoTick: false —— 这里只为注册「秒表配置 / 投入日志」两个键，不额外养一个高频定时器
useEarnings({ autoTick: false })

// 会话恢复（幂等：main.ts 已经等过一次，这里不会重复请求）
void authStore.init()
// 壁纸：把 IndexedDB 里的图片取出来变成可用 URL（没有则什么都不做）
void wallpaperStore.init()

// 登录态 → 云同步：登录激活（含迁移）、登出停用并清缓存
watch(
  () => [authStore.isAuthed, authStore.user?.id] as const,
  ([isAuthed, userId]) => {
    if (isAuthed && userId) {
      void todoStore.activateCloud(userId)
      // 第九阶段：偏好设置（主题/标签/布局/秒表/壁纸…）同一个账号、同一套
      void activateSettingsSync(userId)
      return
    }
    if (todoStore.syncUserId) void todoStore.deactivateCloud()
    deactivateSettingsSync()
  },
  { immediate: true },
)

// 同步状态 → 用户提示（规划要求：断网 / 恢复 / 迁移完成都要有即时反馈）
useSyncNotifications({
  success: (text) => ElMessage.success(text),
  warning: (text) => ElMessage.warning(text),
})

// 网络恢复自动补发离线队列
let unbindConnectivity: () => void = () => {}
onMounted(() => {
  unbindConnectivity = todoStore.bindConnectivity()
})
onBeforeUnmount(() => unbindConnectivity())

// 联网后立刻补发「设置」的离线改动（任务那边由 todoStore 自己的 online 监听负责）
useEventListener(window, 'online', retrySettingsSync)

/**
 * 校准「今天」：跨零点后「今日到期 / 今日聚焦 / 今日完成度」要能自己换天。
 * 页面在后台开一整夜时没有任何任务写入，只靠 computed 是不会重算的，
 * 所以这里每分钟对一次日期、回前台再对一次（跨零点立刻生效）。
 */
useIntervalFn(todoStore.refreshToday, 60_000, { immediate: true, immediateCallback: true })
useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState === 'visible') todoStore.refreshToday()
})

// ---- 桌面版（第七阶段）：这些差异全部由 utils/platform.ts 一处判定 ----
const desktop = isTauri()

onMounted(() => {
  // 首次进入桌面版时默认用紧凑密度（桌面屏空间大，信息密度优先；设置面板仍可改）
  if (desktop && !localStorage.getItem(THEME_STORAGE_KEY)) {
    themeStore.setDensity(defaultDensity())
  }
  // 给根元素打平台标记：桌面专属的 CSS（禁止选中、细滚动条等）都挂在它下面
  document.documentElement.dataset.platform = desktop ? 'desktop' : 'web'
})

/**
 * 外链统一交给系统浏览器（桌面版）。
 *
 * 用**一个全局监听**而不是逐个组件改：只拦截绝对 http(s) 链接，站内路由链接
 * （`href="/todos"` 这种）原样交给 vue-router —— 这样以后新加的外链自动生效，
 * 不会出现「某处漏改，结果在壳里把应用自己导航走了，用户回不来」。
 */
function onDocumentClick(ev: MouseEvent) {
  if (!desktop) return
  const anchor = (ev.target as HTMLElement | null)?.closest?.('a')
  if (!anchor) return

  const href = anchor.getAttribute('href') ?? ''
  if (!isExternalHttpUrl(href)) return

  ev.preventDefault()
  void openExternal(href)
}
useEventListener(document, 'click', onDocumentClick)
</script>

<template>
  <el-config-provider :size="themeStore.elSize">
    <div class="flex min-h-screen flex-col" data-testid="app-shell">
      <!-- 自绘标题栏：只有桌面版有（浏览器版有系统标签页，再画一条是多余的） -->
      <TitleBar v-if="desktop" />
      <!-- 壁纸铺在根容器上：卡片是不透明白底，所以不影响内容可读性 -->
      <div
        :style="wallpaperStore.style"
        class="min-h-0 flex-1 bg-cover bg-fixed bg-center"
        data-testid="app-root"
      >
        <!-- /login 独立全屏，其余路由由 DefaultLayout 套壳 -->
        <router-view />
      </div>
    </div>
  </el-config-provider>
</template>
