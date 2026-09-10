import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Supabase 客户端的打桩方式与 `todoRemote.spec.ts` 保持一致：
 * 只替换 `requireSupabaseClient`，未注入时抛真的 `SupabaseUnavailableError`
 * ——这样「未配置 Supabase」这条分支测的是真代码，而不是我编出来的假错误。
 */
const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('./supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./supabase')>()
  return {
    ...actual,
    requireSupabaseClient: () => {
      if (!holder.client) throw new actual.SupabaseUnavailableError()
      return holder.client
    },
  }
})

import {
  NOTIFY_FUNCTION_NAME,
  NOTIFY_MESSAGES,
  isNotifyFunctionAvailable,
  sendWxPusherViaProxy,
} from './notify'
import type { NotifyPayload } from './notify'

type InvokeResult = { data: unknown; error: unknown }

/** 造一个 supabase-js 风格的错误对象：`context` 是原始 Response */
function invokeError(status: number, body?: unknown, message?: string): Error {
  const error = new Error(message ?? 'Edge Function returned a non-2xx status code')
  error.name = 'FunctionsHttpError'
  Object.assign(error, {
    context: {
      status,
      json: async () => {
        if (body === undefined) throw new SyntaxError('Unexpected token < in JSON')
        return body
      },
    },
  })
  return error
}

/** 网络层失败（FunctionsFetchError 没有 context） */
function fetchError(message = 'Failed to send a request to the Edge Function'): Error {
  const error = new Error(message)
  error.name = 'FunctionsFetchError'
  return error
}

function installClient(result: InvokeResult | (() => Promise<InvokeResult>)) {
  const invoke = vi.fn(typeof result === 'function' ? result : async () => result)
  holder.client = { functions: { invoke } }
  return invoke
}

const payload: NotifyPayload = {
  uid: 'UID_abcdefghijklmnopqrstuvwx',
  title: '写周报',
  content: '<p>写周报</p>',
  url: 'https://app.example.com/#/todos?focus=t1',
}

