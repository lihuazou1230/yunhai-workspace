import { describe, expect, it } from 'vitest'

import {
  THEME_COLOR_NAMES,
  THEME_COLOR_PRESETS,
  darken,
  hexToRgb,
  isThemeColorName,
  lighten,
  mixHex,
  rgbToHex,
} from './themeColor'

describe('预设色板', () => {
  it('THEME_COLOR_NAMES 与色板 key 完全一致（设置页按它遍历渲染色块）', () => {
    expect(THEME_COLOR_NAMES).toEqual(Object.keys(THEME_COLOR_PRESETS))
    expect(THEME_COLOR_NAMES.length).toBeGreaterThanOrEqual(2)
  })

  it('每个预设都是能直接塞进 CSS 变量的 6 位小写 hex', () => {
    for (const name of THEME_COLOR_NAMES) {
      expect(THEME_COLOR_PRESETS[name], name).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('默认仍是 emerald（改掉它等于换掉整个应用的观感，必须是审慎的改动）', () => {
    expect(THEME_COLOR_PRESETS.emerald).toBe('#10b981')
  })
})

describe('isThemeColorName', () => {
  it('预设名一律为真（设置页据此回填当前选中项）', () => {
    for (const name of THEME_COLOR_NAMES) expect(isThemeColorName(name)).toBe(true)
  })

  it('其它字符串一律为假：hex 值、空串、带空白的名字都不是色名', () => {
    expect(isThemeColorName('#fff')).toBe(false)
    expect(isThemeColorName('#10b981')).toBe(false)
    expect(isThemeColorName('')).toBe(false)
    // 手改 localStorage 时容易多打空格，这里不做 trim 容错，直接判非法
    expect(isThemeColorName(' emerald')).toBe(false)
    expect(isThemeColorName('不存在的色')).toBe(false)
  })

  it('非字符串输入不崩且为假（localStorage 里的脏值可能是任何类型）', () => {
    expect(isThemeColorName(null)).toBe(false)
    expect(isThemeColorName(undefined)).toBe(false)
    expect(isThemeColorName(123)).toBe(false)
    expect(isThemeColorName({})).toBe(false)
    expect(isThemeColorName(['emerald'])).toBe(false)
  })

  it('原型链上的属性名不再被误判为合法色名（用 Object.hasOwn 而非 in）', () => {
    // 这条曾经是漏洞：`'toString' in PRESETS` 走原型链返回 true，themeStore 就会把
    // 一个函数当成颜色串去解析，整套主题变量渲染不出来。现已改用 Object.hasOwn。
    expect(isThemeColorName('toString')).toBe(false)
    expect(isThemeColorName('constructor')).toBe(false)
    expect(isThemeColorName('hasOwnProperty')).toBe(false)
    expect(isThemeColorName('__proto__')).toBe(false)
  })
})

describe('hexToRgb', () => {
  it('6 位 hex 按通道拆开', () => {
    expect(hexToRgb('#10b981')).toEqual([16, 185, 129])
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
  })

  it('3 位简写按「每位重复一次」展开（#abc 是 #aabbcc，不是 #abcabc）', () => {
    expect(hexToRgb('#abc')).toEqual([0xaa, 0xbb, 0xcc])
    expect(hexToRgb('#abc')).toEqual(hexToRgb('#aabbcc'))
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
    expect(hexToRgb('#000')).toEqual([0, 0, 0])
  })

  it('容忍缺 # 与首尾空白（取色器与手写的写法并不统一）', () => {
    expect(hexToRgb('10b981')).toEqual([16, 185, 129])
    expect(hexToRgb('  #10b981  ')).toEqual([16, 185, 129])
  })
})

describe('rgbToHex', () => {
  it('每个通道补足两位（少补零会把 #000000 写成 #000）', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
    expect(rgbToHex(10, 11, 12)).toBe('#0a0b0c')
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff')
  })

  it('与 hexToRgb 互逆：预设色来回一趟不掉精度', () => {
    for (const name of THEME_COLOR_NAMES) {
      const hex = THEME_COLOR_PRESETS[name]
      const [r, g, b] = hexToRgb(hex)
      expect(rgbToHex(r, g, b)).toBe(hex)
    }
  })
})

describe('mixHex / lighten / darken（Element Plus 主题色阶梯）', () => {
  it('比例 0 保持原色、比例 1 完全变成目标色', () => {
    expect(mixHex(THEME_COLOR_PRESETS.emerald, '#ffffff', 0)).toBe(THEME_COLOR_PRESETS.emerald)
    expect(mixHex(THEME_COLOR_PRESETS.emerald, '#ffffff', 1)).toBe('#ffffff')
    expect(lighten(THEME_COLOR_PRESETS.emerald, 1)).toBe('#ffffff')
    expect(darken(THEME_COLOR_PRESETS.emerald, 1)).toBe('#000000')
  })

  it('中间比例按 0.5 向上取整（换实现成「五成双」会得到不同色阶）', () => {
    expect(mixHex('#000000', '#030303', 0.5)).toBe('#020202')
    expect(mixHex('#000000', '#010101', 0.5)).toBe('#010101')
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080')
  })

  it('默认 emerald 主题的实际变量值（改公式会让全站按钮色阶一起变）', () => {
    // --el-color-primary-light-3 / light-5 / dark-2
    expect(lighten(THEME_COLOR_PRESETS.emerald, 0.3)).toBe('#58cea7')
    expect(lighten(THEME_COLOR_PRESETS.emerald, 0.5)).toBe('#88dcc0')
    expect(darken(THEME_COLOR_PRESETS.emerald, 0.2)).toBe('#0d9467')
  })

  it('3 位简写的自定义色也能算色阶（自定义取色允许简写输入）', () => {
    expect(lighten('#abc', 0.5)).toBe('#d5dde6')
    expect(darken('#abc', 0.5)).toBe('#555e66')
  })

  it('同一颜色混自己等于没混（阶梯不会因重复计算而漂移）', () => {
    expect(mixHex('#7c8cf8', '#7c8cf8', 0.37)).toBe('#7c8cf8')
  })
})
