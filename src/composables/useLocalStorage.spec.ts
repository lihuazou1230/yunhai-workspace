import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useLocalStorage } from './useLocalStorage'

const KEY = 'test-key'

function createMockStorage() {
  const store = new Map<string, string>()
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v)
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k)
    }),
  }
}

describe('useLocalStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('无存储时返回默认值', () => {
    const storage = createMockStorage() as unknown as Storage
    const value = useLocalStorage<string>(KEY, 'hello', storage)
    expect(value.value).toBe('hello')
  })

  it('值变化后写入 JSON', async () => {
    const storage = createMockStorage() as unknown as Storage
    const value = useLocalStorage<{ n: number }>(KEY, { n: 0 }, storage)
    value.value = { n: 42 }
    await nextTick()
    expect(storage.setItem).toHaveBeenCalledWith(KEY, '{"n":42}')
  })

  it('再次读取时恢复已存值', async () => {
    const storage = createMockStorage() as unknown as Storage
    const first = useLocalStorage<number>(KEY, 0, storage)
    first.value = 7
    await nextTick()
    const second = useLocalStorage<number>(KEY, 0, storage)
    expect(second.value).toBe(7)
  })

  it('损坏 JSON 回退默认值', () => {
    const storage = {
      getItem: vi.fn(() => '{oops'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown as Storage
    const value = useLocalStorage<number>(KEY, 1, storage)
    expect(value.value).toBe(1)
  })
})

/**
 * 上面几条都显式注入了假存储，测的是「注入之后」的逻辑；
 * 下面这几条补的是**生产实际走的那条路**——不注入（默认 window.localStorage）、
 * 注入 null、以及存储本身抛错。这三条才是线上会不会炸的分界线。
 */
describe('useLocalStorage · 默认存储与故障降级', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('不注入存储时默认用 window.localStorage：读得到上次存的值，也写得回去', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ n: 9 }))

    // 不传第三个参数 = 生产调用方式（reminderStore、themeStore 等都这么用）
    const value = useLocalStorage<{ n: number }>(KEY, { n: 0 })
    expect(value.value).toEqual({ n: 9 })

    value.value = { n: 1 }
    await nextTick()
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ n: 1 })
  })

  it('注入 null（无存储环境）：只保留内存态，读写都不抛错', () => {
    const value = useLocalStorage<number>(KEY, 1, null)
    // 读：直接给默认值，而不是去碰一个不存在的存储
    expect(value.value).toBe(1)

    // 写：静默跳过，业务拿到的新值仍然生效（界面不能因为存不下就不更新）
    expect(() => {
      value.value = 5
    }).not.toThrow()
    expect(value.value).toBe(5)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('没有 window（SSR 预渲染）时自动降级为内存态，不让 window 未定义把渲染打挂', () => {
    vi.stubGlobal('window', undefined)

    const value = useLocalStorage<number>(KEY, 3)
    expect(value.value).toBe(3)
    expect(() => {
      value.value = 4
    }).not.toThrow()
  })

  it('写入超限（QuotaExceededError）被吞掉：容量满了不该中断用户的正常操作', async () => {
    // Safari 隐私模式 / localStorage 写满都会走到这里
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }),
      removeItem: vi.fn(),
    } as unknown as Storage

    const value = useLocalStorage<number>(KEY, 1, storage)
    value.value = 42
    await nextTick()

    expect(storage.setItem).toHaveBeenCalled()
    // 落盘失败，但内存态必须是新值——否则用户会看到「点了没反应」
    expect(value.value).toBe(42)
  })

  it('读取本身抛错（隐私模式禁用存储）时回退默认值', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException('denied', 'SecurityError')
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown as Storage

    expect(useLocalStorage<number>(KEY, 8, storage).value).toBe(8)
  })
})
