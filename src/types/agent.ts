/**
 * 知识库 / Agent 领域类型（第十阶段 10.4）。
 *
 * 分工：**后端 yunhai-agent 保管 Key、跑模型、管向量库；前端只做消费**。
 * 前端拿得到的只有三样东西：一个基地址、一条 SSE 事件流、一份自检信息。
 *
 * 事件协议一次定死七种事件（见后端 app/sse.py）：第十阶段只用到 token / citation / done / error，
 * 但 tool_call / tool_result / proposal 现在就进类型，
 * 这样第十一阶段的工具调用、第十三阶段的文件提案都不用再改前端的解析与渲染骨架。
 */

/** SSE 事件名（与后端 sse.py 常量一一对应） */
export type AgentEventName =
  'token' | 'tool_call' | 'tool_result' | 'citation' | 'proposal' | 'done' | 'error'

/** 引用来源块（后端按检索结果生成，不依赖模型自报编号） */
export interface AgentCitation {
  /** 与回答里的 [编号] 对应，从 1 起 */
  index: number
  source: string
  source_type: string
  doc_id: string
  chunk_index: number
  /** PDF 才有页码 */
  page: number | null
  /** 余弦相似度 / 归一化后的 BM25，0~1 */
  score: number
  snippet: string
}

/** 本轮回答的依据类型 */
export type AgentFallback = 'kb' | 'refuse' | 'bare' | 'web'

/** 检索策略（语义 / 字面，用于对比实验） */
export type AgentRetrievalMode = 'semantic' | 'lexical'

/** 工具调用过程（第十一阶段启用，类型先备好） */
export interface AgentToolCall {
  name: string
  args?: unknown
}

/** 文件变更提案（第十三阶段启用） */
export interface AgentProposal {
  path: string
  diff: string
  summary?: string
}

/** 一条解析好的流式事件 */
export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'citation'; citation: AgentCitation }
  | { type: 'tool_call'; call: AgentToolCall }
  | { type: 'tool_result'; call: AgentToolCall; result: unknown }
  | { type: 'proposal'; proposal: AgentProposal }
  | {
      type: 'done'
      sessionId: string
      messageId: string
      citations: AgentCitation[]
      fallback: AgentFallback
      hitCount: number
      latencyMs: number
    }
  | { type: 'error'; code: string; message: string }

/** 消息视图模型（前端渲染用，比后端记录多几个"这一刻"的状态位） */
export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: AgentCitation[]
  /** 依据类型：知识库 / 拒答 / 裸答 / 联网 */
  fallback?: AgentFallback
  /** 正在逐字渲染 */
  streaming?: boolean
  /** 流里收到的错误信息（渲染成一条红色提示，不弹全局 toast） */
  error?: string
  errorCode?: string
  hitCount?: number
  latencyMs?: number
  /**
   * 工具调用过程。第十阶段的回答里不会有，但事件一到就收下来，
   * 第十一阶段的 `BaseToolTag` 直接渲染这份数据，不用回头改 store。
   */
  tools?: AgentToolCall[]
  /** 文件变更提案（第十三阶段渲染 BaseDiffCard） */
  proposals?: AgentProposal[]
  createdAt: string
}

/** 知识库文档（侧栏清单） */
export interface AgentDocument {
  doc_id: string
  source: string
  source_type: string
  uploaded_at: string
  chunks: number
  pages: number | null
}

/** 后端自检信息 */
export interface AgentHealth {
  status: string
  version: string
  llm_configured: boolean
  llm_model: string
  embedder: string
  embedder_model: string
  /** 非空 = 后端正在降级运行（例如配了 bge 但没装依赖） */
  degraded_reason: string
  documents: number
  chunks: number
  lexical_chunks: number
  sources: string[]
  chunk_size: number
  chunk_overlap: number
  top_k: number
  score_threshold: number
  lexical_score_threshold: number
  fallback_mode: AgentFallback
}

/** 会话列表项 */
export interface AgentSession {
  id: string
  title: string
  mode: string
  created_at: string
  updated_at: string
  message_count: number
}

/** 会话里的消息记录（后端原样返回） */
export interface AgentMessageRecord {
  id: string
  session_id: string
  role: string
  content: string
  citations: AgentCitation[]
  meta: Record<string, unknown>
  created_at: string
}

export interface AgentSessionDetail extends AgentSession {
  messages: AgentMessageRecord[]
}

/** 上传结果 */
export interface AgentIngestResult {
  status: 'done' | 'queued'
  document: AgentDocument | null
  stats?: { documents: number; chunks: number; lexical_chunks: number } | null
  job_id: string | null
  message: string
}

/** 异步入库任务状态 */
export interface AgentJob {
  job_id: string
  name: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
  updated_at: string
}

/**
 * 后端基地址存在**本机**（不进账号同步清单）：
 * 它描述的是"我这台机器怎么连后端"，换台设备本来就该各填各的
 * （和天气缓存、侧边栏折叠状态同一类，见第九阶段 9.3 的分类）。
 */
export const AGENT_ENDPOINT_KEY = 'smart-workspace:agent-endpoint'

/** 默认连本机后端：开发期 uvicorn 默认端口 */
export const DEFAULT_AGENT_ENDPOINT = 'http://127.0.0.1:8000'

/** 检索策略的中文标签（对比实验时展示） */
export const AGENT_MODE_LABELS: Record<AgentRetrievalMode, string> = {
  semantic: '语义检索',
  lexical: '字面检索',
}

/** 依据类型的中文标签 */
export const AGENT_FALLBACK_LABELS: Record<AgentFallback, string> = {
  kb: '基于知识库',
  refuse: '知识库无相关内容',
  bare: '不基于知识库',
  web: '联网搜索（未接入）',
}

/** 与后端 config.py 对齐的上限，前端提前拦一次，避免白传 10MB */
export const AGENT_LIMITS = {
  maxQuestionLength: 2000,
  maxUploadBytes: 10 * 1024 * 1024,
  /** 超过它就转后台入库（后端 LARGE_FILE_BYTES） */
  largeFileBytes: 2 * 1024 * 1024,
  allowedExtensions: ['.pdf', '.md', '.markdown', '.txt', '.jsonl'],
} as const

/** 规范化基地址：去掉尾斜杠，空值回退默认（用户填了带斜杠的地址是常态） */
export function normalizeAgentEndpoint(input: string | undefined | null): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return DEFAULT_AGENT_ENDPOINT
  return trimmed.replace(/\/+$/, '')
}

/** 文件是否在后端白名单里（大小写不敏感） */
export function isAllowedAgentFile(name: string): boolean {
  const lowered = name.toLowerCase()
  return AGENT_LIMITS.allowedExtensions.some((ext) => lowered.endsWith(ext))
}
