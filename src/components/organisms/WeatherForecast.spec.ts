import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { Ref } from 'vue'

import type { WeatherForecast } from '@/types/weather'

/** useWeather 的桩：保留组件用到的状态与动作（含可选的 query/forecast） */
const weatherStub = vi.hoisted(() => ({
  weather: null as unknown,
  state: null as unknown,
  error: null as unknown,
  configured: null as unknown,
  fromCache: null as unknown,
  locating: null as unknown,
  located: null as unknown,
  locateHint: null as unknown,
  placeLabel: null as unknown,
  query: undefined as unknown,
  forecast: undefined as unknown,
  init: vi.fn(),
  locate: vi.fn(),
  setCity: vi.fn(),
  refresh: vi.fn(),
  retry: vi.fn(),
}))

/** fetchWeatherForecast 的桩：组件自行请求预报时走这里（不碰网络） */
const weatherApi = vi.hoisted(() => ({ fetchWeatherForecast: vi.fn() }))

vi.mock('@/composables/useWeather', () => ({ useWeather: () => weatherStub }))

// 局部替换：CITY_ADCODE 等其余导出保持真实实现
vi.mock('@/api/weather', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/weather')>()
  return { ...actual, fetchWeatherForecast: weatherApi.fetchWeatherForecast }
})

import WeatherWidget from './WeatherWidget.vue'

/** 四日预报样例（高德免费档：当天 + 未来 3 天） */
const FORECAST: WeatherForecast = {
  province: '浙江',
  city: '杭州市',
  reportTime: '2026-09-10 11:00:00',
  days: [
    {
      date: '2026-09-10',
      week: '星期四',
      dayWeather: '晴',
      nightWeather: '多云',
      dayTemp: 30,
      nightTemp: 21,
      dayWind: '东北',
      dayPower: '≤3',
      icon: '☀️',
    },
    {
      date: '2026-09-11',
      week: '星期五',
      dayWeather: '多云',
      nightWeather: '阴',
      dayTemp: 28,
      nightTemp: 19,
      dayWind: '北',
      dayPower: '≤3',
      icon: '⛅',
    },
    {
      date: '2026-09-12',
      week: '星期六',
      dayWeather: '小雨',
      nightWeather: '小雨',
      dayTemp: 24,
      nightTemp: 17,
      dayWind: '东',
      dayPower: '4',
      icon: '🌧️',
    },
    {
      date: '2026-09-13',
      week: '星期日',
      dayWeather: '雷阵雨',
      nightWeather: '阴',
      dayTemp: 22,
      nightTemp: 16,
      dayWind: '东南',
      dayPower: '5',
      icon: '⛈️',
    },
  ],
}

/** 常见实况（断言「预报不影响实况卡片」时对比用） */
function stubCurrentWeather() {
  weatherStub.weather = ref({
    city: '杭州市',
    province: '浙江省',
    temperature: 27,
    description: '晴',
    icon: '☀️',
    humidity: 44,
    windDirection: '东北',
    windPower: '5',
    updatedAt: Date.parse('2026-09-10T13:00:00'),
  })
  weatherStub.state = ref('success')
  weatherStub.error = ref('')
  weatherStub.configured = ref(true)
  weatherStub.fromCache = ref(false)
  weatherStub.locating = ref(false)
  weatherStub.located = ref(false)
  weatherStub.locateHint = ref('')
  weatherStub.placeLabel = ref('杭州市 · 浙江省')
  weatherStub.init = vi.fn(async () => true)
}

