import { describe, expect, it } from 'vitest'

// 用 `?raw` 读样式源文件：这是全局 CSS 降级规则，没有可断言的组件行为，只能做结构守卫
import customCss from '@/assets/styles/custom.css?raw'
import todoItem from '@/components/molecules/TodoItem.vue?raw'

/**
 * `prefers-reduced-motion` 的降级策略守卫。
 *
 * 策略（2026-09-14 收窄，原来是 `*` 一刀切）：按**动效类型**分档 ——
 * 位移/缩放/旋转关掉，颜色与透明度这类轻过渡保留。
 *
 * 为什么不用通配符把 transition 也压掉：那会连"点完成之后的反馈"一起抹掉，
 * 用户会以为操作没生效 —— 可用性问题不比动效敏感更轻。
 */
/**
 * 只看**生效的规则**：把注释剥掉再断言。
 * 否则「不再使用 transition-duration: 0.01ms」这类断言会被注释里引用的旧写法误伤
 * （注释里正解释着"以前是这么写的"）。
 */
const css = customCss.replace(/\/\*[\s\S]*?\*\//g, '')

describe('减少动效的降级范围', () => {
  it('存在 prefers-reduced-motion 媒体查询', () => {
    expect(customCss).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('大幅位移/缩放的动画被显式关掉（白名单，不用通配符）', () => {
    // 任务行的滑入滑出
    for (const cls of [
      '.anim-slide-left',
      '.anim-slide-right',
      '.anim-reveal-right',
      '.anim-enter-left',
    ]) {
      expect(css).toContain(cls)
    }
    // 礼花：粒子飞散 + 光环扩散
    expect(css).toContain('.particle')
    expect(css).toContain('.burst-ring')
    // 关掉的方式是 animation: none，而不是把时长压成 0.01ms
    expect(css).toMatch(/\.anim-slide-left,[\s\S]*?animation:\s*none\s*!important/)
  })

  it('无限动画压成只播一次（否则会被压成高频闪烁，比原动画更糟）', () => {
    expect(css).toContain('animation-duration: 0.01ms !important')
    expect(css).toContain('animation-iteration-count: 1 !important')
  })

  it('**不再**用通配符压掉 transition（保住颜色/透明度这类轻过渡）', () => {
    // 这条是本次策略调整的核心：transition-duration 不应再出现在任何生效规则里
    expect(css).not.toContain('transition-duration: 0.01ms !important')
    expect(css).not.toContain('transition-duration: 0.01ms')
  })

  it('只改 opacity 的完成淡出被恢复成正常时长（抵消通配符的 0.01ms）', () => {
    // 组件侧：存在只改透明度的完成动画
    expect(todoItem).toContain('.anim-fade-out')
    expect(todoItem).toContain('@keyframes fade-out')
    // 全局侧：在通配符之后把它恢复回来
    const fadeIdx = css.indexOf('.anim-fade-out {')
    const wildcardIdx = css.indexOf('animation-duration: 0.01ms !important')
    expect(wildcardIdx).toBeGreaterThan(-1)
    expect(fadeIdx).toBeGreaterThan(wildcardIdx)
  })

  it('平滑滚动属于位移动效，关掉', () => {
    expect(css).toContain('scroll-behavior: auto !important')
  })

  it('秒表数字仍保留原有的彻底关闭过渡', () => {
    expect(css).toContain('.digit-strip')
    expect(css).toContain('transition: none')
  })
})
