/**
 * Agent 后端调用（原生 fetch，不引 axios —— 与 httpClient 同一条约定）。
 *
 * 两件必须自己写的事：
 * 1. **手写 SSE 解析**：`response.body.getReader()` + TextDecoder 增量解码，
 *    按 `\n\n` 切帧。EventSource 用不了——它只支持 GET，而问答要 POST 带 body；
 * 2. **把网络级错误翻译成人话**：后端没启动时 fetch 抛的是 `TypeError: Failed to fetch`，
 *    对用户毫无意义，这里统一翻成「连不上后端（是否已启动 yunhai-agent？）」。
 */

import type {
  AgentCitation,
  AgentDocument,
  AgentDoneStatus,
  AgentEvent,
  AgentFallback,
  AgentHealth,
  AgentIngestResult,
  AgentJob,
  AgentProposal,
  AgentRetrievalMode,
  AgentSession,
  AgentSessionDetail,
  AgentToolCall,
} from '@/types/agent'
import { normalizeAgentEndpoint } from '@/types/agent'

/** 后端返回的业务错误（带机器可读 code，前端据此做分支引导） */
export class AgentError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'agent_error', status = 0) {
    super(message)
    this.name = 'AgentError'
    this.code = code
    this.status = status
  }
}

/** 未配 Key 时的标识性 code（UI 依赖它给出「去后端 .env 配置」的引导） */
export const AGENT_NOT_CONFIGURED = 'llm_not_configured'
/** 连不上后端（不是后端报的错，是前端自己判定的） */
export const AGENT_UNREACHABLE = 'agent_unreachable'

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

interface AskPayload {
  question: string
  session_id?: string | null
  mode?: AgentRetrievalMode
  fallback_mode?: AgentFallback
  top_k?: number
  threshold?: number
  /**
   * 走哪条链路：`agent`（ReAct 循环 + 工具，后端默认）或 `rag`（第十阶段的固定检索直答）。
   * 第十一阶段起前端默认发 `agent`，否则 client 工具的回环永远不会触发。
   */
  strategy?: 'agent' | 'rag'
  /** 临时关掉工具（排障 / 让纯对话可验证），后端默认 true */
  tools_enabled?: boolean
}

export interface AskOptions {
  signal?: AbortSignal
}

/** 前端执行完一个 client 工具后回传给 `/api/ask/resume` 的观察结果 */
export interface AgentToolResultPayload {
  tool_call_id: string
  name: string
  ok: boolean
  /** 给模型看的文本观察结果（也是界面上那一行摘要） */
  summary: string
  result?: unknown
  error?: string
}

export interface ResumeAskPayload {
  /** 上一轮 done 事件里的 run_id（后端靠它取回这轮的 messages） */
  runId: string
  results: AgentToolResultPayload[]
}

// ---------------- 流式问答 ----------------

/**
 * 发一次问答，逐事件产出。
 *
 * 注意**流里的 error 事件不是异常**：后端刻意让 HTTP 保持 200 并把错误发在流里
 * （这样前端只有一条错误路径）。这里把 error 事件照样 yield 出去，
 * 由调用方决定是渲染成红色提示还是终止本轮。
 */
export async function* streamAsk(
  baseUrl: string,
  payload: AskPayload,
  options: AskOptions = {},
): AsyncGenerator<AgentEvent> {
  const base = normalizeAgentEndpoint(baseUrl)
  yield* readEventStream(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: payload.question,
      session_id: payload.session_id ?? null,
      mode: payload.mode ?? 'semantic',
      fallback_mode: payload.fallback_mode ?? null,
      top_k: payload.top_k ?? null,
      threshold: payload.threshold ?? null,
      // 显式写死成后端的默认值：这一层是"前端现在就走 agent 链路"的声明，
      // 将来要加「关掉工具」的开关也只改这里
      strategy: payload.strategy ?? 'agent',
      tools_enabled: payload.tools_enabled ?? true,
    }),
    signal: options.signal,
  })
}

/**
 * 前端跑完 client 工具后回来续跑同一轮（同一个 SSE 协议，同一套解析）。
 *
 * 与 `/api/ask` 的唯一区别是它带 `run_id`：后端把这轮的 messages 存在服务端，
 * 我们只回传"工具干了什么"。run 过期时后端返回 404 JSON，走的是同一条错误映射。
 */
