import { describe, expect, it } from 'vitest'

// 用 `?raw` 读样式源文件：这是全局 CSS 降级规则，没有可断言的组件行为，只能做结构守卫
import customCss from '@/assets/styles/custom.css?raw'

/**
 * `prefers-reduced-motion` 的降级范围守卫。
 *
 * 规划明确要求「用户偏好减少动效时降级」，而此前只处理了秒表数字（`.digit-strip`）：
 * 任务行的滑出/滑入、礼花 burst、骨架 `animate-pulse`、大量 `transition-colors` 照播 ——
 * 对前庭功能敏感的用户来说，这些位移与缩放比数字滚动难受得多。
 */
describe('减少动效的降级范围', () => {
  it('存在 prefers-reduced-motion 媒体查询', () => {
    expect(customCss).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('不只是秒表数字：对全部元素做了动画/过渡压缩', () => {
    expect(customCss).toContain('animation-duration: 0.01ms !important')
    expect(customCss).toContain('transition-duration: 0.01ms !important')
    // 通配符覆盖（含伪元素），否则组件内的动画仍会漏网
    expect(customCss).toMatch(/\*,\s*\n\s*\*::before,\s*\n\s*\*::after/)
  })

  it('无限动画只播一次（否则会被压成高频闪烁，比原动画更糟）', () => {
    expect(customCss).toContain('animation-iteration-count: 1 !important')
  })

  it('秒表数字仍保留原有的彻底关闭过渡', () => {
    expect(customCss).toContain('.digit-strip')
    expect(customCss).toContain('transition: none')
  })
})
