/**
 * Cloudflare Turnstile 人机验证（第五阶段「注册安全增强」）
 *
 * **为什么是 Turnstile 而不是 canvas 自绘验证码**：自绘验证码的答案就在前端代码里
 * （`drawCaptcha` 和 `checkCaptcha` 用的是同一个随机串），只能防君子不防脚本；
 * Turnstile 的 token 由 Cloudflare 签发、**Supabase 在服务端拿 secretKey 核验**，
 * 前端伪造无效——而且 secretKey 全程不进前端、不需要 Serverless。
 *
 * 一次完整闭环（四步）：
 * 1. 渲染 widget（managed 模式：正常用户**无感通过**，可疑流量才弹交互挑战）
 * 2. 回调拿到**一次性** token → `supabase.auth.signUp({ captchaToken })`
 * 3. Supabase 服务端向 Cloudflare 核验 token
 * 4. 通过才建号并发出确认邮件
 *
 * ⚠️ 最容易漏的坑：**token 是一次性的**。注册失败（邮箱已存在、发信失败……）后
 * 必须 `reset()` 重新取 token，否则第二次提交必然被服务端拒掉。
 *
 * 降级原则（与「未配 Supabase 就进本地模式」同一套思路）：
 * - **没配 siteKey**：不渲染 widget、不拦注册（本地开发/没申请站点时不该把注册功能锁死）
 * - **配了但脚本加载失败**：`unavailable` → 注册按钮置灰并给出原因（不放行 = 不绕过服务端校验）
 */

import { computed, getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import type { InjectionKey } from 'vue'

/** 验证码状态机（规划里写的是 idle → verifying → passed / expired，这里补上降级与差错分支） */
export type TurnstileStatus =
  /** 未配置 siteKey：不验证、也不拦注册 */
  | 'disabled'
  /** 已配置但 widget 还没挂载 */
  | 'idle'
  /** CDN 脚本加载中 */
  | 'loading'
  /** widget 已渲染，等待通过（managed 模式通常瞬间过） */
  | 'verifying'
  /** 已拿到一次性 token */
  | 'passed'
  /** token 过期，需要重新验证 */
  | 'expired'
  /** widget 自身报错（可重试） */
  | 'error'
  /** 脚本加载失败（网络 / 被 CSP 拦）→ 注册按钮置灰并提示 */
  | 'unavailable'

/** Turnstile 官方脚本地址（显式渲染模式：挂载时机与容器都由我们自己控制） */
export const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** 脚本元素 id（复用/清理时按它找） */
export const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script'

/** 官方文档给的测试 siteKey：本地开发不必申请真钥匙（必过 / 必挡 / 强制交互） */
export const TURNSTILE_TEST_SITE_KEYS = {
  /** 总是通过（无感） */
  alwaysPass: '1x00000000000000000000AA',
  /** 总是通过（不可见） */
  alwaysPassInvisible: '1x00000000000000000000BB',
  /** 总是拦截（用于验证失败分支） */
  alwaysBlock: '2x00000000000000000000AB',
  /** 强制交互挑战（用于看挑战界面） */
  forceChallenge: '3x00000000000000000000FF',
} as const

/** widget 渲染参数（只声明我们用到的字段） */
export interface TurnstileRenderOptions {
  sitekey: string
  action?: string
  theme?: 'auto' | 'light' | 'dark'
  /** 验证通过：拿到一次性 token */
  callback: (token: string) => void
  /** token 过期（有效期约 5 分钟，也可能被 Cloudflare 提前作废） */
  'expired-callback': () => void
  /** 验证出错（网络、配置错误等） */
  'error-callback': () => void
}

/** 从 CDN 拿到的全局 API（只声明我们用到的三个方法） */
export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | number | undefined
  reset: (widgetId?: string | number) => void
  remove?: (widgetId?: string | number) => void
}

