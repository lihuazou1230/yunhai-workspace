/**
 * 提醒调度器（第六阶段 6.5）。
 *
 * 分层降级的实现（Web 没有常驻后台进程，这是必须承认的前提）：
 * 1. **系统通知**：授权后由浏览器弹出；点击通知聚焦页面并跳到对应任务
 * 2. **应用内兜底**：铃铛红点 + 标签页标题计数（权限被拒时唯一依赖）
 * 3. **补发摘要**：重新打开时把错过的提醒汇总出来（`store.missed`）
 * 4.（可选）**微信推送**：经 Supabase Edge Function 代理调 WxPusher；失败只提示不阻塞
 *
 * 两个工程要点：
 * - **30 秒一轮扫描**，且 `visibilitychange` / `focus` 回前台立刻补扫：
 *   合盖一晚后一打开就能把错过的补上，而不是等下一个周期
 * - **已通知标记存 store**（两个组件共享）：否则系统通知与微信各弹一次，变成骚扰
 *
 * 状态全在 `reminderStore` 里，这个 composable 只负责「定时器 + 通道发送」这层副作用；
 * 因此**同一时间只应有一处 `autoScan: true`**（默认布局），设置页只读改设置。
 */

import { onScopeDispose, ref } from 'vue'
import type { Ref } from 'vue'

import { storeToRefs } from 'pinia'
import { useEventListener, useIntervalFn } from '@vueuse/core'

import { sendWxPusherViaProxy } from '@/api/notify'
import { useReminderStore } from '@/stores/reminderStore'
import { MISSED_WINDOW_MS, REMINDER_SCAN_INTERVAL } from '@/types/reminder'
import type { DueReminder, MissedReminder, NotifiedMap, ReminderSettings } from '@/types/reminder'
import type { Todo } from '@/types/todo'
import { appUrl } from '@/utils/appUrl'
import {
  collectDueReminders,
  markNotified,
  pruneNotified,
  reminderTimingText,
} from '@/utils/reminderSchedule'
import { buildReminderMessage } from '@/utils/wxpusher'

/** 各通道的发送实现（可注入，便于测试断言「该发几次、发给了谁」） */
export interface ReminderChannels {
  system: (reminder: DueReminder) => void
  inApp: (reminder: DueReminder) => void
  wxpusher: (reminder: DueReminder) => Promise<void>
}

export interface UseReminderOptions {
  /** 任务来源（一般是 visibleTodos 的 getter），每轮扫描取最新值 */
  todos: () => readonly Todo[]
  /** 注入时钟（测试） */
  clock?: () => Date
  /** 是否自动每 30 秒扫描；同一时间只应有一处为 true */
  autoScan?: boolean
  /** 覆盖默认通道实现（测试用） */
  channels?: Partial<ReminderChannels>
  /**
   * 点击系统通知后如何跳到那条任务。
   * 必须由调用方注入：通知的点击回调发生在组件树之外，而项目用的是 history 路由
   * （写 `location.hash` 不会真的导航，只会往地址栏粘一个没用的片段）。
   */
  onOpenTodo?: (todoId: string) => void
  /** 微信推送失败时的提示回调（UI 弹 Toast） */
  onWxPusherError?: (message: string) => void
}

export interface UseReminderReturn {
  settings: Ref<ReminderSettings>
  pending: Ref<DueReminder[]>
  missed: Ref<MissedReminder[]>
  permission: Ref<NotificationPermission | 'unsupported'>
  pendingCount: Ref<number>
  scan: () => void
  requestPermission: () => Promise<NotificationPermission | 'unsupported'>
  dismiss: (todoId: string) => void
  clearMissed: () => void
  updateSettings: (patch: Partial<ReminderSettings>) => void
}

