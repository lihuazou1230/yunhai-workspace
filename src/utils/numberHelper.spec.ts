import { describe, expect, it } from 'vitest'

import { round1, round2, roundTo } from './numberHelper'

describe('numberHelper', () => {
  it('round1 收敛浮点尾巴', () => {
    expect(round1(0.30000000000000004)).toBe(0.3)
    expect(round1(8.449999)).toBe(8.4)
    expect(round1(8.45)).toBe(8.5)
    expect(round1(1234.567)).toBe(1234.6)
  })

  it('round2 保留两位', () => {
    expect(round2(0.6666666)).toBe(0.67)
    expect(round2(-0.1234)).toBe(-0.12)
  })

  it('roundTo 支持任意位数，位数 < 0 视为 0 位', () => {
    expect(roundTo(1.2345, 3)).toBe(1.235)
    expect(roundTo(1.2345, 0)).toBe(1)
    expect(roundTo(1.6, -3)).toBe(2)
    // 小数位数向下取整：2.9 位按 2 位算
    expect(roundTo(1.2349, 2.9)).toBe(1.23)
  })

  it('非有限值原样返回（由调用方判定，而不是悄悄变成 0）', () => {
    expect(Number.isNaN(round1(Number.NaN))).toBe(true)
    expect(round2(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
  })
})