export async function* resumeAsk(
  baseUrl: string,
  payload: ResumeAskPayload,
  options: AskOptions = {},
): AsyncGenerator<AgentEvent> {
  const base = normalizeAgentEndpoint(baseUrl)
  yield* readEventStream(`${base}/api/ask/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id: payload.runId, results: payload.results }),
    signal: options.signal,
  })
}

/**
 * SSE 读取循环（`/api/ask` 与 `/api/ask/resume` 共用）。
 *
 * 为什么单独抽出来：两条接口的"请求"不同但"读流"完全一样——
 * 增量解码 + 按 `\n\n` 切帧 + 收尾补一帧。复制第二份等于以后每个解析修复都要改两处。
 */
async function* readEventStream(url: string, init: RequestInit): AsyncGenerator<AgentEvent> {
  const response = await safeFetch(url, init)

  if (!response.ok) throw await toAgentError(response)
  if (!response.body) throw new AgentError('后端没有返回流式响应体（SSE 需要 HTTP/1.1 分块）')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = parseFrame(frame)
        if (event) yield event
        boundary = buffer.indexOf('\n\n')
      }
    }
    // 收尾：最后可能有一帧没有以空行结尾
    buffer += decoder.decode()
    const tail = parseFrame(buffer)
    if (tail) yield tail
  } finally {
    // 用户点了「停止」时主动取消，释放连接（否则后端会一直生成到结束）
    void reader.cancel().catch(() => undefined)
  }
}

/** 解析一帧 SSE；不认识的 event 或坏 JSON 一律忽略（前向兼容新事件） */
export function parseFrame(frame: string): AgentEvent | null {
  const lines = frame.split('\n')
  let name = ''
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!name || dataLines.length === 0) return null

  let data: Record<string, unknown>
  try {
    data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
  } catch {
    return null
  }

  switch (name) {
    case 'token':
      return { type: 'token', text: String(data.text ?? '') }
    case 'citation':
      return { type: 'citation', citation: data as unknown as AgentCitation }
    case 'tool_call':
      return { type: 'tool_call', call: toToolCall(data) }
    case 'tool_result':
      // 新协议把 id/name/ok/summary/error 平铺在 data 上；老协议曾把它们裹在 `call` 里，
      // 两种都认（`call` 存在时以它为准），历史事件才不会解析成空壳
      return {
        type: 'tool_result',
        call: toToolResultCall(isRecord(data.call) ? data.call : data),
        // 后端没有 result 字段——结构化结果在 `meta` 里（见 app/sse.py 的 tool_result_event）
        result: data.result ?? data.meta ?? null,
      }
    case 'proposal':
      return { type: 'proposal', proposal: data as unknown as AgentProposal }
    case 'done':
      return {
        type: 'done',
        sessionId: String(data.session_id ?? ''),
        runId: String(data.run_id ?? ''),
        messageId: String(data.message_id ?? ''),
        citations: (data.citations ?? []) as AgentCitation[],
        fallback: (data.fallback ?? 'kb') as AgentFallback,
        kind: String(data.kind ?? ''),
        hitCount: Number(data.hit_count ?? 0),
        latencyMs: Number(data.latency_ms ?? 0),
        status: (data.status ?? 'ok') as AgentDoneStatus,
        rounds: Number(data.rounds ?? 0),
        tokens: Number(data.tokens ?? 0),
        tools: toToolList(data.tools),
        pending: toToolList(data.pending),
      }
    case 'error':
      return {
        type: 'error',
        code: String(data.code ?? 'internal_error'),
        message: String(data.message ?? '后端返回了未说明的错误'),
      }
    default:
      // 后端将来加了新事件：老前端忽略即可，不该让整条流解析失败
      return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 事件里的工具对象 -> 领域对象；缺字段就留空，渲染层自己兜底 */
function toToolCall(data: Record<string, unknown>): AgentToolCall {
  const call: AgentToolCall = { name: String(data.name ?? '') }
  if (data.id !== undefined && data.id !== null) call.id = String(data.id)
  if (isRecord(data.arguments)) call.arguments = data.arguments
  if (data.executor === 'server' || data.executor === 'client') call.executor = data.executor
  if (data.status) call.status = data.status as AgentToolCall['status']
  if (data.summary) call.summary = String(data.summary)
  if (data.error) call.error = String(data.error)
  return call
}

/** `tool_result` 的 ok 布尔要翻译成调用状态，其余字段照收 */
function toToolResultCall(data: Record<string, unknown>): AgentToolCall {
  const call = toToolCall(data)
  if (typeof data.ok === 'boolean') call.status = data.ok ? 'ok' : 'error'
  return call
}

/**
 * `done.tools` / `done.pending` 里的条目。
 * pending 只有 id/name/arguments/executor，tools 多一个 ok（要翻成 status）——同一个解析器吃两种。
 */
function toToolList(value: unknown): AgentToolCall[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map(toToolResultCall)
}

// ---------------- 非流式接口 ----------------

export async function fetchHealth(baseUrl: string, options: AskOptions = {}): Promise<AgentHealth> {
  return request<AgentHealth>(`${normalizeAgentEndpoint(baseUrl)}/api/health`, {
    signal: options.signal,
  })
}

/** 真跑一次编码，确认向量模型可用（首次加载 bge 要几秒，让用户主动触发） */
export async function warmupEmbedder(
  baseUrl: string,
): Promise<{ status: string; embedder: string; dim: number }> {
  return request(`${normalizeAgentEndpoint(baseUrl)}/api/health/embedder`)
}

export async function listDocuments(
  baseUrl: string,
  options: AskOptions = {},
): Promise<{ documents: AgentDocument[]; total_chunks: number }> {
  return request(`${normalizeAgentEndpoint(baseUrl)}/api/documents`, { signal: options.signal })
}

export async function uploadDocument(baseUrl: string, file: File): Promise<AgentIngestResult> {
  const form = new FormData()
  form.append('file', file, file.name)
  return request<AgentIngestResult>(`${normalizeAgentEndpoint(baseUrl)}/api/documents`, {
    method: 'POST',
    body: form,
  })
}

export async function deleteDocument(
  baseUrl: string,
  docId: string,
): Promise<{ removed_chunks: number }> {
  return request(`${normalizeAgentEndpoint(baseUrl)}/api/documents/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
  })
}

