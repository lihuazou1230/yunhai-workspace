import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

/** useWeather 的桩：只保留组件用到的状态与动作 */
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
  init: vi.fn(),
  locate: vi.fn(),
  setCity: vi.fn(),
  refresh: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('@/composables/useWeather', () => ({ useWeather: () => weatherStub }))

import WeatherWidget from './WeatherWidget.vue'

function mountWidget() {
  return mount(WeatherWidget)
}

describe('WeatherWidget（天气卡）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    weatherStub.weather = ref({
      city: '杭州市',
      province: '浙江省',
      temperature: 27,
      feelsLike: 30,
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
    weatherStub.setCity = vi.fn(async () => true)
  })

  it('展示温度大数字与天气描述', () => {
    const wrapper = mountWidget()

    expect(wrapper.text()).toContain('27°C')
    expect(wrapper.text()).toContain('晴')
    expect(wrapper.text()).toContain('湿度 44%')
  })

  it('手动切换城市：默认收起，点「🏙 城市」展开输入框与常用城市快捷键', async () => {
    const wrapper = mountWidget()

    expect(wrapper.find('[data-testid="weather-city-picker"]').exists()).toBe(false)

    await wrapper.find('button[aria-label="切换城市"]').trigger('click')
    const picker = wrapper.find('[data-testid="weather-city-picker"]')
    expect(picker.exists()).toBe(true)
    expect(picker.find('input[aria-label="输入城市名"]').exists()).toBe(true)
    // 六个常用城市快捷键
    for (const name of ['北京', '上海', '广州', '深圳', '杭州', '成都']) {
      expect(picker.text()).toContain(name)
    }
  })

  it('输入城市名提交后调用 setCity，成功后收起面板并清空输入', async () => {
    const wrapper = mountWidget()
    await wrapper.find('button[aria-label="切换城市"]').trigger('click')

    const input = wrapper.find('input[aria-label="输入城市名"]')
    await input.setValue('南昌')
    await wrapper.find('[data-testid="weather-city-picker"] form').trigger('submit')

    expect(weatherStub.setCity).toHaveBeenCalledWith('南昌')
    expect(wrapper.find('[data-testid="weather-city-picker"]').exists()).toBe(false)
  })

  it('点常用城市快捷键切换', async () => {
    const wrapper = mountWidget()
    await wrapper.find('button[aria-label="切换城市"]').trigger('click')

    const quick = wrapper
      .findAll('[data-testid="weather-city-picker"] button')
      .find((b) => b.text() === '杭州')
    expect(quick).toBeTruthy()
    await quick!.trigger('click')

    expect(weatherStub.setCity).toHaveBeenCalledWith('杭州')
  })

  it('切换失败时保留面板（让用户能改一个城市重试）', async () => {
    weatherStub.setCity = vi.fn(async () => false)
    const wrapper = mountWidget()
    await wrapper.find('button[aria-label="切换城市"]').trigger('click')

    await wrapper.find('input[aria-label="输入城市名"]').setValue('不存在的城市')
    await wrapper.find('[data-testid="weather-city-picker"] form').trigger('submit')

    expect(wrapper.find('[data-testid="weather-city-picker"]').exists()).toBe(true)
  })

  it('未配置 Key 时不展示切换城市入口，只给配置指引', () => {
    weatherStub.configured = ref(false)
    const wrapper = mountWidget()

    expect(wrapper.find('button[aria-label="切换城市"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('天气还没接通')
  })

  it('工具栏只留「城市 / 刷新」：不再显示「缓存」标记与「📍 定位」按钮', () => {
    weatherStub.fromCache = ref(true)
    weatherStub.located = ref(true)
    const wrapper = mountWidget()

    expect(wrapper.text()).not.toContain('缓存')
    expect(wrapper.find('button[aria-label="重新定位"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="切换城市"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="刷新天气"]').exists()).toBe(true)
  })

  it('「↻ 刷新」：展示的是定位结果时重新定位（跳过缓存），不再走单独的定位按钮', async () => {
    weatherStub.located = ref(true)
    const wrapper = mountWidget()

    await wrapper.find('button[aria-label="刷新天气"]').trigger('click')

    expect(weatherStub.locate).toHaveBeenCalledWith({ force: true })
    expect(weatherStub.refresh).not.toHaveBeenCalled()
  })

  it('「↻ 刷新」：手动选过城市时只刷新那座城市，不被定位盖回去', async () => {
    weatherStub.located = ref(false)
    const wrapper = mountWidget()

    await wrapper.find('button[aria-label="刷新天气"]').trigger('click')

    expect(weatherStub.refresh).toHaveBeenCalled()
    expect(weatherStub.locate).not.toHaveBeenCalled()
  })

  it('城市面板里保留「用当前位置」：手动切城后还能回到自动定位', async () => {
    const wrapper = mountWidget()
    await wrapper.find('button[aria-label="切换城市"]').trigger('click')

    const button = wrapper.find('[data-testid="weather-use-current-location"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')

    expect(weatherStub.locate).toHaveBeenCalledWith({ force: true })
    // 面板收起，回到卡片主体看结果
    expect(wrapper.find('[data-testid="weather-city-picker"]').exists()).toBe(false)
  })
})
