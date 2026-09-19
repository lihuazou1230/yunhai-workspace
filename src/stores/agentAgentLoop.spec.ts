/**
 * agentStore 的 **client 工具回环**（第十一阶段 11.1）。
 *
 * 网络层只 mock 到两条流（streamAsk / resumeAsk），`runClientTool` 用**真的**——
 * 这里要验证的正是"store 把事件、工具执行、续跑串成一条助手消息"这件事：
 * 换了假执行器就等于把被测对象挖空了。
 *
 * 与 agentStore.spec.ts 的分工：那边管状态机（事件怎么落到消息上、错误与取消），
 * 这边只管多轮往返。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { AgentError, listSessions, resumeAsk, streamAsk } from '@/api/agent'
import { doneEvent, streamOf } from '@/test/agentFixtures'
import { useAgentStore } from './agentStore'
import { useTodoStore } from './todoStore'
import { DEFAULT_AGENT_ENDPOINT } from '@/types/agent'
import type { AgentEvent, AgentToolCall } from '@/types/agent'

vi.mock('@/api/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/agent')>()
  return {
    ...actual,
    streamAsk: vi.fn(),
    resumeAsk: vi.fn(),
    listSessions: vi.fn(),
  }
})

const TOOL_ID = 'call-1'
const RUN_ID = 'run-1'

/** 后端的第一段：说了半句 → 要前端建任务 → 停在 awaiting_client */
function firstRound(): AgentEvent[] {
  const pending: AgentToolCall = {
    id: TOOL_ID,
    name: 'task_crud',
    arguments: { action: 'create', title: '交周报', due_date: '2026-03-01', priority: 'high' },
    executor: 'client',
  }
  return [
    { type: 'token', text: '我先把这条记下来。' },
    { type: 'tool_call', call: { ...pending, status: 'awaiting_client' } },
    doneEvent({
      runId: RUN_ID,
      messageId: '',
      status: 'awaiting_client',
      tools: [],
      pending: [pending],
    }),
  ]
}

/** 续跑那一段：把话说完并正常收口 */
function secondRound(patch: Partial<Extract<AgentEvent, { type: 'done' }>> = {}): AgentEvent[] {
  return [
    { type: 'token', text: '已经建好了。' },
    doneEvent({
      runId: RUN_ID,
      messageId: 'm-final',
      status: 'ok',
      kind: 'tool',
      fallback: 'tool',
      rounds: 1,
      tokens: 42,
      // 后端 run.tools 里回带一次（只有 ok/error，没有摘要），按 id 并回去才能补齐结果
      tools: [{ id: TOOL_ID, name: 'task_crud', status: 'ok', executor: 'client' }],
      ...patch,
    }),
  ]
}

