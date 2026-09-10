/**
 * 高德地图（Amap）天气对接 —— 国内数据源，无需境外访问
 * 文档：https://lbs.amap.com/api/webservice/guide/api/weatherinfo
 *
 * 三个关键点：
 * 1. 需要一个「Web 服务」类型的 Key，从 VITE_AMAP_KEY 读取（.env.local）
 * 2. `city` 参数要求 adcode（行政区划编码）：输入 6 位数字直接用，否则先地理编码换算
 * 3. 高德失败时仍然返回 HTTP 200，错误藏在响应体的 status/info/infocode 中，必须显式判断
 */

import { httpClient } from './httpClient'
import { isFresh, normalizeCityKey, weatherCache, WEATHER_CACHE_TTL } from './weatherCache'
import type { WeatherCache } from './weatherCache'
import { DEFAULT_WEATHER_CITY } from '@/types/weather'
import type {
  LocatedPlace,
  WeatherData,
  WeatherForecast,
  WeatherForecastDay,
} from '@/types/weather'

const AMAP_BASE = 'https://restapi.amap.com/v3'
const WEATHER_URL = `${AMAP_BASE}/weather/weatherInfo`
const GEOCODE_URL = `${AMAP_BASE}/geocode/geo`
/** 逆地理编码：坐标 -> 行政区（自动定位用） */
const REGEO_URL = `${AMAP_BASE}/geocode/regeo`

/** 天气 API Key 缺失时的标识性错误信息（useWeather 依赖该常量做友好提示） */
export const WEATHER_KEY_MISSING_MESSAGE = '未配置天气 API Key（VITE_AMAP_KEY）'

/** 高德通用响应外壳 */
interface AmapBase {
  /** '1' 成功，'0' 失败 */
  status: string
  info: string
  infocode: string
}

/** 实况天气（extensions=base） */
interface AmapLive {
  province: string
  city: string
  adcode: string
  /** 天气现象（中文），如「晴」 */
  weather: string
  /** 实时气温，摄氏度的字符串 */
  temperature: string
  winddirection: string
  /** 风力级别，如「≤3」 */
  windpower: string
  humidity: string
  /** 数据发布时间，如 2026-09-10 12:00:00 */
  reporttime: string
}

interface AmapWeatherResponse extends AmapBase {
  count?: string
  lives?: AmapLive[]
}

/**
 * 预报中的单日（extensions=all 的 `forecasts[0].casts` 元素）。
 * 高德把气温、风力也返回成字符串，字段还可能缺省，映射时统一归一化。
 */
export interface AmapCast {
  date: string
  week: string
  dayweather: string
  nightweather: string
  daytemp: string
  nighttemp: string
  daywind: string
  daypower: string
}

/** 预报天气（extensions=all）：免费档返回「当日实况 + 未来 3 天」共 4 条 casts */
interface AmapForecast {
  province?: string
  city?: string
  reporttime?: string
  casts?: AmapCast[]
}

interface AmapForecastResponse extends AmapBase {
  count?: string
  forecasts?: AmapForecast[]
}

interface AmapGeocode {
  formatted_address?: string
  province?: string
  city?: string
  adcode?: string
}

interface AmapGeocodeResponse extends AmapBase {
  geocodes?: AmapGeocode[]
}

/** 逆地理编码响应（自动定位用） */
interface AmapRegeoResponse extends AmapBase {
  regeocode?: {
    formatted_address?: string
    addressComponent?: {
      province?: string
      /** 注意：直辖市（北京/上海等）该字段是空数组 []，不能当字符串用 */
      city?: string | string[]
      district?: string
      adcode?: string
    }
  }
}

/** 常见 infocode -> 中文提示（其余情况回落到 info 原文） */
const INFOCODE_MESSAGE: Record<string, string> = {
  '10001': 'API Key 无效或已过期',
  '10002': '该 Key 没有调用此服务的权限',
  '10003': '今日调用量已超限',
  '10004': '访问过于频繁，请稍后再试',
  '10009': 'Key 与平台类型不匹配，请申请「Web服务」类型的 Key',
  '10012': 'Key 已被删除或停用',
  '10014': '请求过于频繁（QPS 超限），请稍后再试',
  '10016': '当前 Key 无权限调用该接口',
  '10019': '请求过于频繁（并发超限），请稍后再试',
  '10021': '请求过于频繁（并发超限），请稍后再试',
  '20000': '请求参数错误',
  '20001': '缺少必填参数',
  '20800': '查询点超出服务范围',
  '20803': '未知错误',
}

