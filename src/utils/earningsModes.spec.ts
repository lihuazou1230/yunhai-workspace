/**
 * 第六阶段 6.2：薪资三模式换算 + 每周计薪日 + 旧配置迁移。
 *
 * 与 earnings.spec.ts 分开：那边钉的是「月薪模式 + 时间/状态机」的既有口径，
 * 这里只钉新增的三模式与迁移逻辑，避免一个文件太长。
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_EARNINGS_CONFIG } from '@/types/earnings'
import type { EarningsConfig } from '@/types/earnings'
import {
  dailyEarnedFen,
  dailyWorkSeconds,
  earnedFen,
  hourlyEarnedFen,
  isEarningsConfigured,
  isWorkDate,
  normalizeEarningsConfig,
  paidDaysInMonth,
  resolveEarningsStatus,
} from './earnings'

/** 2026-09-10 是周四 */
function at(hours: number, minutes = 0, day = 10): Date {
  return new Date(2026, 8, day, hours, minutes, 0)
}

/** 09:00-18:00 扣 1 小时午休 = 每日计薪 8 小时 */
const BASE: EarningsConfig = { ...DEFAULT_EARNINGS_CONFIG, workDays: [1, 2, 3, 4, 5] }

describe('薪资三模式换算', () => {
  it('月薪模式：日薪 = 月薪 ÷ 月计薪天数，时薪 = 日薪 ÷ 每日计薪小时', () => {
    const config: EarningsConfig = { ...BASE, salaryMode: 'monthly', monthlySalary: 21750 }
    expect(dailyEarnedFen(config)).toBe(100000) // 1000 元
    expect(hourlyEarnedFen(config)).toBe(12500) // 125 元
    expect(earnedFen(config, at(10))).toBe(12500) // 上班 1 小时
  })

  it('日薪模式：直接用日薪，不看月计薪天数', () => {
    const config: EarningsConfig = {
      ...BASE,
      salaryMode: 'daily',
      dailySalary: 800,
      monthWorkDays: 21.75,
      monthlySalary: 0,
    }
    expect(dailyEarnedFen(config)).toBe(80000)
    expect(hourlyEarnedFen(config)).toBe(10000) // 800 / 8h = 100 元/时
    expect(earnedFen(config, at(10))).toBe(10000)
    expect(isEarningsConfigured(config)).toBe(true)
  })

  it('时薪模式：日薪 = 时薪 × 每日计薪小时数（每日计薪小时随班次变化）', () => {
    const config: EarningsConfig = { ...BASE, salaryMode: 'hourly', hourlySalary: 100 }
    expect(dailyWorkSeconds(config)).toBe(8 * 3600)
    expect(dailyEarnedFen(config)).toBe(80000) // 100 × 8
    expect(earnedFen(config, at(10))).toBe(10000)
  })

  it('时薪模式：不扣午休时每日计薪 9 小时，日薪随之变成 9 × 时薪', () => {
    const config: EarningsConfig = {
      ...BASE,
      salaryMode: 'hourly',
      hourlySalary: 100,
      lunchStart: '',
      lunchEnd: '',
    }
    expect(dailyWorkSeconds(config)).toBe(9 * 3600)
    expect(dailyEarnedFen(config)).toBe(90000)
  })

  it('三种模式在「同一日薪基准」下算出的今日金额一致', () => {
    const monthly: EarningsConfig = { ...BASE, salaryMode: 'monthly', monthlySalary: 21750 }
    const daily: EarningsConfig = { ...BASE, salaryMode: 'daily', dailySalary: 1000 }
    const hourly: EarningsConfig = { ...BASE, salaryMode: 'hourly', hourlySalary: 125 }

    for (const hour of [10, 12, 15, 18]) {
      expect(earnedFen(daily, at(hour))).toBe(earnedFen(monthly, at(hour)))
      expect(earnedFen(hourly, at(hour))).toBe(earnedFen(monthly, at(hour)))
    }
  })

  it('金额为 0 时视为未配置（三种模式都成立）', () => {
    expect(isEarningsConfigured({ ...BASE, salaryMode: 'monthly', monthlySalary: 0 })).toBe(false)
    expect(isEarningsConfigured({ ...BASE, salaryMode: 'daily', dailySalary: 0 })).toBe(false)
    expect(isEarningsConfigured({ ...BASE, salaryMode: 'hourly', hourlySalary: 0 })).toBe(false)
    expect(resolveEarningsStatus({ ...BASE, salaryMode: 'daily', dailySalary: 0 }, at(10))).toBe(
      'not-configured',
    )
  })

  it('浮点金额按「分」取整，不出现 0.1+0.2 类误差', () => {
    const config: EarningsConfig = { ...BASE, salaryMode: 'daily', dailySalary: 99.99 }
    // 99.99 元 -> 9999 分，加班到满勤仍是 9999 分
    expect(dailyEarnedFen(config)).toBe(9999)
    expect(earnedFen(config, at(18))).toBe(9999)
  })
})

