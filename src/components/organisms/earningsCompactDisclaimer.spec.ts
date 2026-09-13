import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import EarningsClock from './EarningsClock.vue'
import { EARNINGS_COMPACT_KEY, EARNINGS_DISCLAIMER } from '@/types/earnings'

/**
 * 回归：折叠成迷你条后免责声明就消失了。
 *
 * 「金额是估算、不是实际到手」这句在展开态才渲染，而把卡片长期折成小条的用户
 * 永远看不到它 —— 一个看起来像真实收入的数字却没有任何口径说明。
 * 迷你条放不下整句，所以补了悬停提示（title）与读屏文本（sr-only）两条通道。
 */
describe('赚钱秒表 · 折叠态的免责声明', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('迷你条带免责声明（悬停可读 + 读屏可读）', () => {
    localStorage.setItem(EARNINGS_COMPACT_KEY, 'true')

    const wrapper = mount(EarningsClock)

    const bar = wrapper.find('[data-testid="earnings-compact"]')
    expect(bar.exists()).toBe(true)
    expect(bar.attributes('title')).toBe(EARNINGS_DISCLAIMER)
    // 读屏通道：文本确实在迷你条内部
    expect(bar.text()).toContain(EARNINGS_DISCLAIMER)
  })

  it('展开态仍保留原有的免责声明块', () => {
    const wrapper = mount(EarningsClock)

    expect(wrapper.find('[data-testid="earnings-disclaimer"]').exists()).toBe(true)
  })
})
