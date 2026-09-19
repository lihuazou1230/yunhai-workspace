/**
 * agentStore（第十阶段 10.4）。
 *
 * 网络层整个被 mock：这里要验证的是**状态机**——
 * 流里的事件怎么落到消息上、失败时留住什么、取消时收口成什么样。
 * SSE 解析本身在 api/agent.spec.ts 里用假响应验过。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import {
  AgentError,
  deleteDocument,
  deleteSession,
  fetchHealth,
  fetchSession,
  listDocuments,
  listSessions,
  pollJob,
  resetKnowledge,
  resumeAsk,
  streamAsk,
  uploadDocument,
  warmupEmbedder,
} from '@/api/agent'
import { useAgentStore } from './agentStore'
import { doneEvent, streamOf } from '@/test/agentFixtures'
import { AGENT_ENDPOINT_KEY, DEFAULT_AGENT_ENDPOINT } from '@/types/agent'
import type { AgentEvent, AgentHealth } from '@/types/agent'

vi.mock('@/api/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/agent')>()
  return {
    ...actual,
    fetchHealth: vi.fn(),
    warmupEmbedder: vi.fn(),
    listDocuments: vi.fn(),
    uploadDocument: vi.fn(),
    deleteDocument: vi.fn(),
    resetKnowledge: vi.fn(),
    listSessions: vi.fn(),
    fetchSession: vi.fn(),
    deleteSession: vi.fn(),
    pollJob: vi.fn(),
    streamAsk: vi.fn(),
    resumeAsk: vi.fn(),
  }
})

const HEALTH: AgentHealth = {
  status: 'ok',
  version: '0.1.0',
  llm_configured: true,
  llm_model: 'deepseek-chat',
  embedder: 'bge',
  embedder_model: 'BAAI/bge-small-zh-v1.5',
  degraded_reason: '',
  documents: 3,
  chunks: 42,
  lexical_chunks: 42,
  sources: ['手册.md'],
  chunk_size: 500,
  chunk_overlap: 80,
  top_k: 4,
  score_threshold: 0.45,
  lexical_score_threshold: 0.35,
  fallback_mode: 'refuse',
}

const DOC = {
  doc_id: 'd1',
  source: '手册.md',
  source_type: 'md',
  uploaded_at: '2026-09-17T10:00:00',
  chunks: 12,
  pages: null,
}

function store() {
  return useAgentStore()
}

/**
 * 让出**一个宏任务**。
 * 流式用例里必须先确保生成器已经把 abort 监听挂上，再调 stop()——
 * 只等微任务时，`yield` 之后的挂载还没完成，abort 会被漏掉（表现为用例超时）。
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  setActivePinia(createPinia())
  window.localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(listSessions).mockResolvedValue([])
  vi.mocked(listDocuments).mockResolvedValue({ documents: [], total_chunks: 0 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('连接与自检', () => {
  it('自检成功：拿到模型与库信息，视为可达', async () => {
    vi.mocked(fetchHealth).mockResolvedValue(HEALTH)
    const agent = store()
    await expect(agent.checkHealth()).resolves.toBe(true)
    expect(agent.reachable).toBe(true)
    expect(agent.llmConfigured).toBe(true)
    expect(agent.embedderReady).toBe(true)
    expect(agent.connectionError).toBe('')
  })

  it('自检失败：留下人话错误，且不假装连着', async () => {
    vi.mocked(fetchHealth).mockRejectedValue(
      new AgentError('连不上 Agent 后端：请确认 yunhai-agent 已启动'),
    )
    const agent = store()
    await expect(agent.checkHealth()).resolves.toBe(false)
    expect(agent.reachable).toBe(false)
    expect(agent.connectionError).toContain('yunhai-agent')
  })

  it('哈希向量（降级）时不算"模型就绪"，要用户手动加载', async () => {
    vi.mocked(fetchHealth).mockResolvedValue({ ...HEALTH, embedder: 'hash' })
    const agent = store()
    await agent.checkHealth()
    expect(agent.embedderReady).toBe(false)
  })

  it('向量模型自检：成功记文案，失败记错误', async () => {
    vi.mocked(warmupEmbedder).mockResolvedValue({ status: 'ok', embedder: 'bge', dim: 512 })
    const agent = store()
    await agent.warmup()
    expect(agent.embedderReady).toBe(true)
    expect(agent.uploadHint).toContain('512 维')

    vi.mocked(warmupEmbedder).mockRejectedValue(new AgentError('向量模型加载失败：没有 torch'))
    await agent.warmup()
    expect(agent.connectionError).toContain('torch')
    expect(agent.warmingUp).toBe(false)
  })
})

describe('配置项（本机）', () => {
  it('基地址规范化后落 localStorage，空值回退默认', async () => {
    const agent = store()
    agent.setEndpoint('http://192.168.1.9:8000///')
    expect(agent.endpoint).toBe('http://192.168.1.9:8000')
    agent.setEndpoint('')
    expect(agent.endpoint).toBe(DEFAULT_AGENT_ENDPOINT)
    // useLocalStorage 的落盘在 watch 回调里（pre-flush），要等一个 tick 才写进存储
    await nextTick()
    expect(window.localStorage.getItem(AGENT_ENDPOINT_KEY)).toContain(DEFAULT_AGENT_ENDPOINT)
  })

  it('检索策略与兜底模式可切换并持久化', async () => {
    const agent = store()
    agent.setMode('lexical')
    agent.setFallbackMode('bare')
    expect(agent.mode).toBe('lexical')
    expect(agent.fallbackMode).toBe('bare')
    await nextTick()
    expect(window.localStorage.getItem('smart-workspace:agent-mode')).toBe('"lexical"')
  })
})

describe('文档管理', () => {
  it('刷新清单：成功写入列表，失败留下错误', async () => {
    vi.mocked(listDocuments).mockResolvedValue({ documents: [DOC], total_chunks: 12 })
    const agent = store()
    await agent.refreshDocuments()
    expect(agent.documents).toHaveLength(1)
    expect(agent.totalChunks).toBe(12)

    vi.mocked(listDocuments).mockRejectedValue(new AgentError('后端报错（HTTP 500）'))
    await agent.refreshDocuments()
    expect(agent.documentsError).toContain('500')
    expect(agent.documentsLoading).toBe(false)
  })

  it('上传前先拦类型与大小（省一次白传）', async () => {
    const agent = store()
    const bad = new File(['x'], '图.png', { type: 'image/png' })
    await expect(agent.upload(bad)).resolves.toBe(false)
    expect(agent.documentsError).toContain('不支持的文件类型')
    expect(uploadDocument).not.toHaveBeenCalled()

    const huge = new File(['x'], '大.md')
    Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 })
    await expect(agent.upload(huge)).resolves.toBe(false)
    expect(agent.documentsError).toContain('10MB')
  })

  it('小文件同步入库：提示后端返回的文案并刷新清单', async () => {
    vi.mocked(uploadDocument).mockResolvedValue({
      status: 'done',
      document: DOC,
      stats: { documents: 1, chunks: 12, lexical_chunks: 12 },
      job_id: null,
      message: '已入库',
    })
    vi.mocked(listDocuments).mockResolvedValue({ documents: [DOC], total_chunks: 12 })
    const agent = store()
    await expect(agent.upload(new File(['x'], '手册.md'))).resolves.toBe(true)
    expect(agent.uploadHint).toContain('已入库')
    expect(agent.documents).toHaveLength(1)
    expect(agent.uploading).toBe(false)
  })

  it('大文件走异步：轮询成功后照样收口', async () => {
    vi.mocked(uploadDocument).mockResolvedValue({
      status: 'queued',
      document: null,
      job_id: 'j1',
      message: '已转后台',
    })
    vi.mocked(pollJob).mockResolvedValue({
      job_id: 'j1',
      name: 'ingest',
      status: 'succeeded',
      result: { chunks: 900 },
      error: null,
      created_at: '',
      updated_at: '',
    })
    const agent = store()
    await expect(agent.upload(new File(['x'], '大文档.pdf'))).resolves.toBe(true)
    expect(agent.uploadHint).toContain('已入库')
  })

  it('异步入库失败：把后端的失败原因原样说清', async () => {
    vi.mocked(uploadDocument).mockResolvedValue({
      status: 'queued',
      document: null,
      job_id: 'j1',
      message: '',
    })
    vi.mocked(pollJob).mockResolvedValue({
      job_id: 'j1',
      name: 'ingest',
      status: 'failed',
      result: null,
      error: '文件里没有可入库的文本',
      created_at: '',
      updated_at: '',
    })
    const agent = store()
    await expect(agent.upload(new File(['x'], '扫描件.pdf'))).resolves.toBe(false)
    expect(agent.documentsError).toContain('没有可入库的文本')
  })

  it('上传抛错（后端未启动）也能给出可读信息', async () => {
    vi.mocked(uploadDocument).mockRejectedValue(new AgentError('连不上 Agent 后端'))
    const agent = store()
    await expect(agent.upload(new File(['x'], '手册.md'))).resolves.toBe(false)
    expect(agent.documentsError).toContain('连不上')
  })

  it('删除文档：从列表里移除并刷新', async () => {
    vi.mocked(listDocuments).mockResolvedValue({ documents: [DOC], total_chunks: 12 })
    const agent = store()
    await agent.refreshDocuments()
    vi.mocked(deleteDocument).mockResolvedValue({ removed_chunks: 12 })
    vi.mocked(listDocuments).mockResolvedValue({ documents: [], total_chunks: 0 })
    await agent.removeDocument('d1')
    expect(agent.documents).toHaveLength(0)
    expect(agent.uploadHint).toContain('12 块向量')
  })

  it('删除失败时不静默：错误留在侧栏', async () => {
    vi.mocked(deleteDocument).mockRejectedValue(new AgentError('文档不存在'))
    const agent = store()
    await agent.removeDocument('d1')
    expect(agent.documentsError).toContain('文档不存在')
  })

  it('清空知识库：成功清列表，失败留错误', async () => {
    vi.mocked(resetKnowledge).mockResolvedValue({ status: 'ok', message: '已清空' })
    const agent = store()
    await agent.clearKnowledge()
    expect(agent.documents).toEqual([])
    expect(agent.uploadHint).toContain('已清空')

    vi.mocked(resetKnowledge).mockRejectedValue(new AgentError('后端报错（HTTP 500）'))
    await agent.clearKnowledge()
    expect(agent.documentsError).toContain('500')
  })
})

describe('会话', () => {
  it('列表加载失败不影响问答主流程（静默保留旧数据）', async () => {
    vi.mocked(listSessions).mockResolvedValue([
      {
        id: 's1',
        title: '分块多大？',
        mode: 'semantic',
        created_at: '',
        updated_at: '',
        message_count: 2,
      },
    ])
    const agent = store()
    await agent.loadSessions()
    expect(agent.sessions).toHaveLength(1)

    vi.mocked(listSessions).mockRejectedValue(new AgentError('炸了'))
    await agent.loadSessions()
    expect(agent.sessions).toHaveLength(1)
  })

  it('打开历史会话：把记录映射回消息（含引用、依据、耗时）', async () => {
    vi.mocked(fetchSession).mockResolvedValue({
      id: 's1',
      title: '分块',
      mode: 'semantic',
      created_at: '',
      updated_at: '',
      message_count: 2,
      messages: [
        {
          id: 'm1',
          session_id: 's1',
          role: 'user',
          content: '分块多大？',
          citations: [],
          meta: {},
          created_at: '',
        },
        {
          id: 'm2',
          session_id: 's1',
          role: 'assistant',
          content: '500 字符 [1]',
          citations: [
            {
              index: 1,
              source: '手册.md',
              source_type: 'md',
              doc_id: 'd1',
              chunk_index: 0,
              page: null,
              score: 0.7,
              snippet: 'x',
            },
          ],
          meta: { fallback: 'kb', hits: [0.7, 0.6], latency_ms: 800 },
          created_at: '',
        },
      ],
    })
    const agent = store()
    await agent.openSession('s1')
    expect(agent.activeSessionId).toBe('s1')
    expect(agent.messages).toHaveLength(2)
    expect(agent.messages[1].fallback).toBe('kb')
    expect(agent.messages[1].hitCount).toBe(2)
    expect(agent.messages[1].latencyMs).toBe(800)
  })

  it('打开会话失败：错误提示，不切当前会话', async () => {
    vi.mocked(fetchSession).mockRejectedValue(new AgentError('会话不存在'))
    const agent = store()
    await agent.openSession('nope')
    expect(agent.connectionError).toContain('会话不存在')
    expect(agent.activeSessionId).toBeNull()
  })

  it('删除会话：列表移除；删的是当前会话就清空对话', async () => {
    vi.mocked(fetchSession).mockResolvedValue({
      id: 's1',
      title: 't',
      mode: 'semantic',
      created_at: '',
      updated_at: '',
      message_count: 0,
      messages: [],
    })
    vi.mocked(deleteSession).mockResolvedValue(undefined)
    const agent = store()
    agent.sessions = [
      { id: 's1', title: 't', mode: 'semantic', created_at: '', updated_at: '', message_count: 0 },
    ]
    await agent.openSession('s1')
    await agent.removeSession('s1')
    expect(agent.sessions).toHaveLength(0)
    expect(agent.activeSessionId).toBeNull()

    vi.mocked(deleteSession).mockRejectedValue(new AgentError('后端报错（HTTP 500）'))
    await agent.removeSession('s2')
    expect(agent.connectionError).toContain('500')
  })

  it('新会话清空当前上下文', () => {
    const agent = store()
    agent.activeSessionId = 's1'
    agent.messages = [{ id: 'x', role: 'user', content: 'q', citations: [], createdAt: '' }]
    agent.newSession()
    expect(agent.activeSessionId).toBeNull()
    expect(agent.hasMessages).toBe(false)
  })
})

describe('问答', () => {
  it('命中知识库：引用、token、done 依次落到同一条消息上', async () => {
    const citation = {
      index: 1,
      source: '手册.md',
      source_type: 'md',
      doc_id: 'd1',
      chunk_index: 0,
      page: null,
      score: 0.72,
      snippet: '片段',
    }
    vi.mocked(streamAsk).mockImplementation(
      streamOf([
        { type: 'citation', citation },
        { type: 'token', text: '分块默认 ' },
        { type: 'token', text: '500 字符。[1]' },
        doneEvent({
          messageId: 'm2',
          citations: [citation],
          fallback: 'kb',
          hitCount: 3,
          latencyMs: 640,
        }),
      ]) as never,
    )

    const agent = store()
    await agent.ask('分块多大？')

    expect(agent.messages).toHaveLength(2)
    expect(agent.messages[0].role).toBe('user')
    const answer = agent.messages[1]
    expect(answer.content).toBe('分块默认 500 字符。[1]')
    expect(answer.citations).toHaveLength(1)
    expect(answer.fallback).toBe('kb')
    expect(answer.hitCount).toBe(3)
    expect(answer.latencyMs).toBe(640)
    expect(answer.streaming).toBe(false)
    expect(answer.id).toBe('m2')
    expect(agent.activeSessionId).toBe('s1')
    expect(agent.streaming).toBe(false)
    // 正常收口（status: 'ok'）不需要前端执行任何工具，也就不会续跑
    expect(resumeAsk).not.toHaveBeenCalled()
  })

  it('把当前会话、策略、兜底模式带给后端', async () => {
    vi.mocked(streamAsk).mockImplementation(
      streamOf([doneEvent({ messageId: 'm', fallback: 'refuse', latencyMs: 5 })]) as never,
    )
    const agent = store()
    agent.activeSessionId = 's9'
    agent.setMode('lexical')
    agent.setFallbackMode('bare')
    await agent.ask('  问点什么  ')
    const [, payload] = vi.mocked(streamAsk).mock.calls[0]
    expect(payload).toMatchObject({
      question: '问点什么',
      session_id: 's9',
      mode: 'lexical',
      fallback_mode: 'bare',
      // strategy / tools_enabled 由 api/agent 这一层补默认值（agent 链路 + 开工具），
      // 这里 streamAsk 被 mock 掉了，所以它的默认值在 api/agent.spec.ts 里断言
    })
  })

  it('空问题与超长问题都不发请求', async () => {
    const agent = store()
    await agent.ask('   ')
    expect(streamAsk).not.toHaveBeenCalled()

    await agent.ask('甲'.repeat(2001))
    expect(streamAsk).not.toHaveBeenCalled()
    expect(agent.messages[0].error).toContain('问题太长')
  })

  it('流里的 error 事件渲染成消息级错误，不弹全局提示', async () => {
    vi.mocked(streamAsk).mockImplementation(
      streamOf([{ type: 'error', code: 'llm_error', message: 'LLM 账户余额不足' }]) as never,
    )
    const agent = store()
    await agent.ask('问题')
    expect(agent.messages[1].error).toContain('余额不足')
    expect(agent.messages[1].errorCode).toBe('llm_error')
    expect(agent.streaming).toBe(false)
  })

  it('未配 Key（llm_not_configured）时同时写进连接提示，便于页面引导', async () => {
    vi.mocked(streamAsk).mockImplementation(
      streamOf([
        { type: 'error', code: 'llm_not_configured', message: '后端未配置 LLM Key' },
      ]) as never,
    )
    const agent = store()
    await agent.ask('问题')
    expect(agent.connectionError).toContain('LLM Key')
  })

  it('请求抛错（后端没起）也收口成消息级错误', async () => {
    vi.mocked(streamAsk).mockImplementation(() => {
      throw new AgentError('连不上 Agent 后端')
    })
    const agent = store()
    await agent.ask('问题')
    expect(agent.messages[1].error).toContain('连不上')
    expect(agent.streaming).toBe(false)
  })

  it('工具调用与文件提案事件被收进消息（为第十一 / 十三阶段预留）', async () => {
    vi.mocked(streamAsk).mockImplementation(
      streamOf([
        { type: 'tool_call', call: { name: 'search_knowledge' } },
        { type: 'tool_result', call: { name: 'search_knowledge' }, result: { hits: 2 } },
        { type: 'tool_call', call: { name: 'get_date' } },
        { type: 'proposal', proposal: { path: 'a.md', diff: '+1' } },
        { type: 'token', text: '好了' },
      ]) as never,
    )
    const agent = store()
    await agent.ask('问题')
    const answer = agent.messages[1]
    expect(answer.tools?.map((tool) => tool.name)).toEqual(['search_knowledge', 'get_date'])
    expect(answer.proposals).toHaveLength(1)
  })

  it('停止生成：中断流并收口，已有内容保留', async () => {
    vi.mocked(streamAsk).mockImplementation(async function* (
      _base: string,
      _payload: unknown,
      options?: { signal?: AbortSignal },
    ) {
      yield { type: 'token', text: '已经出了一半' } as AgentEvent
      await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })
    } as never)

    const agent = store()
    const pending = agent.ask('问题')
    await tick()
    expect(agent.streaming).toBe(true)
    agent.stop()
    await pending
    expect(agent.messages[1].content).toBe('已经出了一半')
    expect(agent.messages[1].streaming).toBe(false)
    expect(agent.streaming).toBe(false)
  })

  it('还没出字就停止：给一个"已停止"的明确回执', async () => {
    vi.mocked(streamAsk).mockImplementation(async function* (
      _base: string,
      _payload: unknown,
      options?: { signal?: AbortSignal },
    ) {
      await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })
      yield { type: 'token', text: '不会到' } as AgentEvent
    } as never)

    const agent = store()
    const pending = agent.ask('问题')
    await tick()
    agent.stop()
    await pending
    expect(agent.messages[1].content).toBe('（已停止）')
  })

  it('正在流式输出时忽略新的提问（避免两条回答交叉写进一条消息）', async () => {
    vi.mocked(streamAsk).mockImplementation(async function* (
      _base: string,
      _payload: unknown,
      options?: { signal?: AbortSignal },
    ) {
      yield { type: 'token', text: '第一段' } as AgentEvent
      await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })
    } as never)

    const agent = store()
    const pending = agent.ask('第一问')
    await tick()
    await agent.ask('第二问')
    agent.stop()
    await pending
    expect(vi.mocked(streamAsk)).toHaveBeenCalledTimes(1)
  })
})
