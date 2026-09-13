import { describe, expect, it } from 'vitest'

// 用 Vite 的 `?raw` 把 index.html 当字符串读进来：
// 这样不必 import node:fs / 用 process（应用的 tsconfig 不含 node 类型，会 TS2591）。
import indexHtml from '../index.html?raw'

/**
 * 首屏预置深色的结构守卫。
 *
 * 这段逻辑必须内联在 index.html 的 <head> 里（要早于样式表生效），
 * 没法当模块 import 来单测，所以这里直接对源文件做结构断言：
 * 脚本在不在、是否在入口模块之前、判定口径是否与 themeStore 一致。
 * 一旦有人顺手删掉它，深色用户就会重新开始「闪白」。
 */
describe('index.html · 首屏深色预置', () => {
  it('head 里有预置脚本，且早于入口模块（否则样式先生效，还是会闪一帧浅色）', () => {
    expect(indexHtml).toContain('smart-workspace:theme')
    expect(indexHtml).toContain("classList.add('dark')")

    const scriptAt = indexHtml.indexOf("classList.add('dark')")
    const entryAt = indexHtml.indexOf('/src/main.ts')
    expect(scriptAt).toBeGreaterThan(-1)
    expect(entryAt).toBeGreaterThan(-1)
    expect(scriptAt).toBeLessThan(entryAt)
  })

  it('判定口径与 themeStore.isDark 一致（dark 直通 / system 看系统偏好）', () => {
    expect(indexHtml).toContain("mode === 'dark'")
    expect(indexHtml).toContain("mode === 'system'")
    expect(indexHtml).toContain('prefers-color-scheme: dark')
  })

  it('读不到偏好或解析失败时静默忽略，不阻断首屏', () => {
    // 有 try/catch 兜住隐私模式下 localStorage 抛错
    expect(indexHtml).toContain('try {')
    expect(indexHtml).toContain('catch')
  })
})
