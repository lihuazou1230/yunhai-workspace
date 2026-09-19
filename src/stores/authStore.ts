import { computed, ref } from 'vue'

import { defineStore } from 'pinia'

import {
  consumeAuthRedirect,
  describeAuthError,
  getCurrentSessionUser,
  resendConfirmEmail,
  sendPasswordReset,
  signInWithPassword,
  signOutUser,
  signUpWithPassword,
  subscribeAuthChanges,
  updateAvatarMetadata,
  updateUserPassword,
} from '@/api/auth'
import { isSupabaseConfigured } from '@/api/supabase'
import type { AuthMode, AuthResult, AuthStatus, AuthUser, SignUpPayload } from '@/types/auth'
import { avatarInitial } from '@/utils/avatarImage'

/**
 * 认证 store（Pinia setup 风格）
 *
 * 关键点：
 * 1. **会话恢复不可闪跳**：初始 status 是 `loading`，路由守卫会 `await ensureReady()` 再放行——
 *    刷新页面时 `getSession()` 还没回来就判「未登录」，会把已登录用户踢到登录页（经典 bug）。
 * 2. **未配置 Supabase 不阻塞使用**：status 直接落到 `guest` + mode `local`，
 *    应用以本地模式完整可用，登录页只做配置引导。
 * 3. **恢复 + 订阅只做一次**：`init()` 用同一个 promise 兜住并发调用（守卫可能并发触发）。
 */
