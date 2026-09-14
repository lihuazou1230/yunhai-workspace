/**
 * 自绘标题栏测试（第七阶段）。
 *
 * 桌面窗口用了 `decorations: false`（去掉系统标题栏），窗口的三键与拖拽就得自己实现——
 * 这几条用例保证「最小化/最大化/关闭」确实打到了对应的窗口 API，
 * 以及最大化/还原图标会跟着窗口状态切换。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

/** 窗口 API 的桩（必须 hoisted，vi.mock 工厂里引用外部变量要先提升） */
const win = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  onResized: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => win,
}))

import TitleBar from './TitleBar.vue'

/** 让「桌面版」判定成立：platform.ts 认 __TAURI_INTERNALS__ */
function stubTauri() {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
}

/**
 * 挂载并等待异步初始化完成。
 * 注意必须 `flushPromises`：窗口 API 是**动态 import** 的，`onMounted` 里的订阅与
 * 「查询最大化状态」都要等模块加载完才落地 —— 只 `nextTick` 会断言在 promise 之前。
 */
async function mountBar() {
  const wrapper = mount(TitleBar)
  await nextTick()
  await flushPromises()
  return wrapper
}

/** 点一个窗口键并等异步动作落地 */
async function clickAndSettle(wrapper: ReturnType<typeof mount>, testId: string) {
  await wrapper.find(`[data-testid="${testId}"]`).trigger('click')
  await flushPromises()
}

beforeEach(() => {
  stubTauri()
  vi.clearAllMocks()
  win.isMaximized.mockResolvedValue(false)
  win.onResized.mockResolvedValue(() => {})
})

describe('TitleBar', () => {
  it('渲染应用名、可拖拽区与三个窗口键', async () => {
    const wrapper = await mountBar()

    expect(wrapper.text()).toContain('云海工作台')
    expect(wrapper.find('[data-testid="title-bar-drag-region"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="window-minimize"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="window-maximize"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="window-close"]').exists()).toBe(true)
  })

  it('拖拽区带 data-tauri-drag-region（Tauri 靠它识别窗口拖动，不需要写 JS）', async () => {
    const wrapper = await mountBar()
    expect(
      wrapper.find('[data-testid="title-bar-drag-region"]').attributes('data-tauri-drag-region'),
    ).toBeDefined()
  })

  it('三个键分别调用窗口 API', async () => {
    const wrapper = await mountBar()

    await clickAndSettle(wrapper, 'window-minimize')
    expect(win.minimize).toHaveBeenCalledTimes(1)

    await clickAndSettle(wrapper, 'window-maximize')
    expect(win.toggleMaximize).toHaveBeenCalledTimes(1)

    await clickAndSettle(wrapper, 'window-close')
    expect(win.close).toHaveBeenCalledTimes(1)
  })

  it('拖拽区**不自己**处理双击：Tauri 注入的 drag.js 已负责，再绑一次会两次切换互相抵消', async () => {
    const wrapper = await mountBar()

    // 这是一条防回归断言：Tauri 的 drag.js 在 mousedown 上按 `e.detail === 2` 调
    // internal_toggle_maximize。如果这里再绑 @dblclick="toggleMaximize"，
    // 双击就会「最大化 → 立刻还原」，用户看到的是双击没反应。
    await wrapper.find('[data-testid="title-bar-drag-region"]').trigger('dblclick')
    await flushPromises()

    expect(win.toggleMaximize).not.toHaveBeenCalled()
  })

  it('最大化状态下图标与 aria-label 变成「还原」', async () => {
    win.isMaximized.mockResolvedValue(true)
    const wrapper = await mountBar()

    const button = wrapper.find('[data-testid="window-maximize"]')
    expect(button.attributes('aria-label')).toBe('还原')
  })

  it('未最大化时为「最大化」', async () => {
    const wrapper = await mountBar()
    expect(wrapper.find('[data-testid="window-maximize"]').attributes('aria-label')).toBe('最大化')
  })

  it('关闭键的提示写明是「最小化到托盘」（行为与用户预期一致）', async () => {
    const wrapper = await mountBar()
    const close = wrapper.find('[data-testid="window-close"]')
    expect(close.attributes('title')).toContain('托盘')
    expect(close.attributes('aria-label')).toContain('托盘')
  })

  it('窗口 API 抛错时三键不会把界面带崩（点击只吞掉错误）', async () => {
    win.minimize.mockRejectedValue(new Error('权限被拒'))
    const wrapper = await mountBar()

    await expect(
      wrapper.find('[data-testid="window-minimize"]').trigger('click'),
    ).resolves.toBeUndefined()
    await flushPromises()
  })

  it('订阅窗口尺寸变化以同步最大化状态；卸载时退订', async () => {
    const off = vi.fn()
    win.onResized.mockResolvedValue(off)
    const wrapper = await mountBar()

    expect(win.onResized).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    expect(off).toHaveBeenCalledTimes(1)
  })
})
