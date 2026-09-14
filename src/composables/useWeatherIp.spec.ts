/**
 * 进站降级链路的「IP 定位」这一级（第七阶段桌面端）。
 *
 * 链路：浏览器定位 → 上次位置 →（桌面版）IP 定位 → 默认城市。
 * 这里专门钉住「桌面版才启用、浏览器版行为不变」这个开关 ——
 * 开关判错的后果是浏览器版平白多打一次接口，或者桌面版被拒定位后直接掉到默认城市。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readRememberedPlace, useWeather } from './useWeather'

const LAST_PLACE_KEY = 'smart-workspace:last-place'

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
      province: '浙江省',
      city: '杭州市',
      adcode: '330100',
      weather: '晴',
      temperature: '27',
      winddirection: '东',
      windpower: '3',
      humidity: '50',
      reporttime: '2026-09-12 10:00:00',
    },
  ],
}

const IP_OK = {
  status: '1',
  info: 'OK',
  infocode: '10000',
  province: '浙江省',
  city: '杭州市',
  adcode: '330100',
}

/** 让浏览器定位被拒绝（用户点了「拒绝」） */
function stubGeoDenied() {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (_ok: unknown, error?: (e: { code: number }) => void) =>
        error?.({ code: 1 }),
    },
  })
}

/** 路由式 fetch：/v3/ip 走 IP 定位响应，其余返回实况天气 */
function stubRoutedFetch(recorder: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      recorder.push(u)
      if (u.includes('/v3/ip')) return mockJson(IP_OK)
      return mockJson(WEATHER_OK)
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

describe('useWeather · IP 定位兜底', () => {
  it('开启兜底 + 定位被拒：按 IP 定位到城市并说明来源', async () => {
    stubGeoDenied()
    const urls: string[] = []
    stubRoutedFetch(urls)

    const w = useWeather({ ipFallback: true })
    await expect(w.init()).resolves.toBe(true)

    expect(urls.some((u) => u.includes('/v3/ip'))).toBe(true)
    expect(w.locateHint.value).toContain('定位权限')
    expect(w.locateHint.value).toContain('IP 定位')
    expect(w.locateHint.value).toContain('杭州市')
    expect(w.state.value).toBe('success')
  })

  it('IP 定位成功后会记住位置（下次进站优先回退到它）', async () => {
    stubGeoDenied()
    stubRoutedFetch([])

    await useWeather({ ipFallback: true }).init()

    expect(readRememberedPlace()).toEqual({ adcode: '330100', label: '杭州市 · 浙江省' })
  })

  it('IP 定位不算「定位到的位置」：located 保持 false（卡片不会误标 📍 当前位置）', async () => {
    stubGeoDenied()
    stubRoutedFetch([])

    const w = useWeather({ ipFallback: true })
    await w.init()

    expect(w.located.value).toBe(false)
  })

  it('默认就启用兜底：定位被拒时不再直接落默认城市，而是先按 IP 定位到城市', async () => {
    stubGeoDenied()
    const urls: string[] = []
    stubRoutedFetch(urls)

    // 不传 options：走的就是默认值（浏览器版与桌面版一致）
    const w = useWeather()
    await expect(w.init()).resolves.toBe(true)

    expect(urls.some((u) => u.includes('/v3/ip'))).toBe(true)
    expect(w.locateHint.value).toContain('IP 定位')
    expect(w.locateHint.value).toContain('杭州市')
    // 明文 HTTP 部署下浏览器必然拒绝定位，这一层是唯一还能自动贴近用户的途径
    expect(w.state.value).toBe('success')
  })

  it('有「上次位置」记忆时优先用记忆，不会绕道 IP（链路顺序不能乱）', async () => {
    localStorage.setItem(LAST_PLACE_KEY, JSON.stringify({ adcode: '110000', label: '北京市' }))
    stubGeoDenied()
    const urls: string[] = []
    stubRoutedFetch(urls)

    const w = useWeather({ ipFallback: true })
    await expect(w.init()).resolves.toBe(true)

    expect(urls.some((u) => u.includes('/v3/ip'))).toBe(false)
    expect(urls.some((u) => u.includes('city=110000'))).toBe(true)
    expect(w.locateHint.value).toContain('上次的位置')
  })

  it('IP 定位也失败时继续降到默认城市（兜底不能拖断链路）', async () => {
    stubGeoDenied()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.includes('/v3/ip')) throw new Error('IP 接口不可用')
        return mockJson(WEATHER_OK)
      }),
    )

    const w = useWeather({ ipFallback: true })
    await expect(w.init()).resolves.toBe(true)

    expect(w.state.value).toBe('success')
    expect(w.locateHint.value).toContain('默认城市')
  })
})
