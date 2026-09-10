/**
 * 提醒状态 store 的契约用例（第六阶段 6.5）。
 *
 * 这些断言对应 reminderStore 顶部注释里承诺的两件事：
 * 1. 设置只能有一个来源——设置页改一下开关，正在跑的调度器立刻读到新值（同一个实例、同一份 ref）
 * 2. 「已通知标记」是防重复提醒的核心——系统通知与微信通道共用它，谁都不会再弹第二次
 *
 * 所以这里不测「方法能跑」，只钉住规则：补丁是**合并**而不是整份替换、
 * 同任务只留**最新**一条（否则铃铛里会出现两条一模一样的提醒）、恢复默认要**真的落盘**。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import {
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_NOTIFIED_KEY,
  REMINDER_STORAGE_KEY,
} from '@/types/reminder'
import type { DueReminder, MissedReminder, NotifiedMap, ReminderSettings } from '@/types/reminder'
import { useReminderStore } from './reminderStore'

/** 造一条待提醒项：去重规则只看 todoId，其余字段用于区分「哪一次」 */
function due(todoId: string, seq = 1): DueReminder {
  return { todoId, title: `任务 ${todoId}`, at: new Date(2026, 8, 15, 9, 0, 0), overdueMs: 0, seq }
}

function missed(todoId: string, at = '2026-09-15T09:00:00.000Z'): MissedReminder {
  return { todoId, title: `任务 ${todoId}`, at }
}

