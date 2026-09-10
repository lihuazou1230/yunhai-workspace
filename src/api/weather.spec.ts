import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchCurrentWeather,
  getWeatherKey,
  locatePlace,
  normalizeWeather,
  resolveAdcode,
  weatherIcon,
  WEATHER_KEY_MISSING_MESSAGE,
} from './weather'

/** 构造一个最小可用的 fetch Response 替身（httpClient 只用到 ok/status/text） */
function mockJson(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }
}

/** 高德实况天气样例（字段均为字符串） */
const LIVE = {
  province: '北京',
  city: '北京市',
  adcode: '110000',
  weather: '晴',
  temperature: '26',
  winddirection: '西北',
  windpower: '≤3',
  humidity: '42',
  reporttime: '2026-09-10 12:00:00',
}

beforeEach(() => {
  // 默认天气缓存基于 localStorage，逐例清空避免用例之间互相污染
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('weatherIcon', () => {
  it('按天气现象映射 emoji，降水类优先于「晴」', () => {
    expect(weatherIcon('晴')).toBe('☀️')
    expect(weatherIcon('多云')).toBe('⛅')
    expect(weatherIcon('阴')).toBe('☁️')
    expect(weatherIcon('小雨')).toBe('🌧️')
    expect(weatherIcon('雷阵雨')).toBe('⛈️')
    expect(weatherIcon('小雪')).toBe('❄️')
    expect(weatherIcon('霾')).toBe('😷')
    expect(weatherIcon('雾')).toBe('🌫️')
    // 复合描述：降水优先，避免「晴转小雨」被判成晴天
    expect(weatherIcon('晴转小雨')).toBe('🌧️')
    expect(weatherIcon('无法识别的现象')).toBe('🌡️')
  })

  it('沙尘与大风单独成档：北方常见的这两种不该落到「无法识别」', () => {
    expect(weatherIcon('扬沙')).toBe('🌪️')
    expect(weatherIcon('浮尘')).toBe('🌪️')
    expect(weatherIcon('大风')).toBe('💨')
  })

  it('天气描述缺失（脏数据）时按「无法识别」处理，不抛错', () => {
    // 上游接口字段完整度不稳定，这里必须兜住，否则一个 undefined 就能让整张天气卡渲染失败
    expect(weatherIcon(undefined as unknown as string)).toBe('🌡️')
  })
})

describe('getWeatherKey（兼容两个环境变量名）', () => {
  it('VITE_AMAP_KEY 没配时回落到规划文档里的 VITE_WEATHER_KEY', async () => {
    // 用户照着规划文档配了 VITE_WEATHER_KEY 却提示「未配置 Key」是最容易劝退的一种失败
    vi.stubEnv('VITE_AMAP_KEY', undefined as unknown as string)
    vi.stubEnv('VITE_WEATHER_KEY', 'doc-key')
    expect(getWeatherKey()).toBe('doc-key')

    // 两个都空/都缺才返回 undefined，由 requireKey 抛出标识性错误
    vi.stubEnv('VITE_WEATHER_KEY', '   ')
    expect(getWeatherKey()).toBeUndefined()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveAdcode('苏州')).rejects.toThrow(WEATHER_KEY_MISSING_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('normalizeWeather', () => {
  it('把高德实况的字符串字段转成规范结构', () => {
    const w = normalizeWeather(LIVE)
    expect(w.city).toBe('北京市')
    expect(w.province).toBe('北京')
    expect(w.temperature).toBe(26)
    expect(w.humidity).toBe(42)
    expect(w.description).toBe('晴')
    expect(w.icon).toBe('☀️')
    expect(w.windDirection).toBe('西北')
    expect(w.windPower).toBe('≤3')
    expect(w.updatedAt).toBe(Date.parse('2026-09-10T12:00:00'))
  })

  it('温度/湿度非法时回落为 0，天气描述为空时给「未知」', () => {
    const w = normalizeWeather({ ...LIVE, temperature: '', humidity: 'abc', weather: '' })
    expect(w.temperature).toBe(0)
    expect(w.humidity).toBe(0)
    expect(w.description).toBe('未知')
  })

  it('字段大面积缺失时逐项兜底：city 退回省份、风向/风力留空、时间回落当前时刻', () => {
    // 高德在不同接口/地区返回的字段完整度不一致，缺字段绝不能让整条天气挂掉。
    // 这里刻意传残缺对象：类型上 AmapLive 字段全必填，用参数类型断言表达「运行时可能缺」
    // （不为测试去放宽 normalizeWeather 的签名）
    type LiveLike = Parameters<typeof normalizeWeather>[0]
    const w = normalizeWeather({ province: '北京', weather: '晴' } as LiveLike)
    expect(w.city).toBe('北京') // 没有 city 就用省份，界面上至少还有地方名
    expect(w.windDirection).toBeUndefined()
    expect(w.windPower).toBeUndefined()
    expect(Math.abs(w.updatedAt - Date.now())).toBeLessThan(5000)

    // 连省份都没有：city 给空串而不是 undefined（模板里直接插值，undefined 会渲染成 "undefined"）
    expect(normalizeWeather({ weather: '晴' } as LiveLike).city).toBe('')
  })

  it('reporttime 是解析不了的脏字符串时回落当前时刻，而不是 NaN', () => {
    const w = normalizeWeather({ ...LIVE, reporttime: '昨天下午' })
    expect(Number.isNaN(w.updatedAt)).toBe(false)
    expect(Math.abs(w.updatedAt - Date.now())).toBeLessThan(5000)
  })
})

describe('resolveAdcode', () => {
  it('6 位数字直接当作 adcode，不发起请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveAdcode('110000')).resolves.toBe('110000')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('常见城市命中本地快查表，不发起请求（兼容「北京市」写法）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveAdcode('北京')).resolves.toBe('110000')
    await expect(resolveAdcode('北京市')).resolves.toBe('110000')
    await expect(resolveAdcode('杭州')).resolves.toBe('330100')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('表外城市名走地理编码换取 adcode', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/geocode/geo')
      expect(url).toContain('address=')
      return mockJson({
        status: '1',
        info: 'OK',
        infocode: '10000',
        geocodes: [{ adcode: '320500' }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveAdcode('苏州')).resolves.toBe('320500')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('查不到城市时抛出提示', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '1', info: 'OK', infocode: '10000', geocodes: [] })),
    )
    await expect(resolveAdcode('不存在的地方')).rejects.toThrow(/未找到城市/)
  })
})

describe('locatePlace（逆地理编码，自动定位用）', () => {
  it('按「经度,纬度」顺序请求，返回区级 adcode 与三级行政区名', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url)
      expect(u.pathname).toContain('/geocode/regeo')
      // 经度在前、纬度在后（写反会定位到完全不同的地方）
      expect(u.searchParams.get('location')).toBe('120.209000,30.246000')
      return mockJson({
        status: '1',
        info: 'OK',
        infocode: '10000',
        regeocode: {
          formatted_address: '浙江省杭州市西湖区',
          addressComponent: {
            province: '浙江省',
            city: '杭州市',
            district: '西湖区',
            adcode: '330106',
          },
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(locatePlace(30.246, 120.209)).resolves.toEqual({
      adcode: '330106',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('直辖市：city 为空数组时归一为 undefined，省份与区县仍可用', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJson({
          status: '1',
          info: 'OK',
          infocode: '10000',
          // 高德对直辖市（北京/上海/重庆）的 city 字段是空数组，不能当字符串用
          regeocode: {
            addressComponent: {
              province: '北京市',
              city: [],
              district: '东城区',
              adcode: '110101',
            },
          },
        }),
      ),
    )
    await expect(locatePlace(39.90923, 116.397428)).resolves.toEqual({
      adcode: '110101',
      province: '北京市',
      city: undefined,
      district: '东城区',
    })
  })

  it('识别不出位置时抛出提示', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '1', info: 'OK', infocode: '10000', regeocode: {} })),
    )
    await expect(locatePlace(0, 0)).rejects.toThrow(/无法识别当前位置/)
  })

  it('city 是数组时取第一项（高德文档里该字段既可能是字符串也可能是数组）', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJson({
          status: '1',
          info: 'OK',
          infocode: '10000',
          regeocode: {
            addressComponent: {
              province: '浙江省',
              city: ['杭州市'],
              district: '西湖区',
              adcode: '330106',
            },
          },
        }),
      ),
    )
    await expect(locatePlace(30.246, 120.209)).resolves.toMatchObject({ city: '杭州市' })

    // 数组里第一项是空白：归一为 undefined，而不是留下一个空字符串当地名
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJson({
          status: '1',
          info: 'OK',
          infocode: '10000',
          regeocode: {
            addressComponent: {
              province: '浙江省',
              city: ['  '],
              district: '西湖区',
              adcode: '330106',
            },
          },
        }),
      ),
    )
    await expect(locatePlace(30.246, 120.209)).resolves.toMatchObject({ city: undefined })
  })

  it('未配置 Key 时抛出标识性错误', async () => {
    vi.stubEnv('VITE_AMAP_KEY', '')
    await expect(locatePlace(30.246, 120.209)).rejects.toThrow(WEATHER_KEY_MISSING_MESSAGE)
  })
})

