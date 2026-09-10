import { describe, expect, it } from 'vitest'

import {
  HOLIDAY_DATA_SOURCE,
  HOLIDAY_YEARS,
  hasHolidayData,
  holidayDatesOfMonth,
  makeupWorkdaysOfMonth,
  holidayName,
  isHoliday,
  isMakeupWorkday,
  loadHolidays,
  upcomingFestivals,
  upcomingHolidays,
} from './holidays'

/** 2026 年国务院通知里的法定节日首日 */
const STATUTORY_2026: Array<[string, string]> = [
  ['2026-01-01', '元旦'],
  ['2026-02-17', '春节'],
  ['2026-04-05', '清明节'],
  ['2026-05-01', '劳动节'],
  ['2026-06-19', '端午节'],
  ['2026-09-25', '中秋节'],
  ['2026-10-01', '国庆节'],
]

describe('holidays 数据与查询', () => {
  it('2026 七个法定节日都能查到名字', () => {
    for (const [date, name] of STATUTORY_2026) {
      expect(holidayName(date)).toBe(name)
      expect(isHoliday(date)).toBe(true)
    }
  })

  it('放假区间按通知收录（含调休凑出来的日子），首尾都在', () => {
    // 春节 2/15~2/23 共 9 天、劳动节 5/1~5/5 共 5 天、国庆 10/1~10/7 共 7 天
    expect(holidayName('2026-02-15')).toBe('春节')
    expect(holidayName('2026-02-23')).toBe('春节')
    expect(holidayName('2026-05-05')).toBe('劳动节')
    expect(holidayName('2026-10-07')).toBe('国庆节')
    // 假期前一天不是假期
    expect(holidayName('2026-02-14')).toBeUndefined()
    expect(holidayName('2026-10-08')).toBeUndefined()
  })

  it('普通日子不是假期，非法日期键也不当成假期', () => {
    expect(holidayName('2026-09-15')).toBeUndefined()
    expect(isHoliday('2026-03-08')).toBe(false)
    expect(isHoliday('')).toBe(false)
    expect(isHoliday('2026-02-30')).toBe(false)
    expect(isHoliday('2026/01/01')).toBe(false)
  })

  it('调休补班日被标记，且全部落在周末（数据自检）', () => {
    const makeup = [
      '2026-01-04',
      '2026-02-14',
      '2026-02-28',
      '2026-05-09',
      '2026-09-20',
      '2026-10-10',
    ]
    for (const date of makeup) {
      expect(isMakeupWorkday(date)).toBe(true)
      // 补班日必然是周六/周日——写错成工作日就说明数据录入有误
      const [y, m, d] = date.split('-').map(Number)
      expect([0, 6]).toContain(new Date(y, m - 1, d).getDay())
    }
    expect(isMakeupWorkday('2026-10-01')).toBe(false)
    expect(isMakeupWorkday('2026-09-15')).toBe(false)
    expect(isMakeupWorkday('2026-13-01')).toBe(false)
    expect(isMakeupWorkday('')).toBe(false)
  })

  it('没有数据的年份返回空结构且不抛错', () => {
    expect(hasHolidayData(2030)).toBe(false)
    expect(loadHolidays(2030)).toEqual({ holidays: {}, workdays: [] })
    expect(holidayName('2030-01-01')).toBeUndefined()
    expect(isHoliday('2030-01-01')).toBe(false)
    expect(isMakeupWorkday('2030-01-04')).toBe(false)
    expect(holidayDatesOfMonth(2030, 1)).toEqual({})
    expect(upcomingHolidays('2030-01-01')).toEqual([])
    // 荒诞输入同样不抛错
    expect(loadHolidays(Number.NaN)).toEqual({ holidays: {}, workdays: [] })
    expect(holidayName('not-a-date')).toBeUndefined()
  })

  it('loadHolidays 返回副本：改结果不会污染内置数据', () => {
    const first = loadHolidays(2026)
    first.holidays['2026-09-15'] = '假的假期'
    first.workdays.push('2026-09-16')

    expect(loadHolidays(2026).holidays['2026-09-15']).toBeUndefined()
    expect(loadHolidays(2026).workdays).not.toContain('2026-09-16')
    expect(isHoliday('2026-09-15')).toBe(false)
  })

  it('导出的年份与来源说明可用', () => {
    expect(HOLIDAY_YEARS).toContain(2026)
    expect(HOLIDAY_YEARS).toContain(2027)
    expect(HOLIDAY_DATA_SOURCE).toContain('2026')
  })
})

