import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import { AI_PRESETS, AI_STORAGE_KEY, DEFAULT_AI_CONFIG } from '@/types/ai'
import { useAiStore } from './aiStore'

describe('aiStore（BYOK 配置）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('默认未配置：Key 为空', () => {
    const store = useAiStore()
    expect(store.config.apiKey).toBe('')
    expect(store.configured).toBe(false)
    expect(store.config.provider).toBe('deepseek')
  })

  it('填 Key 后进入已配置状态并持久化', async () => {
    const store = useAiStore()
    store.setApiKey('  sk-abc  ')

    expect(store.config.apiKey).toBe('sk-abc') // 去空白
    expect(store.configured).toBe(true)

    await nextTick()
    const persisted = JSON.parse(localStorage.getItem(AI_STORAGE_KEY)!)
    expect(persisted.apiKey).toBe('sk-abc')
  })

  it('切换厂商时同步替换地址与模型（避免「选了 GLM 却打 DeepSeek 地址」）', () => {
    const store = useAiStore()
    store.setProvider('glm')

    expect(store.config.baseUrl).toBe(AI_PRESETS.glm.baseUrl)
    expect(store.config.model).toBe(AI_PRESETS.glm.model)
    expect(store.preset.label).toBe('智谱 GLM')
  })

  it('切到自定义厂商保留原地址与模型，让用户自己填', () => {
    const store = useAiStore()
    store.setBaseUrl('https://my.gateway/v1')
    store.setModel('my-model')

    store.setProvider('custom')

    expect(store.config.baseUrl).toBe('https://my.gateway/v1')
    expect(store.config.model).toBe('my-model')
  })

  it('移除 Key 后回到未配置（可再次引导设置）', () => {
    const store = useAiStore()
    store.setApiKey('sk-abc')
    store.clearApiKey()

    expect(store.config.apiKey).toBe('')
    expect(store.configured).toBe(false)
  })

  it('恢复默认回到预置的 DeepSeek 且清掉 Key', () => {
    const store = useAiStore()
    store.setProvider('glm')
    store.setApiKey('sk-abc')

    store.reset()

    expect(store.config).toEqual(DEFAULT_AI_CONFIG)
    expect(store.configured).toBe(false)
  })

  it('地址与模型写入时去空白', () => {
    const store = useAiStore()
    store.setBaseUrl('  https://api.example.com/v1  ')
    store.setModel('  gpt-x  ')

    expect(store.config.baseUrl).toBe('https://api.example.com/v1')
    expect(store.config.model).toBe('gpt-x')
  })
})
