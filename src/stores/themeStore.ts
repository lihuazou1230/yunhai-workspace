/**
 * 主题状态（Pinia）：深色/浅色、主题色、圆角、密度，持久化到 localStorage。
 * 系统深色偏好（systemDark）为运行时状态，不持久化，由 useTheme 同步。
 */

import { computed, ref } from 'vue'

import { defineStore } from 'pinia'

import { useSyncedStorage } from '@/composables/useSyncedStorage'
import { THEME_COLOR_PRESETS } from '@/utils/themeColor'
import type { ThemeColorName } from '@/utils/themeColor'

export const THEME_STORAGE_KEY = 'smart-workspace:theme'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ThemeDensity = 'compact' | 'default' | 'loose'
export type ThemeRadius = 'small' | 'medium' | 'large'

export interface ThemePrefs {
  mode: ThemeMode
  colorName: ThemeColorName
  /** 用户自定义颜色（hex）；非空时覆盖预设色 */
  customColor: string | null
  density: ThemeDensity
  radius: ThemeRadius
}

const DEFAULT_THEME: ThemePrefs = {
  mode: 'system',
  // 视觉规范默认 emerald（可切 lavender 等预设，或自定义取色）
  colorName: 'emerald',
  customColor: null,
  density: 'default',
  radius: 'medium',
}

function readSystemDark(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export const useThemeStore = defineStore('theme', () => {
  // 第九阶段：外观偏好跟账号走（换设备不再"像换了个应用"）
  const prefs = useSyncedStorage<ThemePrefs>(THEME_STORAGE_KEY, { ...DEFAULT_THEME })
  /** 系统深色偏好（运行时，不持久化） */
  const systemDark = ref(readSystemDark())

  // ---- getters ----
  /** 实际主色：优先自定义色，否则用预设色 */
  const primaryColor = computed<string>(() => {
    if (prefs.value.customColor) return prefs.value.customColor
    return THEME_COLOR_PRESETS[prefs.value.colorName] ?? THEME_COLOR_PRESETS.indigo
  })

  /** 实际是否深色：dark 或（system 且系统为深色） */
  const isDark = computed<boolean>(
    () => prefs.value.mode === 'dark' || (prefs.value.mode === 'system' && systemDark.value),
  )

  /** 密度 -> Element Plus size */
  const elSize = computed<'small' | 'default' | 'large'>(() => {
    switch (prefs.value.density) {
      case 'compact':
        return 'small'
      case 'loose':
        return 'large'
      case 'default':
      default:
        return 'default'
    }
  })

  /** 圆角 -> px（视觉规范：卡片吃 +8px，得到 16/20/24px 的大圆角卡片） */
  const radiusPx = computed<number>(() => {
    switch (prefs.value.radius) {
      case 'small':
        return 8
      case 'large':
        return 16
      case 'medium':
      default:
        return 12
    }
  })

  // ---- actions ----
  function setMode(mode: ThemeMode) {
    prefs.value.mode = mode
  }
  function setColorName(colorName: ThemeColorName) {
    prefs.value.colorName = colorName
    prefs.value.customColor = null
  }
  function setCustomColor(hex: string) {
    prefs.value.customColor = hex
  }
  function setDensity(density: ThemeDensity) {
    prefs.value.density = density
  }
  function setRadius(radius: ThemeRadius) {
    prefs.value.radius = radius
  }
  function setSystemDark(val: boolean) {
    systemDark.value = val
  }
  function reset() {
    prefs.value = { ...DEFAULT_THEME }
  }

  return {
    prefs,
    systemDark,
    primaryColor,
    isDark,
    elSize,
    radiusPx,
    setMode,
    setColorName,
    setCustomColor,
    setDensity,
    setRadius,
    setSystemDark,
    reset,
  }
})
