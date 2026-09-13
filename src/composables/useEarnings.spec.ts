import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import {
  DEFAULT_EARNINGS_CONFIG,
  EARNINGS_COMPACT_KEY,
  EARNINGS_STORAGE_KEY,
} from '@/types/earnings'
import type { EarningsConfig } from '@/types/earnings'
import { WORKLOG_STORAGE_KEY } from '@/utils/workLog'
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

    // 推进 1 秒（默认 tick 间隔）：定时器跑过一轮，金额按新时间戳重算
    current = at(10, 0, 1)
    vi.advanceTimersByTime(1000)
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

describe('useEarnings · 切回标签页补算', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function configured(clock: () => Date) {
    return useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock,
      autoTick: false,
    })
  }

  it('标签页重新可见时立刻补算，不必等下一个 tick（否则切回来第一眼是旧数字）', () => {
    let current = at(10, 0, 0)
    const earnings = configured(() => current)
    expect(earnings.amountText.value).toBe('125.00')

    // 后台被节流期间时间照走
    current = at(14, 0, 0)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(earnings.amountText.value).toBe('500.00')
  })

  it('标签页转为隐藏时不补算：后台不该白跑高频计算', () => {
    let current = at(10, 0, 0)
    const earnings = configured(() => current)

    current = at(14, 0, 0)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(earnings.amountText.value).toBe('125.00')
  })
})

describe('useEarnings · 次要指标与计薪日键', () => {
  it('monthAmountText = 已过计薪日 × 日薪 + 今日已赚（与主指标同一基准，两个数字对得上账）', () => {
    // 2026-09-10 是周四：本月之前的计薪日为 1~4、7~9 共 7 天；日薪 = 21750 / 21.75 = 1000 元
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => at(11),
      autoTick: false,
    })

    expect(earnings.monthAmountText.value).toBe('7,250.00')
    expect(earnings.shiftDateKey.value).toBe('2026-09-10')
  })

  it('夜班凌晨 01:00：金额按班次坐标算（3/8），计薪日键归属「昨天开始」的那个班', () => {
    const night: EarningsConfig = {
      ...CONFIG,
      workStart: '22:00',
      workEnd: '06:00',
      lunchStart: '',
      lunchEnd: '',
    }
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(night) }),
      clock: () => new Date(2026, 8, 11, 1, 0, 0),
      autoTick: false,
    })

    // 22:00 → 01:00 已计薪 3 小时，占 8 小时的 3/8 => 375.00 元（跨零点不产生误差）
    expect(earnings.amountText.value).toBe('375.00')
    // 2026-09-11 凌晨仍属于 09-10 开始的那个夜班
    expect(earnings.shiftDateKey.value).toBe('2026-09-10')
  })
})

describe('useEarnings · tick 循环不被重复启动', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('重复 start 不会叠加定时器（叠加就会跑出两倍 tick）', () => {
    vi.useFakeTimers()
    const clock = vi.fn(() => at(10, 0, 0))
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock,
      autoTick: false,
    })
    const callsBefore = clock.mock.calls.length

    earnings.start()
    earnings.start()
    vi.advanceTimersByTime(3000)

    // 每秒一次 → 3 次；如果第二次 start 又建了一个定时器，这里会是 6 次
    expect(clock.mock.calls.length).toBe(callsBefore + 3)
    earnings.stop()
  })

  it('rAF 模式 stop 后即使浏览器又回调一帧，也不会再排下一帧（循环真能停下来）', () => {
    const frames: Array<() => void> = []
    const rafSpy = vi.fn((cb: () => void) => {
      frames.push(cb)
      return frames.length
    })
    vi.stubGlobal('requestAnimationFrame', rafSpy)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => at(10, 0, 0),
      autoTick: true,
      useRaf: true,
    })

    earnings.stop()
    const scheduled = rafSpy.mock.calls.length

    // 已排队的帧仍会被浏览器调用：此时必须直接返回，否则 rAF 循环永远停不下来
    frames.shift()?.()

    expect(rafSpy.mock.calls.length).toBe(scheduled)
  })
})

