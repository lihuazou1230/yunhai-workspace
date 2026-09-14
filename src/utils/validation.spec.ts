import { describe, expect, it } from 'vitest'

import {
  DISPLAY_NAME_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  isValidDateKey,
  validateDisplayName,
  validateEmail,
  validatePasswordConfirm,
  validateTodoTitle,
} from './validation'

describe('validation', () => {
  it('validateTodoTitle：空标题不通过', () => {
    expect(validateTodoTitle('').valid).toBe(false)
    expect(validateTodoTitle('   ').valid).toBe(false)
  })

  it('validateTodoTitle：超长不通过', () => {
    expect(validateTodoTitle('a'.repeat(TITLE_MAX_LENGTH + 1)).valid).toBe(false)
    expect(validateTodoTitle('a'.repeat(TITLE_MAX_LENGTH)).valid).toBe(true)
  })

  it('validateTodoTitle：trim 后通过', () => {
    const result = validateTodoTitle('  写周报  ')
    expect(result.valid).toBe(true)
  })

  it('isValidDateKey 识别合法/非法日期', () => {
    expect(isValidDateKey('2026-09-15')).toBe(true)
    expect(isValidDateKey('2024-02-29')).toBe(true) // 闰年
    expect(isValidDateKey('2026-02-30')).toBe(false) // 不存在
    expect(isValidDateKey('2026-13-01')).toBe(false)
    expect(isValidDateKey('2026/09/15')).toBe(false)
    expect(isValidDateKey('2026-9-5')).toBe(false)
    expect(isValidDateKey('')).toBe(false)
  })

  it('isValidDateKey 拦截超长年份（6位或多位）', () => {
    expect(isValidDateKey('232233-10-01')).toBe(false)
    expect(isValidDateKey('62026-09-15')).toBe(false)
    expect(isValidDateKey('123456-01-01')).toBe(false)
    expect(isValidDateKey('202699-12-01')).toBe(false)
  })
})

describe('登录 / 注册表单校验', () => {
  it('validateEmail：空、带空格、缺 @ 或域名不通过', () => {
    expect(validateEmail('').message).toBe('请输入邮箱')
    expect(validateEmail('a b@c.com').valid).toBe(false)
    expect(validateEmail('zhang.example.com').valid).toBe(false)
    expect(validateEmail('zhang@localhost').valid).toBe(false)
  })

  it('validateEmail：常见合法邮箱通过（含 + 号与子域名）', () => {
    expect(validateEmail('zhang@example.com').valid).toBe(true)
    expect(validateEmail('  zhang+work@mail.example.co.uk  ').valid).toBe(true)
  })

  it('validatePasswordConfirm：必须一致', () => {
    expect(validatePasswordConfirm('123456', '').message).toBe('请再次输入密码')
    expect(validatePasswordConfirm('123456', '654321').message).toBe('两次输入的密码不一致')
    expect(validatePasswordConfirm('123456', '123456').valid).toBe(true)
  })

  it('validateDisplayName：可留空，超长不通过', () => {
    expect(validateDisplayName('').valid).toBe(true)
    expect(validateDisplayName('  ').valid).toBe(true)
    expect(validateDisplayName('张'.repeat(DISPLAY_NAME_MAX_LENGTH)).valid).toBe(true)
    expect(validateDisplayName('张'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)).valid).toBe(false)
  })
})

// 密码**强度**规则（长度下限/字符类别/弱密码黑名单）另有专门用例：见 utils/auth.spec.ts
