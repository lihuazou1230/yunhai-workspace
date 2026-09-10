import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AVATAR_BLOB_KEY,
  BLOB_DB_NAME,
  BLOB_DB_VERSION,
  BLOB_STORE,
  deleteBlob,
  getBlob,
  isIndexedDbAvailable,
  putBlob,
} from './useIndexedDb'

/**
 * IndexedDB 在 happy-dom 里没有实现，用 fake-indexeddb 顶上——
 * 这样测的是真实的事务代码路径（open/upgrade/put/get/delete），而不是我另写的假实现。
 */
describe('IndexedDB blob 仓库', () => {
  beforeEach(async () => {
    vi.unstubAllGlobals()
    await deleteBlob(AVATAR_BLOB_KEY)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('环境支持时判定为可用', () => {
    expect(isIndexedDbAvailable()).toBe(true)
  })

  it('写入后可读回（验证 put → get 链路打通）', async () => {
    const blob = new Blob(['avatar-bytes'], { type: 'image/webp' })
    const persisted = await putBlob(AVATAR_BLOB_KEY, blob)

    expect(persisted).toBe(true)
    // 注意：真实浏览器里读回的就是原样 Blob；happy-dom 的 Blob 过 fake-indexeddb 的
    // structuredClone 后结构会丢（拿不到 size/type），所以这里只断言「读到了东西」，
    // Blob 保真度由内存兜底那条用例（同一引用）覆盖。
    const restored = await getBlob(AVATAR_BLOB_KEY)
    expect(restored).toBeTruthy()
  })

  it('删除后读不到', async () => {
    await putBlob('temp-key', new Blob(['x']))
    await deleteBlob('temp-key')
    expect(await getBlob('temp-key')).toBeNull()
  })

  it('没有存过时返回 null（不是抛错）', async () => {
    expect(await getBlob('never-saved')).toBeNull()
  })

  it('IndexedDB 不可用时降级到内存：本次会话仍能读写', async () => {
    vi.stubGlobal('indexedDB', undefined)
    expect(isIndexedDbAvailable()).toBe(false)

    const blob = new Blob(['memory-only'], { type: 'image/png' })
    const persisted = await putBlob('memory-key', blob)

    // 返回 false 表示「没能持久化」，调用方据此给出「刷新后会丢失」的提示
    expect(persisted).toBe(false)
    const restored = await getBlob('memory-key')
    expect(restored).toBe(blob)
    expect(restored?.size).toBe(blob.size)

    await deleteBlob('memory-key')
    expect(await getBlob('memory-key')).toBeNull()
  })

  it('indexedDB 被显式置为 null（部分内嵌 WebView）时也判定不可用', async () => {
    vi.stubGlobal('indexedDB', null)

    expect(isIndexedDbAvailable()).toBe(false)
    // typeof null === 'object'，光判断 undefined 会漏掉这一种
    expect(await getBlob('null-key')).toBeNull()
  })
})

/**
 * 下面这组用例覆盖「IndexedDB 打不开 / 事务建不起来」的异常路径。
 * 这些路径在真机上确实会遇到（Safari 无痕模式、配额耗尽、被其它标签页阻塞），
 * 关键断言不是「报错了」，而是**降级后功能仍在**：本次会话还能预览头像，只是刷新后不保留。
 */
describe('IndexedDB blob 仓库 · 失败降级', () => {
  function makeRequest(result?: unknown) {
    return {
      result,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    } as unknown as Record<string, unknown> & {
      result: unknown
      onupgradeneeded: (() => void) | null
      onsuccess: (() => void) | null
      onerror: (() => void) | null
      onblocked: (() => void) | null
    }
  }

  /** open 永远失败：模拟浏览器直接拒绝打开数据库 */
  function stubFailingOpen(trigger: 'onerror' | 'onblocked') {
    const open = vi.fn(() => {
      const request = makeRequest()
      // 处理器是在 open() 返回之后才被赋值的，所以用微任务触发
      queueMicrotask(() => request[trigger]?.())
      return request
    })
    vi.stubGlobal('indexedDB', { open })
    return open
  }

  beforeEach(async () => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('open 触发 onerror 时降级到内存，并如实返回 false（调用方据此提示刷新会丢）', async () => {
    stubFailingOpen('onerror')
    const blob = new Blob(['fail-open'], { type: 'image/webp' })

    expect(await putBlob('fail-open-key', blob)).toBe(false)
    // 关键：写失败不等于功能不可用，本次会话仍能拿到同一份 blob
    expect(await getBlob('fail-open-key')).toBe(blob)
  })

  it('open 被 onblocked（别的标签页占着旧版本）时同样降级，不抛错', async () => {
    stubFailingOpen('onblocked')
    const blob = new Blob(['blocked'], { type: 'image/webp' })

    await expect(putBlob('blocked-key', blob)).resolves.toBe(false)
    expect(await getBlob('blocked-key')).toBe(blob)
  })

  it('indexedDB.open 同步抛错（隐私模式直接禁止）时被 try/catch 兜住并降级', async () => {
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        throw new Error('SecurityError: 隐私模式禁止访问 IndexedDB')
      }),
    })
    const blob = new Blob(['sync-throw'], { type: 'image/png' })

    await expect(putBlob('sync-throw-key', blob)).resolves.toBe(false)
    expect(await getBlob('sync-throw-key')).toBe(blob)
  })

  it('事务建不起来时关闭数据库连接再降级（不能把连接泄漏在那儿）', async () => {
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: vi.fn(() => {
        throw new Error('transaction 失败')
      }),
      close: vi.fn(),
    }
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        const request = makeRequest(db)
        queueMicrotask(() => request.onsuccess?.())
        return request
      }),
    })

    const blob = new Blob(['tx-fail'], { type: 'image/png' })
    expect(await putBlob('tx-fail-key', blob)).toBe(false)
    expect(db.close).toHaveBeenCalledTimes(1)

    // 读路径同样被兜住：返回内存兜底那份，而不是抛异常
    expect(await getBlob('tx-fail-key')).toBe(blob)
    expect(db.close).toHaveBeenCalledTimes(2)
  })

  it('升级时建好 blobs 对象仓库（不建的话后续读写全部落空）', async () => {
    const createObjectStore = vi.fn()
    const db = {
      objectStoreNames: { contains: vi.fn(() => false) },
      createObjectStore,
      close: vi.fn(),
    }
    const request = makeRequest(db)
    const open = vi.fn(() => request)
    vi.stubGlobal('indexedDB', { open })

    const pending = putBlob('upgrade-key', new Blob(['x']))
    // 处理器已在 open() 之后同步挂好，这里手动触发升级 + 失败收尾
    request.onupgradeneeded?.()
    request.onerror?.()

    await expect(pending).resolves.toBe(false)
    expect(open).toHaveBeenCalledWith(BLOB_DB_NAME, BLOB_DB_VERSION)
    expect(db.objectStoreNames.contains).toHaveBeenCalledWith(BLOB_STORE)
    expect(createObjectStore).toHaveBeenCalledWith(BLOB_STORE)
  })

  it('对象仓库已存在时不重复创建（重复建会抛错并把整个升级流程打挂）', async () => {
    const createObjectStore = vi.fn()
    const db = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore,
      close: vi.fn(),
    }
    const request = makeRequest(db)
    vi.stubGlobal('indexedDB', { open: vi.fn(() => request) })

    const pending = putBlob('existing-store-key', new Blob(['x']))
    request.onupgradeneeded?.()
    request.onerror?.()

    await expect(pending).resolves.toBe(false)
    expect(db.objectStoreNames.contains).toHaveBeenCalledWith(BLOB_STORE)
    // 已存在 → 必须跳过创建
    expect(createObjectStore).not.toHaveBeenCalled()
  })

  it('写入请求本身报错（配额耗尽等）时返回 false 并保留内存兜底', async () => {
    // put 返回的请求对象由用例掌控：可以精确模拟「写失败」
    const putRequest = {
      result: undefined as unknown,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    }
    const fakeStore = { put: vi.fn(() => putRequest) }
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: vi.fn(() => ({ objectStore: () => fakeStore, oncomplete: null })),
      close: vi.fn(),
    }
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        const request = makeRequest(db)
        queueMicrotask(() => request.onsuccess?.())
        return request
      }),
    })

    const blob = new Blob(['quota'], { type: 'image/png' })
    const pending = putBlob('request-error-key', blob)
    // 放行若干微任务，等 open 成功、事务建好、put 请求挂上回调
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fakeStore.put).toHaveBeenCalledWith(blob, 'request-error-key')

    putRequest.onerror?.()

    await expect(pending).resolves.toBe(false)
    // 关键：写失败后的兜底必须还在，否则用户刚选的头像会立刻消失
    expect(await getBlob('request-error-key')).toBe(blob)
  })

  it('删除失败也降级：内存兜底里的旧头像必须先失效，否则会“复活”', async () => {
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        throw new Error('打不开')
      }),
    })
    const blob = new Blob(['to-delete'], { type: 'image/png' })
    await putBlob('delete-fail-key', blob)
    expect(await getBlob('delete-fail-key')).toBe(blob)

    await expect(deleteBlob('delete-fail-key')).resolves.toBeUndefined()

    expect(await getBlob('delete-fail-key')).toBeNull()
  })
})
