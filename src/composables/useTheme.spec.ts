import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'

import { useThemeStore } from '@/stores/themeStore'
import { useTheme } from './useTheme'

const Wrapper = defineComponent({
  setup() {
    const theme = useTheme()
    // 顶层 ref/computed 会被 proxyRefs 解包，用例里可直接当值读
    return { toggleDark: theme.toggleDark, isDark: theme.isDark, themeVars: theme.themeVars }
  },
  template: '<div />',
})

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
  })

  it('挂载时应用 isDark 到 html.dark 类', () => {
    const store = useThemeStore()
    store.setMode('dark')
    mount(Wrapper)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('切换 mode 时同步 html.dark 类', async () => {
    const store = useThemeStore()
    store.setMode('light')
    mount(Wrapper)
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    store.setMode('dark')
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('system 模式跟随系统偏好', async () => {
    const store = useThemeStore()
    store.setMode('system')
    store.setSystemDark(false)
    store.setMode('light')
    mount(Wrapper)
    store.setMode('system')
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    store.setSystemDark(true)
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggleDark 在当前明暗间取反', async () => {
    const store = useThemeStore()
    store.setMode('light')
    const wrapper = mount(Wrapper)
    ;(wrapper.vm as unknown as { toggleDark: () => void }).toggleDark()
    await nextTick()
    expect(store.prefs.mode).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 补充：主题桥接的实际副作用（html 上的类/color-scheme、CSS 变量、系统偏好监听）
// ---------------------------------------------------------------------------

/** 顶层 ref/computed 经 proxyRefs 解包后可直接当值读取 */
interface ThemeVm {
  isDark: boolean
  themeVars: Record<string, string>
  toggleDark: () => void
}

/** 每个用例自建 pinia，并把「同一个实例」既设为 active 又交给挂载 */
function setupTheme() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useThemeStore()
  const wrapper = mount(Wrapper, { global: { plugins: [pinia] } })
  return { store, wrapper, vm: wrapper.vm as unknown as ThemeVm }
}

type ChangeListener = (e: { matches: boolean }) => void

/**
 * 系统深色偏好替身：可手动 emit('change')，
 * 从而不必等操作系统真的换主题，也不会因为跑测机器恰好是深色而结果不稳定。
 */
function stubMatchMedia(initialDark: boolean, legacy = false) {
  const listeners = new Set<ChangeListener>()
  const mql: Record<string, unknown> = {
    matches: initialDark,
    media: '(prefers-color-scheme: dark)',
  }
  mql.listenerCount = () => listeners.size
  mql.emit = (next: boolean) => {
    mql.matches = next
    for (const cb of [...listeners]) cb({ matches: next })
  }
  if (legacy) {
    // 老 Safari/旧 WebView 只有废弃的 addListener/removeListener
    mql.addListener = (cb: ChangeListener) => void listeners.add(cb)
    mql.removeListener = (cb: ChangeListener) => void listeners.delete(cb)
  } else {
    mql.addEventListener = (_type: string, cb: ChangeListener) => void listeners.add(cb)
    mql.removeEventListener = (_type: string, cb: ChangeListener) => void listeners.delete(cb)
  }

  const matchMedia = vi.fn(() => mql)
  vi.stubGlobal('matchMedia', matchMedia)
  return {
    matchMedia,
    emit: (next: boolean) => (mql.emit as (v: boolean) => void)(next),
    listenerCount: () => (mql.listenerCount as () => number)(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTheme · 应用到文档根节点', () => {
  it('浅色/深色切换同时写 html.dark 类与 color-scheme（原生滚动条/输入框跟着变深）', async () => {
    const { store, vm } = setupTheme()

    store.setMode('dark')
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(vm.isDark).toBe(true)

    store.setMode('light')
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(vm.isDark).toBe(false)
  })

  it('themeVars 默认按 emerald 主色派生 Element Plus 的深浅档位', () => {
    const { vm } = setupTheme()

    expect(vm.themeVars['--el-color-primary']).toBe('#10b981')
    // 逐级提亮：浅底/描边/悬浮态各用一档，任何一档算错都会让 Element Plus 配色失真
    expect(vm.themeVars['--el-color-primary-light-3']).toBe('#58cea7')
    expect(vm.themeVars['--el-color-primary-light-5']).toBe('#88dcc0')
    expect(vm.themeVars['--el-color-primary-light-7']).toBe('#b7ead9')
    expect(vm.themeVars['--el-color-primary-light-8']).toBe('#cff1e6')
    expect(vm.themeVars['--el-color-primary-light-9']).toBe('#e7f8f2')
    expect(vm.themeVars['--el-color-primary-dark-2']).toBe('#0d9467')
    // 卡片圆角 = 基础圆角（视觉规范里卡片吃 +8px 由 CSS 侧处理）
    expect(vm.themeVars['--el-border-radius-base']).toBe('12px')
    expect(vm.themeVars['--app-radius']).toBe('12px')
  })

  it('换预设色 / 自定义色 / 圆角后 themeVars 立即重算', async () => {
    const { store, vm } = setupTheme()

    store.setColorName('rose')
    await nextTick()
    expect(vm.themeVars['--el-color-primary']).toBe('#f43f5e')

    // 纯黑主色的派生档位是确定的，用它钉住 lighten/darken 的接入是否正确
    store.setCustomColor('#000000')
    await nextTick()
    expect(vm.themeVars['--el-color-primary']).toBe('#000000')
    expect(vm.themeVars['--el-color-primary-light-3']).toBe('#4d4d4d')
    expect(vm.themeVars['--el-color-primary-light-5']).toBe('#808080')
    expect(vm.themeVars['--el-color-primary-light-9']).toBe('#e6e6e6')
    expect(vm.themeVars['--el-color-primary-dark-2']).toBe('#000000')

    store.setRadius('large')
    await nextTick()
    expect(vm.themeVars['--el-border-radius-base']).toBe('16px')
    expect(vm.themeVars['--app-radius']).toBe('16px')
  })
})

describe('useTheme · 跟随系统深色偏好', () => {
  it('系统偏好变化实时同步：store.systemDark 与 html 类一起变', async () => {
    const media = stubMatchMedia(false)
    const { store, wrapper, vm } = setupTheme()
    store.setMode('system')
    await nextTick()

    expect(media.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
    expect(vm.isDark).toBe(false)

    media.emit(true)
    await nextTick()
    expect(store.systemDark).toBe(true)
    expect(vm.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    media.emit(false)
    await nextTick()
    expect(vm.isDark).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    wrapper.unmount()
  })

  it('卸载时注销监听：页面销毁后系统换主题不再触碰已失效的实例（避免监听泄漏）', () => {
    const media = stubMatchMedia(false)
    const { wrapper } = setupTheme()

    expect(media.listenerCount()).toBe(1)
    wrapper.unmount()
    expect(media.listenerCount()).toBe(0)
  })

  it('只有废弃的 addListener/removeListener 的老环境也能监听与注销', async () => {
    const media = stubMatchMedia(false, true)
    const { store, wrapper, vm } = setupTheme()
    store.setMode('system')
    await nextTick()

    expect(media.listenerCount()).toBe(1)
    media.emit(true)
    await nextTick()
    expect(vm.isDark).toBe(true)

    wrapper.unmount()
    expect(media.listenerCount()).toBe(0)
  })

  it('环境没有 matchMedia 时不抛错，仅按 store 的 mode 着色', async () => {
    vi.stubGlobal('matchMedia', undefined)
    const { store, wrapper, vm } = setupTheme()

    store.setMode('dark')
    await nextTick()
    expect(vm.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // 没有 mql/handler 时卸载也必须安全（不能对空对象调方法）
    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('没有 document 的环境（SSR 预渲染）下跳过 DOM 写入，但 store 状态照常更新', async () => {
    const { store, wrapper } = setupTheme()

    // 先落到确定的浅色起点，避免受「上一个用例异步落盘的 mode」影响
    store.setMode('light')
    await nextTick()
    const html = document.documentElement
    expect(html.classList.contains('dark')).toBe(false)
    expect(html.style.colorScheme).toBe('light')

    vi.stubGlobal('document', undefined)
    store.setMode('dark')
    await nextTick()

    expect(store.isDark).toBe(true)
    // 没有 document 可写：既不抛错，也不能只写一半（类是浅的、color-scheme 却是深的）
    expect(html.classList.contains('dark')).toBe(false)
    expect(html.style.colorScheme).toBe('light')

    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('matchMedia 返回的对象连 addListener 都没有（实现残缺）时不抛错，只是失去跟随能力', async () => {
    // 极老/被打桩的环境：MediaQueryList 只有 matches/media，没有任何注册方法
    const mql: Record<string, unknown> = { matches: false, media: '(prefers-color-scheme: dark)' }
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mql),
    )
    const { store, wrapper, vm } = setupTheme()

    store.setMode('system')
    await nextTick()
    expect(vm.isDark).toBe(false)

    // 注册失败不该影响 store 本身：手动改偏好照样生效
    store.setSystemDark(true)
    await nextTick()
    expect(vm.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // 没有可注销的方法时卸载也必须安全
    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('system 模式下 toggleDark 把「当前实际明暗」取反为固定明/暗', async () => {
    stubMatchMedia(true) // 系统当前就是深色
    const { store, wrapper, vm } = setupTheme()
    store.setMode('system')
    await nextTick()
    expect(vm.isDark).toBe(true)

    vm.toggleDark()
    await nextTick()
    // 取反成固定浅色，而不是切回 system（否则用户会觉得「点了没反应」）
    expect(store.prefs.mode).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    wrapper.unmount()
  })
})
