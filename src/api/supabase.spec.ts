import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import {
  SUPABASE_SETUP_HINT,
  SupabaseUnavailableError,
  checkSupabaseConnection,
  getSupabaseClient,
  isSupabaseConfigured,
  readSupabaseEnv,
  requireSupabaseClient,
  resetSupabaseClient,
} from './supabase'

/** 用桩替换真正的 createClient：这里只验证「何时创建、是否复用」，不发任何请求 */
const createClientMock = vi.hoisted(() => vi.fn(() => ({ kind: 'client' })))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

describe('Supabase 配置读取与客户端单例', () => {
  beforeEach(() => {
    // 显式清空而不是 unstubAllEnvs：后者会把开发机 .env.local 的真实配置读回来
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    resetSupabaseClient()
    createClientMock.mockClear()
  })

  it('未配置时读取到空串，且判定为未配置', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    expect(readSupabaseEnv()).toEqual({ url: '', anonKey: '' })
    expect(isSupabaseConfigured()).toBe(false)
  })

  it('只填一半视为未配置（避免半配置状态下白屏）', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    expect(isSupabaseConfigured()).toBe(false)
  })

  it('配置齐全后（含首尾空格）判定为已配置', () => {
    vi.stubEnv('VITE_SUPABASE_URL', ' https://demo.supabase.co ')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', ' anon-key ')
    expect(readSupabaseEnv()).toEqual({ url: 'https://demo.supabase.co', anonKey: 'anon-key' })
    expect(isSupabaseConfigured()).toBe(true)
  })

  it('未配置时 getSupabaseClient 返回 null，requireSupabaseClient 抛引导错误', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')

    expect(getSupabaseClient()).toBeNull()
    expect(() => requireSupabaseClient()).toThrow(SupabaseUnavailableError)
    try {
      requireSupabaseClient()
    } catch (error) {
      expect((error as Error).message).toBe(SUPABASE_SETUP_HINT)
      expect((error as Error).message).toContain('.env.local')
    }
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('已配置时按需创建并复用客户端（同样的配置只创建一次）', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

    const first = getSupabaseClient()
    const second = getSupabaseClient()
    expect(first).toBe(second)
    expect(createClientMock).toHaveBeenCalledTimes(1)
    expect(createClientMock).toHaveBeenCalledWith(
      'https://demo.supabase.co',
      'anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: true, autoRefreshToken: true }),
      }),
    )
  })

  it('配置变化时重建客户端（换 Supabase 项目不用刷新页面）', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://a.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'key-a')
    const first = getSupabaseClient()

    vi.stubEnv('VITE_SUPABASE_URL', 'https://b.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'key-b')
    const second = getSupabaseClient()

    expect(second).not.toBe(first)
    expect(createClientMock).toHaveBeenCalledTimes(2)
  })

  it('已配置时 requireSupabaseClient 返回同一个单例（写操作入口不会各建一个客户端）', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

    const required = requireSupabaseClient()

    // 与 getSupabaseClient 必须指向同一实例：否则会话/令牌会在两份客户端之间不同步
    expect(required).toBe(getSupabaseClient())
    expect(createClientMock).toHaveBeenCalledTimes(1)
  })
})

describe('连接自检 checkSupabaseConnection', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('正常：打到 /auth/v1/health 且带上 apikey', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await checkSupabaseConnection()

    expect(result.ok).toBe(true)
    expect(result.message).toContain('连接正常')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.supabase.co/auth/v1/health',
      expect.objectContaining({ headers: { apikey: 'anon-key' } }),
    )
  })

  it('密钥无效（401）：明确指出是密钥问题而不是网络问题', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401 })),
    )

    const result = await checkSupabaseConnection()

    expect(result.ok).toBe(false)
    expect(result.message).toContain('密钥无效')
    expect(result.detail).toContain('401')
  })

  it('HTTP 异常状态：原样报出状态码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    )
    const result = await checkSupabaseConnection()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('503')
  })

  it('域名解析不了（fetch 直接抛错）：提示多半是 Project URL 抄错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const result = await checkSupabaseConnection()

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Project URL')
    // 把实际请求地址摊出来，方便对着 .env.local 核对
    expect(result.detail).toContain('https://demo.supabase.co/auth/v1/health')
  })

  it('超时（AbortError）：提示超时', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }),
    )

    const result = await checkSupabaseConnection()
    expect(result.message).toContain('超时')
  })

  it('未配置时不发请求，直接给配置引导', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await checkSupabaseConnection()

    expect(result.ok).toBe(false)
    expect(result.message).toContain('本地模式')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('配置读取与超时保护的边界情况', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** 永不返回、只在收到 abort 信号时拒绝的 fetch 替身（配合假时钟测超时，不产生真实等待） */
  function hangingFetch() {
    return vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
    )
  }

  it('环境变量键根本不存在（不是空串）时同样按未配置处理，不抛错', () => {
    const env = import.meta.env as Record<string, unknown>
    const had = Object.prototype.hasOwnProperty.call(env, 'VITE_SUPABASE_URL')
    try {
      // .env.local 里只写了 anon key 的情况：这个键根本不存在，读出来是 undefined 而不是 ''
      delete env.VITE_SUPABASE_URL
      expect(env.VITE_SUPABASE_URL).toBeUndefined()

      expect(readSupabaseEnv().url).toBe('')
      expect(isSupabaseConfigured()).toBe(false)
      expect(getSupabaseClient()).toBeNull()

      // 反过来只写了 url、没写 key：同样不许半配置状态下白屏
      env.VITE_SUPABASE_URL = 'https://demo.supabase.co'
      delete env.VITE_SUPABASE_ANON_KEY
      expect(readSupabaseEnv().anonKey).toBe('')
      expect(isSupabaseConfigured()).toBe(false)
    } finally {
      if (had) env.VITE_SUPABASE_URL = 'https://demo.supabase.co'
      else delete env.VITE_SUPABASE_URL
    }
  })

  it('连接自检超时时明确提示「请求超时」，而不是含糊地说地址抄错了', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())

    const pending = checkSupabaseConnection(8000)
    await vi.advanceTimersByTimeAsync(8000)
    const result = await pending

    expect(result.ok).toBe(false)
    expect(result.message).toContain('超时')
    expect(result.detail).toContain('/auth/v1/health')
  })
})
