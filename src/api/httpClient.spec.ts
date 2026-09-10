import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpError, httpClient } from './httpClient'

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

/** 永远挂着、只在收到 abort 信号时拒绝的 fetch 替身（用来测超时，不产生真实等待） */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) return reject(abortError())
        signal?.addEventListener('abort', () => reject(abortError()))
      }),
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('httpClient', () => {
  it('成功时解析 JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ value: 7 }),
      })),
    )
    const data = await httpClient<{ value: number }>('https://api.test/ok')
    expect(data).toEqual({ value: 7 })
  })

  it('非 2xx 时抛 http 错误并携带状态码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      })),
    )
    await expect(httpClient('https://api.test/missing')).rejects.toMatchObject({
      name: 'HttpError',
      kind: 'http',
      status: 404,
    })
  })

  it('fetch 抛出网络异常时抛 network 错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
    )
    await expect(httpClient('https://api.test/net')).rejects.toMatchObject({
      name: 'HttpError',
      kind: 'network',
    })
  })

  it('超时（AbortController 触发）时抛 timeout 错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal
            if (signal?.aborted) return reject(abortError())
            signal?.addEventListener('abort', () => reject(abortError()))
          }),
      ),
    )
    await expect(httpClient('https://api.test/slow', { timeoutMs: 10 })).rejects.toMatchObject({
      name: 'HttpError',
      kind: 'timeout',
    })
  })

  it('响应不是合法 JSON 时抛 json 错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => 'not-json',
      })),
    )
    await expect(httpClient('https://api.test/empty')).rejects.toMatchObject({
      name: 'HttpError',
      kind: 'json',
    })
  })

  it('HttpError 传了 message 时用它，不传才按 kind/status 拼默认文案', () => {
    // 调用方（业务接口层）需要把技术错误换成更贴业务的提示，这条口子必须留着
    const custom = new HttpError('http', 'https://api.test/x', 500, '服务器开小差了，请稍后重试')
    expect(custom.message).toBe('服务器开小差了，请稍后重试')
    expect(custom.name).toBe('HttpError')
    expect(custom.kind).toBe('http')
    expect(custom.status).toBe(500)
    expect(custom.url).toBe('https://api.test/x')

    // 不传时四种 kind 各有默认文案（错误提示里必须能看出是哪一类问题）
    expect(new HttpError('timeout', 'u').message).toBe('请求超时: u')
    expect(new HttpError('network', 'u').message).toBe('网络错误: u')
    expect(new HttpError('http', 'u', 503).message).toBe('HTTP 503: u')
    expect(new HttpError('json', 'u').message).toBe('响应不是合法 JSON: u')
  })

  it('未传 timeoutMs 时默认 10 秒才超时（不会因为挂了请求把界面一直卡住）', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())

    let outcome: unknown = null
    const settled = httpClient('https://api.test/default-timeout').then(
      (value) => {
        outcome = { ok: true, value }
      },
      (error: unknown) => {
        outcome = { ok: false, error }
      },
    )

    // 差 1 毫秒到 10 秒：还在默认窗口内，绝不能提前判超时（否则慢接口全被误杀）
    await vi.advanceTimersByTimeAsync(9_999)
    expect(outcome).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await settled

    expect(outcome).toMatchObject({ ok: false, error: { name: 'HttpError', kind: 'timeout' } })
    // 全程没有任何真实等待：假时钟推进 10 秒是瞬时的
    vi.useRealTimers()
  })

  it('中止错误是普通对象（只有 name: AbortError，不是 DOMException）时同样判为超时', async () => {
    // 有些运行环境/请求库抛的是 { name: 'AbortError' } 这样的普通对象，
    // 只认 DOMException 会把「超时」误报成「网络错误」，用户照着网络去排查就找错方向了
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject({ name: 'AbortError', message: 'aborted' })),
    )

    await expect(httpClient('https://api.test/plain-abort')).rejects.toMatchObject({
      name: 'HttpError',
      kind: 'timeout',
      status: 0,
    })
  })

  it('500 也按 http 错误处理并原样带上状态码与文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'boom',
      })),
    )

    const error = await httpClient('https://api.test/boom').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({
      name: 'HttpError',
      kind: 'http',
      status: 500,
      message: 'HTTP 500: https://api.test/boom',
    })
  })

  it('响应体为空串时按 json 错误抛（空响应体不是合法 JSON）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => '' })),
    )

    const error = await httpClient('https://api.test/no-body').catch((e: unknown) => e)

    expect(error).toMatchObject({ name: 'HttpError', kind: 'json', status: 200 })
  })

  it('读响应体本身失败时原样抛出（并未被包装成 HttpError，调用方拿到的是原始错误）', async () => {
    // 注意：当前实现的行为如此（疑似缺陷，未修，已上报）——
    // res.text() 在 try 里、但没有任何 catch 包装它，所以流被消费/连接中断时
    // 抛出去的是原始错误（如 TypeError），与模块注释承诺的「任何失败都抛 HttpError」不一致，
    // 上层按 kind 分类处理的地方会收到一个没有 kind 的错误。
    const broken = new TypeError('body stream already read')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => {
          throw broken
        },
      })),
    )

    const error = await httpClient('https://api.test/broken-body').catch((e: unknown) => e)

    expect(error).toBe(broken)
    expect(error).not.toBeInstanceOf(HttpError)
  })
})