/**
 * 常见城市 -> adcode 快查表。
 * 命中时可直接请求天气接口，省掉一次地理编码请求（更快，也少占 QPS 配额）。
 * 表中 adcode 均已通过高德地理编码接口实测核对。
 */
export const CITY_ADCODE: Record<string, string> = {
  北京: '110000',
  上海: '310000',
  广州: '440100',
  深圳: '440300',
  杭州: '330100',
  成都: '510100',
}

/**
 * 读取高德 Key，未配置或为空返回 undefined。
 * 兼容两个变量名：`VITE_AMAP_KEY`（项目一直在用）与 `VITE_WEATHER_KEY`（规划文档里的写法），
 * 两者取其一即可，避免用户照着文档配了却读不到。
 */
export function getWeatherKey(): string | undefined {
  const raw = import.meta.env.VITE_AMAP_KEY ?? import.meta.env.VITE_WEATHER_KEY
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

function requireKey(): string {
  const key = getWeatherKey()
  if (!key) throw new Error(WEATHER_KEY_MISSING_MESSAGE)
  return key
}

/** 高德业务错误（携带 infocode，便于判断能否重试） */
export class AmapError extends Error {
  readonly infocode: string

  constructor(message: string, infocode: string) {
    super(message)
    this.name = 'AmapError'
    this.infocode = infocode
  }
}

/** 可重试的错误码：频率/并发类限制，稍后重试通常即可成功 */
const RETRYABLE_INFOCODES = new Set(['10004', '10014', '10019', '10021'])

/** 重试间隔（ms）：免费 Key 实测约需 ≥1s 间隔，故退避到 1s / 2s */
const RETRY_DELAYS = [1000, 2000]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 遇到频率/并发类限制时自动退避重试。
 * 免费 Key 的 QPS 限制较紧，而「城市名 -> 地理编码 -> 天气」是两次连续请求，容易触发限流。
 */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      const retryable = err instanceof AmapError && RETRYABLE_INFOCODES.has(err.infocode)
      if (!retryable || attempt >= RETRY_DELAYS.length) throw err
      await delay(RETRY_DELAYS[attempt])
    }
  }
}

/** 校验高德响应：status != '1' 时抛出带中文提示的错误 */
function assertAmapOk(base: AmapBase, what: string): void {
  if (base?.status === '1') return
  const infocode = base?.infocode ?? ''
  const friendly = INFOCODE_MESSAGE[infocode] ?? base?.info ?? '未知错误'
  throw new AmapError(`${what}失败：${friendly}（infocode ${infocode || '-'}）`, infocode)
}

/**
 * 天气现象（中文）-> emoji 图标。
 * 降水/灾害类优先于「晴」，避免「晴转小雨」被判成晴天。纯函数，便于单测。
 */
export function weatherIcon(description: string): string {
  const d = description ?? ''
  if (d.includes('雷')) return '⛈️'
  if (d.includes('雪')) return '❄️'
  if (d.includes('雨')) return '🌧️'
  if (d.includes('霾')) return '😷'
  if (d.includes('雾')) return '🌫️'
  if (d.includes('沙') || d.includes('尘')) return '🌪️'
  if (d.includes('阴')) return '☁️'
  if (d.includes('多云')) return '⛅'
  if (d.includes('晴')) return '☀️'
  if (d.includes('风')) return '💨'
  return '🌡️'
}