/** 浏览器是否支持系统通知（SSR / 老浏览器 / happy-dom 测试环境） */
function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function useReminder(options: UseReminderOptions): UseReminderReturn {
  const clock = options.clock ?? (() => new Date())
  const store = useReminderStore()
  // Pinia 的 setup store 直接把 ref 解包成值，所以要用 storeToRefs 拿回引用，
  // 否则组件里 `v-model`/`watch` 拿到的是快照，改不动也看不见变化。
  const { settings, pending, missed, pendingCount } = storeToRefs(store)

  const permission = ref<NotificationPermission | 'unsupported'>(
    notificationsSupported() ? Notification.permission : 'unsupported',
  )

  /** 默认的系统通知实现 */
  function defaultSystem(reminder: DueReminder): void {
    if (!notificationsSupported() || Notification.permission !== 'granted') return
    try {
      const notification = new Notification(`⏰ ${reminder.title}`, {
        body:
          reminder.seq === 1 ? '任务到期提醒' : `催办：${reminderTimingText(reminder.at, clock())}`,
        // tag 用任务 id：同一任务的新通知替换旧的，而不是在通知中心堆一排
        tag: reminder.todoId,
      })
      notification.onclick = () => {
        window.focus()
        // 交给调用方导航（history 路由下不能靠改 hash 跳转，见 onOpenTodo 的说明）
        options.onOpenTodo?.(reminder.todoId)
        notification.close()
      }
    } catch {
      // 某些浏览器在无用户手势时构造通知会抛错：静默降级到应用内兜底
    }
  }

  /** 默认的微信推送实现（经 Supabase Edge Function 代理，appToken 不进前端） */
  async function defaultWxPusher(reminder: DueReminder): Promise<void> {
    const uid = store.settings.wxpusherUid.trim()
    if (!uid) return
    const message = buildReminderMessage({ id: reminder.todoId, title: reminder.title }, appUrl())
    const result = await sendWxPusherViaProxy({ uid, ...message })
    if (!result.ok) options.onWxPusherError?.(result.error)
  }

  const channels: ReminderChannels = {
    system: options.channels?.system ?? defaultSystem,
    inApp: options.channels?.inApp ?? (() => {}),
    wxpusher: options.channels?.wxpusher ?? defaultWxPusher,
  }

  /**
   * 扫描一轮：算出该提醒的 → 逐个通道发送 → 记已通知标记。
   *
   * 顺序很关键：**先发再记**。反过来的话，发送过程里抛错就会把这次提醒永久标记成
   * 已通知，用户再也收不到（宁可偶发重复，也不要静默丢失）。
   */
  function scan(): void {
    if (!store.settings.enabled) return

    const now = clock()
    const list = options.todos()
    const due = collectDueReminders(list, store.notified, now, MISSED_WINDOW_MS)

    if (due.length === 0) {
      // 顺手清理已被删除任务的标记（标记只增不减会撑爆 localStorage）
      const pruned = pruneNotified(store.notified, list)
      if (Object.keys(pruned).length !== Object.keys(store.notified).length)
        store.setNotified(pruned)
      return
    }

    let nextNotified: NotifiedMap = store.notified

    for (const reminder of due) {
      if (store.settings.system) channels.system(reminder)
      if (store.settings.inApp) channels.inApp(reminder)
      if (store.settings.wxpusher) {
        // 不 await：微信通道慢（走服务端代理），不该拖住本地提醒
        void channels.wxpusher(reminder).catch(() => {})
      }

      nextNotified = markNotified(nextNotified, reminder.todoId, reminder.at)

      // 补发摘要：过期超过 5 分钟才算「错过」，避免正常到点也弹摘要
      if (reminder.overdueMs > 5 * 60 * 1000) {
        store.pushMissed({
          todoId: reminder.todoId,
          title: reminder.title,
          at: reminder.at.toISOString(),
        })
      }

      if (store.settings.inApp) store.pushPending(reminder)
    }

    // 一次性写回：循环里逐次写会产生 N 次持久化，也没必要
    store.setNotified(nextNotified)
  }

  /** 申请系统通知权限：**只在用户显式动作里调用**（进门就要权限是最招人烦的反模式） */
  async function requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (!notificationsSupported()) {
      permission.value = 'unsupported'
      return 'unsupported'
    }
    try {
      const result = await Notification.requestPermission()
      permission.value = result
      return result
    } catch {
      return permission.value
    }
  }

  // ---- 自动扫描 ----
  if (options.autoScan !== false) {
    useIntervalFn(scan, REMINDER_SCAN_INTERVAL, { immediate: false })
    useEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') scan()
    })
    useEventListener(window, 'focus', scan)
    // 挂载即扫一轮：打开应用就能看到错过的提醒
    scan()
  }

  onScopeDispose(() => {
    // 只清运行时列表；设置与已通知标记是持久化状态，必须留着
    pending.value = []
  })

  return {
    settings,
    pending,
    missed,
    permission,
    pendingCount,
    scan,
    requestPermission,
    dismiss: store.dismiss,
    clearMissed: store.clearMissed,
    updateSettings: store.updateSettings,
  }
}
