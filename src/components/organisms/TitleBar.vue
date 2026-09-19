<script setup lang="ts">
/**
 * 有机体组件：自绘标题栏（第七阶段，**仅桌面版渲染**）。
 *
 * 为什么需要它：桌面窗口配了 `decorations: false`（去掉 Windows 系统白条标题栏），
 * 应用界面从窗口最顶端开始，这才是「原生质感」而不是「套壳网页」。
 * 代价是窗口的三键与拖拽得自己实现——就是本组件。
 *
 * 三个细节对齐 Windows 11 原生行为：
 * - 中部整条空白区可拖拽移动，**双击切换最大化**——两者都由 Tauri 注入的 drag.js 负责，
 *   本组件只提供 `data-tauri-drag-region` 标记（详见模板里的注释：自己再绑一次会抵消）
 * - 三键尺寸 46×32，hover 浅灰底，关闭键 hover 红底白字
 * - 最大化/还原图标跟随窗口状态切换（监听 resize 而不是只查一次）
 *
 * 组件只在 isTauri 时被父级挂载（见 App.vue），浏览器版完全不出现。
 */

import { onMounted, onUnmounted, ref } from 'vue'

import { runWindowAction } from '@/utils/platform'
import type { WindowAction } from '@/utils/platform'

const isMaximized = ref(false)

/** 查询当前最大化状态（失败时保持原值，不影响使用） */
async function syncMaximized() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    isMaximized.value = await getCurrentWindow().isMaximized()
  } catch {
    // 非 Tauri 环境或权限不足：保持原值
  }
}

function onAction(action: WindowAction) {
  // 窗口 API 也可能失败（权限未声明、窗口已销毁、系统拒绝）。
  // 这里必须 catch：标题栏的三键是最外层的窗口控件，一个未处理的 Promise 拒绝
  // 会冒到全局，而且用户也已经无法补救 —— 静默忽略是唯一合理策略。
  void runWindowAction(action)
    .then(() => {
      if (action === 'toggleMaximize') void syncMaximized()
    })
    .catch(() => {})
}

let unlisten: (() => void) | null = null

onMounted(async () => {
  if (typeof window === 'undefined') return
  try {
    // 最大化状态可能被「拖到屏幕边缘」「系统快捷键」改变，所以订阅而不是只查一次
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    unlisten = await getCurrentWindow().onResized(() => void syncMaximized())
  } catch {
    // 忽略：拿不到事件不影响三键本身
  }
  void syncMaximized()
})

onUnmounted(() => unlisten?.())
</script>

<template>
  <header
    class="flex h-10 shrink-0 select-none items-center border-b border-slate-200 bg-white/80 pl-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80"
    data-testid="title-bar"
  >
    <!-- 左：应用名称（图标已按需求去掉，与侧边栏品牌保持一致：只留站名） -->
    <span class="shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200">
      云海工作台
    </span>

    <!--
      中：整条空白区可拖拽移动窗口，双击最大化/还原。

      ⚠️ 这里**绝对不能**再绑 `@dblclick="toggleMaximize"`：
      Tauri（2.11.5 `src/window/scripts/drag.js`）会为每个窗口注入一段脚本，
      它自己在 document 的 mousedown 上判断 `data-tauri-drag-region`——
      `e.detail === 1` 调 start_dragging、`e.detail === 2` 调 internal_toggle_maximize。
      我们再绑一个 dblclick 就是第二次切换，两次抵消 → 双击看起来毫无反应。
      该内部命令的权限（core:window:allow-internal-toggle-maximize）已含在
      core:window:default 里，而 capabilities 申请了 core:default，所以原生路径本来就是通的。
      顺带白拿 Tauri 对「双击拖拽区边缘」的修复（tauri#2549）。
    -->
    <div class="h-full flex-1" data-tauri-drag-region data-testid="title-bar-drag-region"></div>

    <!-- 右：最小化 / 最大化 / 关闭（尺寸与 hover 语义对齐 Windows 11） -->
    <div class="flex shrink-0 items-stretch">
      <button
        type="button"
        class="flex h-10 w-[46px] items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label="最小化"
        data-testid="window-minimize"
        @click="onAction('minimize')"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1.5 6h9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </button>

      <button
        type="button"
        class="flex h-10 w-[46px] items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        :aria-label="isMaximized ? '还原' : '最大化'"
        data-testid="window-maximize"
        @click="onAction('toggleMaximize')"
      >
        <svg
          v-if="!isMaximized"
          class="h-3.5 w-3.5"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="1.75"
            y="1.75"
            width="8.5"
            height="8.5"
            rx="1.5"
            stroke="currentColor"
            stroke-width="1.2"
          />
        </svg>
        <svg v-else class="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect
            x="1.75"
            y="3.75"
            width="6.5"
            height="6.5"
            rx="1.2"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <path
            d="M4.25 3.5V2.6c0-.47.38-.85.85-.85h4.3c.47 0 .85.38.85.85v4.3c0 .47-.38.85-.85.85h-.9"
            stroke="currentColor"
            stroke-width="1.2"
          />
        </svg>
      </button>

      <button
        type="button"
        class="flex h-10 w-[46px] items-center justify-center text-slate-600 transition-colors hover:bg-rose-600 hover:text-white dark:text-slate-300"
        aria-label="关闭（最小化到托盘）"
        title="关闭（最小化到托盘）"
        data-testid="window-close"
        @click="onAction('close')"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 2.5l7 7m0-7l-7 7"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </header>
</template>
