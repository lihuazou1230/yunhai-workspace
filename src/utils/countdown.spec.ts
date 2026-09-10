import { describe, expect, it } from 'vitest'

import {
  clampPaydayDay,
  daysUntil,
  formatCountdown,
  nextOccurrence,
  nextPayday,
  resolveCountdown,
  sortCountdowns,
} from './countdown'
import type { CountdownItem } from './countdown'

/** 2026-09-15（周二） */
const NOW = new Date(2026, 8, 15, 10, 30)

function item(partial: Partial<CountdownItem> & { date: string }): CountdownItem {
  return { id: 'x', title: '条目', kind: 'anniversary', yearly: false, ...partial }
}

describe('daysUntil', () => {
  it('今天 0、明天 1、昨天 -1', () => {
    expect(daysUntil('2026-09-15', NOW)).toBe(0)
    expect(daysUntil('2026-09-16', NOW)).toBe(1)
    expect(daysUntil('2026-09-14', NOW)).toBe(-1)
  })

  it('跨月与跨年都按日历天数算', () => {
    expect(daysUntil('2026-10-01', NOW)).toBe(16)
    expect(daysUntil('2026-09-30', new Date(2026, 7, 31, 23, 59))).toBe(30)
    expect(daysUntil('2027-01-01', new Date(2026, 11, 31, 23, 0))).toBe(1)
    expect(daysUntil('2027-09-15', NOW)).toBe(365)
  })

  it('与时间点无关：同一天的凌晨与深夜结果一致（不受 DST 影响的实现）', () => {
    // 北美 DST 切换日：2026-03-08（春季前移，本地只有 23 小时）与 2026-11-01（秋季回拨，25 小时）
    // 用本地时间戳直接除 86400000 会在这两天算成 0 天或 2 天，UTC 零点相减则恒为 1
    expect(daysUntil('2026-03-09', new Date(2026, 2, 8, 0, 30))).toBe(1)
    expect(daysUntil('2026-03-09', new Date(2026, 2, 8, 23, 30))).toBe(1)
    expect(daysUntil('2026-11-02', new Date(2026, 10, 1, 1, 0))).toBe(1)
    expect(daysUntil('2026-11-02', new Date(2026, 10, 1, 23, 0))).toBe(1)
    // 同一天的不同时刻必须等价（否则「今天」会在半夜变成「昨天」）
    expect(daysUntil('2026-09-15', new Date(2026, 8, 15, 0, 0))).toBe(0)
    expect(daysUntil('2026-09-15', new Date(2026, 8, 15, 23, 59))).toBe(0)
  })

  it('非法日期键返回 0，不产生 NaN', () => {
    expect(daysUntil('', NOW)).toBe(0)
    expect(daysUntil('2026-02-30', NOW)).toBe(0)
    expect(daysUntil('2026/09/20', NOW)).toBe(0)
  })
})

describe('nextOccurrence', () => {
  it('非 yearly 原样返回（过期不滚到下一年）', () => {
    expect(nextOccurrence(item({ date: '2026-09-20' }), NOW)).toBe('2026-09-20')
    expect(nextOccurrence(item({ date: '2020-01-01' }), NOW)).toBe('2020-01-01')
  })

  it('yearly 取今年的月日，今年已过则顺延到明年', () => {
    const birthday = item({ date: '1995-10-01', yearly: true })
    expect(nextOccurrence(birthday, NOW)).toBe('2026-10-01')
    expect(nextOccurrence(birthday, new Date(2026, 9, 2))).toBe('2027-10-01')
  })

  it('yearly 就是今天时保留今天，不顺延', () => {
    const birthday = item({ date: '1995-10-01', yearly: true })
    expect(nextOccurrence(birthday, new Date(2026, 9, 1, 8, 0))).toBe('2026-10-01')
    expect(resolveCountdown(birthday, new Date(2026, 9, 1, 8, 0))).toEqual({
      date: '2026-10-01',
      days: 0,
      isToday: true,
      isPast: false,
    })
  })

  it('2/29 纪念日在平年退到 3/1，闰年回到 2/29', () => {
    const leap = item({ date: '2000-02-29', yearly: true })
    // 2026 是平年：今年没有 2/29，退到 3/1
    expect(nextOccurrence(leap, new Date(2026, 0, 10))).toBe('2026-03-01')
    // 已经过了 3/1 就顺延到明年的 3/1（2027 同样是平年）
    expect(nextOccurrence(leap, new Date(2026, 2, 2))).toBe('2027-03-01')
    // 2028 是闰年，回到正日子
    expect(nextOccurrence(leap, new Date(2028, 0, 10))).toBe('2028-02-29')
    // 2/29 当天（闰年）与「退到的 3/1」当天都算今天
    expect(nextOccurrence(leap, new Date(2028, 1, 29, 9, 0))).toBe('2028-02-29')
    expect(nextOccurrence(leap, new Date(2026, 2, 1, 9, 0))).toBe('2026-03-01')
  })

  it('非法日期的 yearly 条目原样返回，不抛错', () => {
    expect(nextOccurrence(item({ date: 'not-a-date', yearly: true }), NOW)).toBe('not-a-date')
  })
})

