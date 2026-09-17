/**
 * 知识库会话状态（第十阶段 10.4）。
 *
 * 为什么用 Pinia 而不是页面内的 ref：知识库页的侧栏（文档管理）与主区（对话）
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
  streamAsk,
  uploadDocument,
  warmupEmbedder,
} from '@/api/agent'
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
} from '@/types/agent'

export const AGENT_MODE_KEY = 'smart-workspace:agent-mode'
export const AGENT_FALLBACK_KEY = 'smart-workspace:agent-fallback'

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

  /** 发一问：先把用户消息与助手占位推上去，再逐事件填充 */
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
    try {
      const stream = streamAsk(
        endpoint.value,
        {
          question: text,
          session_id: activeSessionId.value,
          mode: mode.value,
          fallback_mode: fallbackMode.value,
        },
        { signal: controller.signal },
      )
      for await (const event of stream) {
        applyEvent(assistant, event)
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
        message.tools = [...(message.tools ?? []), event.call]
        break
      case 'tool_result': {
        const tools = [...(message.tools ?? [])]
        const index = tools.findIndex((tool) => tool.name === event.call.name)
        if (index >= 0) tools[index] = { ...tools[index], ...event.call }
        else tools.push(event.call)
        message.tools = tools
        break
      }
      case 'proposal':
        message.proposals = [...(message.proposals ?? []), event.proposal]
        break
      case 'done':
        message.citations = event.citations.length ? event.citations : message.citations
        message.fallback = event.fallback
        message.hitCount = event.hitCount
        message.latencyMs = event.latencyMs
        if (event.sessionId) activeSessionId.value = event.sessionId
        if (event.messageId) message.id = event.messageId
        message.streaming = false
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
