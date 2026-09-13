import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useWorkLog } from './useWorkLog'
import { WORKLOG_STORAGE_KEY } from '@/utils/workLog'

function createMockStorage() {
  const store = new Map<string, string>()
  return {
    store,
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v)
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k)
    }),
  }
}

describe('useWorkLog', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('记录某天的计薪秒数并落盘', async () => {
    const storage = createMockStorage()
    const { record, log } = useWorkLog(storage as unknown as Storage)

    record('2026-09-15', 3600)
    expect(log.value).toEqual({ '2026-09-15': 3600 })

    await nextTick()
    expect(JSON.parse(storage.store.get(WORKLOG_STORAGE_KEY)!)).toEqual({ '2026-09-15': 3600 })
  })

  it('重复记录同一个值不再写存储（秒表 100ms 一次 tick，不拦截就是每秒十次全量序列化）', async () => {
    const storage = createMockStorage()
    const { record } = useWorkLog(storage as unknown as Storage)

    record('2026-09-15', 600)
    await nextTick()
    const writes = storage.setItem.mock.calls.length

    record('2026-09-15', 600)
    record('2026-09-15', 300) // 更小的值也不写（取大值语义）
    await nextTick()
    expect(storage.setItem.mock.calls.length).toBe(writes)
  })

  it('值变大时更新', async () => {
    const storage = createMockStorage()
    const { record, log } = useWorkLog(storage as unknown as Storage)

    record('2026-09-15', 600)
    record('2026-09-15', 900)
    expect(log.value['2026-09-15']).toBe(900)
  })

  it('记录时顺带裁掉窗口外的老记录（localStorage 不会无限长胖）', () => {
    const storage = createMockStorage()
    storage.store.set(WORKLOG_STORAGE_KEY, JSON.stringify({ '2020-01-01': 3600 }))
    const { record, log } = useWorkLog(storage as unknown as Storage)

    record('2026-09-15', 600)
    expect(log.value['2020-01-01']).toBeUndefined()
    expect(log.value['2026-09-15']).toBe(600)
  })

  it('hoursOn 换算小时，缺失记 0', () => {
    const storage = createMockStorage()
    const { record, hoursOn } = useWorkLog(storage as unknown as Storage)

    record('2026-09-15', 5400)
    expect(hoursOn('2026-09-15')).toBe(1.5)
    expect(hoursOn('2026-09-14')).toBe(0)
  })

  it('totalSeconds 累计到今天为止（未来日期不计入）', () => {
    const storage = createMockStorage()
    const { record, totalSeconds } = useWorkLog(storage as unknown as Storage)

    record('2020-01-01', 600)
    expect(totalSeconds.value).toBe(600)
  })

  it('reset 清空日志', () => {
    const storage = createMockStorage()
    const { record, reset, log } = useWorkLog(storage as unknown as Storage)

    record('2026-09-15', 600)
    reset()
    expect(log.value).toEqual({})
  })

  it('脏存储（非法形状）不会把页面打挂', () => {
    const storage = createMockStorage()
    storage.store.set(WORKLOG_STORAGE_KEY, '"oops"')
    const { log, hoursOn } = useWorkLog(storage as unknown as Storage)
    expect(log.value).toEqual({})
    expect(hoursOn('2026-09-15')).toBe(0)
  })
})