function toNumber(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** "2026-09-10 12:00:00" -> 时间戳 ms（解析失败回落到当前时间） */
function parseReportTime(value: string | undefined): number {
  if (!value) return Date.now()
  const ms = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(ms) ? ms : Date.now()
}

/** 归一化：高德实况 -> 应用内 WeatherData */
export function normalizeWeather(live: AmapLive): WeatherData {
  const description = live.weather?.trim() || '未知'
  return {
    city: live.city?.trim() || live.province?.trim() || '',
    province: live.province?.trim() || undefined,
    temperature: toNumber(live.temperature),
    description,
    icon: weatherIcon(description),
    humidity: toNumber(live.humidity),
    windDirection: live.winddirection?.trim() || undefined,
    windPower: live.windpower?.trim() || undefined,
    updatedAt: parseReportTime(live.reporttime),
  }
}

/** 预报字段容错：高德偶有缺字段/脏数据，非字符串一律当空串处理 */
function castText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 归一化：高德预报 casts -> 应用内逐日预报。
 * 响应里的 casts 直接映射（免费档最多 4 条：当天 + 未来 3 天），不做增删，
 * 展示几条由 UI 决定；字段缺失/非法时兜底成空串或 0，绝不抛异常。
 */
export function normalizeForecast(casts: AmapCast[]): WeatherForecastDay[] {
  if (!Array.isArray(casts)) return []
  return casts.map((cast) => {
    const dayWeather = castText(cast?.dayweather) || '未知'
    return {
      date: castText(cast?.date),
      week: castText(cast?.week),
      dayWeather,
      nightWeather: castText(cast?.nightweather) || '未知',
      dayTemp: toNumber(cast?.daytemp),
      nightTemp: toNumber(cast?.nighttemp),
      dayWind: castText(cast?.daywind),
      dayPower: castText(cast?.daypower),
      // 图标按白天天气取：预报条一行三个，用夜间图标反而对不上用户的直觉
      icon: weatherIcon(dayWeather),
    }
  })
}

/** 6 位纯数字视为 adcode */
const ADCODE_PATTERN = /^\d{6}$/

/**
 * 把用户输入换算成 adcode（结果会写入缓存，避免重复地理编码）：
 * 1. 6 位数字 -> 直接使用
 * 2. 命中 adcode 缓存 / 本地快查表 -> 直接使用，省一次请求
 * 3. 其它城市名 -> 调用高德地理编码换算
 */
export async function resolveAdcode(
  input: string,
  cache: WeatherCache = weatherCache,
): Promise<string> {
  const query = input.trim()
  if (ADCODE_PATTERN.test(query)) return query

  const cached = cache.getAdcode(query)
  if (cached) return cached

  const known = CITY_ADCODE[normalizeCityKey(query)]
  if (known) {
    cache.setAdcode(query, known)
    return known
  }

  const params = new URLSearchParams({ key: requireKey(), address: query, output: 'JSON' })
  // 注意：assertAmapOk 必须在 withRetry 内部 —— 高德失败时 HTTP 仍是 200，
  // 错误要等解析响应体才知道，放在外面重试就永远不会触发。
  const raw = await withRetry(async () => {
    const res = await httpClient<AmapGeocodeResponse>(`${GEOCODE_URL}?${params.toString()}`, {
      timeoutMs: 10_000,
    })
    assertAmapOk(res, '城市查询')
    return res
  })

  const adcode = raw.geocodes?.[0]?.adcode
  if (!adcode) throw new Error(`未找到城市「${query}」，请换个名称或填写 6 位 adcode`)
  cache.setAdcode(query, adcode)
  return adcode
}

/** 高德对直辖市（北京/上海/天津/重庆）会把 city 返回成空数组，这里统一成 string | undefined */
function asText(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]).trim() || undefined : undefined
  }
  return value?.trim() || undefined
}

/**
 * 逆地理编码：把浏览器定位到的经纬度换算成地点信息（自动定位用）。
 *
 * 三个要点：
 * - 高德要求 location 参数格式为「经度,纬度」（经度在前，容易写反）
 * - 返回**区级** adcode（如 360111），已实测可直接用于天气查询
 * - 行政区名只能从这里拿：天气接口按区级 adcode 查询时，city 字段返回的是区名
 */
export async function locatePlace(latitude: number, longitude: number): Promise<LocatedPlace> {
  const key = requireKey()
  const location = `${longitude.toFixed(6)},${latitude.toFixed(6)}`
  const params = new URLSearchParams({ key, location, output: 'JSON' })

  const raw = await withRetry(async () => {
    const res = await httpClient<AmapRegeoResponse>(`${REGEO_URL}?${params.toString()}`, {
      timeoutMs: 10_000,
    })
    assertAmapOk(res, '定位')
    return res
  })

  const component = raw.regeocode?.addressComponent
  const adcode = asText(component?.adcode)
  if (!adcode) throw new Error('无法识别当前位置')

  return {
    adcode,
    province: asText(component?.province),
    city: asText(component?.city),
    district: asText(component?.district),
  }
}

export interface WeatherQueryOptions {
  /** 跳过缓存，强制请求最新数据（手动刷新） */
  force?: boolean
  /** 注入缓存实现（便于测试） */
  cache?: WeatherCache
}

export interface WeatherResult {
  data: WeatherData
  /** 是否直接命中缓存（未发起网络请求） */
  fromCache: boolean
}

/**
 * 获取指定城市当前天气（优先命中缓存）。
 * @param city 城市名（中文）或 6 位 adcode，默认北京
 * @param options force 跳过缓存；cache 注入缓存实现
 */
