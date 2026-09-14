/**
 * 密码强度校验（纯函数，第五阶段「注册安全增强」）
 *
 * 为什么不塞进 `utils/validation.ts`：
 * 那里放的是**表单形状**校验（邮箱怎么写、两次是否一致、标题长度），
 * 这里放的是**安全规则**（长度下限、字符类别、弱密码黑名单）——注册与改密共用，
 * 之后还会跟着「服务端最小长度」「黑名单来源」一起演进，两者的变更理由不同。
 *
 * ⚠️ 前端校验是**体验**，不是**防线**：真正的兜底是 Supabase Dashboard 里的
 * Authentication → Settings → Password strength（最小长度调到 8）——
 * 绕过前端直接调 API 时由服务端拒绝。这里只负责让用户在提交前就知道差什么。
 */

import type { ValidationResult } from './validation'

/** 密码强度档位 */
export type PasswordLevel = 'weak' | 'medium' | 'strong'

export interface PasswordStrength {
  /** 是否满足全部硬性规则（未达 strong 不允许提交注册/改密） */
  valid: boolean
  level: PasswordLevel
  /** 未满足项（含弱密码黑名单这类一票否决），按顺序可直接展示给用户 */
  errors: string[]
  /** 满足的硬性规则数 → 强度条百分比（0 / 25 / 50 / 75 / 100） */
  score: number
}

/** 密码最短长度（与 Supabase Dashboard 里设置的最小长度保持一致，改这里要同步改那边） */
export const PASSWORD_MIN_LENGTH = 8

/**
 * 常见弱密码黑名单（小写比对）。
 * 覆盖三类：纯数字/连号、键盘顺序、英文常见词——它们是撞库字典的头几页，
 * 命中直接拒绝（不是"扣分"，是不允许用）。
 */
export const WEAK_PASSWORDS: readonly string[] = [
  // 纯数字与连号
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '000000',
  '666666',
  '888888',
  '654321',
  '87654321',
  '5201314',
  'woaini1314',
  // 键盘顺序
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'asdfgh',
  'asdfghjkl',
  'zxcvbnm',
  '1q2w3e4r',
  '1qaz2wsx',
  'qazwsx',
  'qwe123',
  '123qwe',
  // 英文常见词与其"加个 1"变体
  'password',
  'password1',
  'passw0rd',
  'p@ssw0rd',
  'admin',
  'admin123',
  'administrator',
  'letmein',
  'welcome',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'batman',
  'trustno1',
  'shadow',
  'master',
  'abc123',
  'a123456',
  'aa123456',
]

/** 强度档位的中文标签（强度条旁边那一个字） */
export const PASSWORD_LEVEL_LABEL: Record<PasswordLevel, string> = {
  weak: '弱',
  medium: '中',
  strong: '强',
}

/** 强度档位对应的颜色（Tailwind rose-500 / amber-500 / emerald-500，与全站语义色一致） */
export const PASSWORD_LEVEL_COLOR: Record<PasswordLevel, string> = {
  weak: '#f43f5e',
  medium: '#f59e0b',
  strong: '#10b981',
}

interface PasswordRule {
  /** 未满足时的展示文案（"缺什么"要具体到可直接照做） */
  message: string
  test: (password: string) => boolean
}

/**
 * 硬性规则（全部满足才算 strong）。
 *
 * 「禁纯数字 / 纯字母」没有单独一条：它已被"必须同时含大小写字母与数字"覆盖——
 * `12345678` 缺大小写、`abcdefgh` 缺大写与数字，都会被拦下。
 * 单独写一条只会得到一句永远不会单独出现的提示。
 */
const PASSWORD_RULES: readonly PasswordRule[] = [
  { message: `至少 ${PASSWORD_MIN_LENGTH} 个字符`, test: (pw) => pw.length >= PASSWORD_MIN_LENGTH },
  { message: '需要包含小写字母', test: (pw) => /[a-z]/.test(pw) },
  { message: '需要包含大写字母', test: (pw) => /[A-Z]/.test(pw) },
  { message: '需要包含数字', test: (pw) => /\d/.test(pw) },
]

/** 是否命中弱密码黑名单（大小写与首尾空格都不算数：`PassWord ` 同样命中 `password`） */
export function isWeakPassword(password: string): boolean {
  return WEAK_PASSWORDS.includes(password.trim().toLowerCase())
}

/**
 * 密码强度校验：`valid` = 满足全部硬性规则且不在黑名单里。
 * 档位按**满足的规则数量**分级：3 条算「中」，4 条且不在黑名单才算「强」。
 */
export function validatePassword(password: string): PasswordStrength {
  if (!password) {
    return { valid: false, level: 'weak', errors: ['请输入密码'], score: 0 }
  }

  const failed = PASSWORD_RULES.filter((rule) => !rule.test(password))
  const score = ((PASSWORD_RULES.length - failed.length) / PASSWORD_RULES.length) * 100
  const blacklisted = isWeakPassword(password)

  const errors = failed.map((rule) => rule.message)
  if (blacklisted) errors.push('这是常见弱密码，换一个更独特的')

  const valid = errors.length === 0
  const level: PasswordLevel = blacklisted
    ? 'weak'
    : valid
      ? 'strong'
      : score >= 75
        ? 'medium'
        : 'weak'

  return { valid, level, errors, score }
}

/**
 * 登录口令校验：**只查非空**。
 *
 * 刻意不在这里查复杂度：规则是本期才加的，老账号的密码可能压根不合规，
 * 服务端才是权威（它只认自己存的那份哈希）。前端按新规则拦下来，
 * 用户会连登录都做不到，而且看到的还不是真实原因（真实原因只能是"密码不对"）。
 */
export function validateLoginPassword(password: string): ValidationResult {
  if (!password) return { valid: false, message: '请输入密码' }
  return { valid: true }
}
