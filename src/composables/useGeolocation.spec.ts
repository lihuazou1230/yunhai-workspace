import { afterEach, describe, expect, it, vi } from 'vitest'

import { GeoError, geoErrorMessage, getCurrentCoords } from './useGeolocation'
import type { GeolocationLike } from './useGeolocation'

function fakeGeo(impl: GeolocationLike['getCurrentPosition']): GeolocationLike {
  return { getCurrentPosition: impl }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('geoErrorMessage', () => {
  it('把浏览器错误码映射为语义与中文提示', () => {
    expect(geoErrorMessage(1)).toEqual({ code: 'denied', message: '定位权限被拒绝' })
    expect(geoErrorMessage(2)).toEqual({ code: 'unavailable', message: '无法获取当前位置' })
    expect(geoErrorMessage(3)).toEqual({ code: 'timeout', message: '定位超时' })
    expect(geoErrorMessage(99)).toEqual({ code: 'unknown', message: '定位失败' })
  })
})

describe('getCurrentCoords', () => {
  it('浏览器不支持定位时抛 unsupported', async () => {
    await expect(getCurrentCoords({ geolocation: null })).rejects.toMatchObject({
      code: 'unsupported',
    })
  })

  it('成功时返回经纬度', async () => {
    const geo = fakeGeo((success) => success({ coords: { latitude: 30.246, longitude: 120.209 } }))
    await expect(getCurrentCoords({ geolocation: geo })).resolves.toEqual({
      latitude: 30.246,
      longitude: 120.209,
    })
  })

  it('权限被拒绝时抛 denied（GeoError 实例）', async () => {
    const geo = fakeGeo((_success, error) => error?.({ code: 1 }))
    await expect(getCurrentCoords({ geolocation: geo })).rejects.toBeInstanceOf(GeoError)
    await expect(getCurrentCoords({ geolocation: geo })).rejects.toMatchObject({ code: 'denied' })
  })

  it('浏览器报超时时抛 timeout', async () => {
    const geo = fakeGeo((_success, error) => error?.({ code: 3 }))
    await expect(getCurrentCoords({ geolocation: geo })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('浏览器一个回调都不触发时，兜底定时器也会超时（不会永久挂起）', async () => {
    vi.useFakeTimers()
    const geo = fakeGeo(() => {
      // 故意不回调
    })
    const pending = getCurrentCoords({ geolocation: geo, timeout: 1000 })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(2100)
    await assertion
  })
})

describe('getCurrentCoords · 默认实现与异常兜底', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('未注入实现时用 navigator.geolocation（即真实链路）', async () => {
    vi.stubGlobal('navigator', {
      geolocation: fakeGeo((success) =>
        success({ coords: { latitude: 30.25, longitude: 120.16 } }),
      ),
    })

    await expect(getCurrentCoords()).resolves.toEqual({ latitude: 30.25, longitude: 120.16 })
  })

  it('浏览器完全没有 geolocation（老环境）时立刻抛 unsupported，而不是静默挂起', async () => {
    vi.stubGlobal('navigator', {})

    await expect(getCurrentCoords()).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('把超时与精度要求明确传给浏览器（否则一次定位可能等到天荒地老）', async () => {
    const seen: Array<Record<string, unknown> | undefined> = []
    const geo = fakeGeo((success, _error, options) => {
      seen.push(options as Record<string, unknown> | undefined)
      success({ coords: { latitude: 0, longitude: 0 } })
    })

    await getCurrentCoords({ geolocation: geo, timeout: 3000 })

    expect(seen[0]).toEqual({
      // 查天气不需要 GPS 级精度：省电、也更容易快速拿到结果
      enableHighAccuracy: false,
      timeout: 3000,
      // 5 分钟内复用上一次坐标，避免每次进页面都弹一次定位
      maximumAge: 5 * 60 * 1000,
    })
  })

  it('错误码 2 / 未知码分别映射为 unavailable / unknown', async () => {
    await expect(
      getCurrentCoords({ geolocation: fakeGeo((_s, e) => e?.({ code: 2 })) }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      getCurrentCoords({ geolocation: fakeGeo((_s, e) => e?.({ code: 99 })) }),
    ).rejects.toMatchObject({ code: 'unknown' })
    // 有的实现对错误对象不带 code：按 0 处理成 unknown，不能把 undefined 传下去
    await expect(
      getCurrentCoords({
        geolocation: fakeGeo((_s, e) => e?.(undefined as unknown as { code: number })),
      }),
    ).rejects.toMatchObject({ code: 'unknown' })
  })

  it('成功回调之后浏览器又报错：以第一次结果为准，迟到的回调被守卫忽略', async () => {
    let lateError: ((e: { code: number }) => void) | undefined
    const geo = fakeGeo((success, error) => {
      lateError = error
      success({ coords: { latitude: 30.1, longitude: 120.2 } })
    })

    await expect(getCurrentCoords({ geolocation: geo })).resolves.toEqual({
      latitude: 30.1,
      longitude: 120.2,
    })
    // 迟到的错误回调必须被 settled 守卫吞掉，否则会变成未捕获的 Promise 拒绝
    expect(() => lateError?.({ code: 1 })).not.toThrow()
  })

  it('默认超时 8000ms：兜底定时器留了 1 秒余量，8 秒整不算超时', async () => {
    vi.useFakeTimers()
    let settled = false
    const geo = fakeGeo(() => {
      // 不回调
    })
    const pending = getCurrentCoords({ geolocation: geo })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    void pending.catch(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(8000)
    expect(settled).toBe(false)

    // 再走 1 秒才到兜底时间：宁可多等 1 秒，也不把「正在回来的坐标」判死
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(settled).toBe(true)
  })

  it('兜底超时后浏览器才回调：结果保持 timeout，迟到的成功不会二次落定', async () => {
    vi.useFakeTimers()
    let lateSuccess: (() => void) | undefined
    const geo = fakeGeo((success) => {
      lateSuccess = () => success({ coords: { latitude: 1, longitude: 1 } })
    })

    const pending = getCurrentCoords({ geolocation: geo, timeout: 500 })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(1600)
    await assertion

    expect(() => lateSuccess?.()).not.toThrow()
  })

  it('定位实现同步抛错时收敛成 GeoError（不再泄漏原始异常）', async () => {
    const geo = fakeGeo(() => {
      throw new Error('SecurityError: 权限策略禁止定位')
    })

    // 这条曾经锁定的是缺陷：同步异常由 Promise 构造器直接转成拒绝，调用方拿到的是原始
    // Error 而不是 GeoError，于是 useWeather 里 `e instanceof GeoError && e.code === 'denied'`
    // 判断落空、「已拒绝定位」标记不会被记住。现在统一包成 GeoError。
    const error = await getCurrentCoords({ geolocation: geo }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GeoError)
    expect((error as GeoError).code).toBe('unknown')
    expect((error as Error).message).toContain('权限策略禁止定位')
  })

  it('坐标缺失/非有限值时按「无法获取当前位置」拒绝（不让 NaN 传进天气接口）', async () => {
    for (const bad of [
      { coords: {} },
      { coords: { latitude: Number.NaN, longitude: 115.9 } },
      { coords: { latitude: 28.6, longitude: Number.POSITIVE_INFINITY } },
      {},
    ]) {
      const geo = {
        getCurrentPosition: (success: (p: unknown) => void) => success(bad),
      } as unknown as GeolocationLike

      const error = await getCurrentCoords({ geolocation: geo }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(GeoError)
      expect((error as GeoError).code).toBe('unavailable')
    }
  })
})
