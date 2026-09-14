/**
 * 邮件链接落地凭据解析（纯函数，第五阶段）
 *
 * 为什么需要它：Supabase 的认证邮件点开后，**不同形态会把不同参数带回来**，
 * 而 supabase-js 的 `detectSessionInUrl` 只认其中一部分：
 *
 * | 邮件里的链接形态 | 地址栏出现什么 | detectSessionInUrl 认得吗 |
 * | --- | --- | --- |
 * | 默认模板 `{{ .ConfirmationURL }}`（GoTrue 服务端验证后 302 回站点） | `#access_token=…&refresh_token=…` | ✅ 认（implicit） |
 * | 开了 PKCE 的客户端 | `?code=…` | ✅ 认（但要本地还留着 code_verifier） |
 * | 模板改成 `{{ .SiteURL }}/auth/confirm?token_hash=…&type=signup`（SSR 推荐写法） | `?token_hash=…&type=…` | ❌ **不认**，得自己调 `verifyOtp` |
 * | 链接过期/已被点过（邮件扫描器常先替你点一次） | `#error=access_denied&error_code=otp_expired` | 部分认（拿不到会话，只报错） |
 *
 * 后两种如果不处理，用户就会看到"链接点开了、页面停在登录页、还得手动登一次"。
 * 这里把四种形态统一解析成一个 plan，交给 `api/auth.ts` 去换会话；纯函数便于单测。
 */

/** 邮件链接的类型（GoTrue 的 email OTP 类型；本项目用得到的是 signup / recovery / email_change） */
export type AuthEmailOtpType =
  'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'

export interface AuthRedirectPlan {
  /** none = 只是普通访问；其余三种都是"邮件链接带回了凭据" */
  kind: 'none' | 'code' | 'otp' | 'error'
  /** kind = code：PKCE 授权码 */
  code?: string
  /** kind = otp：新版模板带来的 token_hash 与其类型 */
  tokenHash?: string
  type?: AuthEmailOtpType
  /** kind = error：GoTrue 直接带回来的错误码（如 otp_expired / access_denied） */
  errorCode?: string
  errorDescription?: string
}

/** 参与解析的参数名（同时用于"处理完把地址栏清干净"） */
const AUTH_PARAM_NAMES = [
  'code',
  'token_hash',
  'type',
  'error',
  'error_code',
  'error_description',
  'access_token',
  'refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'provider_token',
  'provider_refresh_token',
] as const

/** 把 query 与 hash 两半都解析出来（hash 里也可能藏着 `#error=…` 或 `#access_token=…`） */
function collectParams(url: string): URLSearchParams {
  const params = new URLSearchParams()
  const queryStart = url.indexOf('?')
  const hashStart = url.indexOf('#')

  if (queryStart >= 0) {
    const queryEnd = hashStart > queryStart ? hashStart : url.length
    new URLSearchParams(url.slice(queryStart + 1, queryEnd)).forEach((value, key) =>
      params.set(key, value),
    )
  }
  if (hashStart >= 0) {
    new URLSearchParams(url.slice(hashStart + 1)).forEach((value, key) => params.set(key, value))
  }
  return params
}

/** 合法的 email OTP 类型（其余一律当无效，避免把乱参数塞给 verifyOtp） */
const EMAIL_OTP_TYPES: readonly AuthEmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]

/**
 * 解析邮件链接落地时的地址栏参数。
 * 优先级：`error` > `token_hash`（新版模板）> `code`（PKCE）> `access_token`（implicit，交给库自己处理）。
 */
export function parseAuthRedirect(url: string): AuthRedirectPlan {
  const params = collectParams(url)

  const errorCode = params.get('error_code') ?? params.get('error') ?? ''
  if (errorCode) {
    return {
      kind: 'error',
      errorCode,
      errorDescription: params.get('error_description') ?? '',
    }
  }

  const tokenHash = params.get('token_hash') ?? ''
  if (tokenHash) {
    const rawType = params.get('type') ?? 'email'
    const type = EMAIL_OTP_TYPES.includes(rawType as AuthEmailOtpType)
      ? (rawType as AuthEmailOtpType)
      : 'email'
    return { kind: 'otp', tokenHash, type }
  }

  const code = params.get('code') ?? ''
  if (code) return { kind: 'code', code }

  // implicit（#access_token=…）由 supabase-js 的 detectSessionInUrl 自己换会话，这里不用管
  return { kind: 'none' }
}

/**
 * 把地址栏里的认证参数清掉，返回新地址（不改变则返回 null）。
 *
 * 为什么必须清：一次性凭据（code / token_hash）用过就废，留着它用户一刷新就会
 * 拿同一个凭据再换一次 → 报「已过期或已被使用」，看起来像"刚验证完就失效"。
 * 只删这些参数、保留其它查询与 hash，不影响业务路由。
 */
export function stripAuthParams(url: string): string | null {
  const hashStart = url.indexOf('#')
  const hash = hashStart >= 0 ? url.slice(hashStart) : ''
  const withoutHash = hashStart >= 0 ? url.slice(0, hashStart) : url
  const queryStart = withoutHash.indexOf('?')
  const base = queryStart >= 0 ? withoutHash.slice(0, queryStart) : withoutHash
  const query = queryStart >= 0 ? withoutHash.slice(queryStart + 1) : ''

  const kept = new URLSearchParams()
  let removed = 0
  new URLSearchParams(query).forEach((value, key) => {
    if ((AUTH_PARAM_NAMES as readonly string[]).includes(key)) removed += 1
    else kept.set(key, value)
  })

  const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
  const keptHash = new URLSearchParams()
  hashParams.forEach((value, key) => {
    if ((AUTH_PARAM_NAMES as readonly string[]).includes(key)) removed += 1
    else keptHash.set(key, value)
  })

  if (removed === 0) return null

  const nextQuery = kept.toString()
  const nextHash = keptHash.toString()
  return `${base}${nextQuery ? `?${nextQuery}` : ''}${nextHash ? `#${nextHash}` : ''}`
}

/** 把邮件链接的错误码翻译成中文（链接过期/被邮件扫描器先点掉是最常见的两种） */
export function describeAuthLinkError(plan: AuthRedirectPlan): string {
  const code = (plan.errorCode ?? '').toLowerCase()
  if (code.includes('expired') || code === 'otp_expired')
    return '邮件链接已失效（多半是超过有效期，或被邮箱安全扫描先点掉了一次）：请回登录页重新发送一封'
  if (code.includes('access_denied') || code.includes('forbidden'))
    return '邮件链接验证未通过：请重新发送一封确认邮件再试'
  return plan.errorDescription || '邮件链接验证失败：请重新发送一封确认邮件再试'
}