describe('reminderStore · 提醒设置与防重复标记', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('updateSettings 是「合并补丁」而不是整份替换：没提到的字段必须原样保留', () => {
    const store = useReminderStore()

    store.updateSettings({ system: true })

    expect(store.settings.system).toBe(true)
    // 只改了一个开关，其余字段（含用户没碰过的默认值）一个都不能丢
    expect(store.settings.enabled).toBe(DEFAULT_REMINDER_SETTINGS.enabled)
    expect(store.settings.inApp).toBe(DEFAULT_REMINDER_SETTINGS.inApp)
    expect(store.settings.wxpusher).toBe(false)
    expect(store.settings.wxpusherUid).toBe('')

    // 默认值常量是共享对象：store 里的改动绝不能反向污染它（否则「恢复默认」会失效）
    store.updateSettings({ inApp: false })
    expect(DEFAULT_REMINDER_SETTINGS.inApp).toBe(true)
  })

  it('设置与已通知标记都落盘，且两个消费方读到的是同一个实例', async () => {
    // 顶栏调度器与设置页各调一次 useReminderStore —— 必须是同一个 store，
    // 否则会出现「设置页关了开关，调度器还按旧值扫」和「同一任务被通知两次」
    const scheduler = useReminderStore()
    const settingsPage = useReminderStore()
    expect(settingsPage).toBe(scheduler)

    settingsPage.updateSettings({ enabled: false, wxpusherUid: 'UID_x' })
    expect(scheduler.enabled).toBe(false)
    expect(scheduler.settings.wxpusherUid).toBe('UID_x')

    await nextTick()
    const persisted = JSON.parse(localStorage.getItem(REMINDER_STORAGE_KEY)!) as ReminderSettings
    expect(persisted.enabled).toBe(false)
    expect(persisted.wxpusherUid).toBe('UID_x')
    expect(persisted.inApp).toBe(DEFAULT_REMINDER_SETTINGS.inApp)
  })

  it('enabled / pendingCount 两个 computed 跟着各自的源数据走', () => {
    const store = useReminderStore()
    expect(store.enabled).toBe(true)
    expect(store.pendingCount).toBe(0)

    store.pushPending(due('t1'))
    store.pushPending(due('t2'))
    expect(store.pendingCount).toBe(2)

    store.dismiss('t1')
    expect(store.pendingCount).toBe(1)

    // 总开关关掉后，铃铛与面板据此不再提示
    store.updateSettings({ enabled: false })
    expect(store.enabled).toBe(false)
  })

  it('setNotified 整份替换标记并落盘（调用方负责算出完整地图，store 不做增量合并）', async () => {
    const store = useReminderStore()
    const first: NotifiedMap = { t1: { count: 1, lastAt: '2026-09-15T09:00:00.000Z' } }
    store.setNotified(first)
    expect(store.notified).toEqual(first)

    // 整份替换：不在新地图里的旧记录必须消失，
    // 否则「改过提醒时间的任务」会被上一次的标记永久压制，再也提醒不出来
    const second: NotifiedMap = { t2: { count: 2, lastAt: '2026-09-15T10:00:00.000Z' } }
    store.setNotified(second)
    expect(store.notified).toEqual(second)
    expect(store.notified.t1).toBeUndefined()

    await nextTick()
    expect(JSON.parse(localStorage.getItem(REMINDER_NOTIFIED_KEY)!)).toEqual(second)
  })

  it('pushPending 同一任务只留最新一条（催办替换到期提醒，而不是并排两条）', () => {
    const store = useReminderStore()
    store.pushPending(due('t1'))
    store.pushPending(due('t2'))

    store.pushPending(due('t1', 2))

    expect(store.pending).toHaveLength(2)
    expect(store.pending.filter((p) => p.todoId === 't1')).toHaveLength(1)
    expect(store.pending.find((p) => p.todoId === 't1')?.seq).toBe(2)
    // 最新进来的一条排在末尾（铃铛面板按时间倒序取用）
    expect(store.pending[store.pending.length - 1].todoId).toBe('t1')
    expect(store.pendingCount).toBe(2)
  })

  it('dismiss 按 id 摘掉一条，其它待处理项不受影响；id 不存在时是空操作', () => {
    const store = useReminderStore()
    store.pushPending(due('t1'))
    store.pushPending(due('t2'))

    store.dismiss('t1')
    expect(store.pending.map((p) => p.todoId)).toEqual(['t2'])

    // 面板可能重复点击/重复派发，销掉一条已经不存在的提醒不能把别的也带走
    store.dismiss('not-exist')
    expect(store.pendingCount).toBe(1)
  })

  it('pushMissed 同任务只留最新一条，clearMissed 整体清空（补发摘要读的就是这份）', () => {
    const store = useReminderStore()
    store.pushMissed(missed('t1', '2026-09-15T09:00:00.000Z'))
    store.pushMissed(missed('t1', '2026-09-15T10:00:00.000Z'))
    store.pushMissed(missed('t2'))

    // 错过 2 次的同一个任务只报 1 条（摘要文案是「你错过了 N 条提醒」，重复计数会误导用户）
    expect(store.missed).toHaveLength(2)
    expect(store.missed.find((m) => m.todoId === 't1')?.at).toBe('2026-09-15T10:00:00.000Z')

    store.clearMissed()
    expect(store.missed).toEqual([])
  })

  it('reset 清运行时列表 + 恢复默认设置 + 清空标记，并把三者都写回 localStorage', async () => {
    const store = useReminderStore()
    store.updateSettings({ enabled: false, inApp: false, wxpusherUid: 'UID_x' })
    store.setNotified({ t1: { count: 2, lastAt: '2026-09-15T10:00:00.000Z' } })
    store.pushPending(due('t1'))
    store.pushMissed(missed('t1'))

    store.reset()

    expect(store.settings).toEqual(DEFAULT_REMINDER_SETTINGS)
    expect(store.enabled).toBe(true)
    expect(store.notified).toEqual({})
    expect(store.pending).toEqual([])
    expect(store.pendingCount).toBe(0)
    expect(store.missed).toEqual([])

    // 「恢复默认」必须真的落盘：只改内存的话，刷新页面又把旧设置读回来了
    await nextTick()
    expect(JSON.parse(localStorage.getItem(REMINDER_STORAGE_KEY)!)).toEqual(
      DEFAULT_REMINDER_SETTINGS,
    )
    expect(JSON.parse(localStorage.getItem(REMINDER_NOTIFIED_KEY)!)).toEqual({})
  })

  it('刷新页面（重建 store）时从 localStorage 恢复设置与标记：已提醒过的不会重复弹', () => {
    localStorage.setItem(
      REMINDER_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_REMINDER_SETTINGS,
        enabled: false,
        wxpusher: true,
        wxpusherUid: 'UID_x',
      }),
    )
    localStorage.setItem(
      REMINDER_NOTIFIED_KEY,
      JSON.stringify({ t1: { count: 1, lastAt: '2026-09-15T09:00:00.000Z' } }),
    )

    setActivePinia(createPinia())
    const store = useReminderStore()

    expect(store.enabled).toBe(false)
    expect(store.settings.wxpusher).toBe(true)
    expect(store.notified.t1?.count).toBe(1)
    // 运行时列表不持久化：刷新后待处理/补发摘要重新扫描，不应凭空出现旧数据
    expect(store.pending).toEqual([])
    expect(store.missed).toEqual([])
  })
})
