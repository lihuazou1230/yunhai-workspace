/**
 * 微信推送代理的客户端（第六阶段 6.5）
 *
 * 前端只传 `{ uid, title, content, url }`：`uid` 是用户扫码后自备的**用户级**凭证（BYOK 存本地），
 * `appToken` 是**开发者**凭证，只存在于 Supabase Edge Function Secrets——
 * 因为 GitHub Pages 的产物是完全公开的，任何写进前端的密钥都等于公开。
 *
 * 本模块的函数**一律不抛异常**（`Promise` 也只在内部吞掉拒绝）：
 * 它挂在提醒调度器的路径上，推送失败最多是「少收一条微信」，
 * 绝不能让本地提醒（系统通知 + Toast + 铃铛红点）跟着一起崩。
 * 失败信息统一是可直接丢进 Toast 的中文文案。
 */

import { requireSupabaseClient } from './supabase'

/** Edge Function 名字（与 `supabase/functions/notify/index.ts` 的目录名一致） */
export const NOTIFY_FUNCTION_NAME = 'notify'

/** 代理请求体（字段与服务端入口一一对应） */
export interface NotifyPayload {
  uid: string
  title: string
  content: string
  /** 深链回应用对应任务（服务端原样转给微信通知的落地地址） */
  url?: string
}

/** 发送结果：`ok: false` 时 `error` 是给用户看的中文 */
export type NotifyResult = { ok: true } | { ok: false; error: string }

/** 面向用户的失败文案（集中一处，设置页与 Toast 共用同一口径） */
export const NOTIFY_MESSAGES = {
  unconfigured: '未配置 Supabase，微信推送不可用',
  unauthenticated: '请先登录：微信推送只对登录用户开放',
  notDeployed: '推送代理尚未部署：请先执行 supabase functions deploy notify',
  unavailable: '微信推送服务暂时不可用，请稍后重试',
} as const

/**
 * 请求超时。
 * 提醒路径上不能有「永远转圈」的请求：WxPusher 或网络卡住时，
 * 10 秒后直接按失败处理（本地提醒早就发出去了，不差这一条）。
 */
const NOTIFY_TIMEOUT_MS = 10_000

/** 探测（是否已部署）用的超时：设置页要快速给结论，不能等太久 */
const PROBE_TIMEOUT_MS = 6_000

/** supabase-js 的 FunctionsError 形状子集（只取我们判断用得到的字段） */
interface InvokeErrorLike {
  name?: string
  message?: string
  /** FunctionsHttpError / FunctionsRelayError 会把它设为原始 Response */
  context?: {
    status?: number
    json?: () => Promise<unknown>
  } | null
}

/** 取 HTTP 状态码（拿不到就返回 undefined，说明错误不是「服务端有应答」这一类） */
function invokeStatus(error: unknown): number | undefined {
  const status = (error as InvokeErrorLike)?.context?.status
  return typeof status === 'number' ? status : undefined
}

/**
 * 读服务端返回的错误文案（我们的函数错误一律是 `{ error: '<中文>' }`）。
 * 读不到就返回空串——**一个响应体只能读一次**，所以调用方读到的结果要复用，别反复调。
 */
async function readErrorBody(error: unknown): Promise<string> {
  const context = (error as InvokeErrorLike)?.context
  if (!context || typeof context.json !== 'function') return ''
  try {
    const body = (await context.json()) as { error?: unknown; message?: unknown } | null
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error.trim()
    if (body && typeof body.message === 'string' && body.message.trim()) return body.message.trim()
  } catch {
    // 响应体已被读过 / 不是 JSON：忽略，调用方退回通用文案
  }
  return ''
}

/**
 * 把 invoke 的失败翻译成中文。
 *
 * 分类依据（从可靠到不可靠依次退化）：
 * 1. HTTP 状态：404 = 函数不存在；401/403 = 没登录或会话过期
 * 2. 响应体：服务端自己写的中文（如「缺少有效的接收人 UID」「推送被拒绝：...」）——最有信息量
 * 3. 错误名/文案兜底：网络层失败、relay 失败等
 */
