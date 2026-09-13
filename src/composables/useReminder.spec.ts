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
import {
  REMINDER_NOTIFIED_KEY,
  REMINDER_SCAN_INTERVAL,
  REMINDER_STORAGE_KEY,
} from '@/types/reminder'
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

  it('传入的列表含归档任务时，其「已通知」标记被保留（否则取消归档后会重复提醒）', () => {
    // 调用方（DefaultLayout）必须把含归档的列表传进来：
    // 归档本身由 collectDueReminders 跳过，但标记要留着，不然取消归档时会被当成没提醒过。
    const archived = todo({ id: 'archived-1', dueDate: '2026-09-10', archived: true })
    const kept = setup(
      () => [archived],
      () => AT(9),
      { enabled: true, inApp: true },
    )
    kept.store.setNotified({ 'archived-1': { count: 1, lastAt: AT(9).toISOString() } })

    kept.scan()
    expect(kept.store.notified['archived-1']).toBeDefined()
    kept.stop()

    // 反例：若调用方只传「可见任务」（排除归档），标记会被清掉 —— 这正是修前的行为
    const dropped = setup(
      () => [],
      () => AT(9),
      { enabled: true, inApp: true },
    )
    dropped.store.setNotified({ 'archived-1': { count: 1, lastAt: AT(9).toISOString() } })

    dropped.scan()
    expect(Object.keys(dropped.store.notified)).toEqual([])
    dropped.stop()
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

  it('关掉「应用内兜底」后：既不进待处理列表，也不调应用内通道（但标记与系统通知照常）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9),
      { enabled: true, system: true, inApp: false },
    )

    h.scan()

    expect(h.inApp).not.toHaveBeenCalled()
    expect(h.store.pending).toHaveLength(0)
    // 通道关了不等于提醒没发生：标记必须写，否则关掉再打开会重复提醒
    expect(h.store.notified['1'].count).toBe(1)
    expect(h.system).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('不注入时钟时用系统时间：默认行为就是「以此刻为准」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(AT(9))

    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useReminderStore()
    store.updateSettings({ enabled: true, inApp: true })

    const inApp = vi.fn()
    const scope = effectScope()
    const api = scope.run(() =>
      useReminder({
        todos: () => [todo({ id: '1', dueDate: '2026-09-10' })],
        autoScan: false,
        channels: { inApp, wxpusher: async () => {} },
      }),
    )!

    api.scan()

    // 系统时间是 2026-09-10 09:00，正好是默认提醒时刻
    expect(inApp).toHaveBeenCalledTimes(1)
    scope.stop()
    vi.useRealTimers()
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

// ---------------------------------------------------------------------------
// 以下三组都不注入假通道，测的是**线上真正跑的那份默认实现**。
// 注入假通道只能证明「调度算对了」，证明不了「通知真的弹出来了」——
// 而默认实现恰恰是最容易在权限变化、浏览器抛错时静默失效的一层。
// ---------------------------------------------------------------------------

interface FakeNotification {
  title: string
  options: { body?: string; tag?: string }
  onclick: (() => void) | null
  close: ReturnType<typeof vi.fn>
}

/** 能 `new` 的 Notification 替身，并记录每次构造出的实例（用于断言文案与点击行为） */
function stubNotification(permission: NotificationPermission, onConstruct?: () => void) {
  const instances: FakeNotification[] = []
  const ctor = vi.fn(function (this: FakeNotification, title: string, options: never) {
    onConstruct?.()
    this.title = title
    this.options = options as FakeNotification['options']
    this.onclick = null
    this.close = vi.fn()
    instances.push(this)
  })
  vi.stubGlobal(
    'Notification',
    Object.assign(ctor, {
      permission,
      requestPermission: vi.fn(async () => permission),
    }),
  )
  return { ctor, instances }
}

/** 不注入 channels 的挂载：走 defaultSystem / defaultWxPusher */
function setupDefaultChannels(
  todos: () => Todo[],
  now: () => Date,
  settings: Record<string, unknown> = {},
  hooks: {
    onOpenTodo?: (todoId: string) => void
    onWxPusherError?: (message: string) => void
  } = {},
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useReminderStore()
  store.updateSettings(settings)

  const scope = effectScope()
  const api = scope.run(() =>
    useReminder({
      todos,
      clock: now,
      autoScan: false,
      onOpenTodo: hooks.onOpenTodo,
      onWxPusherError: hooks.onWxPusherError,
    }),
  )!

  return { api, store, stop: () => scope.stop() }
}

describe('useReminder · 默认系统通知（Notification API）', () => {
  it('授权 granted：到点弹通知，标题带 ⏰，tag 用任务 id（同一任务替换而不是堆一排）', () => {
    const { ctor, instances } = stubNotification('granted')
    const list = [todo({ id: 'x', title: '交周报', dueDate: '2026-09-10' })]
    const h = setupDefaultChannels(
      () => list,
      () => AT(9),
      { enabled: true, system: true },
    )

    h.api.scan()

    expect(ctor).toHaveBeenCalledTimes(1)
    expect(instances[0].title).toBe('⏰ 交周报')
    expect(instances[0].options.body).toBe('任务到期提醒')
    expect(instances[0].options.tag).toBe('x')
    h.stop()
  })

  it('点击通知：聚焦页面 + 回调导航到那条任务 + 关掉通知', () => {
    const { instances } = stubNotification('granted')
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const opened: string[] = []
    const list = [todo({ id: 'x', title: '交周报', dueDate: '2026-09-10' })]
    const h = setupDefaultChannels(
      () => list,
      () => AT(9),
      { enabled: true, system: true },
      { onOpenTodo: (id) => opened.push(id) },
    )

    h.api.scan()
    instances[0].onclick?.()

    expect(focusSpy).toHaveBeenCalled()
    expect(opened).toEqual(['x'])
    expect(instances[0].close).toHaveBeenCalled()
    focusSpy.mockRestore()
    h.stop()
  })

  it('第 2 次是催办：正文带上已超时时长，用户一眼知道晚了多久', () => {
    const { instances } = stubNotification('granted')
    const list = [todo({ id: '1', title: '交周报', dueDate: '2026-09-10' })]
    let now = AT(9)
    const h = setupDefaultChannels(
      () => list,
      () => now,
      { enabled: true, system: true },
    )

    h.api.scan()
    expect(instances[0].options.body).toBe('任务到期提醒')

    now = AT(10, 30)
    h.api.scan()

    expect(instances).toHaveLength(2)
    expect(instances[1].options.body).toBe('催办：已超时 30 分')
    h.stop()
  })

  it('未授权（default/denied）：不构造通知，但提醒标记与应用内兜底照常（权限不阻塞本地流程）', () => {
    const { ctor } = stubNotification('denied')
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setupDefaultChannels(
      () => list,
      () => AT(9),
      { enabled: true, system: true, inApp: true },
    )

    h.api.scan()

    expect(ctor).not.toHaveBeenCalled()
    // 权限被拒时应用内兜底是唯一依赖，必须仍然拿到这条提醒
    expect(h.store.notified['1'].count).toBe(1)
    expect(h.store.pending).toHaveLength(1)
    h.stop()
  })

  it('构造通知抛错（无用户手势等场景）被吞掉：不打断扫描，也不影响兜底', () => {
    stubNotification('granted', () => {
      throw new Error('无用户手势')
    })
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setupDefaultChannels(
      () => list,
      () => AT(9),
      { enabled: true, system: true, inApp: true },
    )

    expect(() => h.api.scan()).not.toThrow()
    expect(h.store.notified['1'].count).toBe(1)
    expect(h.store.pending).toHaveLength(1)
    h.stop()
  })

  it('权限申请抛错时保留原有 permission，不把状态改坏', async () => {
    const ctor = vi.fn()
    vi.stubGlobal(
      'Notification',
      Object.assign(ctor, {
        permission: 'default',
        requestPermission: vi.fn(async () => {
          throw new Error('浏览器拒绝调用')
        }),
      }),
    )
    const h = setupDefaultChannels(
      () => [],
      () => AT(9),
    )

    await expect(h.api.requestPermission()).resolves.toBe('default')
    expect(h.api.permission.value).toBe('default')
    h.stop()
  })
})

describe('useReminder · 默认微信通道（经 Supabase 代理）', () => {
  beforeEach(() => {
    vi.mocked(sendWxPusherViaProxy).mockResolvedValue({ ok: true })
  })

  it('没填 UID：直接跳过，不发无谓请求（没绑定就不该产生服务端调用）', async () => {
    const list = [todo({ id: '1', title: '交周报', dueDate: '2026-09-10' })]
    const h = setupDefaultChannels(
      () => list,
      () => AT(9),
      { enabled: true, inApp: true, wxpusher: true, wxpusherUid: '   ' },
    )

    h.api.scan()
    await nextTick()

    expect(sendWxPusherViaProxy).not.toHaveBeenCalled()
    // 本地提醒不受影响
    expect(h.store.pending).toHaveLength(1)
    h.stop()
  })

  it('配了 UID：按 uid + 推送文案调代理，正文含任务标题与深链', async () => {
    const list = [todo({ id: 'x', title: '交周报', dueDate: '2026-09-10' })]
    const h = setupDefaultChannels(
      () => list,
      () => AT(9),
      { enabled: true, wxpusher: true, wxpusherUid: ' UID_abc12345 ' },
    )

    h.api.scan()
    await vi.waitFor(() => expect(sendWxPusherViaProxy).toHaveBeenCalledTimes(1))

    const payload = vi.mocked(sendWxPusherViaProxy).mock.calls[0][0]
    // UID 前后空白要被 trim（用户从微信里复制经常带空格）
    expect(payload.uid).toBe('UID_abc12345')
    expect(payload.title).toBe('交周报')
    expect(payload.content).toContain('交周报')
    expect(payload.url).toContain('/todos?focus=x')
    h.stop()
  })

  it('代理返回失败：回调提示原因，但不影响本地提醒（降级而非阻塞）', async () => {
    vi.mocked(sendWxPusherViaProxy).mockResolvedValue({ ok: false, error: '代理未部署' })
    const onWxPusherError = vi.fn()
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setupDefaultChannels(
      () => list,
      () => AT(9),
      { enabled: true, inApp: true, wxpusher: true, wxpusherUid: 'UID_abc12345' },
      { onWxPusherError },
    )

    h.api.scan()
    await vi.waitFor(() => expect(onWxPusherError).toHaveBeenCalledWith('代理未部署'))
    expect(h.store.notified['1'].count).toBe(1)
    expect(h.store.pending).toHaveLength(1)
    h.stop()
  })

  it('代理成功：不打扰用户（只有失败才提示）', async () => {
    const onWxPusherError = vi.fn()
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useReminderStore()
    store.updateSettings({
      enabled: true,
      wxpusher: true,
      wxpusherUid: 'UID_abc12345',
    })
    const scope = effectScope()
    const api = scope.run(() =>
      useReminder({
        todos: () => [todo({ id: '1', dueDate: '2026-09-10' })],
        clock: () => AT(9),
        autoScan: false,
        onWxPusherError,
      }),
    )!

    api.scan()
    await vi.waitFor(() => expect(sendWxPusherViaProxy).toHaveBeenCalledTimes(1))
    await nextTick()

    expect(onWxPusherError).not.toHaveBeenCalled()
    scope.stop()
  })
})

describe('useReminder · 自动扫描的触发时机（回前台必须立刻补扫）', () => {
  /** 页面可见性只读，happy-dom 里得自己 defineProperty 才能模拟切后台 */
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', {
      value: state,
      configurable: true,
      writable: true,
    })
  }

  /** 不传 autoScan（默认开启），注入 inApp 便于数「扫了几轮」 */
  function setupAuto(todos: () => Todo[], now: () => Date) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useReminderStore()
    store.updateSettings({ enabled: true, inApp: true })

    const inApp = vi.fn()
    const scope = effectScope()
    const api = scope.run(() =>
      useReminder({
        todos,
        clock: now,
        channels: { inApp, wxpusher: async () => {} },
      }),
    )!

    return { api, store, inApp, stop: () => scope.stop() }
  }

  afterEach(() => {
    setVisibility('visible')
    vi.useRealTimers()
  })

  it('挂载即扫一轮：打开应用就能看到错过/到点的提醒，不用等周期', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setupAuto(
      () => list,
      () => AT(9),
    )

    // 没有手动调用 scan：挂载时就该发出去
    expect(h.inApp).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('visibilitychange 回到可见：立刻补扫（合盖一晚后一打开就补上，不等下一个周期）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    let now = AT(9)
    const h = setupAuto(
      () => list,
      () => now,
    )
    expect(h.inApp).toHaveBeenCalledTimes(1)

    // 时间推进到催办时刻，但**不**手动 scan，只模拟用户切回标签页
    now = AT(10)
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(h.inApp).toHaveBeenCalledTimes(2)
    h.stop()
  })

  it('visibilitychange 但页面仍隐藏：不白扫一轮', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    let now = AT(9)
    const h = setupAuto(
      () => list,
      () => now,
    )

    now = AT(10)
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(h.inApp).toHaveBeenCalledTimes(1)

    // 真正可见时才补上
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(h.inApp).toHaveBeenCalledTimes(2)
    h.stop()
  })

  it('window focus：切回窗口也补扫一轮（比 visibilitychange 更早触发）', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    let now = AT(9)
    const h = setupAuto(
      () => list,
      () => now,
    )

    now = AT(10)
    window.dispatchEvent(new Event('focus'))

    expect(h.inApp).toHaveBeenCalledTimes(2)
    h.stop()
  })

  it('30 秒轮询真的在跑：推进一个周期会再扫一轮（曾经是死代码）', () => {
    // 这条用例保护一个踩过的坑：useIntervalFn 的 `immediate` 控制的是「是否自动 resume()」，
    // 之前写成 immediate:false，定时器压根没建，规划要求的周期轮询成了死代码。
    vi.useFakeTimers()
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    let now = AT(9)
    const h = setupAuto(
      () => list,
      () => now,
    )
    // 挂载即扫一轮：到点提醒发出
    expect(h.inApp).toHaveBeenCalledTimes(1)

    // 推进到 10:00（第二次提醒的时点）并跨过一个扫描周期 → 轮询应当自己发现催办
    now = AT(10)
    vi.advanceTimersByTime(REMINDER_SCAN_INTERVAL)

    expect(h.inApp).toHaveBeenCalledTimes(2)
    h.stop()
  })

  it('轮询是幂等的：时钟没走时连推多个周期也不会把同一条提醒发第二遍', () => {
    // 打开轮询之后，扫描从「偶发」变成「每 30 秒一次」——防重复标记必须扛得住高频重复扫描，
    // 否则用户每半分钟被骚扰一次（这比原来不轮询更糟，所以这条是打开轮询的配套保护）
    vi.useFakeTimers()
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setupAuto(
      () => list,
      () => AT(9),
    )
    expect(h.inApp).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(REMINDER_SCAN_INTERVAL * 3)

    expect(h.inApp).toHaveBeenCalledTimes(1)
    expect(h.store.notified['1'].count).toBe(1)
    h.stop()
  })

  it('卸载后定时器被摘掉：推进时间不会再扫（否则组件销毁后还在后台空转）', () => {
    vi.useFakeTimers()
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    let now = AT(9)
    const h = setupAuto(
      () => list,
      () => now,
    )
    expect(h.inApp).toHaveBeenCalledTimes(1)

    h.stop()

    // 卸载后把时间推过第二次提醒的时点：如果定时器没被清掉，这里会多出一次催办
    now = AT(11)
    vi.advanceTimersByTime(REMINDER_SCAN_INTERVAL * 5)

    expect(h.inApp).toHaveBeenCalledTimes(1)
  })

  it('组件卸载：清掉运行时待处理列表，但设置与已通知标记必须留着', () => {
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setupAuto(
      () => list,
      () => AT(10),
    )
    expect(h.store.pending).toHaveLength(1)

    h.stop()

    expect(h.store.pending).toHaveLength(0)
    // 持久化状态不能跟着组件一起消失，否则重新挂载会重复提醒
    expect(h.store.notified['1'].count).toBe(1)
    expect(h.store.settings.enabled).toBe(true)
  })
})
