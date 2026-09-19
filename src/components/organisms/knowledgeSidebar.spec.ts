/**
 * AI 助手页侧栏（KnowledgeSidebar）：连接、上传、删除、清空、降级提示。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

import KnowledgeSidebar from './KnowledgeSidebar.vue'
import {
  deleteDocument,
  fetchHealth,
  listDocuments,
  resetKnowledge,
  uploadDocument,
  warmupEmbedder,
} from '@/api/agent'
import { useAgentStore } from '@/stores/agentStore'
import type { AgentHealth } from '@/types/agent'

vi.mock('@/api/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/agent')>()
  return {
    ...actual,
    fetchHealth: vi.fn(),
    listDocuments: vi.fn(),
    uploadDocument: vi.fn(),
    deleteDocument: vi.fn(),
    resetKnowledge: vi.fn(),
    warmupEmbedder: vi.fn(),
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
  documents: 1,
  chunks: 20,
  lexical_chunks: 20,
  sources: [],
  chunk_size: 500,
  chunk_overlap: 80,
  top_k: 4,
  score_threshold: 0.45,
  lexical_score_threshold: 0.35,
  fallback_mode: 'refuse',
} as AgentHealth

const DOC = {
  doc_id: 'd1',
  source: '手册.md',
  source_type: 'md',
  uploaded_at: '2026-09-17T10:00:00',
  chunks: 20,
  pages: 3,
}

async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(KnowledgeSidebar, { global: { plugins: [pinia] } })
  await flushPromises()
  return { wrapper, agent: useAgentStore() }
}

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(fetchHealth).mockResolvedValue(HEALTH)
  vi.mocked(listDocuments).mockResolvedValue({ documents: [DOC], total_chunks: 20 })
})

describe('KnowledgeSidebar', () => {
  it('未连接时显示未连接与通用提示', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('[data-testid="knowledge-status-dot"]').text()).toContain('未连接')
    expect(wrapper.text()).toContain('还没有文档')
  })

  it('连接成功后显示库内统计与文档清单（含页数）', async () => {
    const { wrapper, agent } = await setup()
    await agent.checkHealth()
    await agent.refreshDocuments()
    await flushPromises()
    expect(wrapper.find('[data-testid="knowledge-status-dot"]').text()).toContain('已连接')
    expect(wrapper.text()).toContain('1 篇文档 · 20 块向量')
    expect(wrapper.find('[data-testid="knowledge-document"]').text()).toContain('手册.md')
    expect(wrapper.find('[data-testid="knowledge-document"]').text()).toContain('3 页')
  })

  it('「检测」按钮把输入框里的地址写回 store 并重新自检', async () => {
    const { wrapper, agent } = await setup()
    await wrapper.find('[data-testid="knowledge-endpoint"]').setValue('http://192.168.1.5:9000/')
    await wrapper.find('[data-testid="knowledge-connect"]').trigger('click')
    await flushPromises()
    expect(agent.endpoint).toBe('http://192.168.1.5:9000')
    expect(fetchHealth).toHaveBeenCalledWith('http://192.168.1.5:9000')
  })

  it('选择文件即上传（走 store，前端先拦类型/大小）', async () => {
    vi.mocked(uploadDocument).mockResolvedValue({
      status: 'done',
      document: DOC,
      stats: { documents: 1, chunks: 20, lexical_chunks: 20 },
      job_id: null,
      message: '已入库',
    })
    const { wrapper } = await setup()
    const input = wrapper.find('[data-testid="knowledge-file-input"]')
    const file = new File(['# 标题'], '手册.md', { type: 'text/markdown' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(uploadDocument).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="knowledge-upload-hint"]').text()).toContain('已入库')
  })

  it('拖拽文件到上传区也能入库', async () => {
    vi.mocked(uploadDocument).mockResolvedValue({
      status: 'done',
      document: DOC,
      stats: null,
      job_id: null,
      message: '已入库',
    })
    const { wrapper } = await setup()
    const zone = wrapper.find('[data-testid="knowledge-dropzone"]')
    await zone.trigger('drop', { dataTransfer: { files: [new File(['x'], '笔记.txt')] } })
    await flushPromises()
    expect(uploadDocument).toHaveBeenCalledTimes(1)
  })

  it('上传类型不合法时当场给出错误，不发请求', async () => {
    const { wrapper } = await setup()
    const input = wrapper.find('[data-testid="knowledge-file-input"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], '图.png', { type: 'image/png' })],
      configurable: true,
    })
    await input.trigger('change')
    await flushPromises()
    expect(uploadDocument).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="knowledge-documents-error"]').text()).toContain(
      '不支持的文件类型',
    )
  })

  it('删除文档会带上 doc_id', async () => {
    vi.mocked(deleteDocument).mockResolvedValue({ removed_chunks: 20 })
    const { wrapper, agent } = await setup()
    await agent.refreshDocuments()
    await flushPromises()
    await wrapper.find('[data-testid="knowledge-delete-d1"]').trigger('click')
    await flushPromises()
    expect(deleteDocument).toHaveBeenCalledWith(expect.any(String), 'd1')
  })

  it('清空知识库要点两次（避免一次误点清库）', async () => {
    vi.mocked(resetKnowledge).mockResolvedValue({ status: 'ok', message: '已清空' })
    const { wrapper, agent } = await setup()
    await agent.refreshDocuments()
    await flushPromises()

    const button = wrapper.find('[data-testid="knowledge-clear"]')
    await button.trigger('click')
    expect(resetKnowledge).not.toHaveBeenCalled()
    expect(button.text()).toContain('再点一次确认清空')
    await button.trigger('click')
    await flushPromises()
    expect(resetKnowledge).toHaveBeenCalledTimes(1)
  })

  it('向量模型未就绪时给出「立即加载」入口', async () => {
    vi.mocked(warmupEmbedder).mockResolvedValue({ status: 'ok', embedder: 'bge', dim: 512 })
    const { wrapper, agent } = await setup()
    agent.health = { ...HEALTH, embedder: 'hash' }
    await flushPromises()
    const hint = wrapper.find('[data-testid="knowledge-embedder-hint"]')
    expect(hint.exists()).toBe(true)
    await wrapper.find('[data-testid="knowledge-warmup"]').trigger('click')
    await flushPromises()
    expect(warmupEmbedder).toHaveBeenCalledTimes(1)
  })

  it('后端降级运行（bge 不可用）时把原因摆在明面上', async () => {
    const { wrapper, agent } = await setup()
    agent.health = { ...HEALTH, degraded_reason: '缺少 sentence-transformers；已临时改用哈希向量' }
    await flushPromises()
    expect(wrapper.find('[data-testid="knowledge-degraded"]').text()).toContain('哈希向量')
  })
})
