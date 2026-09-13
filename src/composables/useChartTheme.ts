/**
 * ECharts 主题令牌：让所有图表跟随主题色与深浅色模式。
 *
 * 解决的具体问题（第八阶段 8.1-6）：ECharts 默认按「浅色背景 + 深色文字」出图，
 * 页面切到深色后，画布透明背景下沉到深色卡片上，而坐标轴/图例文字仍是深灰——
 * 也就是"图表发白、字看不见"。这里的做法不是给 ECharts 传内置 dark 主题
 * （那会接管整套配色、和主题色脱钩），而是**显式给出每个色值**：
 * 深浅两套中性色 + 由主题色派生的热力色阶与强调色，主题一变 option 重算 → setOption 重绘。
 *
 * `buildChartTheme` 是纯函数，单测直接喂（主色, 深色）断言输出。
 */

import { computed } from 'vue'
import type { ComputedRef } from 'vue'

import { useThemeStore } from '@/stores/themeStore'
import { darken, lighten, mixHex } from '@/utils/themeColor'

export interface ChartThemeTokens {
  isDark: boolean
  /** 主题主色 */
  primary: string
  /** 坐标轴/图例文字 */
  label: string
  /** 更淡的次级文字（轴名、单位） */
  subLabel: string
  /** 网格线/轴线 */
  split: string
  /** 空位（无数据格）底色 */
  empty: string
  /** 第二序列的强调色（移动平均线） */
  accent: string
  /** 热力图色阶（低 → 高，4 档） */
  heat: string[]
  /** ECharts 公共片段：透明背景 + 文字/提示框配色（组件里 spread 进自己的 option） */
  base: Record<string, unknown>
}

/**
 * 由（主色, 是否深色）算出全部图表配色。
 *
 * 几个刻意的选择：
 * - **背景一律 transparent**：卡片本身已经有白/深色底与圆角，图表再铺一层纯色就会
 *   在圆角处露出直角（视觉上的"发白方块"正是这么来的）。
 * - **深色下的热力色阶向背景色混合**：直接用 `lighten` 会在深色底上糊成一片亮斑，
 *   所以低档位是"主色混深底色"。
 * - **提示框自带底色/边框/圆角/阴影**：ECharts 默认白底黑字，深色模式里非常刺眼。
 */
export function buildChartTheme(primary: string, isDark: boolean): ChartThemeTokens {
  const label = isDark ? '#94a3b8' : '#64748b'
  const subLabel = isDark ? '#64748b' : '#94a3b8'
  const split = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.22)'
  const empty = isDark ? '#334155' : '#e2e8f0'
  const tooltipBg = isDark ? 'rgba(15,23,42,0.94)' : 'rgba(255,255,255,0.97)'
  const tooltipBorder = isDark ? 'rgba(148,163,184,0.32)' : 'rgba(148,163,184,0.38)'
  const tooltipText = isDark ? '#e2e8f0' : '#334155'
  const accent = isDark ? '#fbbf24' : '#f59e0b'

  const heat = isDark
    ? [
        mixHex(primary, '#0f172a', 0.82),
        mixHex(primary, '#0f172a', 0.5),
        primary,
        lighten(primary, 0.28),
      ]
    : [lighten(primary, 0.88), lighten(primary, 0.62), primary, darken(primary, 0.32)]

  return {
    isDark,
    primary,
    label,
    subLabel,
    split,
    empty,
    accent,
    heat,
    base: {
      backgroundColor: 'transparent',
      textStyle: { color: label, fontSize: 11 },
      tooltip: {
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        textStyle: { color: tooltipText, fontSize: 12 },
        extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,0.14);',
      },
    },
  }
}

/** 连接 themeStore：主题色/深浅色一变，令牌与引用了它的 option 一起重算 */
export function useChartTheme(): { tokens: ComputedRef<ChartThemeTokens> } {
  const themeStore = useThemeStore()
  const tokens = computed(() => buildChartTheme(themeStore.primaryColor, themeStore.isDark))
  return { tokens }
}
