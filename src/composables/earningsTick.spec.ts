import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useEarnings } from '@/composables/useEarnings'
import { secondsOfDay } from '@/utils/earnings'

/**
 * 秒表的两个「看不见但会漏」的点：
 * ① 时间精度——取时间要带毫秒（tick 默认每秒一次，但也可以调细到 100ms / rAF）；
 * ② 生命周期——仪表板被 keep-alive 缓存，切走不卸载，定时器不回收就会一直空转。
 */
describe('秒表：计时精度与定时器生命周期', () => {
  it('同一秒内的不同毫秒算作不同的时间点（更细的 tick 才有意义）', () => {
    const base = new Date(2026, 8, 9, 10, 30, 0, 0)
    const later = new Date(2026, 8, 9, 10, 30, 0, 500)

    expect(secondsOfDay(later) - secondsOfDay(base)).toBeCloseTo(0.5, 6)
  })

  it('整秒时刻的值与整秒语义一致（不会因为引入毫秒而漂移）', () => {
    expect(secondsOfDay(new Date(2026, 8, 9, 10, 30, 15, 0))).toBe(10 * 3600 + 30 * 60 + 15)
  })

  it('作用域销毁后回收定时器（keep-alive 下切走不再空转）', () => {
    vi.useFakeTimers()
    const scope = effectScope()
    scope.run(() => useEarnings({ autoTick: true }))

    const running = vi.getTimerCount()
    scope.stop()
    const afterDispose = vi.getTimerCount()
    vi.useRealTimers()

    expect(running).toBeGreaterThan(0)
    expect(afterDispose).toBe(0)
  })
})
