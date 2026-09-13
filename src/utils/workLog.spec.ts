import { describe, expect, it } from 'vitest'

import {
  normalizeWorkLog,
  pruneWorkLog,
  recordWorkSeconds,
  sumWorkSeconds,
  workHoursOn,
  workLogKeepFrom,
  workSecondsOn,
  WORKLOG_KEEP_DAYS,
} from './workLog'

describe('normalizeWorkLog', () => {
  it('丢弃非法日期键与非法数值（脏存储不能让散点图画出 NaN 坐标）', () => {
    const log = normalizeWorkLog({
      '2026-09-15': 3600,
      '2026/09/15': 3600, // 分隔符不对
      '2026-9-5': 3600, // 未补零
      '2026-09-16': -1, // 负数
      '2026-09-17': 0, // 0 不落记录
      '2026-09-18': Number.NaN,
      '2026-09-19': Number.POSITIVE_INFINITY,
      notADate: 100,
    })
    expect(log).toEqual({ '2026-09-15': 3600 })
  })

  it('字符串数字能救回来，小数四舍五入到整秒', () => {
    expect(normalizeWorkLog({ '2026-09-15': '3600.6' })).toEqual({ '2026-09-15': 3601 })
  })

  it('非对象输入（null / 数组 / 字符串）一律回空日志', () => {
    expect(normalizeWorkLog(null)).toEqual({})
    expect(normalizeWorkLog([1, 2])).toEqual({})
    expect(normalizeWorkLog('oops')).toEqual({})
    expect(normalizeWorkLog(undefined)).toEqual({})
  })
})

describe('recordWorkSeconds', () => {
  it('首次记录直接写入', () => {
    expect(recordWorkSeconds({}, '2026-09-15', 600)).toEqual({ '2026-09-15': 600 })
  })

  it('取较大值：值没变大时原样返回入参对象（调用方据此跳过存储写入）', () => {
    const log = { '2026-09-15': 600 }
    expect(recordWorkSeconds(log, '2026-09-15', 600)).toBe(log)
    expect(recordWorkSeconds(log, '2026-09-15', 300)).toBe(log)
  })

  it('值变大时返回新对象，且不修改原对象', () => {
    const log = { '2026-09-15': 600 }
    const next = recordWorkSeconds(log, '2026-09-15', 900)
    expect(next).toEqual({ '2026-09-15': 900 })
    expect(log).toEqual({ '2026-09-15': 600 })
    expect(next).not.toBe(log)
  })

  it('非法输入不写入', () => {
    const log = { '2026-09-15': 600 }
    expect(recordWorkSeconds(log, 'bad-key', 900)).toBe(log)
    expect(recordWorkSeconds(log, '2026-09-16', 0)).toBe(log)
    expect(recordWorkSeconds(log, '2026-09-16', -5)).toBe(log)
    expect(recordWorkSeconds(log, '2026-09-16', Number.NaN)).toBe(log)
  })

  it('小数秒四舍五入', () => {
    expect(recordWorkSeconds({}, '2026-09-15', 599.6)).toEqual({ '2026-09-15': 600 })
  })
})

describe('pruneWorkLog', () => {
  it('裁掉窗口外的老记录', () => {
    const log = { '2025-01-01': 60, '2026-09-14': 120, '2026-09-15': 180 }
    expect(pruneWorkLog(log, '2026-09-14')).toEqual({ '2026-09-14': 120, '2026-09-15': 180 })
  })

  it('没有可裁的项时原样返回（引用相等，避免无意义写入）', () => {
    const log = { '2026-09-15': 180 }
    expect(pruneWorkLog(log, '2026-09-01')).toBe(log)
  })

  it('超出条数上限时按日期倒序保留最近的那些', () => {
    const log = { '2026-09-13': 1, '2026-09-14': 2, '2026-09-15': 3 }
    expect(pruneWorkLog(log, '2026-01-01', 2)).toEqual({ '2026-09-15': 3, '2026-09-14': 2 })
  })

  it('上限为 0 时清空', () => {
    expect(pruneWorkLog({ '2026-09-15': 3 }, '2026-01-01', 0)).toEqual({})
  })
})

describe('查询与累计', () => {
  const log = { '2026-09-14': 3600, '2026-09-15': 1800 }

  it('workSecondsOn 缺失记 0', () => {
    expect(workSecondsOn(log, '2026-09-15')).toBe(1800)
    expect(workSecondsOn(log, '2026-09-13')).toBe(0)
  })

  it('workHoursOn 换算成 1 位小数的小时', () => {
    expect(workHoursOn(log, '2026-09-14')).toBe(1)
    expect(workHoursOn(log, '2026-09-15')).toBe(0.5)
    expect(workHoursOn({ '2026-09-15': 5400 }, '2026-09-15')).toBe(1.5)
  })

  it('sumWorkSeconds 支持限起点（含）与截止点（含）', () => {
    expect(sumWorkSeconds(log, null, '2026-09-15')).toBe(5400)
    expect(sumWorkSeconds(log, '2026-09-15', '2026-09-15')).toBe(1800)
    expect(sumWorkSeconds(log, '2026-09-16', '2026-09-20')).toBe(0)
  })

  it('workLogKeepFrom 就是保留窗口的起点', () => {
    expect(workLogKeepFrom('2026-09-15')).toBe('2025-08-11')
    expect(WORKLOG_KEEP_DAYS).toBe(400)
  })
})
