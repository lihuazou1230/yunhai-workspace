/**
 * AI 输出的 schema 校验（纯函数，可靠性三件套的第二件）。
 *
 * 为什么必须单独校验：即使开了 `response_format: json_object`，模型仍可能给出
 * 「字段缺失 / 日期写成 2026-13-45 / 优先级写成 important」这类结构对但语义错的结果。
 * 直接入库会让脏数据污染任务列表，所以这里逐字段收敛，**校验失败要能说出失败原因**，
 * 好把错误回灌给模型让它重试一次。
 */

import type { AiTodoDraft } from '@/types/ai'
import type { TodoPriority } from '@/types/todo'
import { isValidDateKey } from '@/utils/validation'
import { addDays, todayKey } from '@/utils/dateFormatter'

export interface ValidationOk<T> {
  ok: true
  value: T
}

export interface ValidationFail {
  ok: false
  /** 面向模型/开发者的失败原因（会作为重试提示回灌） */
  error: string
}

export type ValidationResult<T> = ValidationOk<T> | ValidationFail

const PRIORITIES: readonly TodoPriority[] = ['low', 'medium', 'high']

/** 把任意值收敛成合法优先级，认不出来的按中优先级 */
function toPriority(value: unknown): TodoPriority {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if ((PRIORITIES as readonly string[]).includes(lower)) return lower as TodoPriority
    // 常见近义词兜底：模型偶尔会给中文或英文别名
    if (['高', 'high', 'urgent', 'important'].includes(lower)) return 'high'
    if (['中', 'medium', 'normal'].includes(lower)) return 'medium'
    if (['低', 'low', 'minor'].includes(lower)) return 'low'
  }
  return 'medium'
}

/** 相对日期短语兜底：模型没换算成具体日期时，我们自己算（今天起算） */
function resolveRelativeDate(text: string, today: string): string | undefined {
  const key = text.trim()
  if (key === '今天' || key === 'today') return today
  if (key === '明天' || key === 'tomorrow') return addDays(today, 1)
  if (key === '后天') return addDays(today, 2)
  if (key === '下周' || key === '下周一') {
    const day = new Date(`${today}T00:00:00`).getDay()
    const sinceMonday = (day + 6) % 7
    return addDays(today, 7 - sinceMonday)
  }
  const weekMatch = /^(\d+)\s*天后$/.exec(key)
  if (weekMatch) return addDays(today, Number(weekMatch[1]))
  return undefined
}

/**
 * 校验「智能添加任务」的模型输出。
 *
 * 容忍度刻意分两档：
 * - **标题必须有效**（空标题没有任何补救意义 → 直接判失败，回灌错误重试）
 * - 日期/优先级属于「尽力而为」：日期非法就退回落空的相对短语解析，仍解析不出就丢掉该字段
 *   （宁可少一个日期，也不要因为日期括号写错就整条扔回给用户重来）
 */
export function validateTodoDraft(raw: unknown, today = todayKey()): ValidationResult<AiTodoDraft> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '返回的不是一个 JSON 对象' }
  }
  const obj = raw as Record<string, unknown>

  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  if (!title) return { ok: false, error: '缺少 title 字段或标题为空' }

  const priority = toPriority(obj.priority)

  let dueDate: string | undefined
  const rawDate = obj.dueDate ?? obj.date ?? obj.due
  if (typeof rawDate === 'string' && rawDate.trim() !== '') {
    const text = rawDate.trim()
    if (isValidDateKey(text)) dueDate = text
    else dueDate = resolveRelativeDate(text, today)
  }

  const note = typeof obj.note === 'string' && obj.note.trim() !== '' ? obj.note.trim() : undefined

  return { ok: true, value: { title, dueDate, priority, note } }
}

/** 从模型返回的文本里抽出 JSON（有的模型会把 JSON 包在 ```json 代码块里） */
export function extractJson(content: string): unknown {
  const text = content.trim()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    // 退一步：剥掉 markdown 代码块围栏再试
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      return null
    }
  }

  // 再退一步：取第一个 { 到最后一个 } 之间的内容
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}