describe('自定义每周计薪日', () => {
  it('单休（周日休）：周六计薪、周日不计薪', () => {
    const config: EarningsConfig = { ...BASE, workDays: [1, 2, 3, 4, 5, 6], monthlySalary: 21750 }
    // 2026-09-12 周六 / 2026-09-13 周日
    expect(isWorkDate(config, new Date(2026, 8, 12, 12))).toBe(true)
    expect(isWorkDate(config, new Date(2026, 8, 13, 12))).toBe(false)
    expect(resolveEarningsStatus(config, at(10, 0, 12))).toBe('working')
    expect(resolveEarningsStatus(config, at(10, 0, 13))).toBe('weekend')
  })

  it('轮休（周三不上班）', () => {
    const config: EarningsConfig = { ...BASE, workDays: [1, 2, 4, 5, 6], monthlySalary: 21750 }
    // 2026-09-09 是周三
    expect(resolveEarningsStatus(config, at(10, 0, 9))).toBe('weekend')
    expect(resolveEarningsStatus(config, at(10, 0, 10))).toBe('working')
  })

  it('月计薪天数随每周计薪日变化（2026-09 共 30 天）', () => {
    expect(paidDaysInMonth({ ...BASE, workDays: [1, 2, 3, 4, 5] }, at(10))).toBe(22)
    expect(paidDaysInMonth({ ...BASE, workDays: [1, 2, 3, 4, 5, 6] }, at(10))).toBe(26)
    expect(paidDaysInMonth({ ...BASE, workDays: [0, 1, 2, 3, 4, 5, 6] }, at(10))).toBe(30)
  })

  it('非计薪日金额为 0（数据层保证，不只靠 UI 隐藏）', () => {
    const config: EarningsConfig = { ...BASE, workDays: [1], monthlySalary: 21750 }
    // 2026-09-10 周四不在计薪日里
    expect(earnedFen(config, at(10))).toBe(0)
  })
})

describe('旧配置迁移（normalizeEarningsConfig）', () => {
  it('老数据只有 weekdaysOnly: true → 迁移成周一~周五', () => {
    const migrated = normalizeEarningsConfig({
      monthlySalary: 21750,
      workStart: '09:00',
      workEnd: '18:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
      monthWorkDays: 21.75,
      weekdaysOnly: true,
    })
    expect(migrated.workDays).toEqual([1, 2, 3, 4, 5])
    expect(migrated.salaryMode).toBe('monthly')
    expect(migrated.monthlySalary).toBe(21750)
  })

  it('老数据 weekdaysOnly: false → 迁移成每天都计薪', () => {
    const migrated = normalizeEarningsConfig({ weekdaysOnly: false })
    expect(migrated.workDays).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('空值 / 非对象 → 返回默认配置', () => {
    expect(normalizeEarningsConfig(null)).toEqual(DEFAULT_EARNINGS_CONFIG)
    expect(normalizeEarningsConfig(undefined)).toEqual(DEFAULT_EARNINGS_CONFIG)
    expect(normalizeEarningsConfig('坏数据')).toEqual(DEFAULT_EARNINGS_CONFIG)
    expect(normalizeEarningsConfig(42)).toEqual(DEFAULT_EARNINGS_CONFIG)
  })

  it('脏值被夹回合法范围：非法时间、负数金额、越界星期、非法模式', () => {
    const migrated = normalizeEarningsConfig({
      salaryMode: '年薪',
      monthlySalary: -100,
      dailySalary: Number.NaN,
      hourlySalary: 'abc',
      workStart: '25:00',
      workEnd: '18:00',
      lunchStart: '99:99',
      lunchEnd: '13:00',
      monthWorkDays: -5,
      workDays: [1, 9, -2, 3.5, 5],
    })

    expect(migrated.salaryMode).toBe('monthly')
    expect(migrated.monthlySalary).toBe(0)
    expect(migrated.dailySalary).toBe(0)
    expect(migrated.hourlySalary).toBe(0)
    expect(migrated.workStart).toBe('09:00') // 非法 → 回落默认
    expect(migrated.workEnd).toBe('18:00')
    expect(migrated.lunchStart).toBe('12:00')
    expect(migrated.monthWorkDays).toBe(-5) // 数值保持，但换算时会按 0 处理
    // 越界（9 / -2）与非整数（3.5）都被丢掉，只留合法项并升序
    expect(migrated.workDays).toEqual([1, 5])
  })

  it('空字符串的午休表示「不扣午休」，不能被当成非法值填回默认', () => {
    const migrated = normalizeEarningsConfig({ lunchStart: '', lunchEnd: '' })
    expect(migrated.lunchStart).toBe('')
    expect(migrated.lunchEnd).toBe('')
  })

  it('迁移是幂等的：跑两次结果一致', () => {
    const once = normalizeEarningsConfig({ weekdaysOnly: false, monthlySalary: 10000 })
    expect(normalizeEarningsConfig(once)).toEqual(once)
  })

  it('合法的新数据原样保留（含 workDays 与三模式金额）', () => {
    const input: EarningsConfig = {
      salaryMode: 'hourly',
      monthlySalary: 0,
      dailySalary: 700,
      hourlySalary: 88,
      workStart: '22:00',
      workEnd: '06:00',
      lunchStart: '',
      lunchEnd: '',
      monthWorkDays: 22,
      workDays: [1, 3, 5],
    }
    expect(normalizeEarningsConfig(input)).toEqual(input)
  })
})