/** 脚本加载器（单测与组件测试靠它注入假实现，不必真的拉 CDN） */
export type TurnstileLoader = () => Promise<TurnstileApi>

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/** 注入键：测试用 `global.provide` 塞一个假 loader，生产走默认的 CDN 加载 */
export const TURNSTILE_LOADER_KEY: InjectionKey<TurnstileLoader> = Symbol('turnstile-loader')

/** 未配置 siteKey 时的说明（登录页会显示，避免用户以为"验证码坏了"） */
export const TURNSTILE_DISABLED_HINT = '未配置人机验证（VITE_TURNSTILE_SITE_KEY 为空），注册不校验'
/** 脚本加载失败时的说明（注册按钮会同时置灰） */
export const TURNSTILE_UNAVAILABLE_MESSAGE =
  '人机验证加载失败（网络不通或被浏览器拦截）。请点「重试」，或稍后再注册。'
/** widget 自身报错 */
export const TURNSTILE_ERROR_MESSAGE = '人机验证出错，请点「重试」重新验证。'
/** token 过期的说明 */
export const TURNSTILE_EXPIRED_MESSAGE = '验证已过期，正在重新验证…'

/** 读取公开 siteKey（空串 = 未配置 → 降级为不验证） */
export function readTurnstileSiteKey(): string {
  const env = import.meta.env ?? {}
  return String(env.VITE_TURNSTILE_SITE_KEY ?? '').trim()
}

/** 是否配置了 siteKey（登录页据此决定「注册按钮是否要看验证码脸色」） */
export function isTurnstileEnabled(): boolean {
  return readTurnstileSiteKey() !== ''
}

/** 加载中的 promise（多处挂载共用同一次请求；失败时清空以便重试） */
let scriptPromise: Promise<TurnstileApi> | null = null

/**
 * 把 script 标签插进文档的方式。
 *
 * 单独抽出来只有一个理由：**单测**。happy-dom 会把插进文档的外链脚本当成"真要加载"，
 * 于是 onerror（甚至"加载被禁用"）会在 `appendChild` 里**同步**触发，
 * 单测根本来不及自己 dispatchEvent 去驱动分支。测试里注入一个只做记录的 appender，
 * 就能完全掌控 load / error / timeout 三条路径。
 */
export type TurnstileScriptAppender = (script: HTMLScriptElement) => void

const appendToHead: TurnstileScriptAppender = (script) => {
  document.head.appendChild(script)
}

/**
 * 加载 Turnstile 的 CDN 脚本（单次、可重试）。
 * - 已经有 `window.turnstile` 直接返回
 * - 已有同 id 的 script 标签则复用它（换页/多次挂载不会重复插脚本）
 * - 超时（默认 10s）或 onerror 都算失败，并把 script 标签摘掉，让"重试"能真正重新请求
 */
export function loadTurnstileScript(
  timeoutMs = 10_000,
  append: TurnstileScriptAppender = appendToHead,
): Promise<TurnstileApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      timer = null
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }
    const fail = (message: string) => {
      cleanup()
      // 摘掉失败的标签：留着它浏览器不会重新请求同一个 src，"重试"就成了空转
      script.remove()
      reject(new Error(message))
    }
    function onLoad() {
      if (window.turnstile) {
        cleanup()
        resolve(window.turnstile)
        return
      }
      fail('Turnstile 脚本已加载但 API 不可用')
    }
    function onError() {
      fail('Turnstile 脚本加载失败')
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)

    if (!existing) {
      script.id = TURNSTILE_SCRIPT_ID
      script.src = TURNSTILE_SCRIPT_SRC
      script.async = true
      script.defer = true
      append(script)
    }

    timer = setTimeout(() => fail('Turnstile 脚本加载超时'), timeoutMs)
  })

  scriptPromise = promise
  // 失败要清缓存，否则"重试"会一直拿到同一个已拒绝的 promise。
  // 注意放在这里而不是 fail() 里：失败可能是 append 时**同步**触发的，
  // 那时 scriptPromise 还没被赋值，写在 fail 里会被随后的赋值覆盖掉。
  void promise.catch(() => {
    if (scriptPromise === promise) scriptPromise = null
  })

  return promise
}