export async function resetKnowledge(
  baseUrl: string,
): Promise<{ status: string; message: string }> {
  return request(`${normalizeAgentEndpoint(baseUrl)}/api/knowledge/reset`, { method: 'POST' })
}

export async function fetchJob(baseUrl: string, jobId: string): Promise<AgentJob> {
  return request(`${normalizeAgentEndpoint(baseUrl)}/api/jobs/${encodeURIComponent(jobId)}`)
}

export async function listSessions(
  baseUrl: string,
  options: AskOptions = {},
): Promise<AgentSession[]> {
  const data = await request<{ sessions: AgentSession[] }>(
    `${normalizeAgentEndpoint(baseUrl)}/api/sessions`,
    { signal: options.signal },
  )
  return data.sessions
}

export async function fetchSession(
  baseUrl: string,
  sessionId: string,
): Promise<AgentSessionDetail> {
  return request(`${normalizeAgentEndpoint(baseUrl)}/api/sessions/${encodeURIComponent(sessionId)}`)
}

export async function deleteSession(baseUrl: string, sessionId: string): Promise<void> {
  await request(
    `${normalizeAgentEndpoint(baseUrl)}/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
    },
  )
}

/**
 * 轮询异步入库任务直到结束（大文件走这条路）。
 * 上限默认 3 分钟：50 页 PDF 在 CPU 上做向量化大致就是这个量级。
 */
export async function pollJob(
  baseUrl: string,
  jobId: string,
  options: AskOptions & { timeoutMs?: number; intervalMs?: number } = {},
): Promise<AgentJob> {
  const timeoutMs = options.timeoutMs ?? 180_000
  const intervalMs = options.intervalMs ?? 1_200
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = await fetchJob(baseUrl, jobId)
    if (job.status === 'succeeded' || job.status === 'failed') return job
    if (Date.now() > deadline) {
      throw new AgentError('入库任务超时（后端可能仍在处理，稍后刷新文档列表看看）', 'job_timeout')
    }
    await delay(intervalMs, options.signal)
  }
}

// ---------------- 内部工具 ----------------

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await safeFetch(url, init)
  if (!response.ok) throw await toAgentError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** 统一的 fetch 包装：只负责把"连不上/被取消"翻译清楚 */
async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new AgentError(
      '连不上 Agent 后端：请确认 yunhai-agent 已启动（run.bat 或 uvicorn app.main:app --port 8000），并检查基地址',
      AGENT_UNREACHABLE,
    )
  }
}

async function toAgentError(response: Response): Promise<AgentError> {
  let code = `http_${response.status}`
  let message = `后端报错（HTTP ${response.status}）`
  try {
    const body = (await response.json()) as { code?: string; message?: string }
    if (body?.code) code = body.code
    if (body?.message) message = body.message
  } catch {
    // 非 JSON 响应（例如反向代理的 HTML 错误页）：保留状态码文案
  }
  return new AgentError(message, code, response.status)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // 轮询间隙里被取消（比如用户关掉侧栏）时要立刻退出，而不是等这一轮 sleep 走完
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
