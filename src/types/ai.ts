/**
 * AI 能力领域类型（第六阶段 6.3）。
 *
 * 定位：AI 嵌在**动作**里而不是做聊天窗口——最高频的「添加任务」获得自然语言入口，
 * 「大目标」一键拆成可执行子任务。两条链路共用同一套模型配置与可靠性三件套。
 *
 * Key 安全走 **BYOK**（Bring Your Own Key）：用户自己填 Key 存 localStorage，
 * 零服务端成本；不引 SDK，继续用原生 fetch 调 OpenAI 兼容接口。
 */

import type { TodoPriority } from '@/types/todo'

/** 预置厂商（都是国内直连、OpenAI 兼容接口） */
export type AiProvider = 'deepseek' | 'glm' | 'custom'

/** AI 配置（BYOK，持久化到 localStorage） */
export interface AiConfig {
  provider: AiProvider
  /** OpenAI 兼容的 API 根地址（不含 /chat/completions），用户可在 custom 下改 */
  baseUrl: string
  model: string
  apiKey: string
}

export interface AiPreset {
  label: string
  baseUrl: string
  model: string
  /** 申请地址 / 说明 */
  hint: string
}

/**
 * 预置厂商参数。
 * model 取 Flash 级/轻量级：单次解析 500~1000 tokens，每次不足一分钱。
 */
export const AI_PRESETS: Record<AiProvider, AiPreset> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '在 platform.deepseek.com 创建 API Key',
  },
  glm: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    hint: '在 open.bigmodel.cn 创建 API Key（glm-4-flash 免费额度充足）',
  },
  custom: {
    label: '自定义',
    baseUrl: '',
    model: '',
    hint: '任何 OpenAI 兼容接口：填根地址（不含 /chat/completions）与模型名',
  },
}

export const AI_PROVIDERS: readonly AiProvider[] = ['deepseek', 'glm', 'custom']

/** localStorage 键 */
export const AI_STORAGE_KEY = 'smart-workspace:ai'

/** 默认配置：缺省选 DeepSeek，Key 留空（未配置时 AI 入口隐藏并引导设置） */
export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'deepseek',
  baseUrl: AI_PRESETS.deepseek.baseUrl,
  model: AI_PRESETS.deepseek.model,
  apiKey: '',
}

/** AI 解析出的任务草稿（**预览用，确认后才入库**） */
export interface AiTodoDraft {
  title: string
  /** YYYY-MM-DD；用户没说日期时为 undefined */
  dueDate?: string
  priority: TodoPriority
  /** 解析置信度说明（展示给用户看「为什么这么理解」） */
  note?: string
}

/** 请求超时（ms）：AI 比天气慢得多，给足 30 秒 */
export const AI_TIMEOUT_MS = 30_000

/** 往返失败时的统一提示后缀（永远是加速器，不是阻塞点） */
export const AI_FALLBACK_HINT = '可以改用下方的手动表单继续添加'
