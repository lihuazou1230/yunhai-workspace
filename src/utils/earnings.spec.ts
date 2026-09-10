import { describe, expect, it } from 'vitest'

import { DEFAULT_EARNINGS_CONFIG } from '@/types/earnings'
import type { EarningsConfig } from '@/types/earnings'
import {
  completedPaidDaysBefore,
  computeEarnings,
  dailyEarnedFen,
  dailyWorkSeconds,
  earnedFen,
  elapsedPaidDays,
  elapsedWorkSeconds,
  formatDuration,
  formatFen,
  hourlyEarnedFen,
  isEarningsConfigured,
  isNightShift,
  isPaidDay,
  lastMonthSamePeriodFen,
  monthlyEarnedFen,
  nextChange,
  paidDaysInMonth,
  parseTimeToSeconds,
  resolveEarningsStatus,
  secondsOfDay,
  yuanToFen,
} from './earnings'

/** 2026-09-10 是周四（工作日） */
function at(hours: number, minutes = 0, seconds = 0, day = 10): Date {
  return new Date(2026, 8, day, hours, minutes, seconds)
}

/** 21750 元 / 21.75 天 = 1000 元/天；09:00-18:00 扣 1 小时午休 = 8 小时 => 时薪 125 元 */
const CONFIG: EarningsConfig = { ...DEFAULT_EARNINGS_CONFIG, monthlySalary: 21750 }

describe('parseTimeToSeconds / secondsOfDay', () => {
  it('解析 HH:mm', () => {
    expect(parseTimeToSeconds('09:00')).toBe(9 * 3600)
    expect(parseTimeToSeconds('9:05')).toBe(9 * 3600 + 5 * 60)
    expect(parseTimeToSeconds(' 18:30 ')).toBe(18 * 3600 + 30 * 60)
  })

  it('非法输入返回 null', () => {
    expect(parseTimeToSeconds('')).toBeNull()
    expect(parseTimeToSeconds('24:00')).toBeNull()
    expect(parseTimeToSeconds('09:60')).toBeNull()
    expect(parseTimeToSeconds('abc')).toBeNull()
    expect(parseTimeToSeconds('9')).toBeNull()
  })

  it('secondsOfDay 含秒', () => {
    expect(secondsOfDay(at(9, 30, 15))).toBe(9 * 3600 + 30 * 60 + 15)
  })
})

describe('金额换算与格式化（整数「分」运算）', () => {
  it('元转分四舍五入到整数分', () => {
    expect(yuanToFen(21750)).toBe(2175000)
    expect(yuanToFen(12.34)).toBe(1234)
    expect(yuanToFen(0.1)).toBe(10)
    expect(yuanToFen(Number.NaN)).toBe(0)
  })

  it('分格式化为两位小数并带千分位', () => {
    expect(formatFen(0)).toBe('0.00')
    expect(formatFen(5)).toBe('0.05')
    expect(formatFen(123456)).toBe('1,234.56')
    expect(formatFen(100000000)).toBe('1,000,000.00')
    expect(formatFen(-123456)).toBe('-1,234.56')
  })

  it('时长格式化', () => {
    expect(formatDuration(45)).toBe('45 秒')
    expect(formatDuration(125)).toBe('2 分 5 秒')
    expect(formatDuration(3600 * 3 + 60 * 24)).toBe('3 小时 24 分')
    expect(formatDuration(-5)).toBe('0 秒')
  })
})

describe('每日计薪时长', () => {
  it('扣除与工时重叠的午休', () => {
    expect(dailyWorkSeconds(CONFIG)).toBe(8 * 3600)
  })

  it('无午休时按整段工时', () => {
    expect(dailyWorkSeconds({ ...CONFIG, lunchStart: '', lunchEnd: '' })).toBe(9 * 3600)
  })

  it('午休部分落在工时外时只扣重叠部分', () => {
    // 08:30-09:30 的午休与 09:00-18:00 只重叠 30 分钟
    expect(dailyWorkSeconds({ ...CONFIG, lunchStart: '08:30', lunchEnd: '09:30' })).toBe(8.5 * 3600)
  })

  it('零长度班次（上下班时间相同）与非法时间返回 0', () => {
    expect(dailyWorkSeconds({ ...CONFIG, workStart: '09:00', workEnd: '09:00' })).toBe(0)
    expect(dailyWorkSeconds({ ...CONFIG, workStart: '', workEnd: '18:00' })).toBe(0)
  })

  // ---- 跨零点夜班（第六阶段 6.2） ----

  it('夜班：下班早于上班时按「次日下班」算班次总长', () => {
    // 22:00 → 06:00 = 8 小时；午休 12:00-13:00 不在班次内，不扣
    const night = { ...CONFIG, workStart: '22:00', workEnd: '06:00' }
    expect(isNightShift(night)).toBe(true)
    expect(dailyWorkSeconds(night)).toBe(8 * 3600)
  })

  it('夜班：午休落在凌晨也能正确扣除', () => {
    // 22:00 → 06:00，午休 02:00-03:00（班次坐标 4h~5h）→ 计薪 7 小时
    const night = {
      ...CONFIG,
      workStart: '22:00',
      workEnd: '06:00',
      lunchStart: '02:00',
      lunchEnd: '03:00',
    }
    expect(dailyWorkSeconds(night)).toBe(7 * 3600)
  })

  it('夜班：白天班次不适用（isNightShift 为 false）', () => {
    expect(isNightShift(CONFIG)).toBe(false)
  })
})