export async function fetchCurrentWeather(
  city: string = DEFAULT_WEATHER_CITY,
  options: WeatherQueryOptions = {},
): Promise<WeatherResult> {
  const cache = options.cache ?? weatherCache
  const adcode = await resolveAdcode(city, cache)

  if (!options.force) {
    const cached = cache.getWeather(adcode)
    if (cached) return { data: cached, fromCache: true }
  }

  const key = requireKey()
  const params = new URLSearchParams({ key, city: adcode, extensions: 'base', output: 'JSON' })
  // 同上：把 assertAmapOk 放进 withRetry，否则限流错误不会触发重试
  const raw = await withRetry(async () => {
    const res = await httpClient<AmapWeatherResponse>(`${WEATHER_URL}?${params.toString()}`, {
      timeoutMs: 10_000,
    })
    assertAmapOk(res, '天气查询')
    return res
  })

  const live = raw.lives?.[0]
  if (!live) throw new Error('该地区暂无天气数据')

  const data = normalizeWeather(live)
  cache.setWeather(adcode, data)
  return { data, fromCache: false }
}

/** 预报缓存键：与实况缓存分开存（见下方说明） */
export const WEATHER_FORECAST_STORAGE_KEY = 'smart-workspace:weather-forecast'

/** adcode -> { 预报, 写入时间 } */
type ForecastCacheState = Record<string, { data: WeatherForecast; cachedAt: number }>

/**
 * 预报缓存为什么不复用 weatherCache：
 * 那边的 weather 字段存的是实况（WeatherData），这边是预报（WeatherForecast），
 * 两份结构不同，共用一个键必然互相覆盖（谁后写谁把对方挤掉）。
 * 所以只借用它的 isFresh/TTL 判定，键与结构各用各的。
 */
function forecastCacheState(storage: Storage | null): ForecastCacheState {
  if (!storage) return {}
  try {
    const raw = storage.getItem(WEATHER_FORECAST_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ForecastCacheState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // 存储不可用（隐私模式/容量超限）或数据损坏：当作没有缓存
    return {}
  }
}

function defaultStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null
}

/** 读预报缓存（命中且未过期才返回） */
function readForecastCache(adcode: string, now: number = Date.now()): WeatherForecast | undefined {
  const entry = forecastCacheState(defaultStorage())[adcode]
  return entry && isFresh(entry.cachedAt, now, WEATHER_CACHE_TTL) ? entry.data : undefined
}

/** 写预报缓存（写入失败静默忽略，下次照常走网络） */
function writeForecastCache(adcode: string, data: WeatherForecast, now: number = Date.now()): void {
  const storage = defaultStorage()
  if (!storage) return
  try {
    const state = forecastCacheState(storage)
    state[adcode] = { data, cachedAt: now }
    storage.setItem(WEATHER_FORECAST_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 忽略：缓存只是省额度，写不进去不影响本次结果
  }
}

/**
 * 获取指定城市未来天气预报（高德 `extensions=all`，免费档上限：当日 + 未来 3 天）。
 *
 * 与实况的分工：实况走 `extensions=base`（每小时多次更新，30 分钟缓存），
 * 预报走 `extensions=all`（一天更新几次足够），两者缓存互不干扰。
 * @param city 城市名（中文）或 6 位 adcode，默认北京
 * @param options force 跳过缓存；cache 注入 adcode 缓存实现
 */
export async function fetchWeatherForecast(
  city: string = DEFAULT_WEATHER_CITY,
  options: WeatherQueryOptions = {},
): Promise<WeatherForecast> {
  const cache = options.cache ?? weatherCache
  // adcode 缓存与实况共用：城市名 -> adcode 的换算两边一模一样，没必要各查一次
  const adcode = await resolveAdcode(city, cache)

  if (!options.force) {
    const cached = readForecastCache(adcode)
    if (cached) return cached
  }

  const key = requireKey()
  const params = new URLSearchParams({ key, city: adcode, extensions: 'all', output: 'JSON' })
  // 同实况：assertAmapOk 必须在 withRetry 内部，否则限流错误不会触发重试
  const raw = await withRetry(async () => {
    const res = await httpClient<AmapForecastResponse>(`${WEATHER_URL}?${params.toString()}`, {
      timeoutMs: 10_000,
    })
    assertAmapOk(res, '天气预报查询')
    return res
  })

  const forecast = raw.forecasts?.[0]
  const days = normalizeForecast(forecast?.casts ?? [])
  if (days.length === 0) throw new Error('该地区暂无天气预报数据')

  const result: WeatherForecast = {
    province: forecast?.province?.trim() || undefined,
    city: forecast?.city?.trim() || '',
    reportTime: forecast?.reporttime?.trim() || undefined,
    days,
  }
  writeForecastCache(adcode, result)
  return result
}