describe('upcomingHolidays', () => {
  it('返回 fromKey 当天及之后最近的假期，按日期升序并给出天数', () => {
    expect(upcomingHolidays('2026-09-15', 3)).toEqual([
      { date: '2026-09-25', name: '中秋节', days: 10 },
      { date: '2026-09-26', name: '中秋节', days: 11 },
      { date: '2026-09-27', name: '中秋节', days: 12 },
    ])
  })

  it('limit 生效；fromKey 就是假期当天时天数为 0', () => {
    expect(upcomingHolidays('2026-09-15', 1).map((h) => h.date)).toEqual(['2026-09-25'])
    expect(upcomingHolidays('2026-10-01', 2)).toEqual([
      { date: '2026-10-01', name: '国庆节', days: 0 },
      { date: '2026-10-02', name: '国庆节', days: 1 },
    ])
    expect(upcomingHolidays('2026-09-15', 0)).toEqual([])
    expect(upcomingHolidays('2026-09-15', -1)).toEqual([])
  })

  it('年份末尾自动跨年，拿下一年的假期', () => {
    expect(upcomingHolidays('2026-12-31', 3)).toEqual([
      { date: '2027-01-01', name: '元旦', days: 1 },
    ])
    // 12/31 之前仍在当年：国庆之后已无假期，同样跨到 2027 元旦
    expect(upcomingHolidays('2026-11-20', 1)).toEqual([
      { date: '2027-01-01', name: '元旦', days: 42 },
    ])
    // 再往后没有 2028 的数据了，只有已收录的部分，不猜
    expect(upcomingHolidays('2027-01-01', 5).map((h) => h.date)).toEqual(['2027-01-01'])
  })

  it('非法 fromKey 返回空数组', () => {
    expect(upcomingHolidays('', 3)).toEqual([])
    expect(upcomingHolidays('2026-02-30', 3)).toEqual([])
  })
})

describe('upcomingFestivals', () => {
  it('同一节日的连续放假合并为一条（取第一天），不会让国庆占满名额', () => {
    expect(upcomingFestivals('2026-09-15', 3)).toEqual([
      { date: '2026-09-25', name: '中秋节', days: 10 },
      { date: '2026-10-01', name: '国庆节', days: 16 },
      { date: '2027-01-01', name: '元旦', days: 108 },
    ])
  })

  it('假期当天起算时也合并（当天算 0 天）', () => {
    expect(upcomingFestivals('2026-02-17', 2)).toEqual([
      { date: '2026-02-17', name: '春节', days: 0 },
      { date: '2026-04-04', name: '清明节', days: 46 },
    ])
  })
})

describe('holidayDatesOfMonth', () => {
  it('按月过滤：只返回该月的放假日期', () => {
    const feb = holidayDatesOfMonth(2026, 2)
    expect(Object.keys(feb)).toHaveLength(9)
    expect(Object.values(feb).every((name) => name === '春节')).toBe(true)
    expect(feb['2026-02-15']).toBe('春节')
    expect(feb['2026-02-23']).toBe('春节')

    expect(Object.keys(holidayDatesOfMonth(2026, 10))).toHaveLength(7)
    expect(Object.keys(holidayDatesOfMonth(2026, 1))).toHaveLength(3)
    expect(holidayDatesOfMonth(2026, 9)).toEqual({
      '2026-09-25': '中秋节',
      '2026-09-26': '中秋节',
      '2026-09-27': '中秋节',
    })
    // 3 月没有假期；月份不补零也要能对上（1..12 都传得进来）
    expect(holidayDatesOfMonth(2026, 3)).toEqual({})
    expect(Object.keys(holidayDatesOfMonth(2026, 5))).toHaveLength(5)
  })
})

describe('makeupWorkdaysOfMonth（调休补班日，供月历标「班」）', () => {
  it('按月过滤并升序返回补班日', () => {
    // 2026 年 2 月有两个补班日：2/14（周六）与 2/28（周六）
    expect(makeupWorkdaysOfMonth(2026, 2)).toEqual(['2026-02-14', '2026-02-28'])
    // 1 月与 10 月各一个
    expect(makeupWorkdaysOfMonth(2026, 1)).toEqual(['2026-01-04'])
    expect(makeupWorkdaysOfMonth(2026, 10)).toEqual(['2026-10-10'])
  })

  it('没有补班的月份/年份返回空数组而不是报错', () => {
    expect(makeupWorkdaysOfMonth(2026, 3)).toEqual([])
    expect(makeupWorkdaysOfMonth(2030, 5)).toEqual([])
  })

  it('返回的补班日确实落在周末（这是调休的定义，数据录错会被这条抓住）', () => {
    for (let month = 1; month <= 12; month++) {
      for (const date of makeupWorkdaysOfMonth(2026, month)) {
        const [y, m, d] = date.split('-').map(Number)
        const dow = new Date(y, m - 1, d).getDay()
        expect([0, 6]).toContain(dow)
      }
    }
  })
})
