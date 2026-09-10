import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import {
  DEFAULT_EARNINGS_CONFIG,
  EARNINGS_COMPACT_KEY,
  EARNINGS_STORAGE_KEY,
} from '@/types/earnings'
import type { EarningsConfig } from '@/types/earnings'
import { useEarnings } from './useEarnings'

/** 内存 Storage 替身：跨"刷新"复用同一实例即可验证持久化 */
function createMemoryStorage(seed?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(seed ?? {}))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage
}

const CONFIG: EarningsConfig = { ...DEFAULT_EARNINGS_CONFIG, monthlySalary: 21750 }

/** 2026-09-10 周四 */
function at(hours: number, minutes = 0, seconds = 0): Date {
  return new Date(2026, 8, 10, hours, minutes, seconds)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useEarnings', () => {
  it('默认未配置：金额为 0，状态为 not-configured', () => {
    const earnings = useEarnings({
      storage: createMemoryStorage(),
      clock: () => at(10),
      autoTick: false,
    })
    expect(earnings.isConfigured.value).toBe(false)
    expect(earnings.snapshot.value.status).toBe('not-configured')
    expect(earnings.amountText.value).toBe('0.00')
  })

  it('读取已持久化的配置并算出金额', () => {
    const storage = createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) })
    const earnings = useEarnings({ storage, clock: () => at(11), autoTick: false })

    expect(earnings.isConfigured.value).toBe(true)
    expect(earnings.snapshot.value.status).toBe('working')
    // 09:00-11:00 计薪 2 小时，占 8 小时的 1/4 => 250.00 元
    expect(earnings.amountText.value).toBe('250.00')
  })

  it('周末不计薪：金额恒为 0（数据层拦截，不只是 UI 隐藏）', () => {
    const saturday = new Date(2026, 8, 12, 14, 0, 0)
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => saturday,
      autoTick: false,
    })

    expect(earnings.snapshot.value.status).toBe('weekend')
    expect(earnings.amountText.value).toBe('0.00')
  })

  it('updateConfig 立即生效并写入 localStorage', async () => {
    const storage = createMemoryStorage()
    const earnings = useEarnings({
      storage,
      clock: () => at(18),
      autoTick: false,
    })

    earnings.updateConfig({ monthlySalary: 21750 })
    expect(earnings.isConfigured.value).toBe(true)
    expect(earnings.amountText.value).toBe('1,000.00')

    // 持久化由 useLocalStorage 的 watch 异步落盘
    await nextTick()
    const persisted = JSON.parse(storage.getItem(EARNINGS_STORAGE_KEY) ?? '{}') as EarningsConfig
    expect(persisted.monthlySalary).toBe(21750)
  })

  it('resetConfig 恢复默认配置', () => {
    const storage = createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) })
    const earnings = useEarnings({ storage, clock: () => at(12), autoTick: false })

    earnings.resetConfig()
    expect(earnings.config.value.monthlySalary).toBe(DEFAULT_EARNINGS_CONFIG.monthlySalary)
    expect(earnings.snapshot.value.status).toBe('not-configured')
  })

  it('refresh 用最新时间戳重算：后台"跳过"若干次 tick 也不产生累计误差', () => {
    let current = at(10)
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => current,
      autoTick: false,
    })

    expect(earnings.amountText.value).toBe('125.00')

    // 模拟标签页被节流：直接跳跃 4 小时后再刷新
    current = at(14)
    earnings.refresh()
    expect(earnings.amountText.value).toBe('500.00')

    // 与"逐秒累加"对照：此刻的准确值就是 500.00（4h/8h × 1000 元）
    current = at(18)
    earnings.refresh()
    expect(earnings.amountText.value).toBe('1,000.00')
  })

  it('autoTick 开启时按秒推进到准确金额', () => {
    vi.useFakeTimers()
    let current = at(10, 0, 0)
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => current,
      autoTick: true,
    })

    expect(earnings.amountText.value).toBe('125.00')

    // 时间前进 10 秒 + 10 次 tick
    current = at(10, 0, 10)
    vi.advanceTimersByTime(10_000)
    expect(earnings.amountText.value).toBe('125.35')

    earnings.stop()
    current = at(11, 0, 0)
    vi.advanceTimersByTime(10_000)
    // 已 stop：不再重算
    expect(earnings.amountText.value).toBe('125.35')
  })

  it('start/stop 控制 tick 开关', () => {
    vi.useFakeTimers()
    let current = at(10, 0, 0)
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => current,
      autoTick: false,
    })

    earnings.start()
    current = at(12, 0, 0)
    vi.advanceTimersByTime(1000)
    expect(earnings.amountText.value).toBe('375.00')

    earnings.stop()
    current = at(18, 0, 0)
    vi.advanceTimersByTime(5000)
    expect(earnings.amountText.value).toBe('375.00')
  })

  // ---- 第六阶段 6.2 ----

  it('默认 tick 提升到 100ms（毫秒级更新，显示仍精准到分）', () => {
    vi.useFakeTimers()
    let current = at(10, 0, 0)
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => current,
      autoTick: true,
    })

    expect(earnings.amountText.value).toBe('125.00')

    // 只推进 100ms：定时器已经跑过一轮，金额按新时间戳重算
    current = at(10, 0, 1)
    vi.advanceTimersByTime(100)
    expect(earnings.amountText.value).toBe('125.03')

    earnings.stop()
  })

  it('可切 requestAnimationFrame 模式：用 rAF 而不是定时器驱动', () => {
    const rafCallbacks: Array<() => void> = []
    const rafSpy = vi.fn((cb: () => void) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    vi.stubGlobal('requestAnimationFrame', rafSpy)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    let current = at(10, 0, 0)
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => current,
      autoTick: true,
      useRaf: true,
    })

    expect(rafSpy).toHaveBeenCalled()

    // 手动触发一帧（模拟浏览器回调），金额按新时间戳重算
    current = at(10, 0, 2)
    rafCallbacks.shift()?.()
    // 2 秒 × 125 元/时 ÷ 3600 ≈ 0.069 元 → 进位到 0.07
    expect(earnings.amountText.value).toBe('125.07')

    earnings.stop()
    vi.unstubAllGlobals()
  })

  it('迷你折叠模式：toggleCompact 切换并持久化到独立键', async () => {
    const storage = createMemoryStorage()
    const earnings = useEarnings({ storage, clock: () => at(10), autoTick: false })

    expect(earnings.compact.value).toBe(false)
    earnings.toggleCompact()
    await nextTick()

    expect(earnings.compact.value).toBe(true)
    expect(storage.getItem(EARNINGS_COMPACT_KEY)).toBe('true')

    earnings.toggleCompact()
    await nextTick()
    expect(earnings.compact.value).toBe(false)
  })

  it('读取老配置时自动迁移（weekdaysOnly → workDays）并写回存储', async () => {
    const legacy = {
      monthlySalary: 21750,
      workStart: '09:00',
      workEnd: '18:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
      monthWorkDays: 21.75,
      weekdaysOnly: false,
    }
    const storage = createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(legacy) })
    const earnings = useEarnings({ storage, clock: () => at(10), autoTick: false })

    // 迁移成「每天都计薪」，并且补上薪资模式
    expect(earnings.config.value.workDays).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(earnings.config.value.salaryMode).toBe('monthly')
    expect(earnings.config.value.monthlySalary).toBe(21750)

    // 迁移结果写回存储要跨两层 watcher（config → stored → storage）
    await nextTick()
    await nextTick()
    const persisted = JSON.parse(storage.getItem(EARNINGS_STORAGE_KEY)!)
    expect(persisted.workDays).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(persisted.weekdaysOnly).toBeUndefined()
  })

  it('updateConfig 会收敛脏值（非法时间回落默认）', () => {
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => at(10),
      autoTick: false,
    })

    earnings.updateConfig({ workStart: '不是时间' })
    expect(earnings.config.value.workStart).toBe('09:00')
  })
})
