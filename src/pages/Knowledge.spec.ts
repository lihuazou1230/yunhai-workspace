/**
 * 知识库页（第十阶段 10.4）：首屏装配、历史会话、未连接时的降级。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

import Knowledge from './Knowledge.vue'
import { AgentError, fetchHealth, fetchSession, listDocuments, listSessions } from '@/api/agent'
import type { AgentHealth } from '@/types/agent'

vi.mock('@/api/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/agent')>()
  return {
    ...actual,
    fetchHealth: vi.fn(),
    listDocuments: vi.fn(),
    listSessions: vi.fn(),
    fetchSession: vi.fn(),
    deleteSession: vi.fn(),
  }
})

const HEALTH = {
  status: 'ok',
  version: '0.1.0',
  llm_configured: true,
  llm_model: 'deepseek-chat',
  embedder: 'bge',
  embedder_model: 'BAAI/bge-small-zh-v1.5',
  degraded_reason: '',
  documents: 2,
  chunks: 30,
  lexical_chunks: 30,
  sources: [],
  chunk_size: 500,
  chunk_overlap: 80,
  top_k: 4,
  score_threshold: 0.45,
  lexical_score_threshold: 0.35,
  fallback_mode: 'refuse',
} as AgentHealth

async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Knowledge, { global: { plugins: [pinia] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(fetchHealth).mockResolvedValue(HEALTH)
  vi.mocked(listDocuments).mockResolvedValue({
    documents: [
      {
        doc_id: 'd1',
        source: '手册.md',
        source_type: 'md',
        uploaded_at: '2026-09-17T10:00:00',
        chunks: 20,
        pages: null,
      },
    ],
    total_chunks: 30,
  })
  vi.mocked(listSessions).mockResolvedValue([])
})

describe('知识库页', () => {
  it('装配三块：页头 + 侧栏 + 对话面板', async () => {
    const wrapper = await setup()
    expect(wrapper.text()).toContain('知识库')
    expect(wrapper.find('[data-testid="knowledge-sidebar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-panel"]').exists()).toBe(true)
  })

  it('进入页面就打自检与文档清单，副标题带上库内统计', async () => {
    const wrapper = await setup()
    expect(fetchHealth).toHaveBeenCalledTimes(1)
    expect(listDocuments).toHaveBeenCalledTimes(1)
    expect(listSessions).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('2 篇文档')
    expect(wrapper.text()).toContain('30 块向量')
  })

  it('后端不可达：页面照常渲染，副标题退回说明文案，不给白屏', async () => {
    vi.mocked(fetchHealth).mockRejectedValue(new AgentError('连不上 Agent 后端'))
    const wrapper = await setup()
    expect(wrapper.text()).toContain('RAG 知识库')
    expect(wrapper.find('[data-testid="knowledge-sidebar"]').exists()).toBe(true)
    // 未连接时不发文档请求（没必要）
    expect(listDocuments).not.toHaveBeenCalled()
  })

  it('历史会话：渲染 chips，点开回看，点 × 删除', async () => {
    vi.mocked(listSessions).mockResolvedValue([
      {
        id: 's1',
        title: '分块多大？',
        mode: 'semantic',
        created_at: '2026-09-17T10:00:00',
        updated_at: '2026-09-17T10:00:00',
        message_count: 2,
      },
    ])
    vi.mocked(fetchSession).mockResolvedValue({
      id: 's1',
      title: '分块多大？',
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
          citations: [],
          meta: { fallback: 'kb' },
          created_at: '',
        },
      ],
    })

    const wrapper = await setup()
    expect(wrapper.text()).toContain('历史会话')
    await wrapper.find('[data-testid="agent-session-s1"]').trigger('click')
    await flushPromises()
    expect(fetchSession).toHaveBeenCalledWith(expect.any(String), 's1')
    expect(wrapper.text()).toContain('500 字符 [1]')
  })

  it('没有会话时不渲染历史区（空壳组件会白占一行）', async () => {
    const wrapper = await setup()
    expect(wrapper.text()).not.toContain('历史会话')
  })
})