/** 让出一个宏任务：等 store 走到"前端执行工具/发 resume"那一步 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function agent() {
  return useAgentStore()
}

function todos() {
  return useTodoStore()
}

beforeEach(() => {
  setActivePinia(createPinia())
  window.localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(listSessions).mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client 工具回环', () => {
  it('跑工具 → 续跑 → 全部落在同一条助手消息上', async () => {
    vi.mocked(streamAsk).mockImplementation(streamOf(firstRound()) as never)
    vi.mocked(resumeAsk).mockImplementation(streamOf(secondRound()) as never)

    const store = agent()
    await store.ask('帮我把交周报记下来，3 月 1 号截止')

    // (a) 真的在工作台数据上执行了
    const created = todos().todos[0]
    expect(created.title).toBe('交周报')
    expect(created.dueDate).toBe('2026-03-01')
    expect(created.priority).toBe('high')

    // (b) 带对的 run_id 与观察结果回去了
    expect(resumeAsk).toHaveBeenCalledTimes(1)
    const [baseUrl, payload, options] = vi.mocked(resumeAsk).mock.calls[0]
    expect(baseUrl).toBe(DEFAULT_AGENT_ENDPOINT)
    expect(payload.runId).toBe(RUN_ID)
    expect(payload.results).toHaveLength(1)
    expect(payload.results[0]).toMatchObject({
      tool_call_id: TOOL_ID,
      name: 'task_crud',
      ok: true,
    })
    expect(payload.results[0].summary).toContain(`已创建任务「交周报」（id=${created.id}`)
    expect(payload.results[0].result).toMatchObject({ id: created.id })
    expect(options?.signal).toBeInstanceOf(AbortSignal)

    // (c) 两段流的 token 拼在同一条消息里，不是两个气泡
    expect(store.messages).toHaveLength(2)
    const answer = store.messages[1]
    expect(answer.content).toBe('我先把这条记下来。已经建好了。')
    expect(answer.id).toBe('m-final')
    expect(answer.status).toBe('ok')
    expect(answer.kind).toBe('tool')
    expect(answer.tokens).toBe(42)
    expect(answer.streaming).toBe(false)

    // (d) 工具调用与它的结果都记在消息上，顺序稳定、不重复
    expect(answer.tools).toHaveLength(1)
    expect(answer.tools?.[0]).toMatchObject({
      id: TOOL_ID,
      name: 'task_crud',
      executor: 'client',
      status: 'ok',
      arguments: { action: 'create', title: '交周报' },
    })
    expect(answer.tools?.[0].summary).toContain('已创建任务「交周报」')
    expect(answer.tools?.[0].result).toMatchObject({ id: created.id })

    expect(store.streaming).toBe(false)
  })

  it('工具失败也照样回传（ok:false 是观察结果，不是中断）', async () => {
    vi.mocked(streamAsk).mockImplementation(
      streamOf([
        {
          type: 'tool_call',
          call: {
            id: TOOL_ID,
            name: 'task_crud',
            arguments: { action: 'create' },
            executor: 'client',
            status: 'awaiting_client',
          },
        },
        doneEvent({
          runId: RUN_ID,
          status: 'awaiting_client',
          pending: [{ id: TOOL_ID, name: 'task_crud', arguments: { action: 'create' } }],
        }),
      ]) as never,
    )
    vi.mocked(resumeAsk).mockImplementation(
      streamOf(
        secondRound({
          status: 'guardrail',
          kind: 'guardrail',
          fallback: 'guardrail',
          tools: [{ id: TOOL_ID, name: 'task_crud', status: 'error', executor: 'client' }],
        }),
      ) as never,
    )

    const store = agent()
    await store.ask('随便记一条')

    const payload = vi.mocked(resumeAsk).mock.calls[0][1]
    expect(payload.results[0].ok).toBe(false)
    expect(payload.results[0].error).toContain('缺少 title')
    // 缺参数不会写进工作台
    expect(todos().todos).toHaveLength(0)
    expect(store.messages[1].tools?.[0].status).toBe('error')
    expect(store.messages[1].tools?.[0].error).toContain('缺少 title')
    expect(store.messages[1].fallback).toBe('guardrail')
  })

  it('服务端工具结果按 id 并进同一条记录（不会出现两个标签）', async () => {
    vi.mocked(streamAsk).mockImplementation(
      streamOf([
        {
          type: 'tool_call',
          call: { id: 's1', name: 'search_knowledge', arguments: { query: '分块' } },
        },
        {
          type: 'tool_result',
          call: { id: 's1', name: 'search_knowledge', status: 'ok', summary: '命中 2 块' },
          result: { hits: 2 },
        },
        { type: 'tool_call', call: { id: 's2', name: 'get_date' } },
        doneEvent({ tools: [{ id: 's2', name: 'get_date', status: 'ok', executor: 'server' }] }),
      ]) as never,
    )

    const store = agent()
    await store.ask('分块多大？')

    const tools = store.messages[1].tools ?? []
    expect(tools.map((tool) => tool.id)).toEqual(['s1', 's2'])
    expect(tools[0]).toMatchObject({ status: 'ok', summary: '命中 2 块', result: { hits: 2 } })
    expect(tools[1].status).toBe('ok')
    expect(resumeAsk).not.toHaveBeenCalled()
  })

  it('续跑失败（run 过期 / 中途断流）→ 消息级错误，不假装成功', async () => {
    vi.mocked(streamAsk).mockImplementation(streamOf(firstRound()) as never)
    vi.mocked(resumeAsk).mockImplementation(async function* () {
      yield { type: 'token', text: '我再确认一下' } as AgentEvent
      throw new AgentError('这一轮已经过期了', 'run_not_found', 404)
    } as never)

    const store = agent()
    await store.ask('帮我把交周报记下来')

    const answer = store.messages[1]
    // 已出的字保留，错误附在同一条消息上
    expect(answer.content).toBe('我先把这条记下来。我再确认一下')
    expect(answer.error).toContain('已经过期')
    expect(answer.errorCode).toBe('run_not_found')
    expect(answer.streaming).toBe(false)
    expect(store.streaming).toBe(false)
    // 工具确实执行过了：错误只影响后续推理，不该回滚用户的数据
    expect(todos().todos).toHaveLength(1)
  })

  it('后端一直要工具 → 到上限就收口（不会无限续跑）', async () => {
    vi.mocked(streamAsk).mockImplementation(streamOf(firstRound()) as never)
    // 每次续跑都要前端再执行一次工具，永远不收口
    vi.mocked(resumeAsk).mockImplementation(
      streamOf([
        {
          type: 'tool_call',
          call: {
            id: TOOL_ID,
            name: 'task_crud',
            arguments: { action: 'list' },
            executor: 'client',
            status: 'awaiting_client',
          },
        },
        doneEvent({
          runId: RUN_ID,
          status: 'awaiting_client',
          pending: [{ id: TOOL_ID, name: 'task_crud', arguments: { action: 'list' } }],
        }),
      ]) as never,
    )

    const store = agent()
    await store.ask('列一下任务')

    expect(resumeAsk).toHaveBeenCalledTimes(5)
    expect(store.messages[1].errorCode).toBe('tool_round_limit')
    expect(store.messages[1].error).toContain('工具调用往返超过 5 轮')
    expect(store.streaming).toBe(false)
  })

  it('续跑阶段点「停止」：中断流并收口，已有内容保留', async () => {
    vi.mocked(streamAsk).mockImplementation(streamOf(firstRound()) as never)
    vi.mocked(resumeAsk).mockImplementation(async function* (
      _base: string,
      _payload: unknown,
      options?: { signal?: AbortSignal },
    ) {
      yield { type: 'token', text: '正在续写' } as AgentEvent
      await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })
    } as never)

    const store = agent()
    const pending = store.ask('帮我把交周报记下来')
    await tick()

    // 已经到了"等续跑"的阶段：工具执行完了，但回答还没完
    expect(resumeAsk).toHaveBeenCalledTimes(1)
    expect(store.streaming).toBe(true)

    store.stop()
    await pending

    const answer = store.messages[1]
    expect(answer.content).toBe('我先把这条记下来。正在续写')
    expect(answer.streaming).toBe(false)
    expect(store.streaming).toBe(false)
    // 停的是流，不是数据：工具已经建好的任务不该被撤销
    expect(todos().todos[0].title).toBe('交周报')
  })
})
