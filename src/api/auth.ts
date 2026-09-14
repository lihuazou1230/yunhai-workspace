/**
 * 认证 API 封装（Supabase Auth）
 *
 * 设计：全部函数 **不抛异常**，统一返回 `AuthResult`（`{ ok, message }`），
 * message 是可直接展示给用户的中文文案——组件里不用再写一层 try/catch + 文案映射。
 * 需要「返回值」的读取类接口（当前会话、订阅登录态）才可能抛错，由 store 兜住。
 */

import type { AuthResult, AuthUser, SignUpPayload } from '@/types/auth'
import { appUrl } from '@/utils/appUrl'
import { describeAuthLinkError, parseAuthRedirect, stripAuthParams } from '@/utils/authRedirect'
import {
  SupabaseUnavailableError,
  getSupabaseClient,
  isSupabaseConfigured,
  requireSupabaseClient,
} from './supabase'

/** Supabase user 的最小子集（结构类型，便于单测传普通对象） */
export interface SupabaseUserLike {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
  app_metadata?: { provider?: string } | null
}

/** 取元数据里第一个非空字符串 */
function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/** 邮箱前缀（`zhang@x.com` → `zhang`） */
export function emailPrefix(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

/**
 * 把 Supabase user 归一化成应用内的 `AuthUser`（纯函数）。
 * 展示名优先级：display_name → full_name / name / user_name → 邮箱前缀 → 「未命名用户」；
 * 头像优先用我们上传的 `avatar_url`，GitHub OAuth 登录时 Supabase 也会带上 GitHub 头像。
 */
export function toAuthUser(user: SupabaseUserLike | null | undefined): AuthUser | null {
  if (!user || !user.id) return null

  const email = typeof user.email === 'string' ? user.email : ''
  const meta = user.user_metadata ?? {}
  const displayName =
    firstString(meta.display_name, meta.full_name, meta.name, meta.user_name) ||
    (email ? emailPrefix(email) : '') ||
    '未命名用户'

  return {
    id: user.id,
    email,
    displayName,
    avatarUrl: firstString(meta.avatar_url),
    provider: firstString(user.app_metadata?.provider) || 'email',
  }
}

/**
 * 把各种原始错误翻译成用户能看懂的中文。
 * Supabase 的错误信息是英文的，直接抛给用户体验很差，这里做一层映射。
 */
export function describeAuthError(error: unknown): string {
  if (error instanceof SupabaseUnavailableError) return error.message
  if (!error) return '认证失败，请稍后重试'

  const raw = typeof error === 'string' ? error : ((error as Error).message ?? '')
  const text = raw.toLowerCase()
  /**
   * supabase-js 的 `AuthApiError` 还带一个服务端错误码（`error.code`）。
   * 有些错误只有码、没有可读的 message，光看 message 会漏掉——所以两个都读。
   */
  const code =
    typeof error === 'object' && error !== null
      ? String((error as { code?: unknown }).code ?? '').toLowerCase()
      : ''

  if (text.includes('invalid login credentials')) return '邮箱或密码不正确'
  if (text.includes('email not confirmed')) return '邮箱尚未验证，请先查收验证邮件'
  if (text.includes('already registered') || text.includes('already been registered'))
    return '该邮箱已注册，请直接登录'
  /**
   * Turnstile 人机验证失败：GoTrue 会把 Cloudflare 的错误码原样带出来，
   * 例如 `captcha protection: request disallowed (timeout-or-duplicate)`。
   * 其中 `timeout-or-duplicate` 几乎总是「token 用了第二次」（一次性），
   * 提示必须指向「重新验证」，否则用户只会反复点注册。
   */
  if (text.includes('timeout-or-duplicate'))
    return '人机验证已过期或已被使用，请重新完成验证后再提交'
  if (text.includes('captcha') || text.includes('invalid-input-response'))
    return '人机验证未通过，请重新完成验证后再试'
  // Supabase 的最小密码长度是可配的（本项目调到 8，对齐 utils/auth 的规则），
  // 所以把数字从报错里读出来，而不是写死 6 —— 否则服务端改了长度，提示反而骗人
  const minLength = raw.match(/password should be at least\s+(\d+)/i)
  if (minLength) return `密码至少 ${minLength[1]} 位`
  /**
   * 密码强度不达标。**调高最小长度/复杂度之后老账号会在登录时撞上这条**：
   * Supabase 的规则「老用户仍可用旧密码登录，但若旧密码达不到新标准，
   * signInWithPassword 会返回 WeakPasswordError」——不翻译的话用户只会看到英文，
   * 还以为是自己密码打错了。
   */
  if (
    code.includes('weak_password') ||
    text.includes('weak password') ||
    text.includes('password is too weak')
  )
    return '这个密码达不到当前强度要求（服务端已提高最小长度/复杂度）：请用「忘记密码」重设一个更强的密码'
  if (text.includes('should be different from the old password')) return '新密码不能与当前密码相同'
  if (text.includes('unable to validate email') || text.includes('invalid email'))
    return '邮箱格式不正确'
  if (text.includes('signups not allowed') || text.includes('signup is disabled'))
    return '当前项目已关闭注册，请使用已有账号登录'
  /**
   * 发信失败：最常见的原因不是 SMTP 配错，而是**收件邮箱根本不存在**。
   * QQ 邮箱的 SMTP 在 RCPT 阶段一律回 250，到 DATA 阶段才校验并拒收
   * （`550 The recipient may contain a non-existent account`），
   * GoTrue 于是统一报 `Error sending confirmation email`，用户完全看不出问题在哪。
   */
  if (text.includes('error sending confirmation email'))
    return '验证邮件发送失败：请确认这个邮箱真实存在且能收信（邮箱不存在时会被邮件服务拒收）'
  if (text.includes('error sending recovery email'))
    return '重置密码邮件发送失败：请确认这个邮箱真实存在且能收信'
  if (text.includes('error sending email') || text.includes('error sending magic link'))
    return '邮件发送失败：请确认这个邮箱真实存在，或稍后重试'
  if (text.includes('rate limit') || text.includes('too many requests'))
    return '操作过于频繁，请稍后再试'
  if (text.includes('failed to fetch') || text.includes('networkerror'))
    return '网络不可用，请检查网络后重试'

  return raw || '认证失败，请稍后重试'
}

/** 统一包装成 AuthResult */
function failure(error: unknown): AuthResult {
  return { ok: false, message: describeAuthError(error) }
}

/** 邮箱注册（成功后若开启邮箱验证，则没有会话，需要去邮箱确认） */
export async function signUpWithPassword(payload: SignUpPayload): Promise<AuthResult> {
  try {
    const client = requireSupabaseClient()
    const { data, error } = await client.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        data: { display_name: payload.displayName },
        // 用 appUrl() 而不是 location.origin：GitHub Pages 部署在 /<repo>/ 子路径下，
        // 只拼 origin 会得到不是本应用的地址，且匹配不上 Supabase 的 Redirect URLs 白名单
        emailRedirectTo: appUrl(),
        /**
         * Turnstile 的一次性 token（第五阶段：注册安全增强）。
         * 服务端在**发出确认邮件之前**拿 secretKey 向 Cloudflare 核验：
         * 不通过就不建号、不发信——所以它挡的是批量注册脚本，而不是"前端有没有画验证码"。
         * 未启用验证码时这里是 undefined，supabase-js 会忽略该字段。
         */
        captchaToken: payload.captchaToken || undefined,
      },
    })
    if (error) return failure(error)

    if (data.session) return { ok: true, message: '注册成功，已自动登录' }
    return {
      ok: true,
      message: '注册成功，请到邮箱完成验证后再登录',
      needsEmailConfirm: true,
    }
  } catch (error) {
    return failure(error)
  }
}

