import { describe, expect, it } from 'vitest'

import { changedSlots, rollingDigits, toAmountCells } from './amountDigits'

describe('toAmountCells', () => {
  it('把金额拆成数字位与分隔符', () => {
    const cells = toAmountCells('1,234.56')
    expect(cells.map((c) => c.char).join('')).toBe('1,234.56')
    expect(cells.map((c) => c.key)).toEqual(['i3', 'c3', 'i2', 'i1', 'i0', 'dot', 'f0', 'f1'])
    expect(
      cells
        .filter((c) => c.rolling)
        .map((c) => c.char)
        .join(''),
    ).toBe('123456')
  })

  it('整数部分从右往左编号（个位 i0），小数部分从左往右编号（十分位 f0）', () => {
    const cells = toAmountCells('12.34')
    expect(cells.map((c) => c.key)).toEqual(['i1', 'i0', 'dot', 'f0', 'f1'])
  })

  it('无小数时没有 dot 位', () => {
    const cells = toAmountCells('250')
    expect(cells.map((c) => c.key)).toEqual(['i2', 'i1', 'i0'])
    expect(cells.some((c) => c.key === 'dot')).toBe(false)
  })

  it('千分位分隔符按「其右侧数字个数」定位，进位变长时不错位', () => {
    // 999.99 -> 1,000.00：个位仍是个位，逗号仍是 c3
    const before = toAmountCells('999.99')
    const after = toAmountCells('1,000.00')
    expect(before.find((c) => c.key === 'i0')?.char).toBe('9')
    expect(after.find((c) => c.key === 'i0')?.char).toBe('0')
    expect(after.find((c) => c.key === 'c3')?.char).toBe(',')
    // 新增的是更高位（i3 = 千位），原有位序不被打乱
    expect(before.some((c) => c.key === 'i3')).toBe(false)
    expect(after.some((c) => c.key === 'i3')).toBe(true)
  })

  it('空串不报错', () => {
    expect(toAmountCells('')).toEqual([])
  })

  it('rollingDigits 只取数字位', () => {
    expect(rollingDigits('1,234.56')).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('小数部分混进分隔符/单位时不算数字位（否则 odometer 会去滚动一个逗号）', () => {
    // 手工拼串的调用方可能给出千分位分隔符或单位，非数字位必须另起 key 且不可滚动
    const cells = toAmountCells('1.234,5')
    expect(cells.map((c) => c.key)).toEqual(['i0', 'dot', 'f0', 'f1', 'f2', 'fc3', 'f4'])
    expect(
      cells
        .filter((c) => c.rolling)
        .map((c) => c.char)
        .join(''),
    ).toBe('12345')
    expect(rollingDigits('12.5%')).toEqual(['1', '2', '5'])
  })
})

describe('changedSlots（只让变化的位滚动）', () => {
  it('只变分位时只有分位是变化位', () => {
    expect(changedSlots('125.00', '125.01')).toEqual(['f1'])
  })

  it('进位时相关位连动（0.09 → 0.10 的十分位与百分位）', () => {
    expect(changedSlots('1.09', '1.10')).toEqual(['f0', 'f1'])
  })

  it('未变化的位不进入变化列表（相同金额为空）', () => {
    expect(changedSlots('1,234.56', '1,234.56')).toEqual([])
  })

  it('位数增加时新出现的位视为变化', () => {
    // 999.99 -> 1,000.00：所有数字位都变（真实进位），且高位 i3/i4 首次出现
    const changed = changedSlots('999.99', '1,000.00')
    expect(changed).toContain('f1')
    expect(changed).toContain('i0')
    expect(changed).toContain('i3')
  })
})
