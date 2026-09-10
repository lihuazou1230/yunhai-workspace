/**
 * AI 调用链测试：可靠性三件套（结构化输出 → 校验失败带错误重试一次 → 仍失败降级）。
 * 全部用 fetch 替身，不发真实请求。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_AI_CONFIG } from '@/types/ai'
import type { AiConfig } from '@/types/ai'
import {
  AI_BASE_URL_MISSING_MESSAGE,
  AI_KEY_MISSING_MESSAGE,
  breakdownWithAi,
  chatJson,
  isAiConfigured,
  parseTodoWithAi,
} from './ai'

const CONFIG: AiConfig = { ...DEFAULT_AI_CONFIG, apiKey: 'sk-test' }
const TODAY = '2026-09-10'

/** 构造一个 OpenAI 兼容的响应体 */
function chatResponse(content: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    text: async () => '',
  }
}

function errorResponse(status: number, body = '') {
  return { ok: false, status, json: async () => ({}), text: async () => body }
}

/** 按顺序返回多个响应的 fetch 替身，并记录请求 URL / 头 / 体 */
function stubSequence(responses: unknown[]) {
  const bodies: Array<Record<string, unknown>> = []
  const urls: string[] = []
  const headers: Array<Record<string, string>> = []

  const fetchMock = vi.fn(
    async (url: string, init: { body: string; headers: Record<string, string> }) => {
      urls.push(url)
      headers.push(init.headers)
      bodies.push(JSON.parse(init.body) as Record<string, unknown>)
      const next = responses.shift()
      if (next instanceof Error) throw next
      return next
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return { bodies, urls, headers, fetchMock }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isAiConfigured', () => {
  it('Key / 根地址 / 模型名三者齐全才算配置好', () => {
    expect(isAiConfigured(CONFIG)).toBe(true)
    expect(isAiConfigured({ ...CONFIG, apiKey: '' })).toBe(false)
    expect(isAiConfigured({ ...CONFIG, apiKey: '   ' })).toBe(false)
    expect(isAiConfigured({ ...CONFIG, baseUrl: '' })).toBe(false)
    expect(isAiConfigured({ ...CONFIG, model: '' })).toBe(false)
  })
})

describe('chatJson（原生 fetch + 结构化输出）', () => {
  it('向 /chat/completions 发请求，带 Bearer 头与 response_format: json_object', async () => {
    const { bodies, urls, headers } = stubSequence([chatResponse({ title: 'x' })])

    const result = await chatJson(CONFIG, [{ role: 'user', content: 'hi' }])

    expect(result).toEqual({ title: 'x' })
    expect(urls[0]).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(headers[0].Authorization).toBe('Bearer sk-test')
    expect(bodies[0].response_format).toEqual({ type: 'json_object' })
    expect(bodies[0].model).toBe('deepseek-chat')
  })

  it('根地址末尾多余的斜杠会被去掉（不产生 //chat/completions）', async () => {
    const { urls } = stubSequence([chatResponse({})])
    await chatJson({ ...CONFIG, baseUrl: 'https://api.example.com/v1///' }, [])
    expect(urls[0]).toBe('https://api.example.com/v1/chat/completions')
  })

  it('缺 Key / 缺地址直接抛错，不发请求', async () => {
    const { fetchMock } = stubSequence([])
    await expect(chatJson({ ...CONFIG, apiKey: '' }, [])).rejects.toThrow(AI_KEY_MISSING_MESSAGE)
    await expect(chatJson({ ...CONFIG, baseUrl: '' }, [])).rejects.toThrow(
      AI_BASE_URL_MISSING_MESSAGE,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('HTTP 错误码转成中文提示（401/402/429/404）', async () => {
    for (const [status, keyword] of [
      [401, 'API Key 无效'],
      [402, '余额不足'],
      [429, '频繁'],
      [404, '接口地址或模型名'],
      [500, 'HTTP 500'],
    ] as Array<[number, string]>) {
      stubSequence([errorResponse(status, 'detail')])
      await expect(chatJson(CONFIG, [])).rejects.toThrow(keyword)
    }
  })

  it('返回内容为空 / 不是 JSON 时抛错', async () => {
    stubSequence([{ ok: true, status: 200, json: async () => ({ choices: [] }) }])
    await expect(chatJson(CONFIG, [])).rejects.toThrow('返回内容为空')

    // 模型回了标量（不是对象/数组）同样判失败
    stubSequence([
      {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '"好的"' } }] }),
      },
    ])
    await expect(chatJson(CONFIG, [])).rejects.toThrow('不是合法 JSON 对象')
  })

  it('网络异常包成 AiError（不把原始错误直接抛给 UI）', async () => {
    stubSequence([new Error('socket hang up')])
    await expect(chatJson(CONFIG, [])).rejects.toThrow('网络错误')
  })

  it('响应被 markdown 围栏包住也能解析', async () => {
    stubSequence([
      {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '```json\n{"title":"x"}\n```' } }] }),
      },
    ])
    await expect(chatJson(CONFIG, [])).resolves.toEqual({ title: 'x' })
  })
})

