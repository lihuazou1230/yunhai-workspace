/**
 * 天气数据组合式函数：自动定位 + 手动切换城市 + 本地缓存 + 加载/错误三态。
 *
 * 进站策略（降级链路）：自动定位 → 上次的位置（localStorage 记忆）→（桌面版）IP 定位 → 默认城市，
 * 每一级都会在卡片内说明当前展示的是哪一级的结果。
 * 手动切换城市是阶段三要求保留的能力：城市名经地理编码（geo 接口）换成 adcode，
 * 并记为「上次的位置」——下次定位不可用时直接回退到用户自己选的城市。
 */

import { computed, ref } from 'vue'

import {
  fetchCurrentWeather,
  getWeatherKey,
  locateByIp,
  locatePlace,
  resolveAdcode,
  WEATHER_KEY_MISSING_MESSAGE,
} from '@/api/weather'
import { GeoError, getCurrentCoords } from '@/composables/useGeolocation'
import { DEFAULT_WEATHER_CITY } from '@/types/weather'
import type { WeatherData, WeatherLoadState } from '@/types/weather'
import { buildPlaceLabel, weatherPlaceLabel } from '@/utils/placeFormatter'

/** 用户拒绝过定位权限：记住后不必每次进站都白试一次 */
const GEO_DENIED_KEY = 'smart-workspace:geo-denied'
/** 上次定位成功的位置：定位不可用时回退到它（比默认城市更贴近用户） */
const LAST_PLACE_KEY = 'smart-workspace:last-place'

/** 记忆的位置（adcode 用于请求，label 用于展示） */
interface RememberedPlace {
  adcode: string
  label: string
}

function readFlag(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

function writeFlag(key: string, value: string | null) {
  try {
    if (typeof localStorage === 'undefined') return
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 隐私模式等场景忽略
  }
}

/** 读取记忆的位置；数据损坏时按「没有记忆」处理，不影响进站 */
export function readRememberedPlace(): RememberedPlace | null {
  const raw = readFlag(LAST_PLACE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<RememberedPlace>
    if (typeof parsed?.adcode === 'string' && parsed.adcode.length > 0) {
      return { adcode: parsed.adcode, label: parsed.label ?? '' }
    }
  } catch {
    // 忽略损坏数据
  }
  return null
}

function errMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.message.includes(WEATHER_KEY_MISSING_MESSAGE)) return '未配置天气 API Key'
    return e.message
  }
  return '天气获取失败，请稍后重试'
}

export interface UseWeatherOptions {
  /**
   * 是否允许「IP 定位」兜底。**默认开启**（浏览器版与桌面版一致）。
   *
   * 为什么浏览器版也要开：定位只在**安全上下文**（https / localhost）可用，
   * 而这个项目的网页端是部署在 `http://<IP>/workspace/` 上的 —— 明文 HTTP 下浏览器
   * 必然拒绝定位，且**没有任何开关能改**（不是用户点了"拒绝"，是平台规则）。
   * 那种情况下 `/v3/ip` 是唯一还能自动贴近用户的途径，至少能落到城市级（南昌而不是默认的北京）。
   * 逆地理编码的隐私成本为零：这个请求本来就发给高德，它早已知道请求方 IP。
   *
   * 代价：定位被拒时多一次请求（免费额度内）。HTTPS 部署后基本不触发 ——
   * 浏览器定位成功就走不到这一层（它只排在「浏览器定位 → 上次的位置」之后）。
   */
  ipFallback?: boolean
}

