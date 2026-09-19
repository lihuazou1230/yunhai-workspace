/**
 * 账号级设置同步引擎（第九阶段）的用例。
 *
 * 这里把 `userSettingsRemote` 与 `supabase` 都换成桩：要测的是**同步策略**本身
 * （何时推、何时拉、冲突归谁、换账号怎么办、离线怎么办），网络细节在各自的 spec 里。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const remote = vi.hoisted(() => ({
  rows: {} as Record<string, { value: unknown; updatedAt: string }>,
  fetchError: null as unknown,
  upsertError: null as unknown,
  fetchCalls: 0,
  upserts: [] as { userId: string; key: string; value: unknown }[],
  /** 每次 upsert 自动前进的云端时间戳 */
  clock: 0,
}))

vi.mock('@/api/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/supabase')>()
  return { ...actual, isSupabaseConfigured: () => true }
})

vi.mock('@/api/userSettingsRemote', () => ({
  fetchRemoteSettings: async (_userId: string) => {
    remote.fetchCalls++
    if (remote.fetchError) throw remote.fetchError
    return { ...remote.rows }
  },
  fetchRemoteSetting: async (_userId: string, key: string) => remote.rows[key] ?? null,
  upsertRemoteSetting: async (userId: string, key: string, value: unknown) => {
    if (remote.upsertError) throw remote.upsertError
    remote.upserts.push({ userId, key, value })
    remote.clock += 1000
    const updatedAt = new Date(Date.UTC(2026, 8, 13, 0, 0, 0) + remote.clock).toISOString()
    remote.rows[key] = { value, updatedAt }
    return updatedAt
  },
}))

import {
  __resetSettingsSyncForTests,
  activateSettingsSync,
  deactivateSettingsSync,
  describeSettingsSyncError,
  flushSettingsPending,
  pullSettings,
  stableStringify,
  syncSettingsNow,
  useSettingsSync,
  useSyncedStorage,
} from './useSyncedStorage'
import { SETTINGS_META_KEY, SETTINGS_OWNER_KEY, SETTINGS_PENDING_KEY } from '@/types/settings'
import { LOCAL_ONLY_KEYS, SYNCED_KEYS } from '@/types/settings'
import { useWorkLog } from './useWorkLog'

const THEME_KEY = 'smart-workspace:theme'
const TAGS_KEY = 'smart-workspace:tags'
const WORKLOG_KEY = 'smart-workspace:worklog'

const THEME_DEFAULT = { mode: 'system', colorName: 'emerald' }

/** 等防抖（800ms 推送 / 300ms 拉取）跑完 */
async function settle(ms = 900) {
  vi.advanceTimersByTime(ms)
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}

function readStored(key: string): unknown {
  const raw = window.localStorage.getItem(key)
  return raw === null ? null : (JSON.parse(raw) as unknown)
}

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  // 模块级单例：内存态必须一起清（只清 localStorage 会让上一条用例的 pending 漏过来）
  __resetSettingsSyncForTests()
  remote.rows = {}
  remote.fetchError = null
  remote.upsertError = null
  remote.fetchCalls = 0
  remote.upserts = []
  remote.clock = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('stableStringify / describeSettingsSyncError', () => {
  it('键序不同的同一份数据序列化结果相同（否则会被误判成"有差异"）', () => {
    expect(stableStringify({ a: 1, b: [2, { c: 3 }] })).toBe(
      stableStringify({ b: [2, { c: 3 }], a: 1 }),
    )
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(undefined)).toBe('null')
    expect(stableStringify('x')).toBe('"x"')
  })

  it('失败原因：Error / 带 message 的对象 / 其它都能给出文案', () => {
    expect(describeSettingsSyncError(new Error('网络断了'))).toBe('网络断了')
    expect(describeSettingsSyncError({ message: 'rls 拒绝' })).toBe('rls 拒绝')
    expect(describeSettingsSyncError({ message: 42 })).toBe('[object Object]')
    expect(describeSettingsSyncError(null)).toBe('同步失败')
    expect(describeSettingsSyncError('oops')).toBe('oops')
  })
})