describe('parseTodoWithAi（校验失败带错误重试一次）', () => {
  it('第一次就合法：只请求一次', async () => {
    const { bodies: calls } = stubSequence([
      chatResponse({ title: '交周报', dueDate: '2026-09-11' }),
    ])

    const draft = await parseTodoWithAi(CONFIG, '明天交周报', TODAY)

    expect(draft.title).toBe('交周报')
    expect(draft.dueDate).toBe('2026-09-11')
    expect(calls).toHaveLength(1)
  })

  it('第一次缺 title：把错误回灌后重试，第二次成功', async () => {
    const { bodies: calls } = stubSequence([
      chatResponse({ dueDate: '2026-09-11' }),
      chatResponse({ title: '交周报', priority: 'high' }),
    ])

    const draft = await parseTodoWithAi(CONFIG, '明天交周报', TODAY)

    expect(draft.title).toBe('交周报')
    expect(calls).toHaveLength(2)
    // 第二轮消息里带上了上一轮的错误说明与原始输出
    const messages = calls[1].messages as Array<{ role: string; content: string }>
    expect(messages.some((m) => m.content.includes('不符合要求'))).toBe(true)
    expect(messages.some((m) => m.role === 'assistant')).toBe(true)
  })

  it('两次都不合法：抛错（由 UI 降级到手动表单）', async () => {
    const { bodies: calls } = stubSequence([chatResponse({}), chatResponse({ title: '' })])

    await expect(parseTodoWithAi(CONFIG, '写点什么', TODAY)).rejects.toThrow('结构不符')
    // 确实重试了一次（共两次请求）
    expect(calls).toHaveLength(2)
  })

  it('空输入直接拒绝，不发请求', async () => {
    const { fetchMock } = stubSequence([])
    await expect(parseTodoWithAi(CONFIG, '   ', TODAY)).rejects.toThrow('请先输入任务描述')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('系统提示里带上「今天」的日期，避免模型自己猜', async () => {
    const { bodies: calls } = stubSequence([chatResponse({ title: 'x' })])
    await parseTodoWithAi(CONFIG, '写周报', TODAY)
    const messages = calls[0].messages as Array<{ content: string }>
    expect(messages[0].content).toContain(TODAY)
  })
})

describe('breakdownWithAi（3~6 条约束 + 重试）', () => {
  it('合法输出直接返回 3~6 条', async () => {
    const { bodies: calls } = stubSequence([
      chatResponse({
        subtasks: [
          { title: '梳理岗位要求', priority: 'high' },
          { title: '复习手写题', priority: 'medium' },
          { title: '做两个项目', priority: 'high' },
        ],
      }),
    ])

    const drafts = await breakdownWithAi(CONFIG, '准备前端面试')

    expect(drafts).toHaveLength(3)
    expect(drafts[0].priority).toBe('high')
    expect(calls).toHaveLength(1)
  })

  it('数量超限：重试一次；仍超限则抛错（不静默截断）', async () => {
    const tooMany = {
      subtasks: Array.from({ length: 8 }, (_, i) => ({ title: `步骤${i}` })),
    }
    const { bodies: calls } = stubSequence([chatResponse(tooMany), chatResponse(tooMany)])

    await expect(breakdownWithAi(CONFIG, '准备面试')).rejects.toThrow('最多 6 条')
    expect(calls).toHaveLength(2)
  })

  it('数量不足：重试后补齐即成功', async () => {
    const { bodies: calls } = stubSequence([
      chatResponse({ subtasks: [{ title: '只有一条' }] }),
      chatResponse({ subtasks: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }),
    ])

    const drafts = await breakdownWithAi(CONFIG, '准备面试')
    expect(drafts.map((d) => d.title)).toEqual(['a', 'b', 'c'])
    expect(calls).toHaveLength(2)
  })

  it('空目标直接拒绝', async () => {
    const { fetchMock } = stubSequence([])
    await expect(breakdownWithAi(CONFIG, '  ')).rejects.toThrow('请先输入要拆解的目标')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
