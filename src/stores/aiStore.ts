/**
 * AI 配置（BYOK：Bring Your Own Key）。
 *
 * 为什么把 Key 放 localStorage 而不是服务端：这是本地工具形态下的合理选择，
 * 零服务端成本、用户自己掌控额度；进阶做法是用 Supabase Edge Function 代理
 * （与天气 Key 同一套「凭证不进前端」话术），本期不做，README 里注明。
 */

import { computed } from 'vue'

import { defineStore } from 'pinia'

import { isAiConfigured } from '@/api/ai'
import { useLocalStorage } from '@/composables/useLocalStorage'
import { AI_PRESETS, AI_STORAGE_KEY, DEFAULT_AI_CONFIG } from '@/types/ai'
import type { AiConfig, AiProvider } from '@/types/ai'

export const useAiStore = defineStore('ai', () => {
  const config = useLocalStorage<AiConfig>(AI_STORAGE_KEY, { ...DEFAULT_AI_CONFIG })

  /** 是否已配置可用（入口显隐、按钮禁用都看它） */
  const configured = computed(() => isAiConfigured(config.value))

  /** 当前厂商预设（设置页展示 baseUrl/model 的默认值） */
  const preset = computed(() => AI_PRESETS[config.value.provider])

  /**
   * 切换厂商：同时把地址与模型切成该厂商的预置值
   * （否则会出现「选了 GLM 却还在打 DeepSeek 的地址」这种难查的问题）。
   * 自定义厂商不动地址/模型，让用户填。
   */
  function setProvider(provider: AiProvider) {
    if (provider === 'custom') {
      config.value = { ...config.value, provider }
      return
    }
    const target = AI_PRESETS[provider]
    config.value = {
      ...config.value,
      provider,
      baseUrl: target.baseUrl,
      model: target.model,
    }
  }

  function setApiKey(apiKey: string) {
    config.value = { ...config.value, apiKey: apiKey.trim() }
  }

  function setBaseUrl(baseUrl: string) {
    config.value = { ...config.value, baseUrl: baseUrl.trim() }
  }

  function setModel(model: string) {
    config.value = { ...config.value, model: model.trim() }
  }

  /** 清空 Key（「移除凭证」用） */
  function clearApiKey() {
    config.value = { ...config.value, apiKey: '' }
  }

  function reset() {
    config.value = { ...DEFAULT_AI_CONFIG }
  }

  return {
    config,
    configured,
    preset,
    setProvider,
    setApiKey,
    setBaseUrl,
    setModel,
    clearApiKey,
    reset,
  }
})