/**
 * 邮箱密码登录。
 *
 * ⚠️ Supabase 的 Captcha 保护是**全局开关**：一旦在 Attack Protection 里打开，
 * 登录（/token?grant_type=password）也会要求 token。所以这里必须能带 captchaToken，
 * 否则"开了验证码就登不进去"。未启用验证码时是 undefined，请求里不会出现该字段。
 */
export async function signInWithPassword(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<AuthResult> {
  try {
    const client = requireSupabaseClient()
    const { error } = await client.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    })
    if (error) return failure(error)
    return { ok: true, message: '登录成功' }
  } catch (error) {
    return failure(error)
  }
}

/** GitHub OAuth 登录（会跳转到 GitHub 授权页，回来时由 detectSessionInUrl 自动换会话） */ export async function signInWithGitHub(
  redirectTo?: string,
): Promise<AuthResult> {
  try {
    const client = requireSupabaseClient()
    const { error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: redirectTo ?? (typeof location !== 'undefined' ? location.href : undefined),
      },
    })
    if (error) return failure(error)
    return { ok: true, message: '正在跳转 GitHub 授权…' }
  } catch (error) {
    return failure(error)
  }
}

/**
 * 重新发送注册验证邮件。
 *
 * 为什么必须有：开启「Confirm email」时，验证信走的是邮件通道，慢或进垃圾箱是常态。
 * 没有重发入口，用户只能干等，或者再点一次注册——而后者会得到「该邮箱已注册」，
 * 反而更懵。这里的错误也要翻译好：Supabase 对发信有频率限制，
 * 连续点会返回 rate limit，得明确告诉用户「过一会儿再试」。
 */
export async function resendConfirmEmail(
  email: string,
  redirectTo?: string,
  captchaToken?: string,
): Promise<AuthResult> {
  try {
    const client = requireSupabaseClient()
    const { error } = await client.auth.resend({
      type: 'signup',
      email,
      options: {
        // 同上：子路径部署下必须带上 base，否则白名单匹配失败
        emailRedirectTo: redirectTo ?? appUrl(),
        // 开了 Captcha 保护时 /resend 也要求 token（未启用时不带该字段）
        ...(captchaToken ? { captchaToken } : {}),
      },
    })
    if (error) return failure(error)
    return { ok: true, message: '验证邮件已重新发送，请稍候查收' }
  } catch (error) {
    return failure(error)
  }
}

