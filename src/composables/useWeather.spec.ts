import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readRememberedPlace, useWeather } from './useWeather'
import { WEATHER_CACHE_KEY } from '@/api/weatherCache'

const DENIED_KEY = 'smart-workspace:geo-denied'
const LAST_PLACE_KEY = 'smart-workspace:last-place'

/** 构造最小可用的 fetch Response 替身 */
function mockJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }
}

const WEATHER_OK = {
  status: '1',
  info: 'OK',
  infocode: '10000',
  lives: [
    {
      province: '江西',
      city: '青山湖区',
      adcode: '360111',
      weather: '晴',
      temperature: '27',
      winddirection: '东北',
      windpower: '5',
      humidity: '44',
      reporttime: '2026-09-10 13:00:00',
    },
  ],
}

const REGEO_OK = {
  status: '1',
  info: 'OK',
  infocode: '10000',
  regeocode: {
    addressComponent: {
      province: '江西省',
      city: '南昌市',
      district: '青山湖区',
      adcode: '360111',
    },
  },
}

/** 用假的 navigator.geolocation 替换浏览器定位 */
function stubGeo(mode: 'ok' | 'denied' | 'none') {
  if (mode === 'none') {
    vi.stubGlobal('navigator', {})
    return
  }
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (
        success: (p: { coords: { latitude: number; longitude: number } }) => void,
        error?: (e: { code: number }) => void,
      ) => {
        if (mode === 'ok') success({ coords: { latitude: 28.68, longitude: 115.9 } })
        else error?.({ code: 1 })
      },
    },
  })
}

