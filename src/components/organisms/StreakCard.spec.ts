import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { DEFAULT_WEEK_GOAL } from '@/utils/streak'
import type { StreakInfo } from '@/utils/streak'
import StreakCard from './StreakCard.vue'

function info(partial: Partial<StreakInfo> = {}): StreakInfo {
  return {
    current: 0,
    best: 0,
    bestWeekday: '',
    weekCompleted: 0,
    weekGoal: DEFAULT_WEEK_GOAL,
    weekRate: 0,
    goalReached: false,
    ...partial,
  }
}

function mountCard(props: { info?: StreakInfo; weekGoal?: number } = {}) {
  return mount(StreakCard, { props: { info: info(), ...props } })
}

describe('StreakCard', () => {
  it('渲染连续天数与火焰点缀', () => {
    const wrapper = mountCard({ info: info({ current: 5 }) })

    expect(wrapper.find('[data-testid="streak-current"]').text()).toBe('连续 5 天')
    expect(wrapper.text()).toContain('🔥')
  })

  it('摘要行给出本周完成数与最佳星期', () => {
    const wrapper = mountCard({
      info: info({ current: 3, bestWeekday: '周三', weekCompleted: 7, best: 12 }),
    })

    const summary = wrapper.find('[data-testid="streak-summary"]')
    expect(summary.text()).toContain('本周完成 7 个')
    expect(summary.text()).toContain('最佳日周三')
    expect(wrapper.text()).toContain('近 90 天最长连续 12 天')
  })

  it('近 90 天没有记录时用占位文案，不硬凑一个最佳日', () => {
    const wrapper = mountCard()

    expect(wrapper.find('[data-testid="streak-summary"]').text()).toContain('近 90 天暂无记录')
    expect(wrapper.find('[data-testid="streak-summary"]').text()).not.toContain('最佳日')
  })

  it('进度条宽度与百分比文字都跟着 weekRate 走', () => {
    const wrapper = mountCard({
      info: info({ weekCompleted: 10, weekGoal: 20, weekRate: 50 }),
    })

    expect(wrapper.find('[data-testid="streak-progress-bar"]').attributes('style')).toContain(
      'width: 50%',
    )
    expect(wrapper.find('[data-testid="streak-rate"]').text()).toBe('50%')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('50')
    expect(wrapper.text()).toContain('本周进度 10 / 20 个')
  })

  it('未达标时不显示达标徽章', () => {
    const wrapper = mountCard({ info: info({ weekCompleted: 19, weekGoal: 20, weekRate: 95 }) })

    expect(wrapper.find('[data-testid="streak-goal-reached"]').exists()).toBe(false)
  })

  it('达到周目标时显示达标徽章', () => {
    const wrapper = mountCard({
      info: info({ weekCompleted: 20, weekGoal: 20, weekRate: 100, goalReached: true }),
    })

    const badge = wrapper.find('[data-testid="streak-goal-reached"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('达标')
  })

  it('没传 weekGoal 时用默认目标 20', () => {
    expect(mountCard().text()).toContain('本周进度 0 / 20 个')
  })

  it('卡上改周目标会 emit update:weekGoal', async () => {
    const wrapper = mountCard({ weekGoal: 20 })

    await wrapper.find('[data-testid="streak-goal-input"]').setValue('30')
    expect(wrapper.emitted('update:weekGoal')).toEqual([[30]])
  })

  it('非法输入（0 / 负数 / 非数字 / 空）一律钳到 1', async () => {
    // 每种非法值各挂一次：钳制后取值相同，Vue 的 model 会把同值写入去重，不复用同一个 wrapper
    for (const bad of ['0', '-5', 'abc', '']) {
      const wrapper = mountCard({ weekGoal: 20 })
      await wrapper.find('[data-testid="streak-goal-input"]').setValue(bad)
      expect(wrapper.emitted('update:weekGoal')).toEqual([[1]])
    }
  })

  it('小数目标向下取整到个位', async () => {
    const wrapper = mountCard({ weekGoal: 20 })

    await wrapper.find('[data-testid="streak-goal-input"]').setValue('12.7')
    expect(wrapper.emitted('update:weekGoal')).toEqual([[12]])
  })

  it('父级把新目标回传后，卡上的进度文案同步更新', async () => {
    const wrapper = mountCard({ weekGoal: 20 })

    await wrapper.find('[data-testid="streak-goal-input"]').setValue('30')
    await wrapper.setProps({ weekGoal: 30 })

    expect(wrapper.find<HTMLInputElement>('[data-testid="streak-goal-input"]').element.value).toBe(
      '30',
    )
    expect(wrapper.text()).toContain('本周进度 0 / 30 个')
  })
})
