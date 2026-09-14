import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TURNSTILE_ERROR_MESSAGE,
  TURNSTILE_SCRIPT_SRC,
  TURNSTILE_UNAVAILABLE_MESSAGE,
  loadTurnstileScript,
  resetTurnstileScript,
  useTurnstile,
} from './useTurnstile'
import type { TurnstileApi, TurnstileRenderOptions } from './useTurnstile'

/** 造一个假 widget API：把渲染参数（回调）留给我们自己触发 */
function fakeApi() {
  const renders: TurnstileRenderOptions[] = []
  const api: TurnstileApi = {
    render: vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      renders.push(options)
      return 'widget-1'
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  return { api, renders }
}

/** 造一个「总是加载成功」的 loader */
function fakeLoader(api: TurnstileApi) {
  return vi.fn(async () => api)
}

const SITE_KEY = '1x00000000000000000000AA'

beforeEach(() => {
  resetTurnstileScript()
  delete window.turnstile
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loadTurnstileScript（CDN 脚本加载）', () => {
  /**
   * 注入只做记录的 appender：测试环境不去真的 fetch CDN，
   * load / error / timeout 三条分支完全由用例自己 dispatchEvent 驱动。
   */
  function captureAppend() {
    const captured: HTMLScriptElement[] = []
    return { captured, append: (script: HTMLScriptElement) => captured.push(script) }
  }

  it('已经有 window.turnstile 时直接返回，不再插标签', async () => {
    const { api } = fakeApi()
    window.turnstile = api
    const { captured, append } = captureAppend()

    await expect(loadTurnstileScript(10_000, append)).resolves.toBe(api)
    expect(captured).toHaveLength(0)
  })

  it('首次加载：插入官方脚本标签（显式渲染模式）', async () => {
    const { api } = fakeApi()
    const { captured, append } = captureAppend()
    const pending = loadTurnstileScript(10_000, append)

    expect(captured).toHaveLength(1)
    expect(captured[0].src).toBe(TURNSTILE_SCRIPT_SRC)
    expect(captured[0].async).toBe(true)

    // script onload 触发时 Cloudflare 已经把 window.turnstile 挂好了
    window.turnstile = api
    captured[0].dispatchEvent(new Event('load'))
    await expect(pending).resolves.toBe(api)
  })

  it('复用同一次请求：并发/重复调用只插一次标签', async () => {
    const { api } = fakeApi()
    const { captured, append } = captureAppend()
    const first = loadTurnstileScript(10_000, append)
    const second = loadTurnstileScript(10_000, append)
    expect(captured).toHaveLength(1)

    window.turnstile = api
    captured[0].dispatchEvent(new Event('load'))
    await expect(first).resolves.toBe(api)
    await expect(second).resolves.toBe(api)
  })

  it('脚本加载失败：reject 且清掉缓存，重试会重新插标签（不然重试是空转）', async () => {
    const { captured, append } = captureAppend()
    const pending = loadTurnstileScript(10_000, append)
    const firstFailure = expect(pending).rejects.toThrow('加载失败')
    captured[0].dispatchEvent(new Event('error'))
    await firstFailure

    const retry = loadTurnstileScript(10_000, append)
    const secondFailure = expect(retry).rejects.toThrow('加载失败')
    expect(captured).toHaveLength(2)
    captured[1].dispatchEvent(new Event('error'))
    await secondFailure
  })

  it('onload 了但 API 没挂上（被 CSP 拦成空壳等情况）：按失败处理', async () => {
    const { captured, append } = captureAppend()
    const pending = loadTurnstileScript(10_000, append)
    const assertion = expect(pending).rejects.toThrow('API 不可用')
    captured[0].dispatchEvent(new Event('load'))
    await assertion
  })

  it('超时：网络卡住时按失败处理，不把注册页永远吊在「正在校验」', async () => {
    vi.useFakeTimers()
    const { append } = captureAppend()
    const pending = loadTurnstileScript(5000, append)
    const assertion = expect(pending).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })
})

describe('useTurnstile（token 状态机）', () => {
  it('未配置 siteKey：disabled，且不拦注册（不放行 = 锁死注册功能，比不验证更糟）', async () => {
    const loader = fakeLoader(fakeApi().api)
    const captcha = useTurnstile({ siteKey: '', loader })

    expect(captcha.enabled).toBe(false)
    expect(captcha.status.value).toBe('disabled')
    expect(captcha.blocked.value).toBe(false)
    expect(captcha.failed.value).toBe(false)

    await captcha.mount(document.createElement('div'))
    expect(loader).not.toHaveBeenCalled()
    expect(captcha.status.value).toBe('disabled')
  })

  it('状态流转：loading → verifying → passed，并把回调交给 widget', async () => {
    const { api, renders } = fakeApi()
    const captcha = useTurnstile({ siteKey: SITE_KEY, loader: fakeLoader(api) })
    const container = document.createElement('div')

    expect(captcha.status.value).toBe('idle')
    const mounting = captcha.mount(container)
    expect(captcha.status.value).toBe('loading')
    // 加载完成前不能提交
    expect(captcha.blocked.value).toBe(true)

    await mounting
    expect(captcha.status.value).toBe('verifying')
    expect(renders).toHaveLength(1)
    expect(renders[0].sitekey).toBe(SITE_KEY)

    // widget 回调：拿到一次性 token
    renders[0].callback('one-shot-token')
    expect(captcha.status.value).toBe('passed')
    expect(captcha.token.value).toBe('one-shot-token')
    expect(captcha.passed.value).toBe(true)
    expect(captcha.blocked.value).toBe(false)
  })

  it('token 过期：token 作废、回到需要重新验证的状态（附说明）', async () => {
    const { api, renders } = fakeApi()
    const captcha = useTurnstile({ siteKey: SITE_KEY, loader: fakeLoader(api) })
    await captcha.mount(document.createElement('div'))
    renders[0].callback('tok')
    expect(captcha.passed.value).toBe(true)

    renders[0]['expired-callback']()
    expect(captcha.status.value).toBe('expired')
    expect(captcha.token.value).toBe('')
    expect(captcha.blocked.value).toBe(true)
    expect(captcha.message.value).toContain('过期')
  })

  it('widget 报错：error 态 + 可重试提示', async () => {
    const { api, renders } = fakeApi()
    const captcha = useTurnstile({ siteKey: SITE_KEY, loader: fakeLoader(api) })
    await captcha.mount(document.createElement('div'))

    renders[0]['error-callback']()
    expect(captcha.status.value).toBe('error')
    expect(captcha.failed.value).toBe(true)
    expect(captcha.message.value).toBe(TURNSTILE_ERROR_MESSAGE)
    expect(captcha.blocked.value).toBe(true)
  })

  it('脚本加载失败：unavailable + 中文说明（注册按钮据此置灰）', async () => {
    const loader = vi.fn(async () => {
      throw new Error('boom')
    })
    const captcha = useTurnstile({ siteKey: SITE_KEY, loader })

    await captcha.mount(document.createElement('div'))
    expect(captcha.status.value).toBe('unavailable')
    expect(captcha.message.value).toBe(TURNSTILE_UNAVAILABLE_MESSAGE)
    expect(captcha.failed.value).toBe(true)
    expect(captcha.blocked.value).toBe(true)
  })

  it('reset()：清掉一次性 token 并让 widget 重新出题（注册失败后必须调）', async () => {
    const { api, renders } = fakeApi()
    const captcha = useTurnstile({ siteKey: SITE_KEY, loader: fakeLoader(api) })
    await captcha.mount(document.createElement('div'))
    renders[0].callback('tok')

    captcha.reset()
    expect(captcha.token.value).toBe('')
    expect(captcha.status.value).toBe('verifying')
    expect(captcha.blocked.value).toBe(true)
    expect(api.reset).toHaveBeenCalledWith('widget-1')
  })

  it('脚本都没加载成功时 reset() 会重新拉一次脚本（重试不是空转）', async () => {
    const { api } = fakeApi()
    const loader = vi
      .fn<() => Promise<TurnstileApi>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(api)
    const captcha = useTurnstile({ siteKey: SITE_KEY, loader })

    await captcha.mount(document.createElement('div'))
    expect(captcha.status.value).toBe('unavailable')

    captcha.reset()
    await vi.waitFor(() => expect(captcha.status.value).toBe('verifying'))
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('加载期间切了容器：不再往旧容器渲染（SPA 切页会留下孤儿 widget）', async () => {
    const { api, renders } = fakeApi()
    const captcha = useTurnstile({ siteKey: SITE_KEY, loader: fakeLoader(api) })
    const first = document.createElement('div')
    const second = document.createElement('div')

    const mountingFirst = captcha.mount(first)
    const mountingSecond = captcha.mount(second)
    await Promise.all([mountingFirst, mountingSecond])

    expect(renders).toHaveLength(1)
    expect(api.render).toHaveBeenCalledWith(second, expect.anything())
  })

  it('dispose()：把 widget 还给 Cloudflare（组件卸载时自动调用）', async () => {
    const { api } = fakeApi()
    const captcha = useTurnstile({ siteKey: SITE_KEY, loader: fakeLoader(api) })
    await captcha.mount(document.createElement('div'))

    captcha.dispose()
    expect(api.remove).toHaveBeenCalledWith('widget-1')
  })

  it('默认 loader / siteKey 从环境变量读（未配置时 degraded 为 disabled）', () => {
    const captcha = useTurnstile()
    expect(captcha.siteKey).toBe('')
    expect(captcha.status.value).toBe('disabled')
  })
})
