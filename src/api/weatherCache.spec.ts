import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createWeatherCache,
  isFresh,
  normalizeCityKey,
  WEATHER_CACHE_KEY,
  WEATHER_CACHE_TTL,
} from './weatherCache'
import type { WeatherData } from '@/types/weather'

/** 内存版 Storage：不依赖 happy-dom 的 localStorage 状态，便于精确控制 */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
  } as Storage
}

const DATA: WeatherData = {
  city: '杭州市',
  province: '浙江',
  temperature: 27,
  description: '多云',
  icon: '⛅',
  humidity: 49,
  windDirection: '西北',
  windPower: '4',
  updatedAt: 1789014930000,
}

describe('normalizeCityKey', () => {
  it('去空白与行政区后缀，「北京市」与「北京」归一为同一键', () => {
    expect(normalizeCityKey('  北京市 ')).toBe('北京')
    expect(normalizeCityKey('杭州')).toBe('杭州')
    expect(normalizeCityKey('杭州市')).toBe('杭州')
  })
})

describe('isFresh', () => {
  it('TTL 内新鲜，达到 TTL 即失效', () => {
    const now = 1_000_000
    expect(isFresh(now - 1000, now)).toBe(true)
    expect(isFresh(now - WEATHER_CACHE_TTL + 1, now)).toBe(true)
    expect(isFresh(now - WEATHER_CACHE_TTL, now)).toBe(false)
    expect(isFresh(now - WEATHER_CACHE_TTL - 1, now)).toBe(false)
  })
})

describe('weatherCache', () => {
  let storage: Storage
  let cache: ReturnType<typeof createWeatherCache>

  beforeEach(() => {
    storage = memoryStorage()
    cache = createWeatherCache(storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adcode 缓存：写入后不同写法都能命中', () => {
    expect(cache.getAdcode('杭州')).toBeUndefined()
    cache.setAdcode('杭州', '330100')
    expect(cache.getAdcode('杭州')).toBe('330100')
    expect(cache.getAdcode(' 杭州 ')).toBe('330100')

    cache.setAdcode('北京市', '110000')
    expect(cache.getAdcode('北京')).toBe('110000')
  })

  it('天气缓存：TTL 内命中，超时失效', () => {
    const now = 2_000_000
    cache.setWeather('330100', DATA, now)
    expect(cache.getWeather('330100', now + 1000)).toEqual(DATA)
    expect(cache.getWeather('330100', now + WEATHER_CACHE_TTL - 1)).toEqual(DATA)
    expect(cache.getWeather('330100', now + WEATHER_CACHE_TTL)).toBeUndefined()
  })

  it('写入 storage：新实例可复用（刷新页面后缓存仍在）', () => {
    const now = 3_000_000
    cache.setAdcode('苏州', '320500')
    cache.setWeather('320500', DATA, now)

    const reopened = createWeatherCache(storage)
    expect(reopened.getAdcode('苏州')).toBe('320500')
    expect(reopened.getWeather('320500', now + 1000)).toEqual(DATA)
  })

  it('clear 清空全部缓存', () => {
    cache.setAdcode('杭州', '330100')
    cache.setWeather('330100', DATA)
    cache.clear()
    expect(cache.getAdcode('杭州')).toBeUndefined()
    expect(cache.getWeather('330100')).toBeUndefined()
  })

  it('存储内容损坏时安全回落，不抛错', () => {
    storage.setItem(WEATHER_CACHE_KEY, '{ 这不是 json')
    expect(cache.getAdcode('杭州')).toBeUndefined()
    cache.setAdcode('杭州', '330100')
    expect(cache.getAdcode('杭州')).toBe('330100')
  })

  it('写入失败（配额超限 / 隐私模式）时降级为纯内存：本次仍可读写，不再反复抛错', () => {
    const broken = memoryStorage()
    // Safari 隐私模式下 localStorage 存在但 setItem 直接抛 QuotaExceededError
    broken.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const memoryOnly = createWeatherCache(broken)

    memoryOnly.setAdcode('杭州', '330100')
    memoryOnly.setWeather('330100', DATA)

    // 降级后数据只能存在内存里，但「写入即读得到」这条契约不能破
    expect(memoryOnly.getAdcode('杭州')).toBe('330100')
    expect(memoryOnly.getWeather('330100')).toEqual(DATA)
    expect(broken.getItem(WEATHER_CACHE_KEY)).toBeNull()
  })

  it('无 storage（隐私模式）时退化为内存缓存，仍可用', () => {
    const memoryOnly = createWeatherCache(null)
    memoryOnly.setAdcode('北京', '110000')
    memoryOnly.setWeather('110000', DATA)
    expect(memoryOnly.getAdcode('北京')).toBe('110000')
    expect(memoryOnly.getWeather('110000')).toEqual(DATA)
    memoryOnly.clear()
    expect(memoryOnly.getWeather('110000')).toBeUndefined()
  })

  it('缓存里缺 adcode 字段（旧版本只写了天气）时按空表处理，写入后照常可用', () => {
    storage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ weather: {} }))

    expect(cache.getAdcode('杭州')).toBeUndefined()
    cache.setAdcode('杭州', '330100')
    expect(cache.getAdcode('杭州')).toBe('330100')
  })

  it('缓存里缺 weather 字段时天气查询按未命中处理，地理编码缓存仍可复用', () => {
    storage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ adcode: { 杭州: '330100' } }))

    expect(cache.getAdcode('杭州')).toBe('330100')
    expect(cache.getWeather('330100')).toBeUndefined()
    cache.setWeather('330100', DATA)
    expect(cache.getWeather('330100')).toEqual(DATA)
  })

  it('没有 window（SSR / 非浏览器宿主）时默认实例静默降级为纯内存', () => {
    // 默认实例在模块加载时创建，若这里不兜住 window 缺失，整个模块导入就会抛 ReferenceError
    vi.stubGlobal('window', undefined)

    const ssr = createWeatherCache()
    ssr.setAdcode('北京', '110000')
    ssr.setWeather('110000', DATA)

    expect(ssr.getAdcode('北京')).toBe('110000')
    expect(ssr.getWeather('110000')).toEqual(DATA)
  })
})