/** 记录所有请求 URL 的 fetch 替身 */
function stubFetch(recorder: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      recorder.push(u)
      return u.includes('regeo') ? mockJson(REGEO_OK) : mockJson(WEATHER_OK)
    }),
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_AMAP_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('useWeather（只展示当前位置）', () => {
  it('进站自动定位并显示当前位置的天气（区 · 城市 · 省份）', async () => {
    stubGeo('ok')
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await w.init()

    expect(urls.some((u) => u.includes('regeo'))).toBe(true)
    expect(urls.some((u) => u.includes('weatherInfo'))).toBe(true)
    expect(w.state.value).toBe('success')
    expect(w.located.value).toBe(true)
    expect(w.locateHint.value).toContain('已定位')
    // 位置文案取自逆地理编码（天气接口的 city 字段其实是区名）
    expect(w.placeLabel.value).toBe('青山湖区 · 南昌市 · 江西省')
  })

  it('定位到直辖市时位置文案为「区 · 城市」', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: (p: unknown) => void) =>
          success({ coords: { latitude: 31.2304, longitude: 121.4737 } }),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('regeo')
          ? mockJson({
              status: '1',
              info: 'OK',
              infocode: '10000',
              regeocode: {
                addressComponent: {
                  province: '上海市',
                  city: [],
                  district: '黄浦区',
                  adcode: '310101',
                },
              },
            })
          : mockJson(WEATHER_OK),
      ),
    )

    const w = useWeather()
    await w.init()

    expect(w.placeLabel.value).toBe('黄浦区 · 上海市')
  })

  it('回落默认城市时位置文案改用天气接口的城市/省份', async () => {
    stubGeo('denied')
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await w.init()

    expect(w.located.value).toBe(false)
    // WEATHER_OK 返回 city=青山湖区 / province=江西
    expect(w.placeLabel.value).toBe('青山湖区 · 江西')
  })

  it('定位被拒：回落默认城市，说明原因，并记住「已拒绝」', async () => {
    stubGeo('denied')
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await w.init()

    // 定位就失败了，不会走到逆地理编码
    expect(urls.some((u) => u.includes('regeo'))).toBe(false)
    expect(w.state.value).toBe('success')
    expect(w.located.value).toBe(false)
    expect(w.locateHint.value).toContain('定位权限被拒绝')
    expect(w.locateHint.value).toContain('已显示默认城市')
    expect(localStorage.getItem(DENIED_KEY)).toBe('1')
  })

  it('已记录「拒绝过定位」：进站不再调用定位，直接显示默认城市', async () => {
    localStorage.setItem(DENIED_KEY, '1')
    const geoSpy = vi.fn()
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: geoSpy } })
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await w.init()

    expect(geoSpy).not.toHaveBeenCalled()
    expect(w.state.value).toBe('success')
    expect(w.locateHint.value).toContain('定位权限已被拒绝')
  })

  it('浏览器不支持定位：回落默认城市', async () => {
    stubGeo('none')
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await w.init()

    expect(w.state.value).toBe('success')
    expect(w.located.value).toBe(false)
    expect(w.locateHint.value).toContain('不支持定位')
  })

  it('「📍 定位」可重新定位，覆盖先前的回落结果', async () => {
    localStorage.setItem(DENIED_KEY, '1')
    stubGeo('ok')
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await w.init()
    expect(w.located.value).toBe(false)

    await w.locate()
    expect(w.located.value).toBe(true)
    expect(w.locateHint.value).toContain('已定位')
  })

  it('「↻ 刷新」跳过缓存，重新请求一次', async () => {
    stubGeo('ok')
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await w.init()
    const weatherCallsBefore = urls.filter((u) => u.includes('weatherInfo')).length

    await w.refresh()
    const weatherCallsAfter = urls.filter((u) => u.includes('weatherInfo')).length

    expect(weatherCallsAfter).toBe(weatherCallsBefore + 1)
    expect(w.fromCache.value).toBe(false)
  })

  it('未配置 Key 时不做任何请求、也不定位', async () => {
    vi.stubEnv('VITE_AMAP_KEY', '')
    stubGeo('ok')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const w = useWeather()
    expect(w.configured.value).toBe(false)
    await expect(w.init()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useWeather（降级链路：定位 → 上次的位置 → 默认城市）', () => {
  it('定位成功会记住位置，供下次回退使用', async () => {
    stubGeo('ok')
    stubFetch([])

    const w = useWeather()
    await w.init()

    expect(readRememberedPlace()).toEqual({
      adcode: '360111',
      label: '青山湖区 · 南昌市 · 江西省',
    })
  })

  it('定位被拒但有记忆：回退到上次的位置，而不是默认城市', async () => {
    // 第一次进站定位成功 → 写入记忆
    stubGeo('ok')
    stubFetch([])
    const first = useWeather()
    await first.init()
    expect(first.located.value).toBe(true)

    // 清掉天气缓存（保留记忆），确保第二次真的发请求，从而验证请求目标
    const remembered = localStorage.getItem(LAST_PLACE_KEY)
    localStorage.clear()
    localStorage.setItem(LAST_PLACE_KEY, remembered ?? '')

    // 第二次进站定位被拒 → 应使用记忆中的位置
    stubGeo('denied')
    const urls: string[] = []
    stubFetch(urls)
    const second = useWeather()
    await second.init()

    expect(second.state.value).toBe('success')
    expect(second.located.value).toBe(false)
    expect(second.placeLabel.value).toBe('青山湖区 · 南昌市 · 江西省')
    expect(second.locateHint.value).toContain('定位权限被拒绝')
    expect(second.locateHint.value).toContain('已显示上次的位置')
    // 请求用的是记忆里的 adcode（高德 adcode 直查，不再走地理编码）
    expect(urls.some((u) => u.includes('regeo'))).toBe(false)
    expect(urls.some((u) => u.includes('360111'))).toBe(true)
  })

  it('二次进站命中 10 分钟缓存：位置仍来自记忆，且不重复请求', async () => {
    stubGeo('ok')
    stubFetch([])
    await useWeather().init()

    stubGeo('denied')
    const urls: string[] = []
    stubFetch(urls)
    const second = useWeather()
    await second.init()

    expect(second.placeLabel.value).toBe('青山湖区 · 南昌市 · 江西省')
    expect(second.fromCache.value).toBe(true)
    expect(urls).toHaveLength(0)
  })

  it('已记录「拒绝过定位」且有记忆：跳过定位调用，直接用上次的位置', async () => {
    localStorage.setItem(DENIED_KEY, '1')
    localStorage.setItem(
      LAST_PLACE_KEY,
      JSON.stringify({ adcode: '360111', label: '青山湖区 · 南昌市 · 江西省' }),
    )
    const geoSpy = vi.fn()
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: geoSpy } })
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await expect(w.init()).resolves.toBe(true)

    expect(geoSpy).not.toHaveBeenCalled()
    expect(w.placeLabel.value).toBe('青山湖区 · 南昌市 · 江西省')
    expect(w.locateHint.value).toBe('定位权限已被拒绝，已显示上次的位置')
  })

  it('定位失败但有记忆：说明原因并回退到上次的位置', async () => {
    localStorage.setItem(
      LAST_PLACE_KEY,
      JSON.stringify({ adcode: '360111', label: '青山湖区 · 南昌市 · 江西省' }),
    )
    stubGeo('none')
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await w.init()

    expect(w.state.value).toBe('success')
    expect(w.placeLabel.value).toBe('青山湖区 · 南昌市 · 江西省')
    expect(w.locateHint.value).toContain('不支持定位')
    expect(w.locateHint.value).toContain('已显示上次的位置')
  })

  it('没有记忆时仍回落默认城市（原行为不变）', async () => {
    stubGeo('denied')
    const urls: string[] = []
    stubFetch(urls)

    const w = useWeather()
    await w.init()

    expect(w.locateHint.value).toContain('已显示默认城市')
    expect(w.locateHint.value).not.toContain('上次的位置')
  })

  it('记忆数据损坏时按「没有记忆」处理，不影响进站', async () => {
    localStorage.setItem(LAST_PLACE_KEY, '{ 坏数据')
    expect(readRememberedPlace()).toBeNull()
    localStorage.setItem(LAST_PLACE_KEY, JSON.stringify({ label: '缺 adcode' }))
    expect(readRememberedPlace()).toBeNull()

    stubGeo('denied')
    stubFetch([])
    const w = useWeather()
    await expect(w.init()).resolves.toBe(true)
    expect(w.locateHint.value).toContain('已显示默认城市')
  })

  it('记忆中的位置也请求失败时，继续降级到默认城市', async () => {
    localStorage.setItem(
      LAST_PLACE_KEY,
      JSON.stringify({ adcode: '999999', label: '某个已失效的位置' }),
    )
    stubGeo('denied')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('999999')) throw new Error('网络异常')
        return mockJson(WEATHER_OK)
      }),
    )

    const w = useWeather()
    await expect(w.init()).resolves.toBe(true)
    expect(w.state.value).toBe('success')
    expect(w.locateHint.value).toContain('已显示默认城市')
  })
})

