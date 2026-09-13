import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MiniCalendar from './MiniCalendar.vue'

/** 2026-09-15（周二） */
const NOW = new Date(2026, 8, 15, 10, 0)

/**
 * 回归：节假日/调休由父级按月注入，而「用户翻到了哪个月」只有组件自己知道。
 * 此前没有这个事件，父级只能一直喂"今天所在月"的数据 ——
 * 翻到 10 月后国庆 7 天与 10/10 调休全都不显示。
 */
describe('MiniCalendar · 把当前展示的月份告诉父级', () => {
  it('挂载即报一次（父级不必自己猜初始月份）', () => {
    const wrapper = mount(MiniCalendar, { props: { now: NOW } })

    expect(wrapper.emitted('viewMonth')?.[0]).toEqual([2026, 9])
  })

  it('往后翻报下一个月（month 为 1~12）', async () => {
    const wrapper = mount(MiniCalendar, { props: { now: NOW } })

    await wrapper.find('[data-testid="cal-next"]').trigger('click')

    const events = wrapper.emitted('viewMonth') ?? []
    expect(events[events.length - 1]).toEqual([2026, 10])
  })

  it('往前翻能跨年', async () => {
    const wrapper = mount(MiniCalendar, {
      props: { now: new Date(2026, 0, 10, 10, 0) }, // 2026-01
    })

    await wrapper.find('[data-testid="cal-prev"]').trigger('click')

    const events = wrapper.emitted('viewMonth') ?? []
    expect(events[events.length - 1]).toEqual([2025, 12])
  })

  it('点「今天」回到当月并再报一次', async () => {
    const wrapper = mount(MiniCalendar, { props: { now: NOW } })

    await wrapper.find('[data-testid="cal-next"]').trigger('click')
    await wrapper.find('[data-testid="cal-today"]').trigger('click')

    const events = wrapper.emitted('viewMonth') ?? []
    expect(events[events.length - 1]).toEqual([2026, 9])
  })
})
