/** 表单校验工具（纯函数） */

export const TITLE_MAX_LENGTH = 100

export interface ValidationResult {
  valid: boolean
  message?: string
}

/** 任务标题校验：非空 + 长度上限 */
export function validateTodoTitle(title: string): ValidationResult {
  const trimmed = title.trim()
  if (!trimmed) return { valid: false, message: '任务标题不能为空' }
  if (trimmed.length > TITLE_MAX_LENGTH) {
    return { valid: false, message: `任务标题不能超过 ${TITLE_MAX_LENGTH} 个字符` }
  }
  return { valid: true }
}

/** 校验 YYYY-MM-DD 是否为真实存在的日期键 */
export function isValidDateKey(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

// ---- 登录 / 注册表单校验（第五阶段） ----
//
// 密码**强度**规则（长度下限、字符类别、弱密码黑名单）在 `utils/auth.ts`：
// 那是安全策略，注册与改密共用，和这里的"表单形状"（邮箱格式、两次是否一致）变更理由不同。

/** 展示名长度上限 */
export const DISPLAY_NAME_MAX_LENGTH = 20

/**
 * 邮箱校验。
 * 刻意保持宽松：真实合法性最终由后端（Supabase）判定，
 * 前端只挡明显写错的输入（缺 @、域名没点、带空格），避免把合法邮箱拦在门外。
 */
export function validateEmail(email: string): ValidationResult {
  const value = email.trim()
  if (!value) return { valid: false, message: '请输入邮箱' }
  if (/\s/.test(value)) return { valid: false, message: '邮箱不能包含空格' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { valid: false, message: '邮箱格式不正确' }
  return { valid: true }
}

/** 确认密码校验 */
export function validatePasswordConfirm(password: string, confirm: string): ValidationResult {
  if (!confirm) return { valid: false, message: '请再次输入密码' }
  if (password !== confirm) return { valid: false, message: '两次输入的密码不一致' }
  return { valid: true }
}

/** 展示名校验：可留空（留空时用邮箱前缀），填了不能超长 */
export function validateDisplayName(name: string): ValidationResult {
  const value = name.trim()
  if (!value) return { valid: true }
  if (value.length > DISPLAY_NAME_MAX_LENGTH) {
    return { valid: false, message: `昵称不能超过 ${DISPLAY_NAME_MAX_LENGTH} 个字符` }
  }
  return { valid: true }
}
