import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import {
  TURNSTILE_LOADER_KEY,
  TURNSTILE_UNAVAILABLE_MESSAGE,
  resetTurnstileScript,
} from '@/composables/useTurnstile'
import type { TurnstileApi, TurnstileRenderOptions } from '@/composables/useTurnstile'
import TurnstileCaptcha from './TurnstileCaptcha.vue'

const SITE_KEY = '1x00000000000000000000AA'

/** 假 widget API：渲染参数（回调）留在手里，由用例触发 */
function fakeApi() {
  const renders: TurnstileRenderOptions[] = []
  const api: TurnstileApi = {
    render: vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      renders.push(options)
      return 'w1'
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  return { api, renders }
}

function mountCaptcha(options: { siteKey?: string; loader?: () => Promise<TurnstileApi> } = {}) {
  return mount(TurnstileCaptcha, {
    props: { siteKey: options.siteKey ?? SITE_KEY },
    global: {
      // 注入假 loader：单测不拉 CDN，也不依赖 Cloudflare 的可用性
      provide: options.loader ? { [TURNSTILE_LOADER_KEY]: options.loader } : {},
    },
  })
}

beforeEach(() => {
  resetTurnstileScript()
})

describe('TurnstileCaptcha（人机验证原子组件）', () => {
  it('未配置 siteKey：不渲染 widget，只说明「当前不校验」，把注册让出去', () => {
    const wrapper = mountCaptcha({ siteKey: '' })

    expect(wrapper.find('[data-testid="turnstile-widget"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="turnstile-disabled"]').text()).toContain(
      'VITE_TURNSTILE_SITE_KEY',
    )
    expect(wrapper.emitted('status')?.[0]).toEqual(['disabled'])
  })

  it('验证通过：向上播一次性 token 与状态，并给用户一个「已通过」的确认', async () => {
    const { api, renders } = fakeApi()
    const wrapper = mountCaptcha({ loader: async () => api })
    await flushPromises()

    expect(wrapper.find('[data-testid="turnstile-widget"]').exists()).toBe(true)
    expect(renders).toHaveLength(1)

    renders[0].callback('one-shot-token')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['one-shot-token'])
    expect(wrapper.emitted('status')?.at(-1)).toEqual(['passed'])
    expect(wrapper.find('[data-testid="turnstile-passed"]').exists()).toBe(true)
  })

  it('验证中先告诉用户在等（而不是留一块空白）', async () => {
    const { api } = fakeApi()
    let release: (value: TurnstileApi) => void = () => {}
    const wrapper = mountCaptcha({
      loader: () =>
        new Promise<TurnstileApi>((resolve) => {
          release = resolve
        }),
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="turnstile-verifying"]').exists()).toBe(true)

    release(api)
    await flushPromises()
    expect(wrapper.find('[data-testid="turnstile-verifying"]').exists()).toBe(true)
  })

  it('脚本加载失败：给出原因 + 重试入口（重试会真的重新拉一次）', async () => {
    const { api } = fakeApi()
    const loader = vi
      .fn<() => Promise<TurnstileApi>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(api)
    const wrapper = mountCaptcha({ loader })
    await flushPromises()

    const error = wrapper.find('[data-testid="turnstile-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain(TURNSTILE_UNAVAILABLE_MESSAGE)

    await wrapper.find('[data-testid="turnstile-retry"]').trigger('click')
    await flushPromises()

    expect(loader).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="turnstile-error"]').exists()).toBe(false)
    expect(wrapper.emitted('status')?.at(-1)).toEqual(['verifying'])
  })

  it('token 过期：提示 + 「重新验证」，点击后清空 token 并让 widget 重新出题', async () => {
    const { api, renders } = fakeApi()
    const wrapper = mountCaptcha({ loader: async () => api })
    await flushPromises()
    renders[0].callback('tok')
    await flushPromises()

    renders[0]['expired-callback']()
    await flushPromises()
    expect(wrapper.find('[data-testid="turnstile-expired"]').exists()).toBe(true)
    // token 已作废：父组件的 v-model 也要收到空值
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])

    await wrapper.find('[data-testid="turnstile-reverify"]').trigger('click')
    expect(api.reset).toHaveBeenCalledWith('w1')
    expect(wrapper.emitted('status')?.at(-1)).toEqual(['verifying'])
  })

  it('卸载时把 widget 还给 Cloudflare（SPA 切页不留孤儿 iframe）', async () => {
    const { api } = fakeApi()
    const wrapper = mountCaptcha({ loader: async () => api })
    await flushPromises()

    wrapper.unmount()
    expect(api.remove).toHaveBeenCalledWith('w1')
  })
})