describe('sendWxPusherViaProxy', () => {
  beforeEach(() => {
    holder.client = null
  })

  it('成功：调 notify 函数并带上 uid/title/content/url', async () => {
    const invoke = installClient({ data: { ok: true }, error: null })

    expect(await sendWxPusherViaProxy(payload)).toEqual({ ok: true })

    expect(invoke).toHaveBeenCalledTimes(1)
    const [name, options] = invoke.mock.calls[0] as unknown as [string, { body: NotifyPayload }]
    expect(name).toBe(NOTIFY_FUNCTION_NAME)
    expect(options.body).toEqual(payload)
  })

  it('未配置 Supabase：给一句短文案，不发请求', async () => {
    const result = await sendWxPusherViaProxy(payload)

    expect(result).toEqual({ ok: false, error: NOTIFY_MESSAGES.unconfigured })
    expect(result.ok).toBe(false)
  })

  it('401/403：统一给中文「请先登录」，不把平台的英文鉴权报文抛给用户', async () => {
    // 平台层（verify_jwt）与函数内校验都会回 401，两者报文措辞不同，
    // 甚至可能夹带英文（Missing authorization header），所以这里一律归一成我们的文案
    installClient({
      data: null,
      error: invokeError(401, { code: 401, message: 'Missing authorization header' }),
    })
    expect(await sendWxPusherViaProxy(payload)).toEqual({
      ok: false,
      error: NOTIFY_MESSAGES.unauthenticated,
    })

    installClient({ data: null, error: invokeError(403, { message: 'Forbidden' }) })
    expect(await sendWxPusherViaProxy(payload)).toEqual({
      ok: false,
      error: NOTIFY_MESSAGES.unauthenticated,
    })
  })

  it('401 且响应体读不出来：还是同一句中文', async () => {
    installClient({ data: null, error: invokeError(401) })
    expect(await sendWxPusherViaProxy(payload)).toEqual({
      ok: false,
      error: NOTIFY_MESSAGES.unauthenticated,
    })
  })

  it('404：提示函数未部署（这是最容易被忘的一步）', async () => {
    installClient({
      data: null,
      error: invokeError(404, { code: 404, message: 'Requested function was not found' }),
    })

    const result = await sendWxPusherViaProxy(payload)
    expect(result).toEqual({ ok: false, error: NOTIFY_MESSAGES.notDeployed })
    expect(result.ok === false && result.error).toContain('supabase functions deploy notify')
  })

  it('400：原样透传服务端的中文校验文案', async () => {
    installClient({
      data: null,
      error: invokeError(400, { error: '缺少有效的接收人 UID（请在设置页粘贴扫码后获得的 UID）' }),
    })

    const result = await sendWxPusherViaProxy(payload)
    expect(result.ok === false && result.error).toContain('UID')
  })

  it('502/503：透传服务端文案（WxPusher 拒绝 / 没配 appToken）', async () => {
    installClient({
      data: null,
      error: invokeError(502, { error: '微信推送被拒绝：appToken 无效' }),
    })
    expect(await sendWxPusherViaProxy(payload)).toEqual({
      ok: false,
      error: '微信推送被拒绝：appToken 无效',
    })

    installClient({
      data: null,
      error: invokeError(503, { error: '服务端未配置 WXPUSHER_APP_TOKEN，微信推送不可用' }),
    })
    const result = await sendWxPusherViaProxy(payload)
    expect(result.ok === false && result.error).toContain('WXPUSHER_APP_TOKEN')
  })

  it('5xx 且没有可读文案：给「暂时不可用」', async () => {
    installClient({ data: null, error: invokeError(500) })
    expect(await sendWxPusherViaProxy(payload)).toEqual({
      ok: false,
      error: NOTIFY_MESSAGES.unavailable,
    })
  })

  it('网络层失败（FunctionsFetchError）：给「暂时不可用」而不是英文原文', async () => {
    installClient({ data: null, error: fetchError() })
    expect(await sendWxPusherViaProxy(payload)).toEqual({
      ok: false,
      error: NOTIFY_MESSAGES.unavailable,
    })
  })

  it('invoke 直接拒绝（SDK 升级 / 桩抛错）也resolve 成 { ok: false }，绝不向外抛', async () => {
    installClient(() => Promise.reject(new Error('boom')))

    const result = await sendWxPusherViaProxy(payload)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe(NOTIFY_MESSAGES.unavailable)
  })

  it('invoke 同步抛出也兜得住（提醒流程不能被它带崩）', async () => {
    holder.client = {
      functions: {
        invoke: () => {
          throw new TypeError('Failed to fetch')
        },
      },
    }

    await expect(sendWxPusherViaProxy(payload)).resolves.toEqual({
      ok: false,
      error: NOTIFY_MESSAGES.unavailable,
    })
  })

  it('超时（AbortError）：同样只提示稍后重试', async () => {
    installClient(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    expect(await sendWxPusherViaProxy(payload)).toEqual({
      ok: false,
      error: NOTIFY_MESSAGES.unavailable,
    })
  })
})

describe('isNotifyFunctionAvailable（设置页探测）', () => {
  beforeEach(() => {
    holder.client = null
  })

  it('400 + JSON 错误体：函数已部署（它自己在校验入参）', async () => {
    const invoke = installClient({
      data: null,
      error: invokeError(400, { error: '缺少有效的接收人 UID（请在设置页粘贴扫码后获得的 UID）' }),
    })

    expect(await isNotifyFunctionAvailable()).toBe(true)
    // 探测必须发非法入参，否则会真给用户推一条消息
    const [, options] = invoke.mock.calls[0] as unknown as [string, { body: { uid: string } }]
    expect(options.body.uid).toBe('')
  })

  it('404：未部署', async () => {
    installClient({ data: null, error: invokeError(404, { code: 404, message: 'not found' }) })
    expect(await isNotifyFunctionAvailable()).toBe(false)
  })

  it('401/503：函数在（只是未登录 / 服务端配置缺失），视为已部署', async () => {
    installClient({ data: null, error: invokeError(401, { error: '未登录' }) })
    expect(await isNotifyFunctionAvailable()).toBe(true)

    installClient({ data: null, error: invokeError(503, { error: '未配置 appToken' }) })
    expect(await isNotifyFunctionAvailable()).toBe(true)
  })

  it('400 但没有 JSON 错误体：不算部署成功（区分中间层自造的 400）', async () => {
    installClient({ data: null, error: invokeError(400) })
    expect(await isNotifyFunctionAvailable()).toBe(false)
  })

  it('未配置 Supabase：直接 false，不发请求', async () => {
    expect(await isNotifyFunctionAvailable()).toBe(false)
  })

  it('网络不通：判不了 → false（宁可提示不可用，也不谎报可用）', async () => {
    installClient({ data: null, error: fetchError() })
    expect(await isNotifyFunctionAvailable()).toBe(false)

    installClient(() => Promise.reject(new Error('boom')))
    expect(await isNotifyFunctionAvailable()).toBe(false)
  })

  it('万一返回 2xx（不该发生）：也算已部署', async () => {
    installClient({ data: { ok: true }, error: null })
    expect(await isNotifyFunctionAvailable()).toBe(true)
  })
})
