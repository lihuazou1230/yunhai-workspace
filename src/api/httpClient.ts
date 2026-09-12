/**
 * 原生 fetch 请求层（无 axios 依赖）
 * - 超时控制：AbortController
 * - 错误分类：timeout / network / http / json
 * - JSON 解析与统一错误对象 HttpError
 */

export type HttpErrorKind = 'timeout' | 'network' | 'http' | 'json'

export class HttpError extends Error {
  readonly kind: HttpErrorKind
  readonly status: number
  readonly url: string

  constructor(kind: HttpErrorKind, url: string, status = 0, message?: string) {
    super(message ?? defaultMessage(kind, status, url))
    this.name = 'HttpError'
    this.kind = kind
    this.status = status
    this.url = url
  }
}

function defaultMessage(kind: HttpErrorKind, status: number, url: string): string {
  switch (kind) {
    case 'timeout':
      return `请求超时: ${url}`
    case 'network':
      return `网络错误: ${url}`
    case 'http':
      return `HTTP ${status}: ${url}`
    case 'json':
      return `响应不是合法 JSON: ${url}`
  }
}

export interface HttpClientOptions extends RequestInit {
  /** 超时毫秒数，默认 10000 */
  timeoutMs?: number
}

function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'AbortError') ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError')
  )
}

/** 发起请求并返回解析后的 JSON。任何失败都抛 HttpError。 */
export async function httpClient<T>(url: string, options: HttpClientOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, ...fetchInit } = options
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    try {
      res = await fetch(url, { ...fetchInit, signal: controller.signal })
    } catch (err) {
      if (isAbortError(err)) {
        throw new HttpError('timeout', url, 0, defaultMessage('timeout', 0, url))
      }
      throw new HttpError('network', url, 0, defaultMessage('network', 0, url))
    }

    if (!res.ok) {
      throw new HttpError('http', url, res.status, defaultMessage('http', res.status, url))
    }

    /**
     * 读 body 也要包起来：这不是多余的防御——流已被消费、连接中途断开、
     * 响应被 abort 都会让 `res.text()` 自己 reject。漏掉的话上层按 `kind` 分类处理的
     * 地方会拿到一个没有 `kind` 的原始 TypeError，与「任何失败都抛 HttpError」的约定不符。
     */
    let text: string
    try {
      text = await res.text()
    } catch {
      throw new HttpError('network', url, res.status, defaultMessage('network', res.status, url))
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw new HttpError('json', url, res.status, defaultMessage('json', res.status, url))
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
