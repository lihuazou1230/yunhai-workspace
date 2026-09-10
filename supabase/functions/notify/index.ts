/**
 * Supabase Edge Function `notify` —— WxPusher 微信推送代理（第六阶段 6.5）
 *
 * 为什么必须有这一层：
 * GitHub Pages 是**纯静态托管，没有 Serverless Functions**；而 WxPusher 的 `appToken`
 * 是开发者凭证，一旦写进前端产物就等于公开（产物是任何人可下载的 JS，等于把推送额度
 * 送给全网）。所以服务端能力统一收口到 Supabase（第五阶段已引入 Auth/DB/Storage，
 * 不再引入第二个后端），由本函数在服务端把 appToken 拼进请求。
 *
 * 两个凭证分属两边：
 * - `WXPUSHER_APP_TOKEN`：本函数从 Edge Function Secrets 读取，**绝不进前端、绝不进日志**
 * - `uid`：用户扫码关注应用后拿到的**用户级**凭证（BYOK 存浏览器 localStorage），随请求带上来
 *
 * 防白嫖：函数内用调用者的 JWT 建一个 Supabase 客户端并 `auth.getUser()`，
 * 只有真实登录用户才放行。平台层的 JWT 校验默认也是开的（部署时**不要**加
 * `--no-verify-jwt`），两层叠加，避免有人把我们的函数当免费推送网关刷量。
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * CORS 头。
 *
 * 前端部署在 GitHub Pages（`https://<user>.github.io/<repo>/`），与本函数**不同源**，
 * 不带这些头浏览器会在预检阶段直接拦掉请求（用户只能看到一句看不懂的 CORS 报错）。
 * **错误响应也必须带上**：否则失败时前端拿不到我们写好的中文提示，只剩一个网络错误。
 *
 * `Allow-Origin: *` 足够且安全：浏览器对跨源 fetch 默认不带凭证，
 * 身份验证靠 `Authorization` 头里的 JWT（不是 Cookie），所以不需要 `Allow-Credentials`。
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

/** WxPusher 标准推送接口 */
const WXPUSHER_SEND_URL = 'https://wxpusher.zjiecode.com/api/send/message'

/**
 * 内容类型。
 *
 * ⚠️ 官方文档口径（docs/openapi.yaml 的 BaseMessage）是 **1 纯文本 / 2 HTML / 3 Markdown**，
 * 而不是某些二手资料写的「3 = HTML」。前端 `buildReminderMessage` 生成的是 HTML 片段，
 * 这里必须用 2；写成 3 的话微信收到的是 Markdown，正文会把 `<p>` 标签原样显示出来。
 * 参考：https://wxpusher.zjiecode.com/docs/api-reference.html
 */
const CONTENT_TYPE_HTML = 2

/** 业务成功码（HTTP 200 也可能是业务失败，必须再看 code） */
const WXPUSHER_OK_CODE = 1000

/** WxPusher 单次请求的超时：推送是并行旁路，不该让函数长时间挂着 */
const WXPUSHER_TIMEOUT_MS = 8_000

/** WxPusher 的 summary 上限 100 字符，超了会被截断/拒绝，这里先自己截 */
const SUMMARY_MAX_LENGTH = 100

/** uid 的长度上限：真 UID 约 28 位，给足余量的同时挡住超长垃圾串 */
const UID_MAX_LENGTH = 128

/** WxPusher 正文上限 40000 字符（官方限制，超限返回业务码 1001） */
const CONTENT_MAX_LENGTH = 40_000

/**
 * 统一 JSON 响应。
 * 错误一律用 `{ error: '<中文文案>' }`——前端据此直接展示，也用来判断「函数确实在应答」。
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** 从 Authorization 头里取出 Bearer token（大小写不敏感；没有就返回空串） */
function readBearerToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : ''
}

/**
 * 校验调用者身份：用 anon key + 调用者的 JWT 建客户端，再 `getUser(jwt)`。
 *
 * 为什么不是「解析一下 JWT 里的 sub」就完事：那样等于相信调用者自己声明的身份
 * （伪造 payload 的 token 也能过）。`getUser` 会拿 token 去 Auth 服务验签 + 查库，
 * 拿到的是**服务端确认过的**用户；顺便 token 过期/被吊销也会在这里被拒。
 *
 * 返回 null 表示未通过（调用方一律回 401）。
 */
async function resolveUser(req: Request): Promise<{ id: string } | null> {
  const jwt = readBearerToken(req)
  if (!jwt) return null

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !anonKey) return null

  const supabase = createClient(supabaseUrl, anonKey, {
    // 服务端一次性调用，不持久化会话、不自动刷新（Edge Function 是无状态的）
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data?.user) return null
  return { id: data.user.id }
}

