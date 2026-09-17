/**
 * Agent 后端调用层（第十阶段 10.4）。
 *
 * happy-dom 的 Response 对"流式 body"支持有限，所以这里用**手写的假响应**：
 * body.getReader() 按预置分片吐字节，正好用来验证「一帧被切成两半」这种真实情况——
 * 这是手写 SSE 解析最容易翻车的地方（分片边界落在 `\n\n` 中间）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AGENT_UNREACHABLE,
  AgentError,
  deleteDocument,
  deleteSession,
  fetchHealth,
  fetchJob,
  fetchSession,
  isAbortError,
  listDocuments,
  listSessions,
  parseFrame,
  pollJob,
  resetKnowledge,
  streamAsk,
  uploadDocument,
  warmupEmbedder,
} from './agent'

const encoder = new TextEncoder()

interface FakeChunk {
  done: boolean
  value?: Uint8Array
}

function fakeStreamResponse(chunks: string[], status = 200): Response {
  const queue = [...chunks]
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    body: {
      getReader: () => ({
        read: async (): Promise<FakeChunk> =>
          queue.length
            ? { done: false, value: encoder.encode(queue.shift() as string) }
            : { done: true },
        cancel: async () => undefined,
      }),
    },
  } as unknown as Response
}

function fakeJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => data,
  } as unknown as Response
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of generator) items.push(item)
  return items
}

describe('parseFrame', () => {
  it('token / citation / done / error 四类事件各自映射到领域对象', () => {
    expect(parseFrame('event: token\ndata: {"text":"你好"}')).toEqual({
      type: 'token',
      text: '你好',
    })

    const citation = parseFrame(
      'event: citation\ndata: {"index":1,"source":"手册.md","score":0.71,"snippet":"片段"}',
    )
    expect(citation).toMatchObject({ type: 'citation' })
    if (citation?.type === 'citation') {
      expect(citation.citation.source).toBe('手册.md')
      expect(citation.citation.score).toBe(0.71)
    }

    const done = parseFrame(
      'event: done\ndata: {"session_id":"s1","message_id":"m1","citations":[],"fallback":"kb","hit_count":2,"latency_ms":900}',
    )
    expect(done).toEqual({
      type: 'done',
      sessionId: 's1',
      messageId: 'm1',
      citations: [],
      fallback: 'kb',
      hitCount: 2,
      latencyMs: 900,
    })

    expect(parseFrame('event: error\ndata: {"code":"llm_error","message":"炸了"}')).toEqual({
      type: 'error',
      code: 'llm_error',
      message: '炸了',
    })
  })

  it('工具调用与文件提案事件也解析（第十一 / 十三阶段先备好）', () => {
    expect(parseFrame('event: tool_call\ndata: {"name":"search_knowledge"}')).toEqual({
      type: 'tool_call',
      call: { name: 'search_knowledge' },
    })
    expect(
      parseFrame(
        'event: tool_result\ndata: {"call":{"name":"get_date"},"result":{"today":"2026-09-17"}}',
      ),
    ).toEqual({
      type: 'tool_result',
      call: { name: 'get_date' },
      result: { today: '2026-09-17' },
    })
    const proposal = parseFrame('event: proposal\ndata: {"path":"a.md","diff":"+1"}')
    expect(proposal).toMatchObject({ type: 'proposal' })
  })

  it('未知事件、坏 JSON、缺字段一律忽略（后端加新事件不该让老前端挂掉）', () => {
    expect(parseFrame('event: 未来事件\ndata: {"a":1}')).toBeNull()
    expect(parseFrame('event: token\ndata: {坏 JSON')).toBeNull()
    expect(parseFrame('data: {"text":"缺 event"}')).toBeNull()
    expect(parseFrame('event: token')).toBeNull()
  })

  it('多行 data 会拼起来', () => {
    expect(parseFrame('event: token\ndata: {"text":\ndata: "多行"}')).toEqual({
      type: 'token',
      text: '多行',
    })
  })
})

describe('streamAsk', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('跨分片拼帧，逐事件产出', async () => {
    // 故意把第一帧的 `\n\n` 切成两半
    mockFetch(() =>
      fakeStreamResponse([
        'event: citation\ndata: {"index":1,"source":"手册.md","score":0.8,"snippet":"x"}\n',
        '\nevent: token\ndata: {"text":"分块"}\n\nevent: token\ndata: {"text":" 500"}\n\n',
        'event: done\ndata: {"session_id":"s1","message_id":"m1","citations":[],"fallback":"kb","hit_count":1,"latency_ms":120}',
      ]),
    )

    const events = await collect(
      streamAsk('http://127.0.0.1:8000/', { question: '分块多大？', mode: 'lexical', top_k: 2 }),
    )
    expect(events.map((event) => event.type)).toEqual(['citation', 'token', 'token', 'done'])
    expect(events[1]).toEqual({ type: 'token', text: '分块' })
  })

  it('请求体带上会话、策略与兜底模式，基地址去掉尾斜杠', async () => {
    const spy = mockFetch(() =>
      fakeStreamResponse(['event: done\ndata: {"fallback":"refuse"}\n\n']),
    )
    await collect(
      streamAsk('http://127.0.0.1:8000///', {
        question: '问题',
        session_id: 's9',
        mode: 'semantic',
        fallback_mode: 'bare',
        top_k: 3,
      }),
    )
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/api/ask')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      question: '问题',
      session_id: 's9',
      mode: 'semantic',
      fallback_mode: 'bare',
      top_k: 3,
    })
  })

  it('后端返回业务错误体时抛出带 code 的 AgentError', async () => {
    mockFetch(() =>
      fakeJsonResponse({ code: 'file_too_large', message: '文件超过 10MB 上限' }, 413),
    )
    await expect(collect(streamAsk('http://x', { question: 'q' }))).rejects.toMatchObject({
      code: 'file_too_large',
      message: '文件超过 10MB 上限',
      status: 413,
    })
  })

  it('非 JSON 错误体（反向代理 HTML）也给出状态码文案', async () => {
    mockFetch(
      () =>
        ({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error('不是 JSON')
          },
        }) as unknown as Response,
    )
    await expect(collect(streamAsk('http://x', { question: 'q' }))).rejects.toMatchObject({
      code: 'http_502',
      message: '后端报错（HTTP 502）',
    })
  })

  it('没有响应体时明确报错（SSE 需要分块传输）', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: null }) as unknown as Response)
    await expect(collect(streamAsk('http://x', { question: 'q' }))).rejects.toThrow('流式响应体')
  })

  it('连不上后端时翻译成人话（附启动提示）', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      collect(streamAsk('http://127.0.0.1:8000', { question: 'q' })),
    ).rejects.toMatchObject({
      code: AGENT_UNREACHABLE,
    })
    await expect(collect(streamAsk('http://127.0.0.1:8000', { question: 'q' }))).rejects.toThrow(
      /yunhai-agent/,
    )
  })

  it('取消（AbortError）原样抛出，不被包装成"连不上"', async () => {
    mockFetch(() => {
      throw new DOMException('aborted', 'AbortError')
    })
    try {
      await collect(streamAsk('http://x', { question: 'q' }))
      expect.unreachable('应当抛出')
    } catch (error) {
      expect(isAbortError(error)).toBe(true)
    }
  })
})

describe('非流式接口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('自检与向量模型自检', async () => {
    const spy = mockFetch((url) =>
      url.endsWith('/api/health')
        ? fakeJsonResponse({ status: 'ok', llm_configured: true, embedder: 'bge', chunks: 12 })
        : fakeJsonResponse({ status: 'ok', embedder: 'bge', dim: 512 }),
    )
    await expect(fetchHealth('http://127.0.0.1:8000')).resolves.toMatchObject({
      llm_configured: true,
      chunks: 12,
    })
    await expect(warmupEmbedder('http://127.0.0.1:8000/')).resolves.toEqual({
      status: 'ok',
      embedder: 'bge',
      dim: 512,
    })
    expect(spy.mock.calls[1][0]).toBe('http://127.0.0.1:8000/api/health/embedder')
  })

  it('文档列表 / 删除 / 清库 / 任务查询', async () => {
    const spy = mockFetch((url, init) => {
      if (init?.method === 'DELETE') return fakeJsonResponse({ doc_id: 'd1', removed_chunks: 7 })
      if (url.endsWith('/api/knowledge/reset'))
        return fakeJsonResponse({ status: 'ok', message: '已清空' })
      if (url.includes('/api/jobs/')) return fakeJsonResponse({ job_id: 'j1', status: 'running' })
      return fakeJsonResponse({ documents: [{ doc_id: 'd1', source: '手册.md' }], total_chunks: 7 })
    })

    const listed = await listDocuments('http://h')
    expect(listed.total_chunks).toBe(7)
    expect(listed.documents[0].source).toBe('手册.md')
    await expect(deleteDocument('http://h', 'd1')).resolves.toEqual({
      doc_id: 'd1',
      removed_chunks: 7,
    })
    await expect(resetKnowledge('http://h')).resolves.toMatchObject({ status: 'ok' })
    await expect(fetchJob('http://h', 'j1')).resolves.toMatchObject({ status: 'running' })
    expect(spy.mock.calls[1][0]).toBe('http://h/api/documents/d1')
  })

  it('上传用 multipart，文件名带进表单', async () => {
    const spy = mockFetch(() =>
      fakeJsonResponse({ status: 'done', document: null, job_id: null, message: '已入库' }),
    )
    const file = new File(['# 标题'], '手册.md', { type: 'text/markdown' })
    const result = await uploadDocument('http://h', file)
    expect(result.message).toBe('已入库')
    const body = spy.mock.calls[0][1]?.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('会话列表 / 详情 / 删除（204 无响应体也能正常收口）', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'DELETE') return { ok: true, status: 204 } as unknown as Response
      if (url.includes('/api/sessions/'))
        return fakeJsonResponse({ id: 's1', messages: [], title: '问题' })
      return fakeJsonResponse({ sessions: [{ id: 's1', title: '问题', message_count: 2 }] })
    })
    await expect(listSessions('http://h')).resolves.toHaveLength(1)
    await expect(fetchSession('http://h', 's1')).resolves.toMatchObject({ id: 's1' })
    await expect(deleteSession('http://h', 's1')).resolves.toBeUndefined()
  })

  it('轮询任务直到结束', async () => {
    let calls = 0
    mockFetch(() => {
      calls += 1
      return fakeJsonResponse({
        job_id: 'j1',
        status: calls < 3 ? 'running' : 'succeeded',
        result: { chunks: 4 },
      })
    })
    const job = await pollJob('http://h', 'j1', { intervalMs: 1 })
    expect(job.status).toBe('succeeded')
    expect(calls).toBe(3)
  })

  it('轮询超时给出可操作提示', async () => {
    mockFetch(() => fakeJsonResponse({ job_id: 'j1', status: 'running' }))
    await expect(pollJob('http://h', 'j1', { intervalMs: 1, timeoutMs: 1 })).rejects.toMatchObject({
      code: 'job_timeout',
    })
  })

  it('轮询期间可被取消', async () => {
    mockFetch(() => fakeJsonResponse({ job_id: 'j1', status: 'running' }))
    const controller = new AbortController()
    const promise = pollJob('http://h', 'j1', { intervalMs: 5, signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toSatisfy(isAbortError)
  })

  it('AgentError 带 code 与状态码', () => {
    const error = new AgentError('坏了', 'boom', 500)
    expect(error.name).toBe('AgentError')
    expect(error.code).toBe('boom')
    expect(error.status).toBe(500)
  })
})
