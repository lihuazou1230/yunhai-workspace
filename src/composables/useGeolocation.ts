/**
 * 浏览器定位封装（Promise 化 + 可注入实现，便于单测）
 *
 * 两个前提要知道：
 * 1. 定位只在「安全上下文」可用：https 或 localhost。用局域网 IP（http://192.168.x.x）打开会被浏览器直接拒绝。
 * 2. 浏览器返回的是 WGS84 坐标，而高德用的是 GCJ-02（火星坐标）。两者在城市尺度下差异只有几百米，
 *    仅在地界附近可能跨区，对「查哪个城市的天气」没有影响，因此本项目不做坐标纠偏（省一次请求）。
 */

export interface GeoCoords {
  latitude: number
  longitude: number
}

export type GeoErrorCode = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'unknown'

export class GeoError extends Error {
  readonly code: GeoErrorCode

  constructor(code: GeoErrorCode, message: string) {
    super(message)
    this.name = 'GeoError'
    this.code = code
  }
}

/** 只声明用到的部分，便于注入假实现 */
export interface GeolocationLike {
  getCurrentPosition(
    success: (position: { coords: { latitude: number; longitude: number } }) => void,
    error?: (error: { code: number }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void
}

/** 浏览器定位错误码 -> 语义 + 中文提示（纯函数） */
export function geoErrorMessage(code: number): { code: GeoErrorCode; message: string } {
  switch (code) {
    case 1:
      return { code: 'denied', message: '定位权限被拒绝' }
    case 2:
      return { code: 'unavailable', message: '无法获取当前位置' }
    case 3:
      return { code: 'timeout', message: '定位超时' }
    default:
      return { code: 'unknown', message: '定位失败' }
  }
}

function defaultGeolocation(): GeolocationLike | null {
  const nav = globalThis.navigator as Navigator | undefined
  return (nav?.geolocation as GeolocationLike | undefined) ?? null
}

/**
 * 获取当前坐标。
 * @param options.timeout 超时毫秒（同时作为兜底定时器依据）
 * @param options.geolocation 注入定位实现（默认取 navigator.geolocation），便于测试
 */
export function getCurrentCoords(
  options: { timeout?: number; geolocation?: GeolocationLike | null } = {},
): Promise<GeoCoords> {
  const { timeout = 8000 } = options
  const geo = options.geolocation !== undefined ? options.geolocation : defaultGeolocation()

  return new Promise<GeoCoords>((resolve, reject) => {
    if (!geo) {
      reject(new GeoError('unsupported', '当前浏览器不支持定位'))
      return
    }

    let settled = false

    function done(action: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }

    // 兜底：即使浏览器一个回调都不触发，也不会让界面永远卡在「定位中」
    const timer = setTimeout(
      () => done(() => reject(new GeoError('timeout', '定位超时'))),
      timeout + 1000,
    )

    /** 坐标是否可用（畸形实现/半初始化状态会给出 undefined，NaN 一路传下去会让天气接口返回怪结果） */
    function coordsOf(position: {
      coords?: { latitude?: number; longitude?: number }
    }): GeoCoords | null {
      const latitude = position?.coords?.latitude
      const longitude = position?.coords?.longitude
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      return { latitude, longitude }
    }

    try {
      geo.getCurrentPosition(
        (position) =>
          done(() => {
            const coords = coordsOf(position)
            if (coords) resolve(coords)
            else reject(new GeoError('unavailable', '无法获取当前位置'))
          }),
        (error) => {
          const mapped = geoErrorMessage(error?.code ?? 0)
          done(() => reject(new GeoError(mapped.code, mapped.message)))
        },
        { enableHighAccuracy: false, timeout, maximumAge: 5 * 60 * 1000 },
      )
    } catch (err) {
      /**
       * 实现**同步抛错**（不安全上下文、注入的桩件本身有问题）也要收敛成 GeoError：
       * 裸抛出去的话，上层 `useWeather.locate()` 里的 `e instanceof GeoError && e.code === 'denied'`
       * 判断会落空，「已拒绝定位」这个标记就不会被记住，于是每次进站都白试一次。
       */
      done(() => reject(new GeoError('unknown', err instanceof Error ? err.message : '定位失败')))
    }
  })
}