describe('跨零点夜班的已计薪时长与状态', () => {
  const NIGHT = { ...CONFIG, workStart: '22:00', workEnd: '06:00' }

  it('班次内：22:30 已计薪 30 分钟，凌晨 03:00 已计薪 5 小时', () => {
    expect(elapsedWorkSeconds(NIGHT, at(22, 30))).toBe(1800)
    // 凌晨属于「昨天 22:00 开始」的班次
    expect(elapsedWorkSeconds(NIGHT, at(3, 0))).toBe(5 * 3600)
  })

  it('班次结束后封顶到总时长（07:00 显示满勤 8 小时）', () => {
    expect(elapsedWorkSeconds(NIGHT, at(7, 0))).toBe(8 * 3600)
    expect(elapsedWorkSeconds(NIGHT, at(20, 0))).toBe(8 * 3600)
  })

  it('状态：班次内 working，班次结束后 after-work，月初 21:00 也已是「收工」', () => {
    expect(resolveEarningsStatus(NIGHT, at(23, 0))).toBe('working')
    expect(resolveEarningsStatus(NIGHT, at(3, 0))).toBe('working')
    expect(resolveEarningsStatus(NIGHT, at(7, 0))).toBe('after-work')
    expect(resolveEarningsStatus(NIGHT, at(21, 0))).toBe('after-work')
  })

  it('状态：凌晨午休时段是 lunch', () => {
    const withLunch = { ...NIGHT, lunchStart: '02:00', lunchEnd: '03:00' }
    expect(resolveEarningsStatus(withLunch, at(2, 30))).toBe('lunch')
    expect(resolveEarningsStatus(withLunch, at(4, 0))).toBe('working')
  })

  it('金额：凌晨 03:00 = 满勤的 5/8', () => {
    // 日薪 1000 元 → 5/8 = 625 元
    expect(earnedFen(NIGHT, at(3, 0))).toBe(62500)
    expect(earnedFen(NIGHT, at(7, 0))).toBe(100000)
  })

  it('计薪日按班次开始那天算：周五晚的夜班到周六凌晨仍计薪', () => {
    // 2026-09-11 是周五，2026-09-12 是周六
    const fridayNight = at(23, 0, 0, 11)
    const saturdayDawn = at(3, 0, 0, 12)
    expect(isPaidDay(NIGHT, fridayNight)).toBe(true)
    expect(isPaidDay(NIGHT, saturdayDawn)).toBe(true)
    // 而周六晚上开始的班次（周六 23:00）不计薪
    expect(isPaidDay(NIGHT, at(23, 0, 0, 12))).toBe(false)
  })

  it('倒计时：工作中显示距下班剩余（凌晨 03:00 → 还剩 3 小时）', () => {
    const change = nextChange(NIGHT, at(3, 0))
    expect(change.target).toBe('off-work')
    expect(change.seconds).toBe(3 * 3600)
  })
})

