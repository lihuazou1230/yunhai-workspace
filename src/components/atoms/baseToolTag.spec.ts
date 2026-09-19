/**
 * BaseToolTag（第十一阶段 11.1）。
 *
 * 纯展示组件：props 驱动，没有 store 与网络。
 * 要守住的两件事：**中文标签**（别把 task_crud 这种实现细节漏给用户）
 * 与**状态点**（执行中/成功/失败/等前端执行，颜色必须分得开）。
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseToolTag from './BaseToolTag.vue'
import { AGENT_TOOL_LABELS, agentToolLabel } from '@/types/agent'
import type { AgentToolCall } from '@/types/agent'

function tool(patch: Partial<AgentToolCall> = {}): AgentToolCall {
  return { name: 'search_knowledge', ...patch }
}

describe('agentToolLabel', () => {
  it('已登记的工具给中文标签，未登记的原样显示名字', () => {
    expect(agentToolLabel('search_knowledge')).toBe('查知识库')
    expect(agentToolLabel('task_crud')).toBe('任务操作')
    expect(agentToolLabel('get_date')).toBe('日期时间')
    expect(agentToolLabel('get_weather')).toBe('天气')
    expect(AGENT_TOOL_LABELS['get_weather']).toBe('天气')
    // 后端新加的工具：宁可显示原始名字，也不要显示空白
    expect(agentToolLabel('future_tool')).toBe('future_tool')
  })
})

describe('BaseToolTag', () => {
  it('用中文标签而不是工具名', () => {
    const wrapper = mount(BaseToolTag, { props: { tool: tool({ name: 'task_crud' }) } })
    expect(wrapper.text()).toContain('任务操作')
    expect(wrapper.text()).not.toContain('task_crud')
    expect(wrapper.attributes('data-tool')).toBe('task_crud')
  })

  it('状态点按状态分色：执行中脉冲、成功绿、失败红、等前端执行琥珀', () => {
    const cases: Array<[AgentToolCall['status'], string]> = [
      ['running', 'animate-pulse'],
      ['ok', 'bg-emerald-500'],
      ['error', 'bg-rose-500'],
      ['awaiting_client', 'bg-amber-500'],
    ]
    for (const [status, expected] of cases) {
      const wrapper = mount(BaseToolTag, { props: { tool: tool({ status }) } })
      expect(wrapper.find('[data-testid="tool-tag-dot"]').classes()).toContain(expected)
    }
  })

  it('没有状态的历史记录给中性灰（显示成"运行中"会让人以为它还在跑）', () => {
    const wrapper = mount(BaseToolTag, { props: { tool: tool() } })
    expect(wrapper.attributes('data-status')).toBe('unknown')
    expect(wrapper.find('[data-testid="tool-tag-dot"]').classes()).toContain('bg-slate-300')
  })

  it('一行摘要：结果优先，其次是失败原因，最后才是参数', () => {
    const withSummary = mount(BaseToolTag, {
      props: { tool: tool({ status: 'ok', summary: '命中 2 块', arguments: { query: '分块' } }) },
    })
    expect(withSummary.text()).toContain('命中 2 块')

    const withError = mount(BaseToolTag, {
      props: { tool: tool({ status: 'error', error: '没有命中' }) },
    })
    expect(withError.text()).toContain('没有命中')

    const withArgs = mount(BaseToolTag, {
      props: { tool: tool({ status: 'running', arguments: { query: '分块' } }) },
    })
    expect(withArgs.text()).toContain('执行中…')
    expect(withArgs.attributes('title')).toContain('"query": "分块"')

    const awaiting = mount(BaseToolTag, {
      props: { tool: tool({ status: 'awaiting_client' }) },
    })
    expect(awaiting.text()).toContain('等待前端执行…')
  })

  it('展开后能看到 JSON 参数与完整结果', async () => {
    const wrapper = mount(BaseToolTag, {
      props: {
        tool: tool({
          status: 'ok',
          summary: '已创建任务「交周报」',
          arguments: { action: 'create', title: '交周报' },
          result: { id: 't1', title: '交周报' },
        }),
      },
    })
    expect(wrapper.find('[data-testid="tool-tag-detail"]').exists()).toBe(false)

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('[data-testid="tool-tag-args"]').text()).toContain('"action": "create"')
    expect(wrapper.find('[data-testid="tool-tag-result"]').text()).toContain('"id": "t1"')
    expect(wrapper.find('[data-testid="tool-tag-summary"]').text()).toContain('交周报')

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('[data-testid="tool-tag-detail"]').exists()).toBe(false)
  })

  it('失败时展开能看到错误原文（红字）', async () => {
    const wrapper = mount(BaseToolTag, {
      props: { tool: tool({ status: 'error', error: '本地还没有天气缓存，先去仪表板刷新天气' }) },
    })
    await wrapper.find('button').trigger('click')
    const error = wrapper.find('[data-testid="tool-tag-error"]')
    expect(error.text()).toContain('先去仪表板刷新天气')
    expect(error.classes()).toContain('text-rose-600')
  })

  it('结果直接是字符串时原样展示（不套 JSON 引号）', async () => {
    const wrapper = mount(BaseToolTag, {
      props: { tool: tool({ status: 'ok', result: '上海 晴 24°C' }) },
    })
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('[data-testid="tool-tag-result"]').text()).toBe('上海 晴 24°C')
  })
})
