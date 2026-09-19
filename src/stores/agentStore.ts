/**
 * AI 助手会话状态（第十阶段 10.4）。
 *
 * 为什么用 Pinia 而不是页面内的 ref：AI 助手页的侧栏（文档管理）与主区（对话）
 * 是两个有机体，中间还夹着会话切换；状态放 store 才不会出现
 * 「侧栏刷新了文档、主区还在用旧清单」这类不同步。
 *
 * 基地址、检索策略、兜底模式三项存**本机** localStorage：
 * 它们描述的是"这台机器怎么连后端"，属于第九阶段 9.3 里"留在本机"的那一类，
 * 不扩账号同步清单（那个清单是 16 项，改它要动 supabase 的类型与自检）。
 */

import { computed, ref } from 'vue'

import { defineStore } from 'pinia'

import {
  AGENT_NOT_CONFIGURED,
  AgentError,
  deleteDocument,
  deleteSession,
  fetchHealth,
  fetchSession,
  isAbortError,
  listDocuments,
  listSessions,
  pollJob,
  resetKnowledge,
  resumeAsk,
  streamAsk,
  uploadDocument,
  warmupEmbedder,
} from '@/api/agent'
import type { AgentToolResultPayload } from '@/api/agent'
import { runClientTool } from '@/agent/clientTools'
import { useLocalStorage } from '@/composables/useLocalStorage'
import {
  AGENT_ENDPOINT_KEY,
  AGENT_LIMITS,
  DEFAULT_AGENT_ENDPOINT,
  isAllowedAgentFile,
  normalizeAgentEndpoint,
} from '@/types/agent'
import type {
  AgentChatMessage,
  AgentDocument,
  AgentEvent,
  AgentFallback,
  AgentHealth,
  AgentRetrievalMode,
  AgentSession,
  AgentToolCall,
} from '@/types/agent'

export const AGENT_MODE_KEY = 'smart-workspace:agent-mode'
export const AGENT_FALLBACK_KEY = 'smart-workspace:agent-fallback'

/**
 * 前端工具回环的安全上限（轮）。
 *
 * 后端自己有轮数护栏，但那是"模型又调了一次工具"的次数；这里限制的是
 * **resume 往返次数**——万一后端状态、run_id 或 pending 出了什么岔子，
 * 前端必须能自己收口，而不是无限地"执行工具 → 续跑"把页面卡死。
 */
const MAX_RESUME_ROUNDS = 5

/**
 * 待续跑的 run_id：**模块内、不持久化**。
 * 它只在一次 ask() 的生命周期里有意义（页面一刷新，后端那边的 run 也过期了），
 * 存进 localStorage 只会留下一份永远用不上的脏数据。
 */
let pendingRunId: string | null = null

function nowIso(): string {
  return new Date().toISOString()
}

function localId(): string {
  return `local-${Math.random().toString(36).slice(2, 10)}`
}