describe('已计薪秒数（时间戳差值）', () => {
  it('上班前为 0，上班瞬间为 0', () => {
    expect(elapsedWorkSeconds(CONFIG, at(8, 0))).toBe(0)
    expect(elapsedWorkSeconds(CONFIG, at(9, 0))).toBe(0)
  })

  it('随真实时间线性增长', () => {
    expect(elapsedWorkSeconds(CONFIG, at(10, 0))).toBe(3600)
    expect(elapsedWorkSeconds(CONFIG, at(10, 30, 30))).toBe(3600 + 30 * 60 + 30)
  })

  it('午休期间冻结在午休开始时刻', () => {
    const beforeLunch = elapsedWorkSeconds(CONFIG, at(12, 0))
    expect(beforeLunch).toBe(3 * 3600)
    expect(elapsedWorkSeconds(CONFIG, at(12, 30))).toBe(beforeLunch)
  })

  it('午休结束后继续累计', () => {
    expect(elapsedWorkSeconds(CONFIG, at(13, 0))).toBe(3 * 3600)
    expect(elapsedWorkSeconds(CONFIG, at(14, 0))).toBe(4 * 3600)
  })

  it('下班后封顶到满勤时长', () => {
    expect(elapsedWorkSeconds(CONFIG, at(18, 0))).toBe(8 * 3600)
    expect(elapsedWorkSeconds(CONFIG, at(23, 59))).toBe(8 * 3600)
  })
})

describe('金额计算', () => {
  it('日薪 = 月薪 ÷ 月计薪天数（分）', () => {
    expect(dailyEarnedFen(CONFIG)).toBe(100000)
  })

  it('时薪 = 日薪 ÷ 每日计薪小时数（分）', () => {
    expect(hourlyEarnedFen(CONFIG)).toBe(12500)
  })

  it('未设置月薪时所有金额为 0', () => {
    const empty = { ...CONFIG, monthlySalary: 0 }
    expect(dailyEarnedFen(empty)).toBe(0)
    expect(hourlyEarnedFen(empty)).toBe(0)
    expect(earnedFen(empty, at(12, 0))).toBe(0)
    expect(isEarningsConfigured(empty)).toBe(false)
  })

  it('今日已赚按已计薪秒数等比换算，精准到分', () => {
    // 3 小时 / 8 小时 × 1000 元 = 375.00 元
    expect(formatFen(earnedFen(CONFIG, at(12, 0)))).toBe('375.00')
    // 4 小时 => 500.00 元
    expect(formatFen(earnedFen(CONFIG, at(14, 0)))).toBe('500.00')
  })

  it('单秒增量正确（1 秒 = 日薪 / 28800 秒）', () => {
    const before = earnedFen(CONFIG, at(10, 0, 0))
    expect(formatFen(before)).toBe('125.00')
    // 累计 10 秒后增加约 34.7 分（100000 分 / 28800 秒 × 10 秒，四舍五入到分）
    expect(earnedFen(CONFIG, at(10, 0, 10)) - before).toBe(Math.round((100000 * 10) / 28800))
  })

  it('下班后等于日薪，且不会超出', () => {
    expect(earnedFen(CONFIG, at(18, 0))).toBe(100000)
    expect(earnedFen(CONFIG, at(23, 30))).toBe(100000)
  })

  it('浮点月薪不产生分位误差（0.1 元级）', () => {
    const config = { ...CONFIG, monthlySalary: 10000.1, monthWorkDays: 21.75 }
    expect(Number.isInteger(earnedFen(config, at(12, 0)))).toBe(true)
  })

  it('不做逐秒累加：任意时刻直接算，切后台再切回无跳变', () => {
    // 模拟"跳过一次 tick"：直接算 09:00 -> 17:00 的金额，与逐秒推演无关
    const jumped = earnedFen(CONFIG, at(17, 0))
    expect(formatFen(jumped)).toBe('875.00')
  })
})

