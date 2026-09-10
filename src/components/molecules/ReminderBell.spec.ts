/**
 * 提醒铃铛（应用内兜底通道的可见部分）。
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { DueReminder } from '@/types/reminder'
import ReminderBell from './ReminderBell.vue'

const NOW = new Date(2026, 8, 10, 10, 0, 0)

function reminder(partial: Partial<DueReminder> = {}): DueReminder {
  return {
    todoId: 't1',
    title: '交周报',
    at: new Date(2026, 8, 10, 9, 0, 0),
    overdueMs: 60 * 60 * 1000,
    seq: 1,
    ...partial,
  }
}

function mountBell(props: Record<string, unknown> = {}) {
  return mount(ReminderBell, { props: { now: NOW, ...props } })
}

describe('ReminderBell', () => {
  it('没有待处理提醒时不显示红点（红点不能变成常亮装饰）', () => {
    const wrapper = mountBell()
    expect(wrapper.find('[data-testid="reminder-badge"]').exists()).toBe(false)
  })

  it('有待处理提醒时显示数量红点，超过 9 显示 9+', () => {
    const one = mountBell({ reminders: [reminder()] })
    expect(one.find('[data-testid="reminder-badge"]').text()).toBe('1')

    const many = mountBell({
      reminders: Array.from({ length: 12 }, (_, i) => reminder({ todoId: `t${i}` })),
    })
    expect(many.find('[data-testid="reminder-badge"]').text()).toBe('9+')
  })

  it('面板默认收起，点铃铛展开；空状态给出说明', async () => {
    const wrapper = mountBell()
    expect(wrapper.find('[data-testid="reminder-panel"]').exists()).toBe(false)

    await wrapper.find('[data-testid="reminder-bell"]').trigger('click')
    expect(wrapper.find('[data-testid="reminder-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('没有待处理的提醒')
  })

  it('列出提醒：标题、计划时间与「已超时」文案', async () => {
    const wrapper = mountBell({ reminders: [reminder()] })
    await wrapper.find('[data-testid="reminder-bell"]').trigger('click')

    const item = wrapper.find('[data-testid="reminder-item-t1"]')
    expect(item.text()).toContain('交周报')
    expect(item.text()).toContain('9月10日 09:00')
    expect(item.text()).toContain('已超时 1 小时')
  })

  it('催办（seq=2）用不同的图标区分', async () => {
    const wrapper = mountBell({ reminders: [reminder({ seq: 2 })] })
    await wrapper.find('[data-testid="reminder-bell"]').trigger('click')

    expect(wrapper.find('[data-testid="reminder-item-t1"]').text()).toContain('🔁')
  })

  it('「知道了」emit dismiss 并从列表消失', async () => {
    const wrapper = mountBell({ reminders: [reminder()] })
    await wrapper.find('[data-testid="reminder-bell"]').trigger('click')

    await wrapper.find('[data-testid="reminder-dismiss-t1"]').trigger('click')

    expect(wrapper.emitted('dismiss')?.[0]).toEqual(['t1'])
    // 只剩一条时顺手收起面板（少一次点击）
    expect(wrapper.find('[data-testid="reminder-panel"]').exists()).toBe(false)
  })

  it('「去看」emit open-todo', async () => {
    const wrapper = mountBell({ reminders: [reminder()] })
    await wrapper.find('[data-testid="reminder-bell"]').trigger('click')

    await wrapper.find('[data-testid="reminder-open-t1"]').trigger('click')

    expect(wrapper.emitted('open-todo')?.[0]).toEqual(['t1'])
  })

  it('补发摘要：显示错过条数与标题，可一键清掉', async () => {
    const wrapper = mountBell({
      missed: [{ todoId: 't9', title: '开会', at: '2026-09-10T01:00:00.000Z' }],
    })
    await wrapper.find('[data-testid="reminder-bell"]').trigger('click')

    expect(wrapper.text()).toContain('你错过了 1 条提醒')
    expect(wrapper.text()).toContain('开会')

    await wrapper.find('[data-testid="reminder-clear-missed"]').trigger('click')
    expect(wrapper.emitted('clear-missed')).toHaveLength(1)
  })

  it('只有补发摘要、没有待处理提醒时，红点仍不出现（摘要不算「待办」）', async () => {
    const wrapper = mountBell({
      missed: [{ todoId: 't9', title: '开会', at: '2026-09-10T01:00:00.000Z' }],
    })
    expect(wrapper.find('[data-testid="reminder-badge"]').exists()).toBe(false)

    await wrapper.find('[data-testid="reminder-bell"]').trigger('click')
    expect(wrapper.text()).toContain('你错过了 1 条提醒')
  })
})
