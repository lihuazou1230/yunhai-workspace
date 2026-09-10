/** 主题色工具：预设色板、hex ↔ rgb、提亮/压暗（用于运行时生成 Element Plus 变量） */

export type ThemeColorName = 'emerald' | 'lavender' | 'indigo' | 'rose' | 'amber' | 'sky' | 'violet'

/**
 * 预设色板。默认 **emerald**（Finexy 风格的克制绿色强调，语义契合"赚钱/完成"的正向指标）；
 * **lavender** 为淡蓝紫备选色调，设置页可一键切换。
 */
export const THEME_COLOR_PRESETS: Record<ThemeColorName, string> = {
  emerald: '#10b981',
  lavender: '#7c8cf8',
  indigo: '#6366f1',
  rose: '#f43f5e',
  amber: '#f59e0b',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
}

export const THEME_COLOR_NAMES = Object.keys(THEME_COLOR_PRESETS) as ThemeColorName[]

/** 校验是否为预设色名 */
export function isThemeColorName(value: unknown): value is ThemeColorName {
  // 同 searchEngine：用 Object.hasOwn 而不是 `in`，否则 'toString' 这类原型键会被放行，
  // 随后 THEME_COLOR_PRESETS['toString'] 取到函数、颜色解析出一堆 NaN。
  return typeof value === 'string' && Object.hasOwn(THEME_COLOR_PRESETS, value)
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0')
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** 把一个色向目标色混合 ratio（0~1，1 = 完全变成目标色） */
export function mixHex(color: string, target: string, ratio: number): string {
  const [r1, g1, b1] = hexToRgb(color)
  const [r2, g2, b2] = hexToRgb(target)
  const mix = (a: number, b: number) => Math.round(a + (b - a) * ratio)
  return rgbToHex(mix(r1, r2), mix(g1, g2), mix(b1, b2))
}

/** 向白色混合（提亮），ratio 越大越亮 */
export function lighten(color: string, ratio: number): string {
  return mixHex(color, '#ffffff', ratio)
}

/** 向黑色混合（压暗），ratio 越大越暗 */
export function darken(color: string, ratio: number): string {
  return mixHex(color, '#000000', ratio)
}
