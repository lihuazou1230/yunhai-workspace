/**
 * 对话面板（ChatPanel）：输入、发送、流式渲染、停止、策略切换。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

import ChatPanel from './ChatPanel.vue'
import { listSessions, streamAsk } from '@/api/agent'
import { useAgentStore } from '@/stores/agentStore'
import { doneEvent, streamOf } from '@/test/agentFixtures'
import type { AgentEvent } from '@/types/agent'

vi.mock('@/api/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/agent')>()
  return { ...actual, streamAsk: vi.fn(), listSessions: vi.fn() }
})

async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(ChatPanel, { global: { plugins: [pinia] } })
  await flushPromises()
  return { wrapper, agent: useAgentStore() }
}

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(listSessions).mockResolvedValue([])
})

describe('ChatPanel', () => {
  it('空态给出示例问题，点一下填进输入框（不直接发出去）', async () => {
    const { wrapper } = await setup()
    const example = wrapper.findAll('[data-testid="chat-example"]')[0]
    await example.trigger('click')
    expect((wrapper.find('[data-testid="chat-input"]').element as HTMLTextAreaElement).value).toBe(
      example.text(),
    )
    expect(streamAsk).not.toHaveBeenCalled()
  })

  it('没问题时发送按钮禁用，输入后可点', async () => {
    const { wrapper } = await setup()
    const send = wrapper.find('[data-testid="chat-send"]')
    expect(send.attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="chat-input"]').setValue('分块多大？')
    expect(wrapper.find('[data-testid="chat-send"]').attributes('disabled')).toBeUndefined()
  })

  it('发送后：用户气泡 + 助手回答 + 引用块 + 依据标签', async () => {
    vi.mocked(streamAsk).mockImplementation(
      streamOf([
        {
          type: 'citation',
          citation: {
            index: 1,
            source: '手册.md',
            source_type: 'md',
            doc_id: 'd1',
            chunk_index: 0,
            page: null,
            score: 0.71,
            snippet: '分块默认 500 字符',
          },
        },
        { type: 'token', text: '分块默认 500 字符。[1]' },
        doneEvent({
          citations: [
            {
              index: 1,
              source: '手册.md',
              source_type: 'md',
              doc_id: 'd1',
              chunk_index: 0,
              page: null,
              score: 0.71,
              snippet: '分块默认 500 字符',
            },
          ],
          fallback: 'kb',
          kind: 'kb',
          hitCount: 1,
          latencyMs: 700,
        }),
      ]) as never,
    )

    const { wrapper } = await setup()
    await wrapper.find('[data-testid="chat-input"]').setValue('分块多大？')
    await wrapper.find('[data-testid="chat-send"]').trigger('click')
    await flushPromises()

    const bubbles = wrapper.findAll('[data-testid="chat-bubble"]')
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0].text()).toBe('分块多大？')
    expect(bubbles[1].text()).toContain('分块默认 500 字符')
    expect(wrapper.find('[data-testid="citation-chip"]').text()).toContain('手册.md')
    expect(wrapper.text()).toContain('基于知识库')
    expect(wrapper.text()).toContain('命中 1 块')
  })

  it('库外问题：助手侧显示「无知识库来源」与拒答标签', async () => {
    vi.mocked(streamAsk).mockImplementation(
      streamOf([
        { type: 'token', text: '知识库里没有检索到与该问题相关的内容，因此不作答。' },
        doneEvent({ fallback: 'refuse', kind: 'chat', latencyMs: 20 }),
      ]) as never,
    )
    const { wrapper } = await setup()
    await wrapper.find('[data-testid="chat-input"]').setValue('世界杯冠军是谁？')
    await wrapper.find('[data-testid="chat-send"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="citation-empty"]').text()).toBe('无知识库来源')
    expect(wrapper.text()).toContain('知识库无相关内容')
  })

  it('流式过程中显示「停止」，点了能停下（按钮回到「发送」）', async () => {
    let release: (() => void) | null = null
    vi.mocked(streamAsk).mockImplementation(async function* (
      _b: string,
      _p: unknown,
      options?: { signal?: AbortSignal },
    ) {
      yield { type: 'token', text: '正在回答' } as AgentEvent
      await new Promise<void>((_resolve, reject) => {
        release = () => reject(new DOMException('aborted', 'AbortError'))
        options?.signal?.addEventListener('abort', () => release?.())
      })
    } as never)

    const { wrapper, agent } = await setup()
    await wrapper.find('[data-testid="chat-input"]').setValue('问题')
    await wrapper.find('[data-testid="chat-send"]').trigger('click')
    await flushPromises()

    const stop = wrapper.find('[data-testid="chat-stop"]')
    expect(stop.exists()).toBe(true)
    await stop.trigger('click')
    await flushPromises()
    expect(agent.streaming).toBe(false)
    expect(wrapper.find('[data-testid="chat-stop"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="chat-send"]').exists()).toBe(true)
  })

  it('Ctrl + Enter 也能发送', async () => {
    vi.mocked(streamAsk).mockImplementation(
      streamOf([doneEvent({ sessionId: 's', messageId: 'm', latencyMs: 1 })]) as never,
    )
    const { wrapper } = await setup()
    const input = wrapper.find('[data-testid="chat-input"]')
    await input.setValue('问题')
    await input.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(streamAsk).toHaveBeenCalledTimes(1)
  })

  it('检索策略切换与兜底模式写回 store', async () => {
    const { wrapper, agent } = await setup()
    await wrapper.find('[data-testid="agent-mode-lexical"]').trigger('click')
    expect(agent.mode).toBe('lexical')

    const select = wrapper.find('[data-testid="agent-fallback"]')
    await select.setValue('bare')
    expect(agent.fallbackMode).toBe('bare')
  })

  it('未配 Key / 连不上后端时给出两条不同的横幅', async () => {
    const { wrapper, agent } = await setup()
    agent.health = { chunks: 0, documents: 0, llm_configured: false } as never
    await flushPromises()
    expect(wrapper.find('[data-testid="chat-key-hint"]').text()).toContain('LLM_API_KEY')

    agent.connectionError = '连不上 Agent 后端'
    await flushPromises()
    expect(wrapper.find('[data-testid="chat-connection-error"]').text()).toContain('连不上')
  })

  it('剩余字数随输入变化（上限由后端与前端共同兜住）', async () => {
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('剩余 2000 字')
    await wrapper.find('[data-testid="chat-input"]').setValue('你好')
    expect(wrapper.text()).toContain('剩余 1998 字')
  })

  it('新会话按钮清空当前对话', async () => {
    const { wrapper, agent } = await setup()
    agent.messages = [{ id: 'x', role: 'user', content: 'q', citations: [], createdAt: '' }]
    await flushPromises()
    await wrapper.find('[data-testid="agent-new-session"]').trigger('click')
    expect(agent.messages).toHaveLength(0)
    expect(wrapper.findAll('[data-testid="chat-bubble"]')).toHaveLength(0)
  })
})