describe('WeatherWidget · 未来 3 日预报条（useWeather 已提供预报）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubCurrentWeather()
    weatherStub.query = ref('330100')
    weatherStub.forecast = ref<WeatherForecast | null>(FORECAST)
  })

  it('渲染 3 列：日期（几号）+ 图标 + 最高/最低气温 + 天气描述', () => {
    const wrapper = mount(WeatherWidget)
    const strip = wrapper.find('[data-testid="weather-forecast"]')

    expect(strip.exists()).toBe(true)
    const columns = strip.findAll('[data-testid^="forecast-day-"]')
    expect(columns).toHaveLength(3)

    // 首列对应 casts 首条（当天），其余两列依次顺延
    expect(columns[0].attributes('data-testid')).toBe('forecast-day-2026-09-10')
    // 口径是「几号」：接口给的 week 是周几，不再直接展示
    expect(columns[0].text()).toContain('9月10日')
    expect(columns[0].text()).not.toContain('星期四')
    expect(columns[0].text()).toContain('30°/21°')
    expect(columns[0].text()).toContain('晴')

    expect(columns[1].text()).toContain('9月11日')
    expect(columns[1].text()).toContain('28°/19°')
    expect(columns[1].text()).toContain('⛅')

    expect(columns[2].text()).toContain('9月12日')
    expect(columns[2].text()).toContain('24°/17°')
    expect(columns[2].text()).toContain('小雨')

    // 第 4 天不渲染：一行只放 3 列
    expect(strip.text()).not.toContain('9月13日')
  })

  it('复用 useWeather 的预报，不再自己请求一次', () => {
    mount(WeatherWidget)
    expect(weatherApi.fetchWeatherForecast).not.toHaveBeenCalled()
  })

  it('预报为 null 时整块不渲染，实况卡片照常显示', () => {
    weatherStub.forecast = ref<WeatherForecast | null>(null)
    const wrapper = mount(WeatherWidget)

    expect(wrapper.find('[data-testid="weather-forecast"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('27°C')
    expect(wrapper.text()).toContain('湿度 44%')
  })

  it('预报 days 为空数组时不渲染', () => {
    weatherStub.forecast = ref<WeatherForecast | null>({ city: '杭州市', days: [] })
    const wrapper = mount(WeatherWidget)

    expect(wrapper.find('[data-testid="weather-forecast"]').exists()).toBe(false)
  })

  it('未配置 Key 时既不请求预报，也不渲染预报条', () => {
    weatherStub.configured = ref(false)
    weatherStub.forecast = ref<WeatherForecast | null>(null)
    const wrapper = mount(WeatherWidget)

    expect(wrapper.find('[data-testid="weather-forecast"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('天气还没接通')
    expect(weatherApi.fetchWeatherForecast).not.toHaveBeenCalled()
  })
})

describe('WeatherWidget · 未来 3 日预报条（组件自行请求）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubCurrentWeather()
    // useWeather 不提供 forecast（当前实现），组件按 query 自行请求
    weatherStub.forecast = undefined
    weatherStub.query = ref('330100')
    weatherApi.fetchWeatherForecast.mockResolvedValue(FORECAST)
  })

  it('与实况并行请求当前查询目标的预报，并渲染 3 列', async () => {
    const wrapper = mount(WeatherWidget)
    await flushPromises()

    // 用实况的查询目标（adcode）请求，保证两处是同一个城市
    expect(weatherApi.fetchWeatherForecast).toHaveBeenCalledWith('330100')
    const columns = wrapper.findAll('[data-testid^="forecast-day-"]')
    expect(columns).toHaveLength(3)
    expect(columns[1].text()).toContain('28°/19°')
  })

  it('预报请求失败时静默降级：不渲染预报条，实况卡片不受影响', async () => {
    weatherApi.fetchWeatherForecast.mockRejectedValue(new Error('今日调用量已超限'))
    const wrapper = mount(WeatherWidget)
    await flushPromises()

    expect(wrapper.find('[data-testid="weather-forecast"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('27°C')
    expect(wrapper.text()).toContain('晴')
    // 失败不该把实况卡片推进错误态
    expect(wrapper.text()).not.toContain('今日调用量已超限')
  })

  it('预报返回空 days 时不渲染', async () => {
    weatherApi.fetchWeatherForecast.mockResolvedValue({ city: '杭州市', days: [] })
    const wrapper = mount(WeatherWidget)
    await flushPromises()

    expect(wrapper.find('[data-testid="weather-forecast"]').exists()).toBe(false)
  })

  it('查询目标为空（组件被单独挂载）时不请求预报', async () => {
    weatherStub.query = undefined
    mount(WeatherWidget)
    await flushPromises()

    expect(weatherApi.fetchWeatherForecast).not.toHaveBeenCalled()
  })

  it('「↻ 刷新」：预报失败后能重试，已经拿到预报则不重复请求', async () => {
    weatherApi.fetchWeatherForecast.mockRejectedValueOnce(new Error('请求过于频繁'))
    const wrapper = mount(WeatherWidget)
    await flushPromises()
    expect(wrapper.find('[data-testid="weather-forecast"]').exists()).toBe(false)

    // 失败过 -> 刷新时重试，成功后补上预报条
    weatherApi.fetchWeatherForecast.mockResolvedValue(FORECAST)
    await wrapper.find('button[aria-label="刷新天气"]').trigger('click')
    await flushPromises()

    expect(weatherApi.fetchWeatherForecast).toHaveBeenCalledTimes(2)
    expect(weatherStub.refresh).toHaveBeenCalled()
    expect(wrapper.findAll('[data-testid^="forecast-day-"]')).toHaveLength(3)

    // 已有预报 -> 再刷新只刷实况，不重复占额度
    await wrapper.find('button[aria-label="刷新天气"]').trigger('click')
    await flushPromises()
    expect(weatherApi.fetchWeatherForecast).toHaveBeenCalledTimes(2)
  })

  it('查询目标变化（切城/定位）时按新目标重新请求', async () => {
    const wrapper = mount(WeatherWidget)
    await flushPromises()
    expect(weatherApi.fetchWeatherForecast).toHaveBeenCalledTimes(1)

    // 切城/定位会改「当前查询目标」，预报要跟着换城市
    ;(weatherStub.query as Ref<string>).value = '110000'
    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(weatherApi.fetchWeatherForecast).toHaveBeenCalledTimes(2)
    expect(weatherApi.fetchWeatherForecast).toHaveBeenLastCalledWith('110000')
  })
})
