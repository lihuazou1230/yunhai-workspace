import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { buildChartTheme, useChartTheme } from './useChartTheme'
import { useThemeStore } from '@/stores/themeStore'

describe('buildChartTheme', () => {
  it('浅色与深色给两套中性色（深色下不能再用深灰字，那正是"图表发白"的成因）', () => {
    const light = buildChartTheme('#10b981', false)
    const dark = buildChartTheme('#10b981', true)

    expect(light.isDark).toBe(false)
    expect(dark.isDark).toBe(true)
    expect(light.label).not.toBe(dark.label)
    expect(light.split).not.toBe(dark.split)
    expect(light.empty).not.toBe(dark.empty)
  })

  it('背景一律透明（卡片自带底色与圆角，图表再铺一层就会在圆角处露直角）', () => {
    expect(buildChartTheme('#10b981', false).base.backgroundColor).toBe('transparent')
    expect(buildChartTheme('#10b981', true).base.backgroundColor).toBe('transparent')
  })

  it('提示框自带底色/边框/圆角（默认白底黑字在深色页面上非常刺眼）', () => {
    const tooltip = buildChartTheme('#10b981', true).base.tooltip as Record<string, unknown>
    expect(tooltip.backgroundColor).toBeTruthy()
    expect(tooltip.borderColor).toBeTruthy()
    expect(String(tooltip.extraCssText)).toContain('border-radius')
  })

  it('热力色阶由主题色派生：浅色向白混合、深色向深底混合，且都是 4 档', () => {
    const light = buildChartTheme('#10b981', false)
    const dark = buildChartTheme('#10b981', true)
    expect(light.heat).toHaveLength(4)
    expect(dark.heat).toHaveLength(4)
    // 最高档就是主色附近，两套不相同
    expect(light.heat).not.toEqual(dark.heat)
    expect(light.heat[0]).not.toBe(dark.heat[0])
  })

  it('主色变了整套配色跟着变（图表跟随主题色）', () => {
    expect(buildChartTheme('#f43f5e', false).heat).not.toEqual(
      buildChartTheme('#10b981', false).heat,
    )
  })
})

describe('useChartTheme', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('跟随 themeStore 的主色与深浅模式', () => {
    const themeStore = useThemeStore()
    const { tokens } = useChartTheme()

    themeStore.setColorName('rose')
    expect(tokens.value.primary).toBe('#f43f5e')
    expect(tokens.value.isDark).toBe(false)

    themeStore.setMode('dark')
    expect(tokens.value.isDark).toBe(true)
    // 深色令牌与浅色不是同一份（切主题会触发图表 setOption 重绘）
    expect(tokens.value.label).toBe('#94a3b8')
  })
})
