import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AmapError,
  fetchWeatherForecast,
  normalizeForecast,
  WEATHER_FORECAST_STORAGE_KEY,
  WEATHER_KEY_MISSING_MESSAGE,
} from './weather'
import type { AmapCast } from './weather'
import { WEATHER_CACHE_KEY } from './weatherCache'

/** 构造一个最小可用的 fetch Response 替身（httpClient 只用到 ok/status/text） */
function mockJson(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }
}

/** 高德预报单日样例（字段均为字符串） */
const CAST: AmapCast = {
  date: '2026-09-11',
  week: '星期五',
  dayweather: '晴',
  nightweather: '多云',
  daytemp: '28',
  nighttemp: '19',
  daywind: '西北',
  daypower: '≤3',
}

/** 高德预报响应样例：免费档 4 条（当天 + 未来 3 天） */
const FORECAST_OK = {
  status: '1',
  info: 'OK',
  infocode: '10000',
  count: '1',
  forecasts: [
    {
      province: '北京',
      city: '北京市',
      reporttime: '2026-09-10 11:00:00',
      casts: [
        CAST,
        { ...CAST, date: '2026-09-12', week: '星期六', daytemp: '30', nighttemp: '20' },
        { ...CAST, date: '2026-09-13', week: '星期日', daytemp: '26', nighttemp: '18' },
        {
          ...CAST,
          date: '2026-09-14',
          week: '星期一',
          dayweather: '小雨',
          daytemp: '24',
          nighttemp: '17',
        },
      ],
    },
  ],
}