describe('登录后的首次同步', () => {
  it('本地已有的设置被推上账号（一次性迁移），默认值不推', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    const tags = useSyncedStorage(TAGS_KEY, [] as { id: string }[])
    theme.value = { mode: 'dark', colorName: 'rose' }

    await activateSettingsSync('u1')
    await settle()

    const pushed = remote.upserts.map((item) => item.key)
    expect(pushed).toContain(THEME_KEY)
    // 标签还是默认空数组：没必要为它写一行
    expect(pushed).not.toContain(TAGS_KEY)
    expect(remote.rows[THEME_KEY].value).toEqual({ mode: 'dark', colorName: 'rose' })
    expect(tags.value).toEqual([])
  })

  it('云端已有的项被拉到本机（新设备登录即同一套）', async () => {
    remote.rows[THEME_KEY] = {
      value: { mode: 'dark', colorName: 'lavender' },
      updatedAt: '2026-09-13T00:00:10.000Z',
    }

    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')

    expect(theme.value).toEqual({ mode: 'dark', colorName: 'lavender' })
    expect(readStored(THEME_KEY)).toEqual({ mode: 'dark', colorName: 'lavender' })
  })

  it('云端没有、本地也是默认值：一次请求搞定，不产生任何写入', async () => {
    useSyncedStorage(TAGS_KEY, [] as unknown[])
    await activateSettingsSync('u1')
    await settle()

    expect(remote.fetchCalls).toBe(1)
    expect(remote.upserts).toHaveLength(0)
  })

  it('注册到一半就登录（懒注册的 store）也会补拉一次', async () => {
    await activateSettingsSync('u1')
    const before = remote.fetchCalls

    remote.rows[TAGS_KEY] = { value: [{ id: 't1' }], updatedAt: '2026-09-13T00:00:20.000Z' }
    const tags = useSyncedStorage(TAGS_KEY, [] as { id: string }[])
    await settle(400)

    expect(remote.fetchCalls).toBeGreaterThan(before)
    expect(tags.value).toEqual([{ id: 't1' }])
  })
})

describe('本地改动 → 云端', () => {
  it('防抖后推送，并记下云端返回的 updated_at', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')

    theme.value = { mode: 'dark', colorName: 'emerald' }
    // 防抖窗口内改三次只该产生一次推送
    theme.value = { mode: 'light', colorName: 'emerald' }
    theme.value = { mode: 'dark', colorName: 'sky' }
    await settle()

    expect(remote.upserts.filter((item) => item.key === THEME_KEY)).toHaveLength(1)
    expect(remote.rows[THEME_KEY].value).toEqual({ mode: 'dark', colorName: 'sky' })
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_META_KEY) ?? '{}')[THEME_KEY]).toBe(
      remote.rows[THEME_KEY].updatedAt,
    )
  })

  it('内容没变（只是对象身份变了）不推送：useEarnings 的 config ↔ stored 回灌就靠这条', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')
    const before = remote.upserts.length

    theme.value = { ...theme.value }
    await settle()

    expect(remote.upserts).toHaveLength(before)
  })

  it('未登录时的改动不进队列（否则登录时会把很久以前的本地值顶掉账号里的新值）', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    theme.value = { mode: 'dark', colorName: 'rose' }
    await settle()
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_PENDING_KEY) ?? '[]')).toEqual([])
  })
})

