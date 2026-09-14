import { describe, expect, it } from 'vitest'

import {
  PASSWORD_LEVEL_COLOR,
  PASSWORD_LEVEL_LABEL,
  PASSWORD_MIN_LENGTH,
  WEAK_PASSWORDS,
  isWeakPassword,
  validateLoginPassword,
  validatePassword,
} from './auth'

describe('validatePassword（密码强度纯函数）', () => {
  it('空密码：直接提示请输入，强度 0', () => {
    const result = validatePassword('')
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(['请输入密码'])
    expect(result.score).toBe(0)
    expect(result.level).toBe('weak')
  })

  it('恰 8 位且大小写 + 数字齐备：达标（strong，满分）', () => {
    const result = validatePassword('Abcd1234')
    expect(result.valid).toBe(true)
    expect(result.level).toBe('strong')
    expect(result.score).toBe(100)
    expect(result.errors).toEqual([])
  })

  it('差一位（7 位）：不达标，缺的正好是长度那一条', () => {
    const result = validatePassword('Abcd123')
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([`至少 ${PASSWORD_MIN_LENGTH} 个字符`])
    // 4 条里满足 3 条 → 75 分 → 中
    expect(result.score).toBe(75)
    expect(result.level).toBe('medium')
  })

  it('长度够但缺某一类字符：逐条说清缺什么', () => {
    expect(validatePassword('abcd1234').errors).toEqual(['需要包含大写字母'])
    expect(validatePassword('ABCD1234').errors).toEqual(['需要包含小写字母'])
    expect(validatePassword('Abcdefgh').errors).toEqual(['需要包含数字'])
    expect(validatePassword('abcd1234').level).toBe('medium')
  })

  it('纯数字 / 纯字母：被「必须同时含大小写与数字」拦下（不需要单独一条规则）', () => {
    const digits = validatePassword('12345678')
    expect(digits.valid).toBe(false)
    // 前两条来自字符类别，「太常见」来自黑名单——'12345678' 两条都占
    expect(digits.errors).toEqual([
      '需要包含小写字母',
      '需要包含大写字母',
      '这是常见弱密码，换一个更独特的',
    ])
    expect(digits.level).toBe('weak')

    const letters = validatePassword('abcdefgh')
    expect(letters.valid).toBe(false)
    expect(letters.errors).toEqual(['需要包含大写字母', '需要包含数字'])
    expect(letters.level).toBe('weak')
  })

  it('弱密码黑名单：一票否决，且强制降到「弱」', () => {
    // 'Passw0rd' 大小写数字齐备、长度也够，只有黑名单这一条能拦住它
    const result = validatePassword('Passw0rd')
    expect(result.valid).toBe(false)
    expect(result.level).toBe('weak')
    expect(result.score).toBe(100)
    expect(result.errors).toEqual(['这是常见弱密码，换一个更独特的'])
  })

  it('黑名单比对忽略大小写与首尾空格（用户会不小心带上）', () => {
    expect(validatePassword('  PassWord  ').valid).toBe(false)
    expect(validatePassword('QWERTY123').valid).toBe(false)
    expect(validatePassword(' 12345678 ').errors).toContain('这是常见弱密码，换一个更独特的')
  })

  it('黑名单不是「包含即命中」：长而独特的密码照常通过', () => {
    expect(validatePassword('Password1234!').valid).toBe(true)
  })

  it('带符号的长密码稳定拿满分（不会因为有符号反而掉分）', () => {
    const result = validatePassword('Zhang@2026#Workspace')
    expect(result.valid).toBe(true)
    expect(result.score).toBe(100)
    expect(result.level).toBe('strong')
  })

  it('每条硬性规则都只算一次分（0 / 25 / 50 / 75 / 100）', () => {
    const scores = ['', 'a', 'abcdefgh', 'abcdefg1', 'Abcd1234'].map(
      (pw) => validatePassword(pw).score,
    )
    expect(scores).toEqual([0, 25, 50, 75, 100])
  })

  it('档位标签与颜色齐备（强度条直接吃这两张表）', () => {
    expect(PASSWORD_LEVEL_LABEL).toEqual({ weak: '弱', medium: '中', strong: '强' })
    expect(Object.keys(PASSWORD_LEVEL_COLOR).sort()).toEqual(['medium', 'strong', 'weak'])
  })

  it('黑名单本身是干净的：全部小写、无重复、无空项', () => {
    expect(WEAK_PASSWORDS.length).toBeGreaterThan(20)
    expect(new Set(WEAK_PASSWORDS).size).toBe(WEAK_PASSWORDS.length)
    for (const weak of WEAK_PASSWORDS) {
      expect(weak).toBe(weak.toLowerCase())
      expect(weak.trim()).not.toBe('')
    }
  })

  it('isWeakPassword 可单独复用（大小写与空格都不算数）', () => {
    expect(isWeakPassword(' password ')).toBe(true)
    expect(isWeakPassword('Password1234!')).toBe(false)
  })
})

describe('validateLoginPassword（登录口令只查非空）', () => {
  it('空密码不通过', () => {
    expect(validateLoginPassword('')).toEqual({ valid: false, message: '请输入密码' })
  })

  it('刻意不查复杂度：老账号的弱密码也能提交，由服务端判定对错', () => {
    expect(validateLoginPassword('123456').valid).toBe(true)
    expect(validateLoginPassword('Abcd1234').valid).toBe(true)
  })
})
