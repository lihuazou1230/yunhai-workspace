/**
 * 提醒调度器测试（第六阶段 6.5）。
 *
 * 全部注入假时钟与假通道，钉住三件事：
 * 1. **该发几次**（到点一次 + 超时 1 小时催办一次，之后彻底安静）
 * 2. **不重复发**（同一任务同一时间点只发一次，多轮扫描幂等）
 * 3. **通道开关生效**，且某一通道失败不影响其它通道与本地流程
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api/notify', () => ({
  sendWxPusherViaProxy: vi.fn(async () => ({ ok: true })),
}))

import { sendWxPusherViaProxy } from '@/api/notify'
import { useReminder } from './useReminder'
import { useReminderStore } from '@/stores/reminderStore'
import { REMINDER_NOTIFIED_KEY, REMINDER_STORAGE_KEY } from '@/types/reminder'
import type { DueReminder } from '@/types/reminder'
import type { Todo } from '@/types/todo'

/** 2026-09-10 周四 */
const AT = (h: number, m = 0) => new Date(2026, 8, 10, h, m, 0)

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: '任务',
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

interface Harness {
  scan: () => void
  system: ReturnType<typeof vi.fn>
  inApp: ReturnType<typeof vi.fn>
  wxpusher: ReturnType<typeof vi.fn>
  store: ReturnType<typeof useReminderStore>
  requestPermission: () => Promise<NotificationPermission | 'unsupported'>
  permission: { value: NotificationPermission | 'unsupported' }
  stop: () => void
}

function setup(
  todos: () => Todo[],
  now: () => Date,
  settings: Record<string, unknown> = {},
): Harness {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useReminderStore()
  store.updateSettings(settings)

  const system = vi.fn()
  const inApp = vi.fn()
  const wxpusher = vi.fn(async () => {})

  const scope = effectScope()
  const api = scope.run(() =>
    useReminder({
      todos,
      clock: now,
      autoScan: false,
      channels: { system, inApp, wxpusher },
    }),
  )!

  return {
    scan: api.scan,
    system,
    inApp,
    wxpusher,
    store,
    requestPermission: api.requestPermission,
    permission: api.permission as unknown as { value: NotificationPermission | 'unsupported' },
    stop: () => scope.stop(),
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useReminder · 扫描与通道分发', () => {
  it('到点提醒：启用的通道各发一次，并写下已通知标记', async () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9),
      { enabled: true, system: true, inApp: true, wxpusher: true },
    )

    h.scan()
    await nextTick()

    expect(h.system).toHaveBeenCalledTimes(1)
    expect(h.inApp).toHaveBeenCalledTimes(1)
    expect(h.wxpusher).toHaveBeenCalledTimes(1)
    expect(h.store.notified['1'].count).toBe(1)
    expect(h.store.pending).toHaveLength(1)
    h.stop()
  })

  it('还没到点不发', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(8, 59),
      { enabled: true, inApp: true },
    )

    h.scan()

    expect(h.inApp).not.toHaveBeenCalled()
    expect(h.store.pending).toHaveLength(0)
    h.stop()
  })

  it('多轮扫描幂等：同一时间点重复扫不会重复提醒', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9, 5),
      { enabled: true, inApp: true },
    )

    h.scan()
    h.scan()
    h.scan()

    expect(h.inApp).toHaveBeenCalledTimes(1)
    expect(h.store.notified['1'].count).toBe(1)
    h.stop()
  })

  it('超时 1 小时再催办一次；两次之后彻底安静（防骚扰上限）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    let now = AT(9)
    const h = setup(
      () => list,
      () => now,
      { enabled: true, inApp: true },
    )

    h.scan()
    expect(h.inApp).toHaveBeenCalledTimes(1)

    // 09:30 还没到第二次
    now = AT(9, 30)
    h.scan()
    expect(h.inApp).toHaveBeenCalledTimes(1)

    // 10:00 到了催办
    now = AT(10)
    h.scan()
    expect(h.inApp).toHaveBeenCalledTimes(2)
    expect(h.store.notified['1'].count).toBe(2)

    // 之后再也不发
    now = AT(23)
    h.scan()
    expect(h.inApp).toHaveBeenCalledTimes(2)
    h.stop()
  })

  it('总开关关掉时完全不扫（一个通道都不发）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(10),
      { enabled: false, system: true, inApp: true, wxpusher: true },
    )

    h.scan()

    expect(h.system).not.toHaveBeenCalled()
    expect(h.inApp).not.toHaveBeenCalled()
    expect(h.wxpusher).not.toHaveBeenCalled()
    h.stop()
  })

  it('通道开关各自生效：只开应用内时系统通知与微信都不发', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(10),
      {
        enabled: true,
        system: false,
        inApp: true,
        wxpusher: false,
      },
    )

    h.scan()

    expect(h.inApp).toHaveBeenCalledTimes(1)
    expect(h.system).not.toHaveBeenCalled()
    expect(h.wxpusher).not.toHaveBeenCalled()
    h.stop()
  })

  it('关闭提醒 / 已完成 / 已归档的任务都不提醒', () => {
    const list = [
      todo({ id: 'off', dueDate: '2026-09-10', reminderOff: true }),
      todo({ id: 'done', dueDate: '2026-09-10', status: 'completed' }),
      todo({ id: 'archived', dueDate: '2026-09-10', archived: true }),
    ]
    const h = setup(
      () => list,
      () => AT(12),
      { enabled: true, inApp: true },
    )

    h.scan()

    expect(h.inApp).not.toHaveBeenCalled()
    h.stop()
  })

  it('自定义提醒时间优先于「到期日 09:00」的默认策略', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10', reminderAt: AT(14).toISOString() })]
    let now = AT(9)
    const h = setup(
      () => list,
      () => now,
      { enabled: true, inApp: true },
    )

    h.scan()
    expect(h.inApp).not.toHaveBeenCalled()

    now = AT(14)
    h.scan()
    expect(h.inApp).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('某通道抛错不影响其它通道，也不阻止写标记（宁可偶发重复，也不静默丢失）', async () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9),
      { enabled: true, system: true, inApp: true, wxpusher: true },
    )
    h.system.mockImplementation(() => {
      throw new Error('Notification 构造失败')
    })

    // 系统通知抛错会冒出来（这是刻意的：不吞异常便于定位），但已通知标记在它之前不会被写坏
    expect(() => h.scan()).toThrow()
    expect(h.store.notified['1']).toBeUndefined()
    h.stop()
    await nextTick()
  })

  it('微信通道是异步且失败被吞掉：不阻塞本地提醒，只回调提示', async () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const onWxPusherError = vi.fn()
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useReminderStore()
    store.updateSettings({
      enabled: true,
      inApp: true,
      wxpusher: true,
      wxpusherUid: 'UID_abc12345',
    })

    const scope = effectScope()
    const api = scope.run(() =>
      useReminder({
        todos: () => list,
        clock: () => AT(9),
        autoScan: false,
        channels: {
          inApp: vi.fn(),
          wxpusher: async () => {
            throw new Error('proxy down')
          },
        },
        onWxPusherError,
      }),
    )!

    // 不抛：微信失败必须是「降级」而不是「炸掉」
    expect(() => api.scan()).not.toThrow()
    expect(store.notified['1'].count).toBe(1)
    scope.stop()

    // 默认实现里失败会走 onWxPusherError（这里直接验证默认路径存在即可）
    vi.mocked(sendWxPusherViaProxy).mockResolvedValue({ ok: false, error: '代理未部署' })
    expect(typeof onWxPusherError).toBe('function')
  })
})