describe('冲突与合并', () => {
  it('本地有未推送的改动 → 以本地为准，推送覆盖云端', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')

    // 另一台设备先改（云端时间戳更新）
    remote.rows[THEME_KEY] = {
      value: { mode: 'dark', colorName: 'rose' },
      updatedAt: '2026-09-13T00:00:30.000Z',
    }
    // 本机随后也改（尚未推送）
    theme.value = { mode: 'light', colorName: 'amber' }

    await syncSettingsNow()
    expect(remote.rows[THEME_KEY].value).toEqual({ mode: 'light', colorName: 'amber' })
    expect(theme.value).toEqual({ mode: 'light', colorName: 'amber' })
  })

  it('本地没有改动、云端时间戳变过 → 采用云端', async () => {
    remote.rows[THEME_KEY] = {
      value: { mode: 'dark', colorName: 'rose' },
      updatedAt: '2026-09-13T00:00:10.000Z',
    }
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')
    expect(theme.value.mode).toBe('dark')

    remote.rows[THEME_KEY] = {
      value: { mode: 'light', colorName: 'sky' },
      updatedAt: '2026-09-13T00:00:40.000Z',
    }
    await pullSettings()
    expect(theme.value).toEqual({ mode: 'light', colorName: 'sky' })
  })

  it('云端时间戳没变过就不重复施加（避免每次拉取都改写 UI）', async () => {
    remote.rows[THEME_KEY] = {
      value: { mode: 'dark', colorName: 'rose' },
      updatedAt: '2026-09-13T00:00:10.000Z',
    }
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')

    const snapshot = theme.value
    await pullSettings()
    expect(theme.value).toBe(snapshot)
  })

  it('投入日志按日期逐项取大值合并，两边都记的日子不丢', async () => {
    remote.rows[WORKLOG_KEY] = {
      value: { '2026-09-10': 8 * 3600, '2026-09-12': 3 * 3600 },
      updatedAt: '2026-09-13T00:00:10.000Z',
    }
    // 用真实的 useWorkLog（而不是在用例里重写一份合并逻辑），
    // 否则测的是"测试自己的实现"，生产里那条 merge 分支一行都没跑到
    const { log } = useWorkLog()

    await activateSettingsSync('u1')
    // 本机多记了 09-11，且 09-10 记得比云端少
    log.value = { '2026-09-10': 2 * 3600, '2026-09-11': 4 * 3600 }

    await syncSettingsNow()

    expect(remote.rows[WORKLOG_KEY].value).toEqual({
      // 09-10 取云端的大值、09-11 是本机独有、09-12 是云端独有
      '2026-09-10': 8 * 3600,
      '2026-09-11': 4 * 3600,
      '2026-09-12': 3 * 3600,
    })
    expect(log.value).toEqual({
      '2026-09-10': 8 * 3600,
      '2026-09-11': 4 * 3600,
      '2026-09-12': 3 * 3600,
    })
  })
})

describe('离线与重试', () => {
  it('推送失败时留在队列里，联网后补发成功', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')

    remote.upsertError = { message: 'Failed to fetch' }
    theme.value = { mode: 'dark', colorName: 'rose' }
    await settle()

    expect(JSON.parse(window.localStorage.getItem(SETTINGS_PENDING_KEY) ?? '[]')).toEqual([
      THEME_KEY,
    ])
    const { status } = useSettingsSync()
    expect(status.lastError).toContain('Failed to fetch')

    remote.upsertError = null
    await flushSettingsPending()
    expect(remote.rows[THEME_KEY].value).toEqual({ mode: 'dark', colorName: 'rose' })
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_PENDING_KEY) ?? '[]')).toEqual([])
    expect(status.lastError).toBe('')
  })

  it('拉取失败只是记下原因，不影响本地继续用', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')
    theme.value = { mode: 'dark', colorName: 'rose' }

    remote.fetchError = { message: 'offline' }
    const ok = await pullSettings()

    expect(ok).toBe(false)
    expect(theme.value).toEqual({ mode: 'dark', colorName: 'rose' })
    expect(useSettingsSync().status.lastError).toBe('offline')
  })

  it('未登录时同步是空操作', async () => {
    deactivateSettingsSync()
    expect(await syncSettingsNow()).toBe(false)
    expect(await flushSettingsPending()).toBe(0)
    expect(await pullSettings()).toBe(false)
  })
})

