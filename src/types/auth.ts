/** 用户系统（Supabase Auth）领域类型 */

/**
 * 认证状态。
 * - `loading`：会话恢复中（路由守卫必须挂起等待，否则刷新页面会闪跳登录页）
 * - `guest`：未登录
 * - `authed`：已登录
 */
export type AuthStatus = 'loading' | 'guest' | 'authed'

/**
 * 运行模式。
 * - `cloud`：已配置 Supabase（真注册/登录 + 多设备云同步）
 * - `local`：未配置 Supabase（纯本地模式，功能全部可用，仅缺少云同步与登录）
 */
export type AuthMode = 'cloud' | 'local'

/** 当前登录用户（把 Supabase session.user 归一化后的视图模型） */
export interface AuthUser {
  id: string
  email: string
  /** 展示名：`user_metadata.display_name` → 邮箱前缀 → 「未命名用户」 */
  displayName: string
  /** 头像公开地址（带版本号用于缓存失效）；未设置时为空串 */
  avatarUrl: string
  /** 登录方式：`email` / `github` / … */
  provider: string
}

/** 认证操作结果（面向 UI：`ok=false` 时 message 可直接展示给用户） */
export interface AuthResult {
  ok: boolean
  message: string
  /** 注册后需要邮箱验证（此时尚无会话，不能直接进应用） */
  needsEmailConfirm?: boolean
}

/** 注册入参 */
export interface SignUpPayload {
  email: string
  password: string
  displayName: string
  /**
   * Cloudflare Turnstile 的一次性 token（第五阶段：注册安全增强）。
   * 由 `TurnstileCaptcha` 提供，supabase-js 透传给 Auth 服务端核验；
   * 未启用验证码时为空（服务端也就不会校验）。
   */
  captchaToken?: string
}

/** 头像允许的文件类型白名单 */
export const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** 头像原图大小上限：5MB（超出先在浏览器端拦截，不去浪费一次上传） */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/** 头像导出边长：256×256 足够所有展示位，头像不需要原图 */
export const AVATAR_SIZE = 256

/** 头像导出 webp 质量 */
export const AVATAR_WEBP_QUALITY = 0.9

/** 头像 Storage bucket 名（与 supabase/schema.sql 保持一致） */
export const AVATAR_BUCKET = 'avatars'

/** 头像「姓名首字母」兜底的最大长度 */
export const AVATAR_INITIAL_MAX = 2