beforeEach(() => {
  // 预报缓存基于 localStorage，逐例清空避免用例之间互相污染
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('normalizeForecast', () => {
  it('字符串温度转成数字，并保留日期/周几/昼夜天气/风', () => {
    const [day] = normalizeForecast([CAST])
    expect(day).toEqual({
      date: '2026-09-11',
      week: '星期五',
      dayWeather: '晴',
      nightWeather: '多云',
      dayTemp: 28,
      nightTemp: 19,
      dayWind: '西北',
      dayPower: '≤3',
      icon: '☀️',
    })
  })

  it('图标按白天天气映射，降水类优先于「晴」', () => {
    expect(normalizeForecast([{ ...CAST, dayweather: '晴转小雨' }])[0].icon).toBe('🌧️')
    expect(normalizeForecast([{ ...CAST, dayweather: '雷阵雨' }])[0].icon).toBe('⛈️')
    expect(normalizeForecast([{ ...CAST, dayweather: '小雪' }])[0].icon).toBe('❄️')
    // 白天晴、夜间雨：图标取白天，避免预报条出现「白天也下雨」的错觉
    expect(normalizeForecast([{ ...CAST, nightweather: '小雨' }])[0].icon).toBe('☀️')
  })

  it('casts 缺失（undefined/null/非数组）时返回空数组，不抛异常', () => {
    expect(normalizeForecast(undefined as unknown as AmapCast[])).toEqual([])
    expect(normalizeForecast(null as unknown as AmapCast[])).toEqual([])
    expect(normalizeForecast([])).toEqual([])
  })

  it('脏数据/缺字段不抛异常：温度回落 0，天气描述回落「未知」', () => {
    const days = normalizeForecast([
      {} as AmapCast,
      {
        ...CAST,
        daytemp: 'abc',
        nighttemp: '',
        dayweather: '',
        week: undefined,
      } as unknown as AmapCast,
      null as unknown as AmapCast,
    ])

    expect(days).toHaveLength(3)
    expect(days[0]).toEqual({
      date: '',
      week: '',
      dayWeather: '未知',
      nightWeather: '未知',
      dayTemp: 0,
      nightTemp: 0,
      dayWind: '',
      dayPower: '',
      icon: '🌡️',
    })
    expect(days[1].dayTemp).toBe(0)
    expect(days[1].nightTemp).toBe(0)
    expect(days[1].dayWeather).toBe('未知')
    expect(days[1].week).toBe('')
    expect(days[2].dayWeather).toBe('未知')
  })
})

describe('fetchWeatherForecast', () => {
  it('未配置 Key 时抛出标识性错误', async () => {
    // 显式置空：避免本机 .env.local 里若填了真实 Key 导致用例失效
    vi.stubEnv('VITE_AMAP_KEY', '')
    await expect(fetchWeatherForecast('110000')).rejects.toThrow(WEATHER_KEY_MISSING_MESSAGE)
  })

  it('请求 extensions=all，并把 forecasts[0].casts 归一化后返回', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/weather/weatherInfo')
      expect(url).toContain('city=110000')
      // 实况用 base，预报必须用 all（否则响应里没有 casts）
      expect(url).toContain('extensions=all')
      return mockJson(FORECAST_OK)
    })
    vi.stubGlobal('fetch', fetchMock)

    const forecast = await fetchWeatherForecast('110000')

    expect(forecast.city).toBe('北京市')
    expect(forecast.province).toBe('北京')
    expect(forecast.reportTime).toBe('2026-09-10 11:00:00')
    expect(forecast.days).toHaveLength(4)
    expect(forecast.days[0].dayTemp).toBe(28)
    expect(forecast.days[3]).toMatchObject({ date: '2026-09-14', dayWeather: '小雨', icon: '🌧️' })
    // adcode 直填时只请求天气接口，不请求地理编码
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('返回体没有 forecasts/casts 时抛出提示', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '1', info: 'OK', infocode: '10000', forecasts: [] })),
    )
    await expect(fetchWeatherForecast('110000')).rejects.toThrow(/暂无天气预报数据/)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJson({
          status: '1',
          info: 'OK',
          infocode: '10000',
          forecasts: [{ city: '北京市', casts: [] }],
        }),
      ),
    )
    await expect(fetchWeatherForecast('110000')).rejects.toThrow(/暂无天气预报数据/)
  })

  it('高德以 HTTP 200 返回失败（status=0）时抛出 AmapError', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'bad-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' })),
    )

    const err = await fetchWeatherForecast('110000').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AmapError)
    expect((err as AmapError).infocode).toBe('10001')
    expect((err as Error).message).toMatch(/API Key 无效或已过期/)
  })

  it('命中频率限制（10021）时自动退避重试并最终成功（复用实况的重试链路）', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        if (call === 1) {
          return mockJson({ status: '0', info: 'CUQPS_HAS_EXCEEDED_THE_LIMIT', infocode: '10021' })
        }
        return mockJson(FORECAST_OK)
      }),
    )

    const pending = fetchWeatherForecast('110000')
    await vi.advanceTimersByTimeAsync(1500)
    const forecast = await pending

    expect(call).toBe(2)
    expect(forecast.days[0].dayTemp).toBe(28)
  })

  it('缓存：第二次查询直接命中预报缓存，不再发起请求', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    const fetchMock = vi.fn(async () => mockJson(FORECAST_OK))
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchWeatherForecast('110000')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await fetchWeatherForecast('110000')
    expect(second).toEqual(first)
    // 命中缓存 -> 请求次数没有增加
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('缓存：force=true 跳过缓存强制刷新', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    const fetchMock = vi.fn(async () => mockJson(FORECAST_OK))
    vi.stubGlobal('fetch', fetchMock)

    await fetchWeatherForecast('110000')
    await fetchWeatherForecast('110000', { force: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('缓存：写入独立的 localStorage 键，不污染实况缓存', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson(FORECAST_OK)),
    )

    await fetchWeatherForecast('110000')

    const raw = localStorage.getItem(WEATHER_FORECAST_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(raw).toContain('北京市')
    // 实况缓存（extensions=base）结构不同，两边必须各写各的键
    expect(localStorage.getItem(WEATHER_CACHE_KEY)).toBeNull()
  })

  it('缓存：城市名换算出的 adcode 也被缓存，force 刷新不再请求地理编码', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/geocode/geo')) {
        return mockJson({
          status: '1',
          info: 'OK',
          infocode: '10000',
          geocodes: [{ adcode: '320500' }],
        })
      }
      expect(url).toContain('city=320500')
      return mockJson(FORECAST_OK)
    })
    vi.stubGlobal('fetch', fetchMock)

    // 首次：地理编码 + 预报 = 2 次
    await fetchWeatherForecast('苏州')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // force 只强制刷新预报，adcode 仍走缓存 -> 只多 1 次请求
    await fetchWeatherForecast('苏州', { force: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