async function describeInvokeError(error: unknown): Promise<string> {
  const status = invokeStatus(error)

  if (status === 404) return NOTIFY_MESSAGES.notDeployed
  if (status === 401 || status === 403) return NOTIFY_MESSAGES.unauthenticated

  const serverMessage = await readErrorBody(error)
  if (serverMessage) return serverMessage

  const name = String((error as InvokeErrorLike)?.name ?? '')
  const raw = (error as InvokeErrorLike)?.message ?? (typeof error === 'string' ? error : '')
  const text = `${name} ${raw}`.toLowerCase()

  // 平台网关在函数不存在时用的是「Function not found」这类英文文案，不同版本措辞不一
  if (text.includes('not found') || text.includes('404')) return NOTIFY_MESSAGES.notDeployed
  // FunctionsFetchError / abort / 网络不通都落这里
  return NOTIFY_MESSAGES.unavailable
}

/**
 * 经 Supabase Edge Function 代理发一条微信推送。
 *
 * 成功只代表「服务端已受理」（WxPusher 是异步分发），不代表用户已经收到。
 * 任何失败都返回 `{ ok: false, error }`，**不抛异常**。
 */
export async function sendWxPusherViaProxy(payload: NotifyPayload): Promise<NotifyResult> {
  let client
  try {
    client = requireSupabaseClient()
  } catch {
    // 未配置 .env.local 时 requireSupabaseClient 会抛 SupabaseUnavailableError；
    // 它的引导文案太长，不适合塞进 Toast（设置页已有常驻引导），这里只说结论
    return { ok: false, error: NOTIFY_MESSAGES.unconfigured }
  }

  try {
    const { error } = await client.functions.invoke(NOTIFY_FUNCTION_NAME, {
      body: payload,
      timeout: NOTIFY_TIMEOUT_MS,
    })
    if (!error) return { ok: true }
    return { ok: false, error: await describeInvokeError(error) }
  } catch (error) {
    // 兜底：supabase-js 的 invoke 内部已经 catch 过，正常不会抛；
    // 但 SDK 升级 / 测试里的桩都可能抛，绝不能让异常穿透到提醒调度器
    return { ok: false, error: await describeInvokeError(error) }
  }
}

/**
 * 探测推送代理是否已部署（设置页用）。
 *
 * 手段是**故意发一个非法请求**（uid 为空），然后看对方怎么应答：
 * - `400` + JSON `{ error }` → 函数在，是它在做校验 → 已部署
 * - `401/403` → 请求到了函数但没通过鉴权（未登录）→ 函数也存在
 * - `5xx` → 函数在，只是自己出错了（比如 secret 没配）→ 仍算已部署
 * - `404` → 平台说「函数不存在」→ 未部署
 * - 网络不通 / 超时 → **无法判定**，按「不可用」返回 false
 *
 * 说实话这是个启发式：它只回答「函数在不在」，不回答「能不能发出去」
 * （比如 secret 没配，函数会回 503，这里仍算已部署——真正的失败由发送时那条中文错误暴露）。
 * 代价是设置页可能显示「已部署」而测试消息失败，但反过来（能发却提示没部署）更糟：
 * 会让用户去反复重新部署一个本来正常的函数。
 */
export async function isNotifyFunctionAvailable(): Promise<boolean> {
  let client
  try {
    client = requireSupabaseClient()
  } catch {
    return false
  }

  try {
    const { error } = await client.functions.invoke(NOTIFY_FUNCTION_NAME, {
      body: { uid: '', title: '', content: '' },
      timeout: PROBE_TIMEOUT_MS,
    })
    if (!error) return true

    const status = invokeStatus(error)
    if (status === 404) return false
    if (status === 400) {
      // 400 说明请求已经进到函数体（平台层鉴权失败回 401，路由不存在回 404）。
      // 再确认一次响应体是我们写的 JSON `{ error }`：这能把「我们的函数在应答」
      // 和「中间层自己生成的 400」区分开，后者不算部署成功。
      return (await readErrorBody(error)) !== ''
    }
    // 其它带状态码的应答（401 未登录 / 403 / 405 方法不对 / 5xx 服务端故障）
    // 都证明「函数在」，至于能不能发出去由真正的发送结果说话
    if (typeof status === 'number') return true

    // 没有 HTTP 状态：网络层失败 / relay 失败。此时「函数在不在」无从判断，
    // 返回 false 会误导用户再去部署一次，但返回 true 又会让他点了按钮才失败——
    // 两害相权取「按不可用处理」，文案里也提示了「稍后重试」。
    return false
  } catch {
    // 连请求都发不出去（网络 / SDK 异常）：判不了，按不可用处理
    return false
  }
}
