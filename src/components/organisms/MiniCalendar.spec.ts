import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import MiniCalendar from './MiniCalendar.vue'

/** 2026-09-15（周二）：所在周 09-14 ~ 09-20，9 月 1 号是周二 */
const NOW = new Date(2026, 8, 15, 10, 0)

function mountCal(
  props: {
    activityDates?: string[]
    now?: Date
    holidayNames?: Record<string, string>
    makeupDays?: string[]
  } = {},
) {
  return mount(MiniCalendar, { props: { now: NOW, ...props } })
}

/** 网格容器的直接子元素（前 7 个是星期表头，之后是每周 7 格） */
function gridCells(wrapper: ReturnType<typeof mountCal>) {
  return Array.from(wrapper.find('[data-testid="cal-grid"]').element.children)
}

describe('MiniCalendar', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('渲染当月天数，每周固定 7 格、前导空位用占位补齐', () => {
    const wrapper = mountCal()

    expect(wrapper.findAll('[data-testid^="cal-day-"]')).toHaveLength(30) // 2026-09 共 30 天
    expect(wrapper.findAll('[data-testid="cal-pad"]')).toHaveLength(5) // 前导 1 + 尾部 4
    expect(gridCells(wrapper)).toHaveLength(7 + 35) // 表头 7 + 5 周 × 7
  })

  it('周一为首列：09-01 落在周二那一列，只有当月日期是可点的 button', () => {
    const wrapper = mountCal()
    const cells = gridCells(wrapper)

    expect(cells[7].getAttribute('data-testid')).toBe('cal-pad') // 周一是空位
    expect(cells[8].getAttribute('data-testid')).toBe('cal-day-2026-09-01')
    // 可点击的只有当月 30 天，占位是 span
    expect(wrapper.find('[data-testid="cal-grid"]').findAll('button')).toHaveLength(30)
  })

  it('今天高亮为主题色，其它日期不高亮', () => {
    const wrapper = mountCal()

    const today = wrapper.find('[data-testid="cal-day-2026-09-15"]')
    expect(today.classes()).toContain('bg-[var(--el-color-primary)]')
    expect(today.classes()).toContain('text-white')
    expect(today.attributes('aria-current')).toBe('date')

    const other = wrapper.find('[data-testid="cal-day-2026-09-14"]')
    expect(other.classes()).not.toContain('bg-[var(--el-color-primary)]')
    expect(other.attributes('aria-current')).toBeUndefined()
  })

  it('小圆点只出现在传进来的活动日期上', () => {
    const wrapper = mountCal({ activityDates: ['2026-09-10', '2026-09-15'] })

    expect(wrapper.findAll('[data-testid^="cal-dot-"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="cal-dot-2026-09-10"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cal-dot-2026-09-15"]').exists()).toBe(true) // 今天也能有圆点
    expect(wrapper.find('[data-testid="cal-dot-2026-09-11"]').exists()).toBe(false)
  })

  it('没有活动日期时不画任何圆点', () => {
    expect(mountCal().findAll('[data-testid^="cal-dot-"]')).toHaveLength(0)
    expect(mountCal({ activityDates: [] }).findAll('[data-testid^="cal-dot-"]')).toHaveLength(0)
  })

  it('点击当月日期 emit select，并带上 YYYY-MM-DD', async () => {
    const wrapper = mountCal()

    await wrapper.find('[data-testid="cal-day-2026-09-10"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['2026-09-10']])

    await wrapper.find('[data-testid="cal-day-2026-09-30"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['2026-09-10'], ['2026-09-30']])
  })

  it('点击跨月占位格什么都不发生', async () => {
    const wrapper = mountCal()
    const pads = wrapper.findAll('[data-testid="cal-pad"]')
    expect(pads.length).toBeGreaterThan(0)

    for (const pad of pads) await pad.trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('上/下月按钮切换展示的月份', async () => {
    const wrapper = mountCal()

    await wrapper.find('[data-testid="cal-prev"]').trigger('click')
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年8月')
    expect(wrapper.findAll('[data-testid^="cal-day-"]')).toHaveLength(31)

    await wrapper.find('[data-testid="cal-next"]').trigger('click')
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年9月')

    await wrapper.find('[data-testid="cal-next"]').trigger('click')
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年10月')
    expect(wrapper.findAll('[data-testid^="cal-day-"]')).toHaveLength(31)
  })

  it('「今天」按钮只在非当月出现，点完回到当月且今天重新高亮', async () => {
    const wrapper = mountCal()
    expect(wrapper.find('[data-testid="cal-today"]').exists()).toBe(false)

    await wrapper.find('[data-testid="cal-next"]').trigger('click')
    expect(wrapper.find('[data-testid="cal-today"]').exists()).toBe(true)
    // 别的月份里没有「今天」
    expect(wrapper.find('[data-testid="cal-day-2026-09-15"]').exists()).toBe(false)

    await wrapper.find('[data-testid="cal-today"]').trigger('click')
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年9月')
    expect(wrapper.find('[data-testid="cal-today"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cal-day-2026-09-15"]').classes()).toContain(
      'bg-[var(--el-color-primary)]',
    )
  })

  /**
   * 回归：父级（Dashboard）为跨零点刷新，每分钟都会把 `now` 换成**新的 Date 对象**。
   * 原来的 `watch(today, ...)` 比较的是 Date 的对象身份，于是用户翻到别的月份后
   * 静置一分钟就被拽回当月 —— 「今天」按钮形同虚设。
   */
  it('翻月后父级换新 now 不把视图拽回当月（只在年月变化时重置）', async () => {
    const wrapper = mountCal()

    await wrapper.find('[data-testid="cal-next"]').trigger('click')
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年10月')

    // 同月内换一个全新的 Date 对象（模拟每分钟刷新）：视图必须留在 10 月
    await wrapper.setProps({ now: new Date(2026, 8, 15, 10, 1) })
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年10月')

    // 同月内换日期同样不该重置
    await wrapper.setProps({ now: new Date(2026, 8, 16, 9, 0) })
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年10月')

    // 真正跨月（10/1 零点后）才跟回「当月」
    await wrapper.find('[data-testid="cal-next"]').trigger('click')
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年11月')
    await wrapper.setProps({ now: new Date(2026, 9, 1, 0, 5) })
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年10月')
  })

  it('往回翻月能跨年', async () => {
    const wrapper = mountCal({ now: new Date(2026, 0, 10, 10, 0) }) // 2026-01
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年1月')

    await wrapper.find('[data-testid="cal-prev"]').trigger('click')
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2025年12月')
    expect(wrapper.findAll('[data-testid^="cal-day-"]')).toHaveLength(31)
  })

  it('闰年 2 月渲染 29 天', () => {
    const wrapper = mountCal({ now: new Date(2028, 1, 10, 10, 0) })
    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2028年2月')
    expect(wrapper.findAll('[data-testid^="cal-day-"]')).toHaveLength(29)
    expect(wrapper.find('[data-testid="cal-day-2028-02-29"]').exists()).toBe(true)
  })

  it('未注入 now 时以系统时间为准', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 15, 10, 0))
    const wrapper = mount(MiniCalendar)

    expect(wrapper.find('[data-testid="cal-label"]').text()).toBe('2026年9月')
    expect(wrapper.find('[data-testid="cal-day-2026-09-15"]').classes()).toContain(
      'bg-[var(--el-color-primary)]',
    )
  })

  // ---- 第六阶段 6.4：法定节假日与调休标记 ----

  it('节假日标「休」并变色，鼠标悬停能看到节日名', () => {
    const wrapper = mountCal({ holidayNames: { '2026-09-25': '中秋节' } })

    const badge = wrapper.find('[data-testid="cal-holiday-2026-09-25"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('休')

    const cell = wrapper.find('[data-testid="cal-day-2026-09-25"]')
    expect(cell.classes()).toContain('text-rose-600')
    expect(cell.attributes('title')).toBe('中秋节')
    expect(cell.attributes('aria-label')).toContain('中秋节')
  })

  it('调休补班日标「班」，与节假日区分开', () => {
    const wrapper = mountCal({ makeupDays: ['2026-09-20'] })

    const badge = wrapper.find('[data-testid="cal-holiday-2026-09-20"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('班')

    const cell = wrapper.find('[data-testid="cal-day-2026-09-20"]')
    expect(cell.classes()).toContain('text-amber-600')
    expect(cell.attributes('title')).toBe('调休上班')
  })

  it('没有节假日数据时不画角标（不显示假信息）', () => {
    const wrapper = mountCal()
    expect(wrapper.find('[data-testid^="cal-holiday-"]').exists()).toBe(false)
  })

  it('节假日与「有完成任务」的小圆点可以同时存在（两种记号互不覆盖）', () => {
    const wrapper = mountCal({
      activityDates: ['2026-09-25'],
      holidayNames: { '2026-09-25': '中秋节' },
    })

    expect(wrapper.find('[data-testid="cal-holiday-2026-09-25"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cal-dot-2026-09-25"]').exists()).toBe(true)
  })
})