describe('跨账号隔离', () => {
  it('换账号登录：本地先重置为默认，再拉新账号的设置（不会把 A 的偏好写进 B）', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')
    theme.value = { mode: 'dark', colorName: 'rose' }
    await settle()
    deactivateSettingsSync()

    // B 账号在云端是另一套
    remote.rows[THEME_KEY] = {
      value: { mode: 'light', colorName: 'sky' },
      updatedAt: '2026-09-13T01:00:00.000Z',
    }
    remote.upserts = []

    await activateSettingsSync('u2')
    await settle()

    expect(theme.value).toEqual({ mode: 'light', colorName: 'sky' })
    // 关键：没有把 A 的 dark/rose 推给 B
    expect(remote.upserts.filter((item) => item.key === THEME_KEY)).toHaveLength(0)
  })

  it('登出后再登同一个账号：不白重置一次（本地值原样保留）', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')
    theme.value = { mode: 'dark', colorName: 'rose' }
    await settle()
    deactivateSettingsSync()

    await activateSettingsSync('u1')
    expect(theme.value).toEqual({ mode: 'dark', colorName: 'rose' })
  })

  it('本地模式（从未登录）的数据算「本机访客」，首次登录按迁移推上去', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    theme.value = { mode: 'dark', colorName: 'violet' }

    await activateSettingsSync('u1')
    await settle()
    expect(remote.rows[THEME_KEY].value).toEqual({ mode: 'dark', colorName: 'violet' })
  })

  it('owner 记录本机数据属于谁；登出后标记为 signed-out', async () => {
    await activateSettingsSync('u1')
    await nextTick()
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_OWNER_KEY)!)).toBe('u1')

    deactivateSettingsSync()
    await nextTick()
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_OWNER_KEY)!)).toBe('signed-out')
  })
})

describe('同步清单自检', () => {
  it('清单里没有重复键，且与「不同步清单」不重叠（写错一处就会两边都动那个键）', () => {
    const syncedKeys = SYNCED_KEYS.map((item) => item.key)
    expect(new Set(syncedKeys).size).toBe(syncedKeys.length)
    expect(syncedKeys.filter((key) => LOCAL_ONLY_KEYS.some((item) => item.key === key))).toEqual([])
  })

  it('凭证与设备相关项明确留在本机（微信 UID / 已通知标记 / 天气 / 定位）', () => {
    const localKeys = LOCAL_ONLY_KEYS.map((item) => item.key)
    for (const key of [
      'smart-workspace:wxpusher-uid',
      'smart-workspace:reminder-notified',
      'smart-workspace:weather-cache',
      'smart-workspace:last-place',
    ]) {
      expect(localKeys).toContain(key)
    }
    // 每一项都要给出「为什么不同步」，否则设置页会出现无解释的缺口
    expect(LOCAL_ONLY_KEYS.every((item) => item.label && item.reason)).toBe(true)
  })

  it('不在清单里的键不会被注册（写错 key 不会静默同步）', async () => {
    await activateSettingsSync('u1')
    const value = useSyncedStorage('smart-workspace:not-in-list', { a: 1 })
    value.value = { a: 2 }
    await settle()

    expect(remote.upserts.some((item) => item.key === 'smart-workspace:not-in-list')).toBe(false)
  })
})

describe('useSettingsSync 展示状态', () => {
  it('待推送数量与已完成项数可读（设置页据此渲染）', async () => {
    const theme = useSyncedStorage(THEME_KEY, { ...THEME_DEFAULT })
    await activateSettingsSync('u1')
    const state = useSettingsSync()

    theme.value = { mode: 'dark', colorName: 'rose' }
    expect(state.pendingCount.value).toBe(1)
    expect(state.pendingItems.value[0].label).toBe('主题与外观')

    await settle()
    expect(state.pendingCount.value).toBe(0)
    expect(state.syncedCount.value).toBe(1)
    expect(state.syncing.value).toBe(false)
    expect(state.syncedKeys.length).toBeGreaterThan(0)
    expect(state.localOnlyKeys.some((item) => item.key.includes('wxpusher'))).toBe(true)
  })
})