describe('resolveCountdown', () => {
  it('给出日期、天数与今天/已过标记', () => {
    expect(resolveCountdown(item({ date: '2026-09-15' }), NOW)).toEqual({
      date: '2026-09-15',
      days: 0,
      isToday: true,
      isPast: false,
    })
    expect(resolveCountdown(item({ date: '2026-09-20' }), NOW)).toEqual({
      date: '2026-09-20',
      days: 5,
      isToday: false,
      isPast: false,
    })
    expect(resolveCountdown(item({ date: '2026-09-10' }), NOW)).toEqual({
      date: '2026-09-10',
      days: -5,
      isToday: false,
      isPast: true,
    })
  })
})

describe('nextPayday', () => {
  it('本月还没到就用本月，已经过了看下个月，今天就是发薪日返回今天', () => {
    expect(nextPayday(20, NOW)).toBe('2026-09-20')
    expect(nextPayday(15, NOW)).toBe('2026-09-15')
    expect(nextPayday(10, NOW)).toBe('2026-10-10')
    // 跨年
    expect(nextPayday(15, new Date(2026, 11, 20))).toBe('2027-01-15')
  })

  it('短月钳制到当月最后一天', () => {
    // 4 月只有 30 天：发薪日 31 -> 4/30
    expect(nextPayday(31, new Date(2026, 3, 10))).toBe('2026-04-30')
    // 已经到 4/30 了，今天就是发薪日
    expect(nextPayday(31, new Date(2026, 3, 30))).toBe('2026-04-30')
    expect(nextPayday(31, new Date(2026, 4, 1))).toBe('2026-05-31')
    // 2 月：2026 平年 28 天、2028 闰年 29 天
    expect(nextPayday(30, new Date(2026, 1, 1))).toBe('2026-02-28')
    expect(nextPayday(29, new Date(2026, 1, 1))).toBe('2026-02-28')
    expect(nextPayday(29, new Date(2028, 1, 1))).toBe('2028-02-29')
    // 2 月的最后一天已是发薪日，不再跳到 3 月
    expect(nextPayday(31, new Date(2026, 1, 28))).toBe('2026-02-28')
  })

  it('越界输入（0 / 32 / NaN / 负数 / 小数）归一到 1..31 语义', () => {
    expect(clampPaydayDay(0)).toBe(1)
    expect(clampPaydayDay(32)).toBe(31)
    expect(clampPaydayDay(Number.NaN)).toBe(1)
    expect(clampPaydayDay(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampPaydayDay(-5)).toBe(1)
    expect(clampPaydayDay(15.6)).toBe(15)

    // 0 / 32 / NaN 都按 1 号与 31 号处理（2026-10 是大月）
    expect(nextPayday(32, new Date(2026, 9, 5))).toBe('2026-10-31')
    expect(nextPayday(0, new Date(2026, 9, 5))).toBe('2026-11-01')
    expect(nextPayday(Number.NaN, new Date(2026, 9, 5))).toBe('2026-11-01')
    expect(nextPayday(-1, new Date(2026, 9, 1))).toBe('2026-10-01')
  })
})

describe('sortCountdowns', () => {
  const items: CountdownItem[] = [
    { id: 'past', title: '过期', kind: 'custom', date: '2026-09-01', yearly: false },
    { id: 'far', title: '很久以后', kind: 'custom', date: '2026-12-01', yearly: false },
    { id: 'today', title: '今天', kind: 'custom', date: '2026-09-15', yearly: false },
    { id: 'soon', title: '快到了', kind: 'custom', date: '2026-09-18', yearly: false },
  ]

  it('未来在前按天数升序，已过去的沉底', () => {
    expect(sortCountdowns(items, NOW).map((e) => e.item.id)).toEqual([
      'today',
      'soon',
      'far',
      'past',
    ])
    expect(sortCountdowns(items, NOW).map((e) => e.days)).toEqual([0, 3, 77, -14])
  })

  it('多条过期时同样按天数升序（过期越久的越靠前，口径与未过期的完全一致）', () => {
    const pasts = [
      item({ id: 'a', date: '2026-09-14' }),
      item({ id: 'b', date: '2026-08-01' }),
      item({ id: 'c', date: '2026-09-10' }),
    ]
    expect(sortCountdowns(pasts, NOW).map((e) => e.item.id)).toEqual(['b', 'c', 'a'])
    expect(sortCountdowns(pasts, NOW).map((e) => e.days)).toEqual([-45, -5, -1])
  })

  it('不修改传入数组，空数组返回空', () => {
    const snapshot = [...items]
    sortCountdowns(items, NOW)
    expect(items).toEqual(snapshot)
    expect(sortCountdowns([], NOW)).toEqual([])
  })
})

describe('formatCountdown', () => {
  it('0/1/2 用口语，3 天以上用「还有 N 天」，负数用「已过去 N 天」', () => {
    expect(formatCountdown(0)).toBe('今天')
    expect(formatCountdown(1)).toBe('明天')
    expect(formatCountdown(2)).toBe('后天')
    expect(formatCountdown(3)).toBe('还有 3 天')
    expect(formatCountdown(30)).toBe('还有 30 天')
    expect(formatCountdown(-1)).toBe('已过去 1 天')
    expect(formatCountdown(-10)).toBe('已过去 10 天')
  })
})
