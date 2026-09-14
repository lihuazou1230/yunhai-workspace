import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'

import { quoteOfDay } from '@/utils/dailyQuote'

/**
 * 认证 store 的桩：页头只读「是否登录 + 显示名」两个字段，
 * 认证流程本身由 authStore.spec.ts 负责，这里不必把整条 Supabase 链路拖进来。
 * 用 getter 暴露（而不是直接给 ref），跟 Pinia store 解包后的形态保持一致——
 * 组件里写的是 `authStore.displayName`，不是 `.value`。
 */
const auth = vi.hoisted(() => ({ isAuthed: null as unknown, displayName: null as unknown }))
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    get isAuthed() {
      return (auth.isAuthed as { value: boolean }).value
    },
    get displayName() {
      return (auth.displayName as { value: string }).value
    },
  }),
}))

import DailyGreeting from './DailyGreeting.vue'

/** 2026-09-10 是周四 */
function freezeTime(hours: number, minutes = 0, day = 10) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, day, hours, minutes, 0))
}

beforeEach(() => {
  // 默认：本地模式（未登录），问候语不带称呼
  auth.isAuthed = ref(false)
  auth.displayName = ref('本地访客')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DailyGreeting', () => {
  it('显示时段问候、日期标签与当日格言', () => {
    freezeTime(9, 30)
    const wrapper = mount(DailyGreeting)
    const quote = quoteOfDay('2026-09-10')

    expect(wrapper.text()).toContain('早上好')
    expect(wrapper.text()).toContain('9月10日 星期四')
    expect(wrapper.text()).toContain(quote.text)
    expect(wrapper.text()).toContain(quote.author)
  })

  it('问候语随当前时段变化', () => {
    freezeTime(3)
    expect(mount(DailyGreeting).text()).toContain('凌晨好')

    freezeTime(15)
    expect(mount(DailyGreeting).text()).toContain('下午好')

    freezeTime(21)
    expect(mount(DailyGreeting).text()).toContain('晚上好')
  })

  // ---- 问候语带用户名 ----

  it('登录后问候语带上用户名：早上好，张三，今天是 …', () => {
    freezeTime(9, 30)
    auth.isAuthed = ref(true)
    auth.displayName = ref('张三')

    expect(mount(DailyGreeting).text()).toContain('早上好，张三，今天是 9月10日 星期四')
  })

  it('本地模式（未登录）不带称呼：不硬塞「本地访客」', () => {
    freezeTime(9, 30)
    auth.isAuthed = ref(false)

    const text = mount(DailyGreeting).text()
    expect(text).toContain('早上好，今天是 9月10日 星期四')
    expect(text).not.toContain('本地访客')
  })

  it('超长昵称截断，避免把右边的格言挤没（昵称上限 20 字，页头只留 12 字）', () => {
    freezeTime(9, 30)
    auth.isAuthed = ref(true)
    auth.displayName = ref('一二三四五六七八九十一二三四五六七八九十')

    const text = mount(DailyGreeting).text()
    expect(text).toContain('早上好，一二三四五六七八九十一二…，今天是')
    expect(text).not.toContain('一二三四五六七八九十一二三四五六七八九十')
  })

  it('同一天多次挂载取到同一句格言（不因重新渲染而换句）', () => {
    freezeTime(10)
    const first = mount(DailyGreeting).text()
    const second = mount(DailyGreeting).text()
    expect(second).toBe(first)
  })

  it('跨过零点后切回标签页会刷新问候与格言', async () => {
    freezeTime(10, 0, 10)
    const wrapper = mount(DailyGreeting)
    expect(wrapper.text()).toContain('早上好')
    const before = quoteOfDay('2026-09-10').text

    // 时间推进到次日凌晨，模拟切回标签页
    vi.setSystemTime(new Date(2026, 8, 11, 1, 0, 0))
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()

    expect(wrapper.text()).toContain('凌晨好')
    expect(wrapper.text()).toContain('9月11日 星期五')
    // 新的一天会换句（同日不再重复出现旧句的概率由轮换保证）
    expect(wrapper.text()).toContain(quoteOfDay('2026-09-11').text)
    expect(before.length).toBeGreaterThan(0)
  })

  // ---- 第六阶段 6.4：页头当前时间 ----

  it('页头显示当前时间 HH:mm:ss', () => {
    freezeTime(9, 5)
    const wrapper = mount(DailyGreeting)
    expect(wrapper.find('[data-testid="header-clock"]').text()).toBe('09:05:00')
  })

  it('切回标签页后时间跟着校准（不是冻结在挂载那一刻）', async () => {
    freezeTime(9, 5)
    const wrapper = mount(DailyGreeting)
    expect(wrapper.find('[data-testid="header-clock"]').text()).toBe('09:05:00')

    vi.setSystemTime(new Date(2026, 8, 10, 18, 42, 7))
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()

    expect(wrapper.find('[data-testid="header-clock"]').text()).toBe('18:42:07')
  })
})