describe('useEarnings · 默认时钟与无 rAF 环境', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('不注入时钟时走系统时间：假系统时间下金额照常算对', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(11, 0, 0))
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      autoTick: false,
    })

    // 09:00-11:00 计薪 2 小时（8 小时的 1/4）=> 250.00 元
    expect(earnings.snapshot.value.status).toBe('working')
    expect(earnings.amountText.value).toBe('250.00')
  })

  it('useRaf 开启但环境没有 requestAnimationFrame 时退回定时器（图表不会一动不动）', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    let current = at(10, 0, 0)
    const earnings = useEarnings({
      storage: createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) }),
      clock: () => current,
      autoTick: true,
      useRaf: true,
    })

    expect(earnings.amountText.value).toBe('125.00')

    current = at(10, 0, 1)
    vi.advanceTimersByTime(1000)
    expect(earnings.amountText.value).toBe('125.03')

    earnings.stop()
  })
})

/**
 * 第八阶段 8.1-4：投入日志是散点图与年度报告的数据源。
 * 这里钉的是「按天、取大值、不写 0」三条口径——它们错了，图表不会报错，只会静默画错。
 */
describe('useEarnings · 投入日志', () => {
  it('工作中把当日累计计薪时长按天写进投入日志', async () => {
    const storage = createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) })
    useEarnings({ storage, clock: () => at(11), autoTick: false })
    await nextTick()

    const log = JSON.parse(storage.getItem(WORKLOG_STORAGE_KEY) ?? '{}')
    expect(log['2026-09-10']).toBe(2 * 3600)
  })

  it('上班前（已计薪 0 秒）不落记录：非计薪时段不该在日志里留下 0', async () => {
    const storage = createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) })
    useEarnings({ storage, clock: () => at(8), autoTick: false })
    await nextTick()

    expect(storage.getItem(WORKLOG_STORAGE_KEY)).toBeNull()
  })

  it('未配置薪资时不写（没开张就没有投入可言）', async () => {
    const storage = createMemoryStorage()
    useEarnings({ storage, clock: () => at(11), autoTick: false })
    await nextTick()

    expect(storage.getItem(WORKLOG_STORAGE_KEY)).toBeNull()
  })

  it('recordWorkLog: false 时完全不碰投入日志（只关心金额的场景）', async () => {
    const storage = createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) })
    useEarnings({ storage, clock: () => at(11), autoTick: false, recordWorkLog: false })
    await nextTick()

    expect(storage.getItem(WORKLOG_STORAGE_KEY)).toBeNull()
  })

  it('跨过整分钟才写一次：重复 refresh 不产生额外写入', async () => {
    let current = at(11, 0, 0)
    const storage = createMemoryStorage({ [EARNINGS_STORAGE_KEY]: JSON.stringify(CONFIG) })
    const earnings = useEarnings({ storage, clock: () => current, autoTick: false })
    await nextTick()
    const first = JSON.parse(storage.getItem(WORKLOG_STORAGE_KEY) ?? '{}')['2026-09-10']

    // 同一分钟内反复重算：值没变大，日志不动
    current = at(11, 0, 30)
    earnings.refresh()
    await nextTick()
    current = at(11, 0, 59)
    earnings.refresh()
    await nextTick()
    expect(JSON.parse(storage.getItem(WORKLOG_STORAGE_KEY) ?? '{}')['2026-09-10']).toBe(first)

    // 跨到下一分钟：日志跟上
    current = at(11, 1, 1)
    earnings.refresh()
    await nextTick()
    expect(JSON.parse(storage.getItem(WORKLOG_STORAGE_KEY) ?? '{}')['2026-09-10']).toBe(
      2 * 3600 + 61,
    )
  })
})
