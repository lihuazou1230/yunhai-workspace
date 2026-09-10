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

import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { useTodoStore } from '@/stores/todoStore'
import { useWallpaperStore } from '@/stores/wallpaperStore'
import { useTheme } from '@/composables/useTheme'
import { useSyncNotifications } from '@/composables/useSyncNotifications'

const themeStore = useThemeStore()
const { themeVars } = useTheme()

const authStore = useAuthStore()
const todoStore = useTodoStore()
const wallpaperStore = useWallpaperStore()

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
      return
    }
    if (todoStore.syncUserId) void todoStore.deactivateCloud()
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
</script>

<template>
  <el-config-provider :size="themeStore.elSize">
    <!-- 壁纸铺在根容器上：卡片是不透明白底，所以不影响内容可读性 -->
    <div
      :style="{ ...themeVars, ...wallpaperStore.style }"
      class="min-h-screen bg-cover bg-fixed bg-center"
      data-testid="app-root"
    >
      <!-- /login 独立全屏，其余路由由 DefaultLayout 套壳 -->
      <router-view />
    </div>
  </el-config-provider>
</template>