export const useAgentStore = defineStore('agent', () => {
  // ---------- 连接配置（本机） ----------
  const endpoint = useLocalStorage<string>(AGENT_ENDPOINT_KEY, DEFAULT_AGENT_ENDPOINT)
  const mode = useLocalStorage<AgentRetrievalMode>(AGENT_MODE_KEY, 'semantic')
  const fallbackMode = useLocalStorage<AgentFallback>(AGENT_FALLBACK_KEY, 'refuse')

  // ---------- 自检 ----------
  const health = ref<AgentHealth | null>(null)
  const checking = ref(false)
  const connectionError = ref('')
  const warmingUp = ref(false)
  const embedderReady = ref(false)

  /** 后端活着但没配 Key：UI 要显示「去后端 .env 配置」而不是「启动后端」 */
  const llmConfigured = computed(() => health.value?.llm_configured ?? false)
  const reachable = computed(() => health.value !== null)

  // ---------- 文档 ----------
  const documents = ref<AgentDocument[]>([])
  const documentsLoading = ref(false)
  const uploading = ref(false)
  const uploadHint = ref('')
  const documentsError = ref('')

  // ---------- 会话 ----------
  const sessions = ref<AgentSession[]>([])
  const activeSessionId = ref<string | null>(null)
  const messages = ref<AgentChatMessage[]>([])
  const streaming = ref(false)
  let controller: AbortController | null = null

  const hasMessages = computed(() => messages.value.length > 0)
  const totalChunks = computed(
    () => health.value?.chunks ?? documents.value.reduce((sum, d) => sum + d.chunks, 0),
  )

  // ---------- 连接 ----------

  function setEndpoint(value: string) {
    endpoint.value = normalizeAgentEndpoint(value)
  }

  function setMode(value: AgentRetrievalMode) {
    mode.value = value
  }

  function setFallbackMode(value: AgentFallback) {
    fallbackMode.value = value
  }

  /** 打一次 /api/health：拿到 Key 状态、模型名、文档数、阈值 */
  async function checkHealth(): Promise<boolean> {
    checking.value = true
    connectionError.value = ''
    try {
      health.value = await fetchHealth(endpoint.value)
      embedderReady.value = health.value.embedder !== 'hash'
      return true
    } catch (error) {
      health.value = null
      connectionError.value = describe(error)
      return false
    } finally {
      checking.value = false
    }
  }

  /** 主动跑一次向量编码（bge 首次加载慢，让用户自己触发并看到结果） */
  async function warmup(): Promise<void> {
    warmingUp.value = true
    connectionError.value = ''
    try {
      const result = await warmupEmbedder(endpoint.value)
      embedderReady.value = true
      uploadHint.value = `向量模型可用（${result.embedder}，${result.dim} 维）`
    } catch (error) {
      connectionError.value = describe(error)
    } finally {
      warmingUp.value = false
    }
  }

  // ---------- 文档 ----------

  async function refreshDocuments(): Promise<void> {
    documentsLoading.value = true
    documentsError.value = ''
    try {
      const data = await listDocuments(endpoint.value)
      documents.value = data.documents
      if (health.value) health.value.chunks = data.total_chunks
    } catch (error) {
      documentsError.value = describe(error)
    } finally {
      documentsLoading.value = false
    }
  }

  /**
   * 上传入库。
   * 前端先按白名单与 10MB 拦一次（省一次白传），后端还会再拦一次（真正的边界在服务端）。
   */
  async function upload(file: File): Promise<boolean> {
    uploadHint.value = ''
    documentsError.value = ''
    if (!isAllowedAgentFile(file.name)) {
      documentsError.value = `不支持的文件类型：${file.name}（仅支持 ${AGENT_LIMITS.allowedExtensions.join(' / ')}）`
      return false
    }
    if (file.size > AGENT_LIMITS.maxUploadBytes) {
      documentsError.value = `文件超过 10MB 上限：${file.name}`
      return false
    }

    uploading.value = true
    try {
      const result = await uploadDocument(endpoint.value, file)
      if (result.status === 'queued' && result.job_id) {
        uploadHint.value = `${file.name} 较大，已转后台入库…`
        const job = await pollJob(endpoint.value, result.job_id)
        if (job.status !== 'succeeded') {
          documentsError.value = `后台入库失败：${job.error ?? '未知原因'}`
          return false
        }
        uploadHint.value = `${file.name} 已入库`
      } else {
        uploadHint.value = `${file.name}：${result.message}`
      }
      await refreshDocuments()
      return true
    } catch (error) {
      documentsError.value = describe(error)
      return false
    } finally {
      uploading.value = false
    }
  }

  async function removeDocument(docId: string): Promise<void> {
    documentsError.value = ''
    try {
      const result = await deleteDocument(endpoint.value, docId)
      documents.value = documents.value.filter((doc) => doc.doc_id !== docId)
      uploadHint.value = `已删除该文档的 ${result.removed_chunks} 块向量`
      await refreshDocuments()
    } catch (error) {
      documentsError.value = describe(error)
    }
  }

  async function clearKnowledge(): Promise<void> {
    documentsError.value = ''
    try {
      await resetKnowledge(endpoint.value)
      documents.value = []
      uploadHint.value = '向量库已清空（换 embedding 模型后必须重建）'
      await refreshDocuments()
    } catch (error) {
      documentsError.value = describe(error)
    }
  }

  // ---------- 会话 ----------

  async function loadSessions(): Promise<void> {
    try {
      sessions.value = await listSessions(endpoint.value)
    } catch {
      // 历史列表拉不到不该影响问答主流程：静默保留旧列表
    }
  }

  function newSession() {
    activeSessionId.value = null
    messages.value = []
  }

  async function openSession(sessionId: string): Promise<void> {
    if (streaming.value) return
    try {
      const detail = await fetchSession(endpoint.value, sessionId)
      activeSessionId.value = detail.id
      messages.value = detail.messages.map((record) => ({
        id: record.id,
        role: record.role === 'user' ? 'user' : 'assistant',
        content: record.content,
        citations: record.citations ?? [],
        fallback: (record.meta?.fallback as AgentFallback | undefined) ?? undefined,
        hitCount: Array.isArray(record.meta?.hits) ? record.meta.hits.length : undefined,
        latencyMs: typeof record.meta?.latency_ms === 'number' ? record.meta.latency_ms : undefined,
        createdAt: record.created_at,
      }))
    } catch (error) {
      connectionError.value = describe(error)
    }
  }

  async function removeSession(sessionId: string): Promise<void> {
    try {
      await deleteSession(endpoint.value, sessionId)
      sessions.value = sessions.value.filter((session) => session.id !== sessionId)
      if (activeSessionId.value === sessionId) newSession()
    } catch (error) {
      connectionError.value = describe(error)
    }
  }

  // ---------- 问答 ----------

  /**
   * 发一问并驱动**完整的 client 工具回环**。
   *
   * 一轮问答可能不止一条流：后端跑到 client 工具（task_crud / get_weather）时会发
   * `done.status = 'awaiting_client'` 停下来，把要执行的调用放在 `pending` 里。
   * 前端执行完这些工具，带 run_id 调 `/api/ask/resume` 让它接着想——
   * 如此往复，直到收到 `ok`（正常答完）或 `guardrail`（撞上限后的诚实收尾）。
   *
   * 三条要点：
   * 1. 所有事件都落到**同一条**助手消息上：用户看到的是一个连续的回答，
   *    而不是"每续跑一次就多一个气泡"；
   * 2. 工具结果同时写进 `message.tools`，界面上的 BaseToolTag 立刻能看到执行结果
   *    （后端不会为 client 工具再发 tool_result 事件，它只把结果记进 done.tools）；
   * 3. 第一段流与后续每段 resume 共用同一个 AbortController，所以「停止」随时管用。
   */
  async function ask(question: string): Promise<void> {
    const text = question.trim()
    if (!text || streaming.value) return
    if (text.length > AGENT_LIMITS.maxQuestionLength) {
      messages.value.push({
        id: localId(),
        role: 'assistant',
        content: '',
        citations: [],
        error: `问题太长（上限 ${AGENT_LIMITS.maxQuestionLength} 字）`,
        errorCode: 'question_too_long',
        createdAt: nowIso(),
      })
      return
    }

    messages.value.push({
      id: localId(),
      role: 'user',
      content: text,
      citations: [],
      createdAt: nowIso(),
    })
    const assistant: AgentChatMessage = {
      id: localId(),
      role: 'assistant',
      content: '',
      citations: [],
      streaming: true,
      createdAt: nowIso(),
    }
    messages.value.push(assistant)

    streaming.value = true
    controller = new AbortController()
    const signal = controller.signal
    pendingRunId = null

    try {
      let stream = streamAsk(
        endpoint.value,
        {
          question: text,
          session_id: activeSessionId.value,
          mode: mode.value,
          fallback_mode: fallbackMode.value,
        },
        { signal },
      )

      for (let round = 0; ; round += 1) {
        // done 只会出现在一条流的末尾；只有 awaiting_client 那条才算"还没答完、要前端接活"
        let pending: AgentToolCall[] = []
        for await (const event of stream) {
          applyEvent(assistant, event)
          if (event.type === 'done' && event.status === 'awaiting_client') {
            pending = event.pending ?? []
          }
        }

        if (assistant.status !== 'awaiting_client' || pending.length === 0) break

        if (round >= MAX_RESUME_ROUNDS) {
          assistant.error = `工具调用往返超过 ${MAX_RESUME_ROUNDS} 轮仍未收口，已停下：可以把问题拆小一点再问`
          assistant.errorCode = 'tool_round_limit'
          break
        }

        const results: AgentToolResultPayload[] = []
        for (const call of pending) {
          const result = await runClientTool({
            id: call.id ?? '',
            name: call.name,
            arguments: call.arguments,
          })
          results.push(result)
          recordToolResult(assistant, result)
        }

        // 用户在"前端跑工具"这段时间里点了停止：别再发 resume 了
        if (signal.aborted) break
        if (!pendingRunId) {
          assistant.error = '后端没有返回 run_id，无法把工具结果送回去续跑'
          assistant.errorCode = 'missing_run_id'
          break
        }

        stream = resumeAsk(endpoint.value, { runId: pendingRunId, results }, { signal })
      }
    } catch (error) {
      if (isAbortError(error)) {
        assistant.content = assistant.content || '（已停止）'
      } else {
        assistant.error = describe(error)
        assistant.errorCode = error instanceof AgentError ? error.code : 'agent_error'
      }
    } finally {
      assistant.streaming = false
      streaming.value = false
      controller = null
      pendingRunId = null
      void loadSessions()
    }
  }

  /** 一个事件怎么落到消息上（集中在一处，测试也好断言） */
  function applyEvent(message: AgentChatMessage, event: AgentEvent) {
    switch (event.type) {
      case 'token':
        message.content += event.text
        break
      case 'citation':
        message.citations.push(event.citation)
        break
      case 'tool_call':
        // 同一轮里工具是"先发 tool_call 再发 tool_result"，按 id 并回去才不会出现两个标签
        upsertTool(message, event.call)
        break
      case 'tool_result': {
        const existing = (message.tools ?? []).find((tool) => sameTool(tool, event.call))
        // `result` 单独带在事件上（后端把结构化结果放在 meta 里），合并时别把它冲掉
        upsertTool(message, { ...existing, ...event.call, result: event.result })
        break
      }
      case 'proposal':
        message.proposals = [...(message.proposals ?? []), event.proposal]
        break
      case 'done':
        message.citations = event.citations.length ? event.citations : message.citations
        message.fallback = event.fallback
        message.kind = event.kind
        message.status = event.status
        message.hitCount = event.hitCount
        message.latencyMs = event.latencyMs
        message.rounds = event.rounds
        message.tokens = event.tokens
        // done.tools 是这一轮的权威清单（含前端跑完的 client 工具），按 id 并进来补齐
        for (const tool of event.tools ?? []) upsertTool(message, tool)
        if (event.sessionId) activeSessionId.value = event.sessionId
        if (event.messageId) message.id = event.messageId
        pendingRunId = event.runId || null
        // awaiting_client 不是终点：工具还要在本地跑、还要续跑，光标继续闪
        message.streaming = event.status === 'awaiting_client'
        break
      case 'error':
        message.error = event.message
        message.errorCode = event.code
        message.streaming = false
        if (event.code === AGENT_NOT_CONFIGURED) {
          connectionError.value = event.message
        }
        break
    }
  }

  /** 把前端执行 client 工具的结果落到消息上（后端不会再为它发 tool_result 事件） */
  function recordToolResult(
    message: AgentChatMessage,
    result: {
      tool_call_id: string
      name: string
      ok: boolean
      summary: string
      result?: unknown
      error?: string
    },
  ) {
    const existing = (message.tools ?? []).find(
      (tool) =>
        (result.tool_call_id && tool.id === result.tool_call_id) || tool.name === result.name,
    )
    upsertTool(message, {
      ...existing,
      id: result.tool_call_id || existing?.id,
      name: result.name,
      status: result.ok ? 'ok' : 'error',
      summary: result.summary,
      error: result.error,
      result: result.result,
    })
  }

  /** 同一个工具调用的判定：有 id 认 id，没有就退回名字（老事件没有 id） */
  function sameTool(a: AgentToolCall, b: AgentToolCall): boolean {
    if (a.id && b.id) return a.id === b.id
    return !!a.name && a.name === b.name
  }

  /**
   * 按 id（其次按名字）合并一条工具调用，**顺序保持不变**。
   * 顺序稳定很重要：用户读的是"先查知识库、再记了条任务"这个故事，乱序就等于说谎。
   */
  function upsertTool(message: AgentChatMessage, tool: AgentToolCall) {
    const tools = [...(message.tools ?? [])]
    const index = tools.findIndex((item) => sameTool(item, tool))
    if (index >= 0) tools[index] = { ...tools[index], ...tool }
    else tools.push(tool)
    message.tools = tools
  }

  /** 停止生成：中断 fetch，后端也会随之停止（连接断掉即取消） */
  function stop() {
    controller?.abort()
    controller = null
    streaming.value = false
  }

  function describe(error: unknown): string {
    if (error instanceof AgentError) return error.message
    if (error instanceof Error) return error.message
    return '未知错误'
  }

  return {
    // 配置
    endpoint,
    mode,
    fallbackMode,
    setEndpoint,
    setMode,
    setFallbackMode,
    // 自检
    health,
    checking,
    connectionError,
    llmConfigured,
    reachable,
    warmingUp,
    embedderReady,
    checkHealth,
    warmup,
    // 文档
    documents,
    documentsLoading,
    uploading,
    uploadHint,
    documentsError,
    totalChunks,
    refreshDocuments,
    upload,
    removeDocument,
    clearKnowledge,
    // 会话
    sessions,
    activeSessionId,
    messages,
    hasMessages,
    streaming,
    loadSessions,
    newSession,
    openSession,
    removeSession,
    ask,
    stop,
  }
})
