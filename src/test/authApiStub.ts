/**
 * 认证 API 桩（多个测试文件共用）
 *
 * 用法：
 * ```ts
 * vi.mock('@/api/auth', async () => (await import('@/test/authApiStub')).authApiStub)
 * ```
 * 注意 '@/api/supabase' 不在这里 mock：需要切换「已配置 / 未配置」两种模式时，
 * 直接用 `vi.stubEnv('VITE_SUPABASE_URL', ...)` 更贴近真实行为。
 */

import { vi } from 'vitest'

import type { AuthResult, AuthUser, SignUpPayload } from '@/types/auth'

export const authApiStub = {
  consumeAuthRedirect: vi.fn<(url?: string) => Promise<AuthResult | null>>(),
  describeAuthError: vi.fn<(error: unknown) => string>(),
  getCurrentSessionUser: vi.fn<() => Promise<AuthUser | null>>(),
  resendConfirmEmail:
    vi.fn<(email: string, redirectTo?: string, captchaToken?: string) => Promise<AuthResult>>(),
  sendPasswordReset:
    vi.fn<(email: string, redirectTo?: string, captchaToken?: string) => Promise<AuthResult>>(),
  signInWithPassword:
    vi.fn<(email: string, password: string, captchaToken?: string) => Promise<AuthResult>>(),
  signOutUser: vi.fn<() => Promise<AuthResult>>(),
  signUpWithPassword: vi.fn<(payload: SignUpPayload) => Promise<AuthResult>>(),
  subscribeAuthChanges: vi.fn<(cb: (user: AuthUser | null) => void) => () => void>(),
  updateAvatarMetadata: vi.fn<(avatarUrl: string) => Promise<AuthResult>>(),
  updateUserPassword: vi.fn<(password: string) => Promise<AuthResult>>(),
}

/** 每个用例开始前调用：清空调用记录并恢复默认实现（默认全部成功、无会话） */
export function resetAuthApiStub() {
  vi.clearAllMocks()
  authApiStub.consumeAuthRedirect.mockResolvedValue(null)
  authApiStub.describeAuthError.mockImplementation((error) => `err:${String(error)}`)
  authApiStub.getCurrentSessionUser.mockResolvedValue(null)
  authApiStub.resendConfirmEmail.mockResolvedValue({
    ok: true,
    message: '验证邮件已重新发送，请稍候查收',
  })
  authApiStub.sendPasswordReset.mockResolvedValue({
    ok: true,
    message: '重置链接已发送，请到邮箱查收（没收到先看垃圾箱）',
  })
  authApiStub.updateUserPassword.mockResolvedValue({
    ok: true,
    message: '密码已更新，可以用新密码登录了',
  })
  authApiStub.signInWithPassword.mockResolvedValue({ ok: true, message: '登录成功' })
  authApiStub.signOutUser.mockResolvedValue({ ok: true, message: '已退出登录' })
  authApiStub.signUpWithPassword.mockResolvedValue({ ok: true, message: '注册成功，已自动登录' })
  authApiStub.subscribeAuthChanges.mockReturnValue(vi.fn())
  authApiStub.updateAvatarMetadata.mockResolvedValue({ ok: true, message: '头像已更新' })
}

/** 一个可用的已登录用户 */
export const AUTH_TEST_USER: AuthUser = {
  id: 'u1',
  email: 'zhang@example.com',
  displayName: '张三',
  avatarUrl: '',
  provider: 'email',
}