/**
 * 发送「重置密码」邮件。
 *
 * 邮件里的链接由 Supabase 校验 token 后跳回 `redirectTo`（默认本站 `/reset-password`），
 * 地址里会带上临时会话凭据，由 `detectSessionInUrl` 自动换成一个 recovery 会话——
 * 用户于是在「已登录但只能改密码」的状态下打开重置页。
 *
 * ⚠️ `redirectTo` 必须出现在 Supabase 的 Redirect URLs 白名单里，否则链接会被拒。
 */
export async function sendPasswordReset(
  email: string,
  redirectTo?: string,
  captchaToken?: string,
): Promise<AuthResult> {
  try {
    const client = requireSupabaseClient()
    const { error } = await client.auth.resetPasswordForEmail(email, {
      // 必须带上部署 base（GitHub Pages 是 /<repo>/），否则重置链接会跳到应用之外
      redirectTo: redirectTo ?? appUrl('reset-password'),
      // 开了 Captcha 保护时 /recover 也要求 token（未启用时不带该字段）
      ...(captchaToken ? { captchaToken } : {}),
    })
    if (error) return failure(error)
    return { ok: true, message: '重置链接已发送，请到邮箱查收（没收到先看垃圾箱）' }
  } catch (error) {
    return failure(error)
  }
}

/**
 * 处理「邮件链接落地」时地址栏带回来的凭据，并把它从地址栏清掉。
 *
 * 覆盖四种形态（详见 `utils/authRedirect.ts` 的说明）：
 * - `#access_token=…`（默认模板，implicit）→ 交给 supabase-js 自己换，这里返回 null
 * - `?code=…`（PKCE）→ `exchangeCodeForSession`
 * - `?token_hash=…&type=…`（新版模板 / SSR 推荐写法）→ `verifyOtp` ← **库不会自动处理这一种**
 * - `#error=…&error_code=otp_expired`（链接过期/被邮件扫描器先点过）→ 翻成中文提示
 *
 * 没带凭据时返回 null（调用方不用区分"成功"与"本来就没这回事"）。
 */
export async function consumeAuthRedirect(
  url: string = typeof window !== 'undefined' ? window.location.href : '',
): Promise<AuthResult | null> {
  if (!url) return null
  const plan = parseAuthRedirect(url)
  if (plan.kind === 'none') return null

  cleanupUrl()
  if (plan.kind === 'error') return { ok: false, message: describeAuthLinkError(plan) }

  try {
    const client = requireSupabaseClient()
    const { error } =
      plan.kind === 'code'
        ? await client.auth.exchangeCodeForSession(plan.code!)
        : await client.auth.verifyOtp({ token_hash: plan.tokenHash!, type: plan.type! })
    if (error) return failure(error)
    return { ok: true, message: '邮箱验证成功，已自动登录' }
  } catch (error) {
    return failure(error)
  }
}

/** 把认证参数从地址栏抹掉（保留其它查询与 hash），避免刷新时拿一次性凭据再换一次 */
function cleanupUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  const next = stripAuthParams(window.location.href)
  if (!next) return
  window.history.replaceState(window.history.state, '', next)
}

/** 改密（登录状态下改密 / 重置链接换来的 recovery 会话都用它）。
 * 前端只做长度与一致性校验，强度规则最终由 Supabase 判定。
 */
export async function updateUserPassword(password: string): Promise<AuthResult> {
  try {
    const client = requireSupabaseClient()
    const { error } = await client.auth.updateUser({ password })
    if (error) return failure(error)
    return { ok: true, message: '密码已更新，可以用新密码登录了' }
  } catch (error) {
    return failure(error)
  }
}

/** 退出登录 */
export async function signOutUser(): Promise<AuthResult> {
  try {
    const client = requireSupabaseClient()
    const { error } = await client.auth.signOut()
    if (error) return failure(error)
    return { ok: true, message: '已退出登录' }
  } catch (error) {
    return failure(error)
  }
}

/** 读取当前会话（刷新页面时恢复登录态）；未配置时直接返回 null */
export async function getCurrentSessionUser(): Promise<AuthUser | null> {
  if (!isSupabaseConfigured()) return null
  const client = requireSupabaseClient()
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  return toAuthUser(data.session?.user as SupabaseUserLike | null | undefined)
}

/**
 * 订阅登录态变化（token 刷新、登出、OAuth 回跳都会触发）。
 * 返回取消订阅函数；未配置时返回空函数。
 */
export function subscribeAuthChanges(onChange: (user: AuthUser | null) => void): () => void {
  const client = getSupabaseClient()
  if (!client) return () => {}

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    onChange(toAuthUser(session?.user as SupabaseUserLike | null | undefined))
  })
  return () => data.subscription.unsubscribe()
}

/** 把头像地址写回 user_metadata（跨设备同步头像 URL） */
export async function updateAvatarMetadata(avatarUrl: string): Promise<AuthResult> {
  try {
    const client = requireSupabaseClient()
    const { error } = await client.auth.updateUser({ data: { avatar_url: avatarUrl } })
    if (error) return failure(error)
    return { ok: true, message: '头像已更新' }
  } catch (error) {
    return failure(error)
  }
}