export const useAuthStore = defineStore('auth', () => {
  // ---- 状态 ----
  /** 认证状态（初始 loading：等待会话恢复） */
  const status = ref<AuthStatus>('loading')
  /** 当前用户（未登录为 null） */
  const user = ref<AuthUser | null>(null)
  /** 最近一次认证失败的原因（可展示） */
  const lastError = ref('')
  /**
   * 邮件链接落地的处理结果（成功/失败各一条），登录页展示一次后清掉。
   * 用它的原因：链接过期、被邮件扫描器先点过一次，用户需要一句明确的解释，
   * 而不是"页面停在登录页、不知道为什么"。
   */
  const redirectNotice = ref<AuthResult | null>(null)

  /** 运行模式：cloud = 已配置 Supabase；local = 纯本地模式 */
  const mode = computed<AuthMode>(() => (isSupabaseConfigured() ? 'cloud' : 'local'))
  const isLocalMode = computed(() => mode.value === 'local')
  const isAuthed = computed(() => status.value === 'authed' && user.value !== null)
  const isReady = computed(() => status.value !== 'loading')
  const displayName = computed(() => user.value?.displayName ?? '本地访客')
  const email = computed(() => user.value?.email ?? '')
  const avatarUrl = computed(() => user.value?.avatarUrl ?? '')
  /** 无头像时的首字母兜底 */
  const initial = computed(() => avatarInitial(displayName.value))

  /** onAuthStateChange 取消订阅函数 */
  let unsubscribe: (() => void) | null = null
  /** 会话恢复 promise（并发调用的去重锁） */
  let readyPromise: Promise<void> | null = null

  function applyUser(next: AuthUser | null, errorMessage = '') {
    user.value = next
    status.value = next ? 'authed' : 'guest'
    lastError.value = errorMessage
  }

  /** 恢复会话并订阅登录态变化（幂等） */
  function init(): Promise<void> {
    if (readyPromise) return readyPromise

    readyPromise = (async () => {
      // 本地模式：没有 Supabase 可恢复，直接判定为未登录（应用仍可完整使用）
      if (!isSupabaseConfigured()) {
        applyUser(null)
        return
      }

      /**
       * **先认领邮件链接带回来的凭据，再恢复会话**——顺序不能反：
       * `verifyOtp` / `exchangeCodeForSession` 执行完会话才落到本地存储，
       * 反过来的话 `getSession()` 拿到的是空的，用户点完验证邮件会被判成"未登录"，
       * 于是停在登录页、还得手动登一次（正是这个顺序问题造成的体验坑）。
       */
      let redirectFailure = ''
      try {
        const redirectResult = await consumeAuthRedirect()
        if (redirectResult) {
          redirectNotice.value = redirectResult
          if (!redirectResult.ok) redirectFailure = redirectResult.message
        }
      } catch (error) {
        redirectFailure = describeAuthError(error)
      }

      try {
        applyUser(await getCurrentSessionUser())
      } catch (error) {
        applyUser(null, describeAuthError(error))
      }

      // 邮件链接失败的原因要"活过"会话恢复——applyUser 会用空串覆盖 lastError
      if (redirectFailure) lastError.value = redirectFailure

      // 订阅放在恢复之后：token 刷新、登出、OAuth 回跳都会走到这里
      unsubscribe?.()
      unsubscribe = subscribeAuthChanges((next) => applyUser(next))
    })()

    return readyPromise
  }

  /** 登录页取走邮件链接的处理结果（取一次就清，避免重复弹） */
  function takeRedirectNotice(): AuthResult | null {
    const notice = redirectNotice.value
    redirectNotice.value = null
    return notice
  }

  /** 路由守卫用：会话恢复完成前挂起，避免误跳登录页 */
  async function ensureReady(): Promise<void> {
    if (status.value === 'loading') await init()
  }

  /** 邮箱密码登录（captchaToken：开了 Attack Protection 时服务端会要求） */
  async function signIn(
    email: string,
    password: string,
    captchaToken?: string,
  ): Promise<AuthResult> {
    const result = await signInWithPassword(email.trim(), password, captchaToken)
    if (result.ok) {
      lastError.value = ''
      // 立即拉一次用户，避免等 onAuthStateChange 才更新界面
      await refreshUser()
    } else {
      lastError.value = result.message
    }
    return result
  }

  /** 邮箱注册 */
  async function signUp(payload: SignUpPayload): Promise<AuthResult> {
    const result = await signUpWithPassword({
      email: payload.email.trim(),
      password: payload.password,
      displayName: payload.displayName.trim(),
      // Turnstile 一次性 token 原样透传（未启用验证码时是空串/undefined）
      captchaToken: payload.captchaToken,
    })
    if (result.ok && !result.needsEmailConfirm) await refreshUser()
    if (!result.ok) lastError.value = result.message
    return result
  }

  /** 重新发送注册验证邮件（开启邮箱验证时用；开了 Captcha 时也要带 token） */
  async function resendConfirm(email: string, captchaToken?: string): Promise<AuthResult> {
    const result = await resendConfirmEmail(email.trim(), undefined, captchaToken)
    if (!result.ok) lastError.value = result.message
    return result
  }

  /** 发送重置密码邮件（忘记密码；开了 Captcha 时也要带 token） */
  async function sendResetEmail(email: string, captchaToken?: string): Promise<AuthResult> {
    const result = await sendPasswordReset(email.trim(), undefined, captchaToken)
    if (!result.ok) lastError.value = result.message
    return result
  }

  /** 修改密码：登录状态下改密、或点重置链接换来的 recovery 会话都用它 */
  async function changePassword(password: string): Promise<AuthResult> {
    const result = await updateUserPassword(password)
    if (!result.ok) lastError.value = result.message
    return result
  }

  /** 退出登录：清空本地用户态（任务本地缓存由 todoStore 负责清理） */
  async function signOut(): Promise<AuthResult> {
    const result = await signOutUser()
    // 无论云端登出是否成功，本地都要退出，否则用户会卡在「看似已登录」的状态
    applyUser(null, result.ok ? '' : result.message)
    return result
  }

  /** 手动刷新当前用户（登录后立即同步界面） */
  async function refreshUser(): Promise<AuthUser | null> {
    if (!isSupabaseConfigured()) return null
    try {
      const next = await getCurrentSessionUser()
      if (next) applyUser(next)
      return next
    } catch (error) {
      lastError.value = describeAuthError(error)
      return null
    }
  }

  /** 更新头像地址（写入 user_metadata，跨设备可见） */
  async function setAvatarUrl(url: string): Promise<AuthResult> {
    const result = await updateAvatarMetadata(url)
    if (result.ok && user.value) user.value = { ...user.value, avatarUrl: url }
    if (!result.ok) lastError.value = result.message
    return result
  }

  /** 仅清空本地头像地址（移除头像时用，不碰云端 Storage 删除结果） */
  function clearLocalAvatar() {
    if (user.value) user.value = { ...user.value, avatarUrl: '' }
  }

  /** 取消订阅并允许重新初始化（组件卸载 / 测试隔离用） */
  function dispose() {
    unsubscribe?.()
    unsubscribe = null
    readyPromise = null
    status.value = 'loading'
    user.value = null
    lastError.value = ''
    redirectNotice.value = null
  }

  return {
    // 状态
    status,
    user,
    lastError,
    redirectNotice,
    // getters
    mode,
    isLocalMode,
    isAuthed,
    isReady,
    displayName,
    email,
    avatarUrl,
    initial,
    // actions
    init,
    ensureReady,
    takeRedirectNotice,
    signIn,
    signUp,
    resendConfirm,
    sendResetEmail,
    changePassword,
    signOut,
    refreshUser,
    setAvatarUrl,
    clearLocalAvatar,
    dispose,
  }
})
