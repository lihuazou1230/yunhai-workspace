/**
 * IP 定位（`/v3/ip`）测试 —— 第七阶段桌面端兜底链路。
 *
 * 为什么单独一个 spec：`weather.spec.ts` 钉的是「实况/预报」两条主链路，
 * 这里是「定位」的第三种手段（前两种是浏览器定位与上次位置），
 * 触发条件与响应结构都不一样，分开更好读。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AmapError, locateByIp } from './weather'

function mockJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }
}

const IP_OK = {
  status: '1',
  info: 'OK',
  infocode: '10000',
  province: '浙江省',
  city: '杭州市',
  adcode: '330100',
  rectangle: '119.9,29.9;120.5,30.4',
}

/** 记录请求 URL 的 fetch 替身 */
function stubFetch(payload: unknown) {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url))
      return mockJson(payload)
    }),
  )
  return urls
}

beforeEach(() => {
  vi.stubEnv('VITE_AMAP_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('locateByIp', () => {
  it('请求 /v3/ip 并返回 adcode 与行政区名', async () => {
    const urls = stubFetch(IP_OK)

    const place = await locateByIp()

    expect(place).toEqual({ adcode: '330100', province: '浙江省', city: '杭州市' })
    expect(urls[0]).toContain('/v3/ip')
    expect(urls[0]).toContain('key=test-key')
  })

  it('直辖市：city 是空数组时用 province 兜底（否则地点文案会缺一截）', async () => {
    stubFetch({
      status: '1',
      info: 'OK',
      infocode: '10000',
      province: '北京市',
      city: [],
      adcode: '110000',
    })

    const place = await locateByIp()

    expect(place.adcode).toBe('110000')
    expect(place.city).toBe('北京市')
    expect(place.province).toBe('北京市')
  })

  it('city 是字符串数组时取第一项（高德偶尔这么返回）', async () => {
    stubFetch({
      status: '1',
      info: 'OK',
      infocode: '10000',
      province: '广东省',
      city: ['广州市'],
      adcode: '440100',
    })

    expect((await locateByIp()).city).toBe('广州市')
  })

  it('没有 adcode（如境外 IP）时抛错，交由上层继续降级', async () => {
    stubFetch({
      status: '1',
      info: 'OK',
      infocode: '10000',
      province: '境外',
      city: [],
      adcode: '',
    })

    await expect(locateByIp()).rejects.toThrow('IP 定位')
  })

  it('高德业务错误（status != 1）转成 AmapError 并带中文提示', async () => {
    stubFetch({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' })

    const error = await locateByIp().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AmapError)
    expect((error as AmapError).message).toContain('API Key 无效')
  })

  it('未配置 Key 时直接报「未配置」，不发请求', async () => {
    vi.stubEnv('VITE_AMAP_KEY', '')
    const urls = stubFetch(IP_OK)

    await expect(locateByIp()).rejects.toThrow('未配置天气 API Key')
    expect(urls).toHaveLength(0)
  })

  it('字段缺失/类型异常时不崩（都收敛成空值后按「识别不到城市」处理）', async () => {
    stubFetch({ status: '1', info: 'OK', infocode: '10000' })

    await expect(locateByIp()).rejects.toThrow('IP 定位')
  })
})
