import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useThemeStore, THEME_STORAGE_KEY } from './themeStore'
import type { ThemePrefs } from './themeStore'

async function flush() {
  await Promise.resolve()
}

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('默认偏好：跟随系统 + emerald + 默认密度/圆角', () => {
    const store = useThemeStore()
    expect(store.prefs.mode).toBe('system')
    expect(store.prefs.colorName).toBe('emerald')
    expect(store.prefs.customColor).toBeNull()
    expect(store.prefs.density).toBe('default')
    expect(store.prefs.radius).toBe('medium')
  })

  it('主色默认取预设色，自定义色优先', () => {
    const store = useThemeStore()
    expect(store.primaryColor).toBe('#10b981')
    store.setCustomColor('#ff0000')
    expect(store.primaryColor).toBe('#ff0000')
    // 选择预设色会清除自定义色
    store.setColorName('lavender')
    expect(store.prefs.colorName).toBe('lavender')
    expect(store.prefs.customColor).toBeNull()
    expect(store.primaryColor).toBe('#7c8cf8')
  })

  it('isDark 依据 mode 与 systemDark', () => {
    const store = useThemeStore()
    store.setMode('dark')
    expect(store.isDark).toBe(true)
    store.setMode('light')
    expect(store.isDark).toBe(false)
    // system 模式跟随系统
    store.setMode('system')
    store.setSystemDark(true)
    expect(store.isDark).toBe(true)
    store.setSystemDark(false)
    expect(store.isDark).toBe(false)
  })

  it('elSize 密度映射', () => {
    const store = useThemeStore()
    store.setDensity('compact')
    expect(store.elSize).toBe('small')
    store.setDensity('loose')
    expect(store.elSize).toBe('large')
    store.setDensity('default')
    expect(store.elSize).toBe('default')
  })

  it('radiusPx 圆角映射', () => {
    const store = useThemeStore()
    store.setRadius('small')
    expect(store.radiusPx).toBe(8)
    store.setRadius('medium')
    expect(store.radiusPx).toBe(12)
    store.setRadius('large')
    expect(store.radiusPx).toBe(16)
  })

  it('偏好持久化到 localStorage，重置恢复默认', async () => {
    const store = useThemeStore()
    store.setMode('dark')
    store.setDensity('compact')
    await flush()
    const persisted = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!) as ThemePrefs
    expect(persisted.mode).toBe('dark')
    expect(persisted.density).toBe('compact')

    store.reset()
    expect(store.prefs.mode).toBe('system')
    expect(store.prefs.density).toBe('default')
  })

  it('matchMedia 一调用就抛（受限 WebView / 老内核）时按浅色处理，store 照常可用', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('matchMedia is not supported')
    })
    // 先确认桩真的落在了 window.matchMedia 上，否则这条 catch 分支根本没被走到（假绿）
    expect(() => window.matchMedia('(prefers-color-scheme: dark)')).toThrow()

    setActivePinia(createPinia())
    const store = useThemeStore()

    // 读不出系统偏好就按浅色，而不是把整个 store 创建过程带崩
    expect(store.systemDark).toBe(false)
    store.setMode('system')
    expect(store.isDark).toBe(false)

    // 主题其它能力不受影响
    store.setMode('dark')
    expect(store.isDark).toBe(true)
  })

  it('老浏览器没有 matchMedia（不是抛错而是压根不存在）时也按浅色处理', () => {
    vi.stubGlobal('matchMedia', undefined)
    setActivePinia(createPinia())

    const store = useThemeStore()

    expect(store.systemDark).toBe(false)
    store.setMode('system')
    expect(store.isDark).toBe(false)
  })

  it('没有 window（SSR / 非浏览器宿主）时按浅色处理，不抛 ReferenceError', () => {
    vi.stubGlobal('window', undefined)
    setActivePinia(createPinia())

    const store = useThemeStore()

    expect(store.systemDark).toBe(false)
    vi.unstubAllGlobals()
  })

  it('localStorage 里的颜色名是脏数据（改了预设表/手改过）时回落到默认主色', () => {
    // 直接改坏的持久化数据不能让主色变成 undefined（界面会整片失色）
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ ...storeDefaults(), colorName: 'not-a-color', customColor: null }),
    )
    setActivePinia(createPinia())

    const store = useThemeStore()

    expect(store.primaryColor).toBe('#6366f1')
  })
})

/** 与 store 内部的默认偏好保持一致（只为构造「被改坏的存档」） */
function storeDefaults() {
  return {
    mode: 'system',
    colorName: 'emerald',
    customColor: null,
    density: 'default',
    radius: 'medium',
  }
}