describe('fetchCurrentWeather', () => {
  it('未配置 Key 时抛出标识性错误', async () => {
    // 显式置空：避免本机 .env.local 里若填了真实 Key 导致用例失效
    vi.stubEnv('VITE_AMAP_KEY', '')
    await expect(fetchCurrentWeather('北京')).rejects.toThrow(WEATHER_KEY_MISSING_MESSAGE)
  })

  it('高德以 HTTP 200 返回失败（status=0）时，抛出中文提示', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'bad-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' })),
    )
    await expect(fetchCurrentWeather('110000')).rejects.toThrow(/API Key 无效或已过期/)
  })

  it('Key 平台类型不匹配（10009）时给出针对性提示', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'js-api-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' })),
    )
    await expect(fetchCurrentWeather('110000')).rejects.toThrow(/Web服务/)
  })

  it('并发超限（10021）时提示请求过于频繁', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJson({ status: '0', info: 'CUQPS_HAS_EXCEEDED_THE_LIMIT', infocode: '10021' }),
      ),
    )
    await expect(fetchCurrentWeather('110000')).rejects.toThrow(/请求过于频繁/)
  })

  it('未映射的错误码回落到 info 原文，仍带 infocode', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '0', info: 'SOME_NEW_ERROR', infocode: '99999' })),
    )
    await expect(fetchCurrentWeather('110000')).rejects.toThrow(/SOME_NEW_ERROR.*99999/)
  })

  it('连 infocode/info 都没给（高德偶发）时也要给一句能看懂的中文错误', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '0' })),
    )

    // 不能抛出「undefined（infocode undefined）」这种把用户当程序员看的文案
    await expect(fetchCurrentWeather('110000')).rejects.toThrow(
      '天气查询失败：未知错误（infocode -）',
    )
  })

  it('成功时返回归一化天气数据', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/weather/weatherInfo')
      expect(url).toContain('city=110000')
      expect(url).toContain('extensions=base')
      return mockJson({
        status: '1',
        info: 'OK',
        infocode: '10000',
        count: '1',
        lives: [LIVE],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { data: w, fromCache } = await fetchCurrentWeather('110000')
    expect(w.temperature).toBe(26)
    expect(w.city).toBe('北京市')
    expect(w.humidity).toBe(42)
    expect(w.icon).toBe('☀️')
    expect(fromCache).toBe(false)
    // adcode 直填时只请求天气接口，不请求地理编码
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('返回体没有 lives 时抛出提示', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '1', info: 'OK', infocode: '10000', lives: [] })),
    )
    await expect(fetchCurrentWeather('110000')).rejects.toThrow(/暂无天气数据/)
  })

  it('表外城市名输入时先地理编码再查天气（共两次请求）', async () => {
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
      return mockJson({
        status: '1',
        info: 'OK',
        infocode: '10000',
        lives: [{ ...LIVE, province: '江苏', city: '苏州市', adcode: '320500', temperature: '31' }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { data: w } = await fetchCurrentWeather('苏州')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(w.city).toBe('苏州市')
    expect(w.temperature).toBe(31)
  })

  it('命中频率限制（10021）时自动退避重试并最终成功', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    let call = 0
    const fetchMock = vi.fn(async () => {
      call += 1
      // 前两次模拟并发超限，第三次成功
      if (call <= 2) {
        return mockJson({ status: '0', info: 'CUQPS_HAS_EXCEEDED_THE_LIMIT', infocode: '10021' })
      }
      return mockJson({ status: '1', info: 'OK', infocode: '10000', lives: [LIVE] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchCurrentWeather('110000')
    // 推进定时器跨过两次退避（1s + 2s），避免测试真的等 3 秒
    await vi.advanceTimersByTimeAsync(4000)
    const { data: w } = await pending

    expect(call).toBe(3)
    expect(w.temperature).toBe(26)
  })

  it('不可重试的错误（如 10001）立即抛出，不重试', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'bad-key')
    const fetchMock = vi.fn(async () =>
      mockJson({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchCurrentWeather('110000')).rejects.toThrow(/API Key 无效/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('缓存：第二次查询直接命中缓存，不再发起请求', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    const fetchMock = vi.fn(async () =>
      mockJson({ status: '1', info: 'OK', infocode: '10000', lives: [LIVE] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchCurrentWeather('110000')
    expect(first.fromCache).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await fetchCurrentWeather('110000')
    expect(second.fromCache).toBe(true)
    expect(second.data).toEqual(first.data)
    // 命中缓存 -> 请求次数没有增加
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('缓存：force=true 跳过缓存强制刷新', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    const fetchMock = vi.fn(async () =>
      mockJson({ status: '1', info: 'OK', infocode: '10000', lives: [LIVE] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchCurrentWeather('110000')
    const forced = await fetchCurrentWeather('110000', { force: true })

    expect(forced.fromCache).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('缓存：城市名换算出的 adcode 也会被缓存，force 刷新不再请求地理编码', async () => {
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
      return mockJson({
        status: '1',
        info: 'OK',
        infocode: '10000',
        lives: [{ ...LIVE, province: '江苏', city: '苏州市', adcode: '320500' }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    // 首次：地理编码 + 天气 = 2 次
    await fetchCurrentWeather('苏州')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // force 只强制刷新天气，adcode 仍走缓存 -> 只多 1 次请求
    const refreshed = await fetchCurrentWeather('苏州', { force: true })
    expect(refreshed.fromCache).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('缓存：写入 localStorage，刷新页面后仍可复用', async () => {
    vi.stubEnv('VITE_AMAP_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockJson({ status: '1', info: 'OK', infocode: '10000', lives: [LIVE] })),
    )

    await fetchCurrentWeather('110000')
    // 模拟刷新页面：仅清掉内存里没有的东西 —— 缓存本就在 localStorage 中
    const raw = localStorage.getItem('smart-workspace:weather-cache')
    expect(raw).toBeTruthy()
    expect(raw).toContain('北京市')
  })
})
