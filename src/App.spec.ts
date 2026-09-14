import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'

import { DEFAULT_EARNINGS_CONFIG, EARNINGS_STORAGE_KEY } from '@/types/earnings'
import { quoteOfDay } from '@/utils/dailyQuote'
import { routes } from '@/router'
import App from './App.vue'

/** 2026-09-10 是周四 */
function freezeTime(hours: number, minutes = 0) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 10, hours, minutes, 0))
}

/** 挂载整个应用（含路由与布局），返回当前路由以便断言守卫行为 */
async function mountApp(path = '/') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()

  const wrapper = mount(App, { global: { plugins: [pinia, router] } })
  await nextTick()
  await nextTick()
  return { wrapper, router }
}

describe('App 集成（第五阶段：路由拆分后的整体装配）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('默认进入仪表板：品牌、每日格言、赚钱秒表、今日完成度与天气都在首页', () => {
    freezeTime(10)
    localStorage.setItem(
      EARNINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_EARNINGS_CONFIG, monthlySalary: 21750 }),
    )
    return mountApp('/').then(({ wrapper, router }) => {
      expect(router.currentRoute.value.name).toBe('dashboard')

      // 侧边栏品牌 + 布局
      expect(wrapper.text()).toContain('云海工作台')
      expect(wrapper.find('[data-testid="sidebar"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="bottom-nav-todos"]').exists()).toBe(true)

      // 每日格言：时段问候 + 当日那句
      expect(wrapper.text()).toContain('早上好')
      expect(wrapper.text()).toContain('9月10日 星期四')
      expect(wrapper.text()).toContain(quoteOfDay('2026-09-10').text)

      // PayDance（赚钱秒表）：今日 09:00-10:00 计薪 1 小时 => 125.00 元
      expect(wrapper.text()).toContain('💰 PayDance')
      expect(wrapper.find('[data-testid="earnings-today"]').text()).toContain('125.00')
      expect(wrapper.find('[data-testid="earnings-stats"]').exists()).toBe(true)

      // 首页只留「一眼看清」的内容：任务表单已搬到 /todos
      expect(wrapper.find('input[placeholder*="添加新任务"]').exists()).toBe(false)
    })
  })

  it('任务页：通过表单添加任务后列表出现该任务', async () => {
    const { wrapper, router } = await mountApp('/todos')
    expect(router.currentRoute.value.name).toBe('todos')

    await wrapper.find('input[placeholder*="添加新任务"]').setValue('集成测试任务')
    await wrapper.find('form').trigger('submit')
    await nextTick()

    expect(wrapper.text()).toContain('集成测试任务')
    // 任务页默认筛选「进行中」，列表计数文案来自 TodoList
    expect(wrapper.text()).toContain('进行中 · 1 项')
  })

  it('统计页：装配图表与热力图', async () => {
    const { wrapper, router } = await mountApp('/stats')
    expect(router.currentRoute.value.name).toBe('stats')
    expect(wrapper.text()).toContain('统计')
    expect(wrapper.text()).toContain('生产力热力图')
  })

  it('设置页：装配个人资料、数据同步与外观自定义', async () => {
    const { wrapper, router } = await mountApp('/settings')
    expect(router.currentRoute.value.name).toBe('settings')

    expect(wrapper.text()).toContain('个人资料')
    expect(wrapper.text()).toContain('数据同步')
    expect(wrapper.text()).toContain('外观自定义')
    // 未配置 Supabase 的测试环境：应显示配置引导而不是报错
    expect(wrapper.find('[data-testid="settings-setup-hint"]').exists()).toBe(true)
  })

  it('未配置 Supabase 时是本地模式：不会被锁在登录页', async () => {
    const { wrapper, router } = await mountApp('/todos')
    expect(router.currentRoute.value.name).toBe('todos')
    expect(wrapper.find('[data-testid="login-card"]').exists()).toBe(false)
  })

  it('登录页可以独立访问（不套布局）', async () => {
    const { wrapper, router } = await mountApp('/login')
    expect(router.currentRoute.value.name).toBe('login')
    expect(wrapper.find('[data-testid="login-card"]').exists()).toBe(true)
    // 独立全屏：不带侧边栏
    expect(wrapper.find('[data-testid="sidebar"]').exists()).toBe(false)
  })
})