/** 清掉脚本缓存（"重试"与测试用） */
export function resetTurnstileScript(): void {
  scriptPromise = null
  document.getElementById(TURNSTILE_SCRIPT_ID)?.remove()
}

export interface UseTurnstileOptions {
  /** 覆盖 siteKey（默认读 `VITE_TURNSTILE_SITE_KEY`） */
  siteKey?: string
  /** 覆盖加载器（单测注入） */
  loader?: TurnstileLoader
  /** widget 主题 */
  theme?: 'auto' | 'light' | 'dark'
  action?: string
}

/**
 * Turnstile 状态机。挂载/重置由调用方（`TurnstileCaptcha.vue`）驱动，
 * 组件卸载时自动 `dispose()`（避免 SPA 切页留下孤儿 widget）。
 */
export function useTurnstile(options: UseTurnstileOptions = {}) {
  const siteKey = (options.siteKey ?? readTurnstileSiteKey()).trim()
  const loader = options.loader ?? loadTurnstileScript
  const enabled = siteKey !== ''

  const status = ref<TurnstileStatus>(enabled ? 'idle' : 'disabled')
  /** 一次性 token（空串 = 还没有有效 token） */
  const token = ref('')
  /** 面向用户的说明（出错时才有值） */
  const message = ref('')

  let api: TurnstileApi | null = null
  let widgetId: string | number | undefined
  let container: HTMLElement | null = null

  /** 已验证通过（可以提交注册） */
  const passed = computed(() => status.value === 'passed' && token.value !== '')
  /** 需要拦提交：配了验证码但还没通过 */
  const blocked = computed(() => enabled && !passed.value)
  /** 处于"需要用户点重试"的差错态 */
  const failed = computed(() => status.value === 'error' || status.value === 'unavailable')

  function onPassed(next: string) {
    token.value = next
    status.value = 'passed'
    message.value = ''
  }

  function onExpired() {
    token.value = ''
    status.value = 'expired'
    message.value = TURNSTILE_EXPIRED_MESSAGE
  }

  function onError() {
    token.value = ''
    status.value = 'error'
    message.value = TURNSTILE_ERROR_MESSAGE
  }

  /** 渲染 widget 到指定容器 */
  async function mount(el: HTMLElement) {
    if (!enabled) return
    container = el
    token.value = ''
    message.value = ''
    status.value = 'loading'

    try {
      api = await loader()
      // 等待期间组件可能已卸载/切页，此时不该再往旧容器里渲染
      if (!container || container !== el) return
      widgetId = api.render(container, {
        sitekey: siteKey,
        theme: options.theme,
        action: options.action,
        callback: onPassed,
        'expired-callback': onExpired,
        'error-callback': onError,
      })
      status.value = 'verifying'
    } catch {
      status.value = 'unavailable'
      message.value = TURNSTILE_UNAVAILABLE_MESSAGE
    }
  }

  /** 丢弃当前 token 并重新验证（**注册失败后必须调用**：token 是一次性的） */
  function reset() {
    if (!enabled) return
    token.value = ''
    message.value = ''
    if (status.value === 'unavailable' || !api || widgetId === undefined) {
      // 脚本都没加载成功 / 还没有 widget：走完整重挂载（含重新拉脚本）
      void remount()
      return
    }
    status.value = 'verifying'
    api.reset(widgetId)
  }

  /** 重挂载：先摘掉旧 widget、清掉脚本缓存，再重新加载 */
  async function remount() {
    if (api && widgetId !== undefined && api.remove) api.remove(widgetId)
    widgetId = undefined
    resetTurnstileScript()
    if (container) await mount(container)
  }

  function dispose() {
    if (api && widgetId !== undefined && api.remove) api.remove(widgetId)
    widgetId = undefined
    container = null
  }

  // 只在组件 setup 里注册生命周期（单测直接调 useTurnstile 时没有实例，跳过即可）
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return {
    enabled,
    siteKey,
    status,
    token,
    message,
    passed,
    blocked,
    failed,
    mount,
    reset,
    remount,
    dispose,
  }
}
