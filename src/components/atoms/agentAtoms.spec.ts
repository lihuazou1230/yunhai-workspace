/**
 * 知识库的三个呈现组件：气泡、引用块、消息组。
 * 都是纯展示组件，用 props 驱动，不需要 store 与网络。
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseChatBubble from './BaseChatBubble.vue'
import BaseCitationChip from './BaseCitationChip.vue'
import BaseMessageGroup from '@/components/molecules/BaseMessageGroup.vue'
import type { AgentChatMessage, AgentCitation } from '@/types/agent'

const CITATION: AgentCitation = {
  index: 1,
  source: '手册.md',
  source_type: 'md',
  doc_id: 'd1',
  chunk_index: 4,
  page: null,
  score: 0.712,
  snippet: '分块默认 500 字符，重叠 80 字符。',
}

function message(patch: Partial<AgentChatMessage> = {}): AgentChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '分块默认 500 字符。[1]',
    citations: [],
    createdAt: '2026-09-17T10:00:00',
    ...patch,
  }
}

describe('BaseChatBubble', () => {
  it('用户消息右对齐用主题色底，助手消息左对齐用中性底', () => {
    const user = mount(BaseChatBubble, { props: { role: 'user', content: '你好' } })
    expect(user.classes()).toContain('justify-end')
    expect(user.find('[data-testid="chat-bubble"]').classes()).toContain('text-white')

    const assistant = mount(BaseChatBubble, { props: { role: 'assistant', content: '你好' } })
    expect(assistant.classes()).toContain('justify-start')
    expect(assistant.find('[data-testid="chat-bubble"]').classes()).toContain('bg-slate-100')
  })

  it('引用编号 [1] 会被高亮成独立片段（和引用块对得上号）', () => {
    const wrapper = mount(BaseChatBubble, { props: { role: 'assistant', content: '结论 [1][2]' } })
    const highlighted = wrapper.findAll('span.font-medium')
    expect(highlighted.map((node) => node.text())).toEqual(['[1]', '[2]'])
  })

  it('流式中且还没有内容时显示占位，出字后显示光标', async () => {
    const wrapper = mount(BaseChatBubble, {
      props: { role: 'assistant', content: '', streaming: true },
    })
    expect(wrapper.text()).toContain('正在检索知识库')
    await wrapper.setProps({ content: '分块' })
    expect(wrapper.text()).toContain('分块')
    expect(wrapper.find('span.animate-pulse').exists()).toBe(true)
  })

  it('错误渲染成气泡内的红色提示', () => {
    const wrapper = mount(BaseChatBubble, {
      props: { role: 'assistant', content: '', error: 'LLM 账户余额不足' },
    })
    expect(wrapper.find('[data-testid="chat-bubble-error"]').text()).toContain('余额不足')
  })
})

describe('BaseCitationChip', () => {
  it('没有来源时显示「无知识库来源」（库外问题的样子）', () => {
    const wrapper = mount(BaseCitationChip, { props: { citation: null } })
    expect(wrapper.find('[data-testid="citation-empty"]').text()).toBe('无知识库来源')
  })

  it('有来源时显示编号、文件名、块号与相似度，点开看片段', async () => {
    const wrapper = mount(BaseCitationChip, { props: { citation: CITATION } })
    expect(wrapper.text()).toContain('手册.md')
    expect(wrapper.text()).toContain('第 5 块')
    expect(wrapper.text()).toContain('71%')
    expect(wrapper.find('[data-testid="citation-snippet"]').exists()).toBe(false)

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('[data-testid="citation-snippet"]').text()).toContain('500 字符')
  })

  it('PDF 来源显示页码而不是块号', () => {
    const wrapper = mount(BaseCitationChip, { props: { citation: { ...CITATION, page: 12 } } })
    expect(wrapper.text()).toContain('第 12 页')
  })
})

describe('BaseMessageGroup', () => {
  it('助手消息带引用块与依据标签、命中数、耗时', () => {
    const wrapper = mount(BaseMessageGroup, {
      props: {
        message: message({
          citations: [CITATION],
          fallback: 'kb',
          hitCount: 3,
          latencyMs: 1250,
        }),
      },
    })
    expect(wrapper.find('[data-testid="citation-chip"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('基于知识库')
    expect(wrapper.text()).toContain('命中 3 块')
    expect(wrapper.text()).toContain('1.25s')
  })

  it('助手消息没有引用时也画空态（说清"这次没有来源"）', () => {
    const wrapper = mount(BaseMessageGroup, { props: { message: message({ fallback: 'refuse' }) } })
    expect(wrapper.find('[data-testid="citation-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('知识库无相关内容')
  })

  it('用户消息不显示引用区与依据标签', () => {
    const wrapper = mount(BaseMessageGroup, {
      props: { message: message({ role: 'user', content: '问题' }) },
    })
    expect(wrapper.find('[data-testid="citation-empty"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('命中')
  })

  it('工具调用以 BaseToolTag 展示（中文标签 + 结果摘要）', () => {
    const wrapper = mount(BaseMessageGroup, {
      props: {
        message: message({
          tools: [
            {
              id: 'c1',
              name: 'search_knowledge',
              status: 'ok',
              summary: '命中 2 块',
              arguments: { query: '分块' },
            },
          ],
        }),
      },
    })
    const tag = wrapper.find('[data-testid="tool-tag"]')
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toContain('查知识库')
    expect(tag.text()).toContain('命中 2 块')
    // 原始工具名不该直接摆在用户面前
    expect(tag.text()).not.toContain('search_knowledge')
    expect(tag.attributes('data-tool')).toBe('search_knowledge')
  })

  it('裸答模式标黄提醒「不基于知识库」', () => {
    const wrapper = mount(BaseMessageGroup, { props: { message: message({ fallback: 'bare' }) } })
    expect(wrapper.text()).toContain('不基于知识库')
  })

  it('第十一阶段新增的依据标签（工具结果 / 轻量对话 / 收口）也渲染', () => {
    const tool = mount(BaseMessageGroup, { props: { message: message({ fallback: 'tool' }) } })
    expect(tool.text()).toContain('基于工具结果')

    const chat = mount(BaseMessageGroup, { props: { message: message({ fallback: 'chat' }) } })
    expect(chat.text()).toContain('轻量对话')

    const guardrail = mount(BaseMessageGroup, {
      props: { message: message({ fallback: 'guardrail' }) },
    })
    expect(guardrail.text()).toContain('已收口（达到上限）')
  })
})
