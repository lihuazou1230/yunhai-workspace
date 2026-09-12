/**
 * 桌面版门控测试（第七阶段）：一套代码双发布渠道。
 *
 * 这里钉的是最容易出事的一件事：**桌面专属的东西绝不能漏到浏览器版**，
 * 反之亦然。验收清单里「GitHub Pages 浏览器版不受影响（自绘标题栏/托盘/紧凑侧栏均不出现）」
 * 就是靠这些用例守住的。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

import { routes } from '@/router'
import App from './App.vue'

/** shell 插件的桩：桌面版外链要走系统浏览器 */
const shellOpen = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => () => {}),
  }),
}))

function setTauri(on: boolean) {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown }
  if (on) w.__TAURI_INTERNALS__ = {}
  else delete w.__TAURI_INTERNALS__
}

/** 当前挂载的实例：afterEach 必须卸载，否则 App 注册的 document 级监听会跨用例累积 */
let mounted: { wrapper: ReturnType<typeof mount> } | null = null

async function mountApp(path = '/') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()

  const wrapper = mount(App, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await nextTick()
  await nextTick()
  mounted = { wrapper }
  return { wrapper, router }
}

beforeEach(() => {
  localStorage.clear()
  setTauri(false)
  vi.clearAllMocks()
})

afterEach(() => {
  // 卸载会跑 onScopeDispose/useEventListener 的清理，避免上个用例的全局监听继续响应点击
  mounted?.wrapper.unmount()
  mounted = null
  setTauri(false)
  delete document.documentElement.dataset.platform
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('浏览器版：桌面专属外观一律不出现', () => {
  it('没有自绘标题栏，但有移动端底部导航', async () => {
    const { wrapper } = await mountApp('/')

    expect(wrapper.find('[data-testid="title-bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="bottom-nav-dashboard"]').exists()).toBe(true)
  })

  it('根元素标记为 web 平台（桌面专属 CSS 不会命中）', async () => {
    await mountApp('/')
    expect(document.documentElement.dataset.platform).toBe('web')
  })

  it('绝对链接不劫持（浏览器版该由浏览器自己导航）', async () => {
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)
    const { wrapper } = await mountApp('/')

    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/x'
    wrapper.element.appendChild(anchor)

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    anchor.dispatchEvent(ev)
    await flushPromises()

    // 关键：浏览器版**不干预** —— 既不走 shell，也不自己 window.open，
    // 更不 preventDefault（否则原生导航会被我们挡掉）
    expect(ev.defaultPrevented).toBe(false)
    expect(shellOpen).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })
})

describe('桌面版：原生质感与功能增量', () => {
  it('渲染自绘标题栏，且不渲染移动端底部导航', async () => {
    setTauri(true)
    const { wrapper } = await mountApp('/')

    expect(wrapper.find('[data-testid="title-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="bottom-nav-dashboard"]').exists()).toBe(false)
  })

  it('根元素标记为 desktop（禁止选中/细滚动条等桌面 CSS 生效）', async () => {
    setTauri(true)
    await mountApp('/')
    expect(document.documentElement.dataset.platform).toBe('desktop')
  })

  it('外链被劫持并交给系统默认浏览器（绝不在壳里导航走丢）', async () => {
    setTauri(true)
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)
    const { wrapper } = await mountApp('/')

    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/y'
    wrapper.element.appendChild(anchor)
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(ev)
    await flushPromises()

    expect(shellOpen).toHaveBeenCalledWith('https://example.com/y')
    expect(ev.defaultPrevented).toBe(true)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('站内链接不会被劫持（只有绝对 http(s) 链接才交给系统浏览器）', async () => {
    setTauri(true)
    const { wrapper } = await mountApp('/')

    const anchor = document.createElement('a')
    anchor.setAttribute('href', '/todos')
    wrapper.element.appendChild(anchor)

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    anchor.dispatchEvent(ev)
    await flushPromises()

    // 相对路径不是外链：既不走 shell，也不该被 preventDefault（否则站内导航会被我们挡掉）
    expect(shellOpen).not.toHaveBeenCalled()
    expect(ev.defaultPrevented).toBe(false)
  })

  it('hash 锚点同理不被劫持', async () => {
    setTauri(true)
    const { wrapper } = await mountApp('/')

    const anchor = document.createElement('a')
    anchor.setAttribute('href', '#section')
    wrapper.element.appendChild(anchor)

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    anchor.dispatchEvent(ev)
    await flushPromises()

    expect(shellOpen).not.toHaveBeenCalled()
    expect(ev.defaultPrevented).toBe(false)
  })
  // 其余 scheme（mailto / javascript / 协议相对地址）的判定是纯函数
  // `isExternalHttpUrl`，在 utils/platform.spec.ts 里做了完整矩阵覆盖 ——
  // 这里不再逐个真实派发点击：happy-dom 会真去执行默认动作，那测的是它而不是我们
})