/** 把 title 收敛成可用的通知栏摘要（空标题给兜底文案，超长先截断） */
function toSummary(title: unknown): string {
  const text = typeof title === 'string' ? title.trim() : ''
  return (text || '任务提醒').slice(0, SUMMARY_MAX_LENGTH)
}

/**
 * 读 WxPusher 的响应体。
 * 返回 null 表示响应不是 JSON（网关 502 页面之类），由调用方翻成中文错误。
 */
async function readWxPusherResult(
  response: Response,
): Promise<{ code?: number; msg?: string } | null> {
  try {
    return (await response.json()) as { code?: number; msg?: string }
  } catch {
    return null
  }
}

/**
 * 调 WxPusher 发送。返回 `null` 表示成功，否则返回面向用户的中文错误 + HTTP 状态。
 */
async function sendToWxPusher(params: {
  appToken: string
  uid: string
  content: string
  summary: string
  url: string
}): Promise<{ error: string; status: number } | null> {
  let response: Response
  try {
    response = await fetch(WXPUSHER_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appToken: params.appToken,
        /**
         * 字段名是 `uids`（数组），不是 `uid`。
         * 官方文档（openapi.yaml → StandardPushRequest）里 POST 的接收人字段只有 `uids`
         * 与 `topicIds`；单数的 `uid` 只存在于 GET 便捷接口的查询参数上。
         * 用错字段名 WxPusher 会直接回业务错误，消息发不出去。
         */
        uids: [params.uid],
        content: params.content,
        summary: params.summary,
        contentType: CONTENT_TYPE_HTML,
        url: params.url,
      }),
      // 超时兜底：WxPusher 偶尔会慢，函数不能无限等（平台本身也有执行时长上限）
      signal: AbortSignal.timeout(WXPUSHER_TIMEOUT_MS),
    })
  } catch {
    // 网络不通 / DNS / 超时都落这里；不回显底层错误，避免把内部细节抛给前端
    return { error: '微信推送服务暂时不可用，请稍后重试', status: 504 }
  }

  const payload = await readWxPusherResult(response)
  if (!payload) {
    return { error: '微信推送服务返回了无法识别的响应，请稍后重试', status: 502 }
  }

  /**
   * 关键：HTTP 200 不等于发送成功。WxPusher 用业务码表示结果，
   * 只有 1000 才是成功；其余（1001 通用错误 / 1002 未登录 / appToken 无效…）
   * 都必须当成失败回给前端——否则用户以为发出去了，其实什么都没收到。
   */
  if (payload.code !== WXPUSHER_OK_CODE) {
    const detail =
      typeof payload.msg === 'string' && payload.msg.trim() ? `：${payload.msg.trim()}` : ''
    return { error: `微信推送被拒绝${detail}`, status: 502 }
  }

  return null
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 预检请求不带 Authorization，走到下面的鉴权必然 401，所以在这里直接短路
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: '仅支持 POST 请求' }, 405)

  // 每次请求读一遍 env：本地 `supabase functions serve` 改 .env 后不必重启进程
  const appToken = (Deno.env.get('WXPUSHER_APP_TOKEN') ?? '').trim()
  if (!appToken) {
    /**
     * 没配 secret 属于「服务端没部署好」，不是调用者的错，所以回 503 而不是 4xx：
     * 前端可以据此提示「去设置 WXPUSHER_APP_TOKEN」，而不会误报成「UID 填错了」。
     */
    return json({ error: '服务端未配置 WXPUSHER_APP_TOKEN，微信推送不可用' }, 503)
  }

  const user = await resolveUser(req)
  if (!user) {
    return json({ error: '未登录或登录已过期，微信推送仅对登录用户开放' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400)
  }

  const uid = typeof body.uid === 'string' ? body.uid.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const url = typeof body.url === 'string' ? body.url.trim() : ''

  // 入参校验：这里只做「明显不合法」的拦截，具体格式由 WxPusher 自己判定
  if (!uid || uid.length > UID_MAX_LENGTH) {
    return json({ error: '缺少有效的接收人 UID（请在设置页粘贴扫码后获得的 UID）' }, 400)
  }
  if (!content) return json({ error: '推送内容不能为空' }, 400)
  if (content.length > CONTENT_MAX_LENGTH) return json({ error: '推送内容过长' }, 400)

  const failure = await sendToWxPusher({
    appToken,
    uid,
    content,
    summary: toSummary(body.title),
    url,
  })
  if (failure) {
    // 只记录「谁发的失败了」，绝不打印 appToken（日志会进 Supabase 控制台，等于半公开）
    console.error(`[notify] 微信推送失败 user=${user.id} uid=${uid} status=${failure.status}`)
    return json({ error: failure.error }, failure.status)
  }

  return json({ ok: true })
})
