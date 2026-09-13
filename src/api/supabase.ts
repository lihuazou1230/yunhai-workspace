/**
 * Supabase 客户端（单例）
 *
 * 三个关键点：
 * 1. **按需创建**：只有 `.env.local` 里配好 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
 *    才会创建客户端；缺失时返回 null，应用降级为「本地模式」而不是白屏报错。
 * 2. **每次读 env**：配置在模块加载时读死会让测试无法切换「已配置 / 未配置」两条路径，
 *    所以统一走 `readSupabaseEnv()`，配置变化时重建客户端（缓存 key 比对）。
 * 3. **会话持久化交给 supabase-js**：`persistSession` + `autoRefreshToken` +
 *    `detectSessionInUrl`（GitHub OAuth 回调地址里带的 token 由它自动换会话）。
 */

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

/** 未配置 Supabase 时给用户的引导文案（登录页 / 设置页共用） */
export const SUPABASE_SETUP_HINT =
  '尚未配置 Supabase：请在项目根目录 `.env.local` 填入 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY，' +
  '并在 Supabase SQL Editor 执行 `supabase/schema.sql`'

/** Supabase 数据表名（集中一处，避免各文件写裸字符串） */
export const SUPABASE_TABLES = {
  todos: 'todos',
  /** 第九阶段：账号级偏好设置（一行一个 key） */
  userSettings: 'user_settings',
} as const

/** Storage bucket 名（头像 + 用户上传的图片） */
export const SUPABASE_BUCKETS = {
  avatars: 'avatars',
  /** 第九阶段：用户上传的壁纸等图片（公开读、写入限本人目录） */
  userAssets: 'user-assets',
} as const

/** 环境变量读取结果 */
export interface SupabaseEnv {
  url: string
  anonKey: string
}

/** 缺配置时抛出的标识性错误（UI 层据此给出引导文案，而不是暴露原始报错） */
export class SupabaseUnavailableError extends Error {
  constructor(message: string = SUPABASE_SETUP_HINT) {
    super(message)
    this.name = 'SupabaseUnavailableError'
  }
}

/** 读取 Supabase 相关环境变量（已 trim，空串视为未配置） */
export function readSupabaseEnv(): SupabaseEnv {
  const env = import.meta.env ?? {}
  return {
    url: String(env.VITE_SUPABASE_URL ?? '').trim(),
    anonKey: String(env.VITE_SUPABASE_ANON_KEY ?? '').trim(),
  }
}

/** 是否已配置 Supabase（决定应用跑在 cloud 还是 local 模式） */
export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = readSupabaseEnv()
  return url !== '' && anonKey !== ''
}

let client: SupabaseClient | null = null
/** 已建客户端对应的配置指纹（配置变了要重建） */
let clientFingerprint = ''

/**
 * 取 Supabase 客户端；未配置时返回 null（调用方走降级分支）。
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null

  const { url, anonKey } = readSupabaseEnv()
  const fingerprint = `${url}::${anonKey}`
  if (!client || clientFingerprint !== fingerprint) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
    clientFingerprint = fingerprint
  }
  return client
}

/** 取 Supabase 客户端；未配置时抛出带引导文案的错误（写操作入口用） */
export function requireSupabaseClient(): SupabaseClient {
  const resolved = getSupabaseClient()
  if (!resolved) throw new SupabaseUnavailableError()
  return resolved
}

/** 清空单例（测试与「切换 Supabase 项目」场景用） */
export function resetSupabaseClient(): void {
  client = null
  clientFingerprint = ''
}

/** 服务端实际开启的登录方式 */
export interface AuthProviders {
  email: boolean
  github: boolean
}

/**
 * 读取服务端真实开启的登录方式（`/auth/v1/settings`，公开接口）。
 *
 * 为什么需要：GitHub 没在 Supabase 后台开启时，按钮点了只会得到一个
 * `provider is not enabled` 的英文报错，用户完全不知道为什么。
 * 拿到配置就能直接不渲染那个按钮。
 *
 * 失败时返回 null（调用方按「未知」处理：按钮照常显示）——
 * 不能因为一次网络抖动把功能藏起来。
 */
export async function fetchAuthProviders(timeoutMs = 8000): Promise<AuthProviders | null> {
  const { url, anonKey } = readSupabaseEnv()
  if (!isSupabaseConfigured()) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      signal: controller.signal,
    })
    if (!response.ok) return null

    const data = (await response.json()) as { external?: Record<string, boolean> }
    const external = data.external ?? {}
    return {
      // email 默认视为开启：它是主流程，判定成 false 会导致登录页没有登录方式
      email: external.email !== false,
      github: external.github === true,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 连接自检结果 */
export interface ConnectionCheck {
  ok: boolean
  /** 面向用户的一句话结论 */
  message: string
  /** 技术细节（请求地址 / HTTP 状态），排查时有用 */
  detail: string
}

/**
 * 连接自检：直接打 Auth 服务的健康检查接口。
 *
 * 为什么需要它：`fetch` 抛出的 `TypeError: Failed to fetch` 会把
 * 「域名拼错 / DNS 解析不了 / 被网络拦截 / 密钥无效」全糊成一句「网络不可用」，
 * 用户完全没法自查。这里把「请求地址 + HTTP 状态」摊开，
 * 一眼就能区分是地址写错还是密钥不对。
 */
export async function checkSupabaseConnection(timeoutMs = 8000): Promise<ConnectionCheck> {
  const { url, anonKey } = readSupabaseEnv()
  if (!isSupabaseConfigured()) {
    return { ok: false, message: '未配置 Supabase（本地模式）', detail: SUPABASE_SETUP_HINT }
  }

  const target = `${url}/auth/v1/health`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(target, {
      headers: { apikey: anonKey },
      signal: controller.signal,
    })

    if (response.ok) {
      return { ok: true, message: '连接正常：Auth 服务可达', detail: target }
    }
    if (response.status === 401) {
      return {
        ok: false,
        message: '地址通了，但密钥无效：请回 API Keys 页重新复制完整的 publishable key',
        detail: `${target} → HTTP 401`,
      }
    }
    return {
      ok: false,
      message: `服务返回异常状态 HTTP ${response.status}`,
      detail: `${target} → HTTP ${response.status}`,
    }
  } catch (error) {
    const timedOut = (error as Error)?.name === 'AbortError'
    return {
      ok: false,
      message: timedOut
        ? '请求超时：地址可能不对，或当前网络访问不了 Supabase'
        : '连不上这个地址：多半是 Project URL 抄错了（域名不存在 / DNS 解析不了）或被网络拦截',
      detail: `请求地址：${target}`,
    }
  } finally {
    clearTimeout(timer)
  }
}
