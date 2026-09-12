/**
 * 运行环境识别（第七阶段：桌面端打包）。
 *
 * 架构原则：**Web 应用是唯一本体，Tauri 只是「壳」**。一套代码双发布渠道——
 * 浏览器版走 GitHub Pages，桌面版出 exe。所以「桌面才有的行为」必须有一个
 * **唯一且可测**的判断入口，而不是在组件里到处嗅探全局对象。
 *
 * 识别方式：Tauri 2 会在窗口上注入 `__TAURI_INTERNALS__`（旧版是 `__TAURI__`），
 * 两个都认，便于跨版本。浏览器里两者都不存在。
 */

interface TauriGlobals {
  __TAURI_INTERNALS__?: unknown
  __TAURI__?: unknown
}

/** 当前是否运行在 Tauri 桌面壳里 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as TauriGlobals
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__)
}

/**
 * 是否渲染自绘标题栏。
 * 只在桌面版渲染：无边框窗口把系统标题栏去掉了，需要自己画一条带上拖拽区和三键的栏；
 * 浏览器版有系统标签页，再画一条就是多余的。
 */
export function shouldShowTitleBar(): boolean {
  return isTauri()
}

/**
 * 是否渲染移动端底部导航。
 * 桌面窗口最窄也有 900px，底部导航既占地方又「移动端感」十足，必须去掉。
 */
export function shouldShowBottomNav(): boolean {
  return !isTauri()
}

/** 外链是否该交给系统默认浏览器（桌面版绝不在壳内导航，否则用户「走丢」回不来） */
export function shouldOpenExternal(): boolean {
  return isTauri()
}

/** 默认界面密度：桌面屏空间大，紧凑密度信息量更高（设置面板仍可改） */
export function defaultDensity(): 'compact' | 'default' {
  return isTauri() ? 'compact' : 'default'
}

/**
 * 打开外部链接。
 * 桌面版走 shell 插件唤起系统浏览器；浏览器版就是普通的 window.open。
 *
 * 用**动态 import**：`@tauri-apps/plugin-shell` 只在桌面版需要，
 * 静态引入会让 Web 包平白多出一块永远不会执行的代码。
 */
export async function openExternal(url: string): Promise<void> {
  const target = typeof url === 'string' ? url.trim() : ''
  if (!target) return

  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(target)
      return
    } catch {
      /**
       * 壳里调用失败（capability 没声明 shell、插件缺失、系统拒绝）时退回浏览器方式。
       * 不兜这一层的话，所有外链会**静默变成死链** —— 用户点半天没反应，
       * 而这种失败又不会在浏览器版里暴露出来。
       */
      if (typeof window !== 'undefined') window.open(target, '_blank', 'noopener,noreferrer')
      return
    }
  }
  if (typeof window !== 'undefined') window.open(target, '_blank', 'noopener,noreferrer')
}

/** 自绘标题栏的三个窗口动作 */
export type WindowAction = 'minimize' | 'toggleMaximize' | 'close'

/**
 * 这个 href 是不是「站外绝对 http(s) 链接」。
 *
 * 桌面版要靠它决定哪些链接交给系统浏览器。只认 `http(s)://`：
 * - 相对路径 `/todos`、锚点 `#x`、`mailto:`、`javascript:` 一律**不算外链**，
 *   它们要么是站内路由、要么由浏览器原生处理，劫持了反而出问题
 *   （`javascript:` 尤其危险：交给 shell.open 可能执行任意脚本）
 * - 协议相对地址 `//host/x` 也放行，它会继承当前页面的协议
 */
export function isExternalHttpUrl(href: string): boolean {
  const value = typeof href === 'string' ? href.trim() : ''
  if (!value) return false
  return /^https?:\/\//i.test(value) || /^\/\/[^/]/i.test(value)
}

/**
 * 执行窗口动作（仅桌面版有效）。
 * 同样动态引入：浏览器里这些 API 不存在，静态引入会直接报错。
 * @returns 是否真的执行了（浏览器里返回 false，调用方可据此静默忽略）
 */
export async function runWindowAction(action: WindowAction): Promise<boolean> {
  if (!isTauri()) return false

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()

  switch (action) {
    case 'minimize':
      await win.minimize()
      return true
    case 'toggleMaximize':
      await win.toggleMaximize()
      return true
    case 'close':
      await win.close()
      return true
    default:
      return false
  }
}
