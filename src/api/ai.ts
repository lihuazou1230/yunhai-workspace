/**
 * AI 调用（原生 fetch，不引 SDK —— 与 httpClient 的技术故事一致）。
 *
 * 可靠性三件套（规划 6.3）：
 * 1. `response_format: { type: 'json_object' }` 强制结构化输出
 * 2. 结果过 schema 校验；字段缺失/日期非法 → **带上错误信息重试一次**
 * 3. 仍失败 → 抛错，由 UI 降级到手动表单（AI 永远是加速器，不是阻塞点）
 */

import type { AiConfig, AiTodoDraft } from '@/types/ai'
import { AI_TIMEOUT_MS } from '@/types/ai'
import type { ValidationResult } from '@/utils/aiSchema'
import { extractJson, validateTodoDraft } from '@/utils/aiSchema'
import { todayKey } from '@/utils/dateFormatter'

/** Key 缺失时的标识性错误（UI 依赖它决定「隐藏入口并引导设置」） */
export const AI_KEY_MISSING_MESSAGE = '未配置 AI API Key'
/** 地址缺失（自定义厂商没填根地址） */
export const AI_BASE_URL_MISSING_MESSAGE = '未配置 AI 接口地址'

export class AiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AiError'
    this.status = status
  }
}

/** 配置是否可用（有 Key + 有根地址 + 有模型名） */
export function isAiConfigured(config: AiConfig): boolean {
  return config.apiKey.trim() !== '' && config.baseUrl.trim() !== '' && config.model.trim() !== ''
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 调一次 OpenAI 兼容的 chat/completions，返回解析后的 JSON。
 * @throws AiError 网络错误 / 非 2xx / 响应结构异常 / JSON 抽不出来
 */
export async function chatJson(
  config: AiConfig,
  messages: ChatMessage[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown> {
  if (!config.apiKey.trim()) throw new AiError(AI_KEY_MISSING_MESSAGE)
  if (!config.baseUrl.trim()) throw new AiError(AI_BASE_URL_MISSING_MESSAGE)
  if (!config.model.trim()) throw new AiError('未配置 AI 模型名')

  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? AI_TIMEOUT_MS)
  // 外部也传了 signal 时一并联动（组件卸载要能取消）
  const onExternalAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onExternalAbort)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        // 三件套之一：强制结构化输出
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await safeText(response)
      throw new AiError(describeHttpError(response.status, detail), response.status)
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') {
      throw new AiError('AI 返回内容为空')
    }

    const json = extractJson(content)
    // 只接受对象/数组：标量（如模型回了 "好的"）对后续 schema 校验没有意义，
    // 在这里就判失败，错误信息也更准确
    if (json === null || typeof json !== 'object') {
      throw new AiError('AI 返回的不是合法 JSON 对象')
    }
    return json
  } catch (error) {
    if (error instanceof AiError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiError('AI 请求超时，请稍后重试')
    }
    throw new AiError(error instanceof Error ? `网络错误：${error.message}` : 'AI 请求失败')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300)
  } catch {
    return ''
  }
}

/** HTTP 状态码 -> 中文提示（401/402/429 是 BYOK 场景最常撞的几个） */
function describeHttpError(status: number, detail: string): string {
  const base =
    status === 401
      ? 'API Key 无效或已过期'
      : status === 402
        ? '账户余额不足'
        : status === 429
          ? '请求过于频繁或额度用尽，请稍后再试'
          : status === 404
            ? '接口地址或模型名不正确'
            : `AI 接口报错（HTTP ${status}）`
  return detail ? `${base}：${detail}` : base
}

/** 系统提示：智能添加任务 */
export function buildTodoSystemPrompt(today: string): string {
  return [
    '你是一个任务解析器。把用户的一句自然语言解析成一个待办任务，只输出 JSON。',
    `今天是 ${today}。相对日期（明天/后天/下周一/3天后）必须换算成 YYYY-MM-DD 绝对日期。`,
    'JSON 结构：{"title": string, "dueDate": "YYYY-MM-DD" | null, "priority": "low"|"medium"|"high", "note": string}',
    '规则：',
    '- title：任务内容本身，去掉「提醒我」「帮我」这类赘词，简洁明确，不要带时间词',
    '- dueDate：用户没提时间就填 null，不要编造',
    '- priority：出现「紧急/重要/马上/尽快」等词判 high；「随时/有空/不急」判 low；其余 medium',
    '- note：一句话说明你的判断依据，20 字以内',
    '只输出 JSON，不要解释、不要 markdown。',
  ].join('\n')
}

export interface AiRunOptions {
  /** 注入 fetch（测试用），默认全局 fetch */
  signal?: AbortSignal
}

/**
 * 带「校验 → 失败带错误重试一次」的通用链路。
 * @param validate 校验函数，返回失败原因时会把原因拼进第二轮的用户消息
 */
async function runWithSchemaRetry<T>(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string,
  validate: (raw: unknown) => ValidationResult<T>,
  options: AiRunOptions = {},
): Promise<T> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  let lastError = ''
  // 最多两次：第一轮正常问，第二轮把上一轮的错误带上让模型自己修
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatJson(config, messages, { signal: options.signal })
    const result = validate(raw)
    if (result.ok) return result.value

    lastError = result.error
    if (attempt === 0) {
      messages.push({ role: 'assistant', content: JSON.stringify(raw) })
      messages.push({
        role: 'user',
        content: `上一次的输出不符合要求：${result.error}。请修正后重新只输出符合结构的 JSON。`,
      })
    }
  }

  throw new AiError(`AI 返回结构不符（已重试一次）：${lastError}`)
}

/** 智能添加任务：自然语言 -> 结构化草稿（**只返回草稿，入库由用户确认**） */
export function parseTodoWithAi(
  config: AiConfig,
  text: string,
  today = todayKey(),
  options: AiRunOptions = {},
): Promise<AiTodoDraft> {
  const trimmed = text.trim()
  if (!trimmed) return Promise.reject(new AiError('请先输入任务描述'))
  return runWithSchemaRetry(
    config,
    buildTodoSystemPrompt(today),
    trimmed,
    (raw) => validateTodoDraft(raw, today),
    options,
  )
}
