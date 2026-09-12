/**
 * 桌面版系统通知分支（第七阶段）。
 *
 * 桌面版不该走 Web Notification，而要走 Tauri 通知插件 → Windows 原生 Toast。
 * 这条分支单独一个 spec：它靠 isTauri() 切换，用浏览器环境的用例覆盖不到。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const notifyPlugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-notification', () => notifyPlugin)
vi.mock('@/api/notify', () => ({
  sendWxPusherViaProxy: vi.fn(async () => ({ ok: true })),
}))

import { useReminder } from './useReminder'
import { useReminderStore } from '@/stores/reminderStore'
import type { Todo } from '@/types/todo'

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

/** 让平台判定为桌面版 */
function stubTauri(on: boolean) {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown }
  if (on) w.__TAURI_INTERNALS__ = {}
  else delete w.__TAURI_INTERNALS__
}

/** 挂一个提醒调度器（autoScan 关掉，手动 scan） */
function setup(list: () => Todo[], now: () => Date) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useReminderStore()
  store.updateSettings({ enabled: true, system: true, inApp: false })

  const scope = effectScope()
  const api = scope.run(() => useReminder({ todos: list, clock: now, autoScan: false }))!
  return { api, store, stop: () => scope.stop() }
}

beforeEach(() => {
  localStorage.clear()
  stubTauri(false)
  vi.clearAllMocks()
  notifyPlugin.isPermissionGranted.mockResolvedValue(true)
  notifyPlugin.requestPermission.mockResolvedValue('granted')
})

describe('useReminder · 桌面版原生通知', () => {
  it('到点提醒走 Tauri 通知插件（而不是 Web Notification）', async () => {
    stubTauri(true)
    const list = [todo({ id: '1', title: '交周报', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9),
    )

    h.api.scan()
    // 动态 import + promise 链要等一轮微任务
    await vi.waitFor(() => expect(notifyPlugin.sendNotification).toHaveBeenCalledTimes(1))

    expect(notifyPlugin.sendNotification).toHaveBeenCalledWith({
      title: '⏰ 交周报',
      body: '任务到期提醒',
    })
    h.stop()
  })

  it('催办（第二次）的文案与到期不同', async () => {
    stubTauri(true)
    const list = [todo({ id: '1', title: '交周报', dueDate: '2026-09-10' })]
    let now = AT(9)
    const h = setup(
      () => list,
      () => now,
    )

    h.api.scan()
    await vi.waitFor(() => expect(notifyPlugin.sendNotification).toHaveBeenCalledTimes(1))

    now = AT(10)
    h.api.scan()
    await vi.waitFor(() => expect(notifyPlugin.sendNotification).toHaveBeenCalledTimes(2))

    expect(notifyPlugin.sendNotification.mock.calls[1][0].body).toContain('催办')
    h.stop()
  })

  it('插件未授权时不发通知（避免弹不出来还以为发了）', async () => {
    stubTauri(true)
    notifyPlugin.isPermissionGranted.mockResolvedValue(false)
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9),
    )

    h.api.scan()
    await new Promise((r) => setTimeout(r, 0))

    expect(notifyPlugin.sendNotification).not.toHaveBeenCalled()
    h.stop()
  })

  it('插件抛错时静默降级（提醒流程不能被它带崩）', async () => {
    stubTauri(true)
    notifyPlugin.sendNotification.mockImplementation(() => {
      throw new Error('插件不可用')
    })
    const list = [todo({ id: '1', dueDate: '2026-09-10' })]
    const h = setup(
      () => list,
      () => AT(9),
    )

    expect(() => h.api.scan()).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    // 已通知标记照常落下（本地流程不受影响）
    expect(h.store.notified['1'].count).toBe(1)
    h.stop()
  })

  it('权限申请走插件的 isPermissionGranted / requestPermission', async () => {
    stubTauri(true)
    notifyPlugin.isPermissionGranted.mockResolvedValue(false)
    notifyPlugin.requestPermission.mockResolvedValue('granted')
    const h = setup(
      () => [],
      () => AT(9),
    )

    await expect(h.api.requestPermission()).resolves.toBe('granted')
    expect(notifyPlugin.requestPermission).toHaveBeenCalledTimes(1)

    // 已授权时不再重复申请
    notifyPlugin.isPermissionGranted.mockResolvedValue(true)
    await expect(h.api.requestPermission()).resolves.toBe('granted')
    expect(notifyPlugin.requestPermission).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('插件申请被拒时返回 denied（UI 据此引导「应用内提醒仍有效」）', async () => {
    stubTauri(true)
    notifyPlugin.isPermissionGranted.mockResolvedValue(false)
    notifyPlugin.requestPermission.mockResolvedValue('denied')
    const h = setup(
      () => [],
      () => AT(9),
    )

    await expect(h.api.requestPermission()).resolves.toBe('denied')
    h.stop()
  })

  it('插件整体不可用（导入/调用失败）时收敛成 unsupported，不抛错', async () => {
    stubTauri(true)
    notifyPlugin.isPermissionGranted.mockRejectedValue(new Error('插件缺失'))
    const h = setup(
      () => [],
      () => AT(9),
    )

    await expect(h.api.requestPermission()).resolves.toBe('unsupported')
    h.stop()
  })
})
