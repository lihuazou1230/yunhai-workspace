import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import WallpaperSettings from './WallpaperSettings.vue'
import { useWallpaperStore } from '@/stores/wallpaperStore'

/**
 * 回归：设置面板曾经在 `onUnmounted` 里 `store.dispose()`。
 *
 * 壁纸是 **App 级**视觉（背景绑在 App 根容器上），面板只是它的设置界面；
 * 登出会连带卸载 DefaultLayout → 面板一起卸载，于是 objectURL 被释放，
 * 而重新登录后没有地方会再调 `init()`（App 只在启动时调一次，
 * 面板要等用户再进设置页才挂载）—— 表现就是「登出再登录，图片壁纸没了」。
 *
 * 这里守的是契约本身：**卸载面板不得释放 App 级资源**。
 */
describe('WallpaperSettings · 生命周期契约', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('卸载设置面板不会 dispose 壁纸（登出再登录后图片还在）', () => {
    // 必须让组件用**同一个** pinia 实例，否则 spy 盯的是另一个 store
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWallpaperStore()
    const disposeSpy = vi.spyOn(store, 'dispose')

    const wrapper = mount(WallpaperSettings, { global: { plugins: [pinia] } })
    expect(disposeSpy).not.toHaveBeenCalled()

    wrapper.unmount()
    expect(disposeSpy).not.toHaveBeenCalled()
  })

  it('挂载面板仍会尝试恢复图片（init 被调用一次）', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWallpaperStore()
    const initSpy = vi.spyOn(store, 'init')

    const wrapper = mount(WallpaperSettings, { global: { plugins: [pinia] } })
    expect(initSpy).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