describe('状态判定', () => {
  it('未设置月薪 → not-configured', () => {
    expect(resolveEarningsStatus({ ...CONFIG, monthlySalary: 0 }, at(10))).toBe('not-configured')
  })

  it('工作日时段判定', () => {
    expect(resolveEarningsStatus(CONFIG, at(8, 59))).toBe('before-work')
    expect(resolveEarningsStatus(CONFIG, at(9, 0))).toBe('working')
    expect(resolveEarningsStatus(CONFIG, at(12, 0))).toBe('lunch')
    expect(resolveEarningsStatus(CONFIG, at(12, 59))).toBe('lunch')
    expect(resolveEarningsStatus(CONFIG, at(13, 0))).toBe('working')
    expect(resolveEarningsStatus(CONFIG, at(18, 0))).toBe('after-work')
  })

  it('非计薪日 → weekend（按 workDays 判定，覆盖单休/轮休）', () => {
    const saturday = at(10, 0, 0, 12)
    expect(saturday.getDay()).toBe(6)
    // 默认周一~周五：周六不计薪
    expect(resolveEarningsStatus(CONFIG, saturday)).toBe('weekend')
    // 每天都计薪
    expect(resolveEarningsStatus({ ...CONFIG, workDays: [0, 1, 2, 3, 4, 5, 6] }, saturday)).toBe(
      'working',
    )
    // 单休（周日休）：周六照常计薪
    expect(resolveEarningsStatus({ ...CONFIG, workDays: [1, 2, 3, 4, 5, 6] }, saturday)).toBe(
      'working',
    )
    // 轮休：周三不上班
    const wednesday = at(10, 0, 0, 9)
    expect(wednesday.getDay()).toBe(3)
    expect(resolveEarningsStatus({ ...CONFIG, workDays: [1, 2, 4, 5, 6] }, wednesday)).toBe(
      'weekend',
    )
  })

  it('无午休配置时午休时段算作工作中', () => {
    const noLunch = { ...CONFIG, lunchStart: '', lunchEnd: '' }
    expect(resolveEarningsStatus(noLunch, at(12, 30))).toBe('working')
  })

  it('工作时段非法 → not-configured', () => {
    // 上下班时间相同 = 零长度班次
    expect(resolveEarningsStatus({ ...CONFIG, workStart: '09:00', workEnd: '09:00' }, at(10))).toBe(
      'not-configured',
    )
  })
})

describe('下一次状态切换', () => {
  it('上班前 → 距上班', () => {
    expect(nextChange(CONFIG, at(8, 0))).toEqual({ target: 'on-work', seconds: 3600 })
  })

  it('上午工作中 → 距午休', () => {
    expect(nextChange(CONFIG, at(11, 0))).toEqual({ target: 'lunch', seconds: 3600 })
  })

  it('午休中 → 距下午上班', () => {
    expect(nextChange(CONFIG, at(12, 30))).toEqual({ target: 'on-work', seconds: 1800 })
  })

  it('下午工作中 → 距下班', () => {
    expect(nextChange(CONFIG, at(17, 0))).toEqual({ target: 'off-work', seconds: 3600 })
  })

  it('下班后/周末 → 无切换点', () => {
    expect(nextChange(CONFIG, at(19, 0))).toEqual({ target: 'none', seconds: 0 })
    expect(nextChange(CONFIG, at(10, 0, 0, 12))).toEqual({ target: 'none', seconds: 0 })
  })
})

describe('本月已赚（次要指标）', () => {
  it('本月计薪天数 = 当月周一~周五的天数（2026-09 为 22 天）', () => {
    expect(paidDaysInMonth(CONFIG, at(10))).toBe(22)
    // 每天都计薪则为整月天数
    expect(paidDaysInMonth({ ...CONFIG, workDays: [0, 1, 2, 3, 4, 5, 6] }, at(10))).toBe(30)
  })

  it('已完整过去的计薪天数只数到昨天', () => {
    // 9/1(二)~9/9(三) 共 7 个工作日
    expect(completedPaidDaysBefore(CONFIG, at(10))).toBe(7)
    // 9/10 当天：昨天是 9/9，仍为 7
    expect(completedPaidDaysBefore(CONFIG, at(10, 23))).toBe(7)
    // 9/14(一)：过去的工作日 = 9/1~9/11 共 9 天
    expect(completedPaidDaysBefore(CONFIG, at(10, 0, 0, 14))).toBe(9)
    // 9/1 当天：没有完整过去的计薪日
    expect(completedPaidDaysBefore(CONFIG, at(10, 0, 0, 1))).toBe(0)
  })

  it('已计薪天数 = 完整过去的天数 + 今天（今天是计薪日时）', () => {
    expect(elapsedPaidDays(CONFIG, at(10))).toBe(8)
    // 周六：今天不计薪，只算过去的 9 天
    expect(elapsedPaidDays(CONFIG, at(10, 0, 0, 12))).toBe(9)
  })

  it('本月已赚 = 完整计薪天数 × 日薪 + 今日已赚', () => {
    // 7 × 1000 + 今日 375（12:00 时已在午休起点）= 7375.00
    expect(formatFen(monthlyEarnedFen(CONFIG, at(12, 0)))).toBe('7,375.00')
    // 9/1 当天只有今日部分
    expect(formatFen(monthlyEarnedFen(CONFIG, at(12, 0, 0, 1)))).toBe('375.00')
    expect(monthlyEarnedFen(CONFIG, at(9, 0, 0, 1))).toBe(0)
  })

  it('周末不再累加，只保留已完整过去的部分', () => {
    // 周六 9/12：过去 9 天 × 1000 = 9000.00
    expect(formatFen(monthlyEarnedFen(CONFIG, at(14, 0, 0, 12)))).toBe('9,000.00')
  })

  it('封顶在月薪：工作日多于月计薪天数时不会超发', () => {
    // 9/30 下班后：21 个完整计薪日 + 今日满勤 = 22000 > 21750
    const cap = monthlyEarnedFen(CONFIG, at(23, 0, 0, 30))
    expect(formatFen(cap)).toBe('21,750.00')
    expect(cap).toBe(yuanToFen(CONFIG.monthlySalary))
  })

  it('未配置月薪时本月已赚为 0', () => {
    expect(monthlyEarnedFen({ ...CONFIG, monthlySalary: 0 }, at(12))).toBe(0)
    expect(monthlyEarnedFen({ ...CONFIG, monthWorkDays: 0 }, at(12))).toBe(0)
  })

  it('快照同时带出今日与本月两个指标', () => {
    const snapshot = computeEarnings(CONFIG, at(10))
    expect(formatFen(snapshot.earnedFen)).toBe('125.00')
    expect(formatFen(snapshot.monthEarnedFen)).toBe('7,125.00')
    expect(snapshot.monthPaidDays).toBe(22)
    expect(snapshot.monthElapsedPaidDays).toBe(8)
  })
})

