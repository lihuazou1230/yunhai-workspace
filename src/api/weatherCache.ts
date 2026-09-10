/**
 * 天气数据本地缓存（localStorage 持久化 + 内存兜底）
 *
 * 目的：省额度、二次查询秒开。
 * 免费高德 Key 限流较紧（实测需 ≥1s 间隔，否则 10021），缓存能显著减少请求：
 * - adcode 缓存：城市名 -> adcode，避免重复地理编码（「杭州」查过一次就不再请求地理编码）
 * - 天气缓存：adcode -> { 数据, 缓存时间 }，默认 30 分钟内视为新鲜，刷新页面依然有效
 */

import type { WeatherData } from '@/types/weather'

export const WEATHER_CACHE_KEY = 'smart-workspace:weather-cache'

/** 缓存有效期：30 分钟（规划口径；高德实况天气每小时更新多次，30 分钟足够新鲜） */
export const WEATHER_CACHE_TTL = 30 * 60 * 1000

export interface WeatherCacheEntry {
  data: WeatherData
  /** 写入缓存的时间戳 ms */
  cachedAt: number
}

export interface WeatherCacheState {
  /** 规范化城市名 -> adcode */
  adcode: Record<string, string>
  /** adcode -> 天气数据 */
  weather: Record<string, WeatherCacheEntry>
}

/** 统一缓存键：去空白 + 去常见行政区后缀（「北京市」与「北京」视为同一城市） */
export function normalizeCityKey(name: string): string {
  return name.trim().replace(/[市省县区]$/, '')
}

/** 缓存是否仍在有效期内（纯函数，便于单测） */
export function isFresh(
  cachedAt: number,
  now: number = Date.now(),
  ttl: number = WEATHER_CACHE_TTL,
): boolean {
  return now - cachedAt < ttl
}

export interface WeatherCache {
  getAdcode(city: string): string | undefined
  setAdcode(city: string, adcode: string): void
  /** 命中且未过期才返回数据 */
  getWeather(adcode: string, now?: number): WeatherData | undefined
  setWeather(adcode: string, data: WeatherData, now?: number): void
  clear(): void
}

function emptyState(): WeatherCacheState {
  return { adcode: {}, weather: {} }
}

function defaultStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null
}

/**
 * 创建缓存实例。
 * @param storage 可注入存储实现（默认 window.localStorage），便于测试；传 null 则仅用内存
 */
export function createWeatherCache(storage?: Storage | null): WeatherCache {
  const target = storage !== undefined ? storage : defaultStorage()
  /** 存储不可用（无 storage / 隐私模式 / 容量超限）时的内存兜底 */
  let memory = emptyState()
  let storageBroken = false

  // 每次都从存储读取，避免多实例/多标签页之间拿到过期副本
  function load(): WeatherCacheState {
    if (!target || storageBroken) return memory
    try {
      const raw = target.getItem(WEATHER_CACHE_KEY)
      if (!raw) return emptyState()
      const parsed = JSON.parse(raw) as Partial<WeatherCacheState>
      return { adcode: parsed.adcode ?? {}, weather: parsed.weather ?? {} }
    } catch {
      storageBroken = true
      return memory
    }
  }

  function persist(state: WeatherCacheState) {
    memory = state
    if (!target || storageBroken) return
    try {
      target.setItem(WEATHER_CACHE_KEY, JSON.stringify(state))
    } catch {
      // 写入失败（隐私模式/超限）：降级为仅内存
      storageBroken = true
    }
  }

  return {
    getAdcode(city) {
      return load().adcode[normalizeCityKey(city)]
    },
    setAdcode(city, adcode) {
      const state = load()
      state.adcode[normalizeCityKey(city)] = adcode
      persist(state)
    },
    getWeather(adcode, now = Date.now()) {
      const entry = load().weather[adcode]
      return entry && isFresh(entry.cachedAt, now) ? entry.data : undefined
    },
    setWeather(adcode, data, now = Date.now()) {
      const state = load()
      state.weather[adcode] = { data, cachedAt: now }
      persist(state)
    },
    clear() {
      persist(emptyState())
    },
  }
}

/** 应用级默认缓存：localStorage 持久化，刷新页面仍然有效 */
export const weatherCache = createWeatherCache()