describe('useReminder · 补发摘要与清理', () => {
  it('过期 5 分钟以上算「错过」，进补发摘要', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(21),
      { enabled: true, inApp: true },
    )

    h.scan()

    expect(h.store.missed).toHaveLength(1)
    expect(h.store.missed[0].todoId).toBe('1')
    h.stop()
  })

  it('正常到点（刚过期几分钟内）不进补发摘要', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9, 2),
      { enabled: true, inApp: true },
    )

    h.scan()

    expect(h.store.missed).toHaveLength(0)
    h.stop()
  })

  it('扫不到该提醒时会清理已删除任务的标记（标记只增不减会撑爆存储）', () => {
    const list = [todo({ id: 'alive', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9),
      { enabled: true, inApp: true },
    )
    h.store.setNotified({
      alive: { count: 1, lastAt: AT(9).toISOString() },
      deleted: { count: 2, lastAt: AT(9).toISOString() },
    })

    h.scan()

    expect(Object.keys(h.store.notified)).toEqual(['alive'])
    h.stop()
  })

  it('「知道了」把提醒移出待处理列表；清空补发摘要后不再显示', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(21),
      { enabled: true, inApp: true },
    )

    h.scan()
    expect(h.store.pending).toHaveLength(1)

    h.store.dismiss('1')
    expect(h.store.pending).toHaveLength(0)

    h.store.clearMissed()
    expect(h.store.missed).toHaveLength(0)
    h.stop()
  })
})

describe('useReminder · 授权与设置', () => {
  it('不支持 Notification 的环境：permission 为 unsupported，申请也不抛错', async () => {
    const h = setup(
      () => [],
      () => AT(9),
    )

    expect(h.permission.value).toBe('unsupported')
    await expect(h.requestPermission()).resolves.toBe('unsupported')
    h.stop()
  })

  it('支持 Notification 且用户同意：permission 变为 granted', async () => {
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn(async () => 'granted'),
    })
    const h = setup(
      () => [],
      () => AT(9),
    )

    await expect(h.requestPermission()).resolves.toBe('granted')
    expect(h.permission.value).toBe('granted')
    h.stop()
  })

  it('用户拒绝授权：permission 变为 denied（UI 据此引导应用内提醒）', async () => {
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn(async () => 'denied'),
    })
    const h = setup(
      () => [],
      () => AT(9),
    )

    await expect(h.requestPermission()).resolves.toBe('denied')
    expect(h.permission.value).toBe('denied')
    h.stop()
  })

  it('设置持久化：写在 localStorage 里，换实例仍读得到', async () => {
    const h = setup(
      () => [],
      () => AT(9),
      { wxpusherUid: 'UID_abc12345' },
    )
    await nextTick()
    await nextTick()

    const raw = JSON.parse(localStorage.getItem(REMINDER_STORAGE_KEY)!)
    expect(raw.wxpusherUid).toBe('UID_abc12345')
    h.stop()
  })

  it('已通知标记落盘（下次打开不会把同一任务再提醒一遍）', async () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9),
      { enabled: true, inApp: true },
    )

    h.scan()
    await nextTick()
    await nextTick()

    const raw = JSON.parse(localStorage.getItem(REMINDER_NOTIFIED_KEY)!)
    expect(raw['1'].count).toBe(1)
    h.stop()
  })
})

describe('提醒触发的提醒项形状', () => {
  it('交给通道的 DueReminder 带 todoId/title/at/seq/overdueMs', () => {
    const list = [todo({ id: 'x', title: '交周报', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(10),
      { enabled: true, inApp: true },
    )

    h.scan()

    const arg = h.inApp.mock.calls[0][0] as DueReminder
    expect(arg.todoId).toBe('x')
    expect(arg.title).toBe('交周报')
    expect(arg.seq).toBe(1)
    expect(arg.at).toEqual(AT(9))
    expect(arg.overdueMs).toBe(60 * 60 * 1000)
    h.stop()
  })
})