/** 地理编码响应（城市名 -> adcode） */
const GEOCODE_OK = {
  status: '1',
  info: 'OK',
  infocode: '10000',
  geocodes: [
    { formatted_address: '江西省南昌市', province: '江西省', city: '南昌市', adcode: '360100' },
  ],
}

/** 路由式 fetch 替身：geocode/geo 返回地理编码，其余返回实况天气 */
function stubRoutedFetch(recorder: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      recorder.push(u)
      if (u.includes('geocode/geo')) return mockJson(GEOCODE_OK)
      if (u.includes('regeo')) return mockJson(REGEO_OK)
      return mockJson(WEATHER_OK)
    }),
  )
}

describe('useWeather · 手动切换城市（规划第三阶段要求保留的能力）', () => {
  it('命中 adcode 快查表的城市直接查天气，不发地理编码请求', async () => {
    const urls: string[] = []
    stubRoutedFetch(urls)

    const w = useWeather()
    await expect(w.setCity('杭州')).resolves.toBe(true)

    expect(w.state.value).toBe('success')
    expect(w.locateHint.value).toBe('已切换到「杭州」')
    // 杭州在快查表里 -> 直接用 330100 查天气，没有 geo 请求
    expect(urls.some((u) => u.includes('city=330100'))).toBe(true)
    expect(urls.some((u) => u.includes('geocode/geo'))).toBe(false)
    // 当前展示的不再是"定位到的位置"
    expect(w.located.value).toBe(false)
  })

  it('未命中快查表的城市走地理编码换 adcode', async () => {
    const urls: string[] = []
    stubRoutedFetch(urls)

    const w = useWeather()
    await expect(w.setCity('南昌')).resolves.toBe(true)

    expect(urls.some((u) => u.includes('geocode/geo'))).toBe(true)
    expect(urls.some((u) => u.includes('city=360100'))).toBe(true)
    expect(w.locateHint.value).toBe('已切换到「南昌」')
  })

  it('切换成功后写入「上次的位置」记忆：下次定位失败会回落到它', async () => {
    stubRoutedFetch([])
    const w = useWeather()
    await w.setCity('杭州')

    expect(readRememberedPlace()).toEqual({ adcode: '330100', label: '杭州' })

    // 只清掉天气缓存（保留位置记忆），让回落这次真的走网络，从而能验证请求的 adcode
    localStorage.removeItem(WEATHER_CACHE_KEY)

    // 换一个实例模拟下次进站：定位被拒 -> 回落到用户手选的城市
    stubGeo('denied')
    const urls: string[] = []
    stubRoutedFetch(urls)
    const next = useWeather()
    await expect(next.init()).resolves.toBe(true)

    expect(urls.some((u) => u.includes('city=330100'))).toBe(true)
    expect(next.locateHint.value).toContain('已显示上次的位置')
  })

  it('空城市名不请求，返回 false', async () => {
    const urls: string[] = []
    stubRoutedFetch(urls)

    const w = useWeather()
    await expect(w.setCity('   ')).resolves.toBe(false)
    expect(urls).toHaveLength(0)
    expect(w.locateHint.value).toBe('')
  })

  it('未配置 API Key 时切换城市直接返回 false，不发请求', async () => {
    vi.stubEnv('VITE_AMAP_KEY', '')
    vi.stubEnv('VITE_WEATHER_KEY', '')
    const urls: string[] = []
    stubRoutedFetch(urls)

    const w = useWeather()
    await expect(w.setCity('杭州')).resolves.toBe(false)
    expect(urls).toHaveLength(0)
  })

  it('切换失败时进入错误态并给出提示（不清空界面结构）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('网络异常')
      }),
    )

    const w = useWeather()
    await expect(w.setCity('杭州')).resolves.toBe(false)
    expect(w.state.value).toBe('error')
    expect(w.error.value).toContain('网络错误')
  })
})