describe('上月同期（月度趋势对比）', () => {
  it('把同一天同一时刻搬到上个月再算一遍', () => {
    // 2026-08-10 是周一；上月同期（8/1~8/9 的完整计薪日）：
    // 8/3(一)~8/7(五) = 5 天，8/1、8/2 为周末 => 5 × 1000 = 5000，加当日 375（12:00）
    expect(formatFen(lastMonthSamePeriodFen(CONFIG, at(12, 0)))).toBe('5,375.00')
  })

  it('上月同日不存在时取上月最后一天', () => {
    // 3/31 → 2 月没有 31 日，取 2/28（2026 非闰年）
    const march31 = new Date(2026, 2, 31, 10, 0, 0)
    const feb28 = new Date(2026, 1, 28, 10, 0, 0)
    expect(lastMonthSamePeriodFen(CONFIG, march31)).toBe(monthlyEarnedFen(CONFIG, feb28))
  })

  it('未配置月薪时为 0', () => {
    expect(lastMonthSamePeriodFen({ ...CONFIG, monthlySalary: 0 }, at(12))).toBe(0)
  })

  it('快照给出本月相对上月同期的涨跌百分比', () => {
    const snapshot = computeEarnings(CONFIG, at(12, 0))
    // 本月 7375 / 上月同期 5375 => +37.2%
    expect(snapshot.monthDeltaPercent).toBeCloseTo(37.2, 1)
  })

  it('上月同期无法计算（为 0）时涨跌为 0，不产生 Infinity', () => {
    const snapshot = computeEarnings({ ...CONFIG, monthlySalary: 0 }, at(12, 0))
    expect(snapshot.monthDeltaPercent).toBe(0)
    expect(Number.isFinite(snapshot.monthDeltaPercent)).toBe(true)
  })
})

describe('computeEarnings 快照', () => {
  it('工作中：金额、进度、倒计时齐备', () => {
    const snapshot = computeEarnings(CONFIG, at(13, 0))
    expect(snapshot.status).toBe('working')
    expect(snapshot.dailyWorkSeconds).toBe(8 * 3600)
    expect(snapshot.elapsedWorkSeconds).toBe(3 * 3600)
    expect(snapshot.progress).toBeCloseTo(0.375, 6)
    expect(snapshot.dailyFen).toBe(100000)
    expect(snapshot.hourlyFen).toBe(12500)
    expect(snapshot.nextChange).toBe('off-work')
    expect(snapshot.secondsToNextChange).toBe(5 * 3600)
  })

  it('下班后：进度 1，金额等于日薪', () => {
    const snapshot = computeEarnings(CONFIG, at(20, 0))
    expect(snapshot.status).toBe('after-work')
    expect(snapshot.progress).toBe(1)
    expect(snapshot.earnedFen).toBe(snapshot.dailyFen)
  })

  it('周末：金额保持为 0（不计薪）', () => {
    const snapshot = computeEarnings(CONFIG, at(14, 0, 0, 12))
    expect(snapshot.status).toBe('weekend')
    expect(snapshot.earnedFen).toBe(0)
  })
})
