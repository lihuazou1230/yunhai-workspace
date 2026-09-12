/**
 * 桌面端平台识别测试（第七阶段）。
 *
 * 这一层是「一套代码双发布渠道」的开关：所有桌面/浏览器的行为差异都从这里判定，
 * 所以每条分支都要钉住 —— 判错的后果是浏览器版冒出标题栏、或桌面版白屏。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  defaultDensity,
  isExternalHttpUrl,
  isTauri,
  openExternal,
  runWindowAction,
  shouldOpenExternal,
  shouldShowBottomNav,
  shouldShowTitleBar,
} from './platform'

/** 模拟 Tauri 2 注入的全局标记 */
function stubTauri() {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
}

/** 模拟旧版 Tauri 的全局标记（两个都认，跨版本兼容） */
function stubTauriLegacy() {
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {}
}

function clearTauri() {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
}

beforeEach(() => {
  clearTauri()
})

afterEach(() => {
  clearTauri()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isTauri 环境识别', () => {
  it('浏览器里为 false', () => {
    expect(isTauri()).toBe(false)
  })

  it('Tauri 2 注入 __TAURI_INTERNALS__ 时为 true', () => {
    stubTauri()
    expect(isTauri()).toBe(true)
  })

  it('旧版注入 __TAURI__ 也认（跨版本兼容）', () => {
    stubTauriLegacy()
    expect(isTauri()).toBe(true)
  })

  it('全局标记存在但值为 false/null 时不算桌面版（避免误判）', () => {
    ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = null
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = undefined
    expect(isTauri()).toBe(false)
  })
})

describe('桌面/浏览器行为开关', () => {
  it('桌面版：显示自绘标题栏、隐藏底部导航、外链走系统浏览器、默认紧凑密度', () => {
    stubTauri()
    expect(shouldShowTitleBar()).toBe(true)
    expect(shouldShowBottomNav()).toBe(false)
    expect(shouldOpenExternal()).toBe(true)
    expect(defaultDensity()).toBe('compact')
  })

  it('浏览器版：不显示标题栏、显示底部导航、默认密度、外链走 window.open', () => {
    expect(shouldShowTitleBar()).toBe(false)
    expect(shouldShowBottomNav()).toBe(true)
    expect(shouldOpenExternal()).toBe(false)
    expect(defaultDensity()).toBe('default')
  })
})

describe('isExternalHttpUrl（决定哪些链接交给系统浏览器）', () => {
  it('绝对 http(s) 链接算外链', () => {
    expect(isExternalHttpUrl('https://example.com')).toBe(true)
    expect(isExternalHttpUrl('http://example.com/a?b=1')).toBe(true)
    expect(isExternalHttpUrl('HTTPS://Example.com')).toBe(true)
    expect(isExternalHttpUrl('  https://example.com  ')).toBe(true)
  })

  it('协议相对地址算外链（继承当前页面协议）', () => {
    expect(isExternalHttpUrl('//cdn.example.com/x.js')).toBe(true)
  })

  it('站内相对路径不算外链（交给 vue-router）', () => {
    expect(isExternalHttpUrl('/todos')).toBe(false)
    expect(isExternalHttpUrl('todos')).toBe(false)
    expect(isExternalHttpUrl('./a')).toBe(false)
    expect(isExternalHttpUrl('../a')).toBe(false)
  })

  it('hash 锚点不算外链（同页内跳转）', () => {
    expect(isExternalHttpUrl('#section')).toBe(false)
    expect(isExternalHttpUrl('')).toBe(false)
  })

  it('其它 scheme 一律不算（尤其 javascript: 绝不能交给 shell.open）', () => {
    expect(isExternalHttpUrl('mailto:a@b.com')).toBe(false)
    expect(isExternalHttpUrl('tel:+8613800000000')).toBe(false)
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalHttpUrl('data:text/html,<script>1</script>')).toBe(false)
    expect(isExternalHttpUrl('file:///C:/x')).toBe(false)
    expect(isExternalHttpUrl('ftp://host/x')).toBe(false)
  })

  it('非字符串输入安全返回 false', () => {
    expect(isExternalHttpUrl(undefined as unknown as string)).toBe(false)
    expect(isExternalHttpUrl(null as unknown as string)).toBe(false)
  })
})

describe('openExternal', () => {
  it('浏览器版：window.open 新标签页（不带 opener 防钓鱼）', async () => {
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    await openExternal('https://example.com/a')

    expect(openSpy).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer')
  })

  it('空字符串/非字符串不发任何跳转（脏数据不该打开空白页）', async () => {
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    await openExternal('')
    await openExternal('   ')
    await openExternal(undefined as unknown as string)

    expect(openSpy).not.toHaveBeenCalled()
  })

  it('桌面版：走 shell 插件的 open（唤起系统默认浏览器）', async () => {
    stubTauri()
    const openSpy = vi.fn(async () => {})
    vi.doMock('@tauri-apps/plugin-shell', () => ({ open: openSpy }))

    // 动态 import 拿的是 mock 后的模块；resetModules 保证这次导入是新模块图
    vi.resetModules()
    const { openExternal: freshOpenExternal } = await import('./platform')

    const winOpen = vi.fn()
    vi.stubGlobal('open', winOpen)

    await freshOpenExternal('https://example.com/b')

    expect(openSpy).toHaveBeenCalledWith('https://example.com/b')
    // 桌面版绝不用 window.open：那会在壳里开新窗口或走丢
    expect(winOpen).not.toHaveBeenCalled()

    vi.doUnmock('@tauri-apps/plugin-shell')
  })
})

describe('runWindowAction', () => {
  it('浏览器版直接返回 false，不尝试调用不存在的 API', async () => {
    await expect(runWindowAction('minimize')).resolves.toBe(false)
    await expect(runWindowAction('toggleMaximize')).resolves.toBe(false)
    await expect(runWindowAction('close')).resolves.toBe(false)
  })

  it('桌面版：三个动作分别调用窗口 API', async () => {
    stubTauri()
    const minimize = vi.fn(async () => {})
    const toggleMaximize = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    vi.doMock('@tauri-apps/api/window', () => ({
      getCurrentWindow: () => ({ minimize, toggleMaximize, close, isMaximized: async () => false }),
    }))

    vi.resetModules()
    const { runWindowAction: freshRunWindowAction } = await import('./platform')

    await expect(freshRunWindowAction('minimize')).resolves.toBe(true)
    expect(minimize).toHaveBeenCalledTimes(1)

    await expect(freshRunWindowAction('toggleMaximize')).resolves.toBe(true)
    expect(toggleMaximize).toHaveBeenCalledTimes(1)

    await expect(freshRunWindowAction('close')).resolves.toBe(true)
    expect(close).toHaveBeenCalledTimes(1)

    vi.doUnmock('@tauri-apps/api/window')
  })
})