export function useWeather(options: UseWeatherOptions = {}) {
  const ipFallback = options.ipFallback ?? true
  const weather = ref<WeatherData | null>(null)
  const state = ref<WeatherLoadState>('loading')
  const error = ref('')
  /** 是否已配置天气 API Key（未配置时无法请求） */
  const configured = ref(getWeatherKey() !== undefined)
  /** 当前展示的数据是否来自本地缓存（未请求接口） */
  const fromCache = ref(false)
  /** 是否正在定位 */
  const locating = ref(false)
  /** 当前展示的是否为定位到的位置 */
  const located = ref(false)
  /** 定位提示（成功 / 失败原因 / 回落说明） */
  const locateHint = ref('')
  /** 定位到的地点文案（区 · 城市 · 省份 / 直辖市为 区 · 城市） */
  const locatedLabel = ref('')
  /** 当前查询目标（adcode 或城市名），供「刷新」复用 */
  const query = ref<string>(DEFAULT_WEATHER_CITY)

  /** 展示用地点文案：优先用定位结果，回落到天气接口返回的城市/省份 */
  const placeLabel = computed(() =>
    locatedLabel.value
      ? locatedLabel.value
      : weatherPlaceLabel(weather.value?.city, weather.value?.province),
  )

  /** 拉取数据并写入状态。返回是否成功。 */
  async function run(target: string, options: { force?: boolean } = {}): Promise<boolean> {
    query.value = target
    state.value = 'loading'
    error.value = ''
    fromCache.value = false
    try {
      const res = await fetchCurrentWeather(target, { force: options.force })
      weather.value = res.data
      fromCache.value = res.fromCache
      state.value = 'success'
      return true
    } catch (e) {
      state.value = 'error'
      error.value = errMessage(e)
      return false
    }
  }

  /** 强制跳过缓存刷新当前位置 */
  function refresh(): Promise<boolean> {
    return run(query.value, { force: true })
  }

  /** 出错后的重试：同样强制刷新，避免拿到旧缓存 */
  function retry(): Promise<boolean> {
    return refresh()
  }

  /**
   * 定位并加载当前位置的天气。
   * @param options force 跳过 30 分钟缓存强制取最新（卡片上的「↻ 刷新」走这条）
   */
  async function locate(options: { force?: boolean } = {}): Promise<boolean> {
    if (!configured.value) return false
    locating.value = true
    locateHint.value = ''
    locatedLabel.value = ''
    try {
      const coords = await getCurrentCoords()
      const place = await locatePlace(coords.latitude, coords.longitude)
      const ok = await run(place.adcode, { force: options.force })
      located.value = ok
      locatedLabel.value = ok ? buildPlaceLabel(place) : ''
      // 成功**不写提示**：卡片上只留「失败 / 回落 / 手动切城」这类需要解释的信息，
      // 「已定位到当前位置」由标题旁的小标承担，再来一行字纯属噪音。
      locateHint.value = ok ? '' : '定位成功，但获取天气失败'
      // 记住这次成功的位置，供下次定位不可用时回退
      if (ok) {
        writeFlag(
          LAST_PLACE_KEY,
          JSON.stringify({ adcode: place.adcode, label: locatedLabel.value }),
        )
      }
      return ok
    } catch (e) {
      located.value = false
      locatedLabel.value = ''
      locateHint.value = e instanceof Error ? e.message : '定位失败'
      if (e instanceof GeoError && e.code === 'denied') writeFlag(GEO_DENIED_KEY, '1')
      return false
    } finally {
      locating.value = false
    }
  }

  /** 回退到记忆中的上次位置；没有记忆或请求失败返回 false */
  async function fallbackToRemembered(hintPrefix: string): Promise<boolean> {
    const remembered = readRememberedPlace()
    if (!remembered) return false
    const ok = await run(remembered.adcode)
    if (!ok) return false
    locatedLabel.value = remembered.label || locatedLabel.value
    locateHint.value = `${hintPrefix}，已显示上次的位置`
    return true
  }

  /**
   * 手动切换城市（阶段三要求保留的能力）。
   * 城市名先用地理编码换成 adcode（命中本地快查表/缓存时不发请求），
   * 查询成功后记为「上次的位置」，让下次定位失败时有更贴近用户的回落目标。
   */
  async function setCity(city: string): Promise<boolean> {
    const name = city.trim()
    if (!name || !configured.value) return false

    located.value = false
    locatedLabel.value = ''
    locateHint.value = ''

    const ok = await run(name)
    if (!ok) return false

    // 记住这次选择（拿不到 adcode 也不影响本次展示）
    try {
      const adcode = await resolveAdcode(name)
      writeFlag(LAST_PLACE_KEY, JSON.stringify({ adcode, label: name }))
    } catch {
      // 忽略：记忆失败只是降级效果差一点
    }
    locateHint.value = `已切换到「${name}」`
    return true
  }

  /**
   * IP 定位兜底（仅桌面版默认开启）。
   * 精度只到城市，所以排在「浏览器定位 → 上次位置」之后，只作为最后一层。
   */
  async function fallbackToIp(hintPrefix: string): Promise<boolean> {
    if (!ipFallback) return false
    try {
      const place = await locateByIp()
      const ok = await run(place.adcode)
      if (!ok) return false
      located.value = false
      locatedLabel.value = buildPlaceLabel(place)
      locateHint.value = `${hintPrefix}，已按 IP 定位到${locatedLabel.value}`
      writeFlag(LAST_PLACE_KEY, JSON.stringify({ adcode: place.adcode, label: locatedLabel.value }))
      return true
    } catch {
      // IP 定位也失败：继续往下走默认城市，不打断链路
      return false
    }
  }

  /**
   * 进站降级链路：自动定位 → 上次定位的位置 →（桌面版）IP 定位 → 默认城市。
   * 每一级都保证「有东西可看」，并在卡片内说明当前展示的是哪一级结果。
   */
  async function init(): Promise<boolean> {
    if (!configured.value) return false

    if (readFlag(GEO_DENIED_KEY)) {
      if (await fallbackToRemembered('定位权限已被拒绝')) return true
      if (await fallbackToIp('定位权限已被拒绝')) return true
      const ok = await run(DEFAULT_WEATHER_CITY)
      if (ok) locateHint.value = '定位权限已被拒绝，已显示默认城市'
      return ok
    }

    const ok = await locate()
    if (ok) return true

    const reason = locateHint.value
    if (await fallbackToRemembered(reason || '定位失败')) return true
    if (await fallbackToIp(reason || '定位失败')) return true

    const fallbackOk = await run(DEFAULT_WEATHER_CITY)
    if (fallbackOk && reason) locateHint.value = `${reason}，已显示默认城市`
    return fallbackOk
  }

  return {
    weather,
    state,
    error,
    configured,
    fromCache,
    locating,
    located,
    locateHint,
    placeLabel,
    query,
    init,
    locate,
    setCity,
    refresh,
    retry,
  }
}
