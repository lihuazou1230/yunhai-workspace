/**
 * 提醒状态（Pinia，第六阶段 6.5）。
 *
 * 为什么必须是 store 而不是 composable 里的局部 ref：提醒设置与「已通知标记」
 * 会被**两处**用到——顶栏的调度器（DefaultLayout）与设置页的开关面板。
 * 各自持一份 ref 会出现两个真问题：
 * 1. 两个实例各扫一轮，同一任务被通知两次（防重复标记各写各的，互相看不见）
 * 2. 设置页改了开关，已经跑着的调度器读的仍是旧值（要刷新才生效）
 *
 * 所以状态收在这里，`useReminder` 只负责「定时器 + 通道发送」这层副作用。
 */

import { computed } from 'vue'

import { defineStore } from 'pinia'

import { useLocalStorage } from '@/composables/useLocalStorage'
import { useSyncedStorage } from '@/composables/useSyncedStorage'
import {
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_NOTIFIED_KEY,
  REMINDER_STORAGE_KEY,
} from '@/types/reminder'
import type { DueReminder, MissedReminder, NotifiedMap, ReminderSettings } from '@/types/reminder'
import { ref } from 'vue'

export const useReminderStore = defineStore('reminder', () => {
  /**
   * 提醒设置（持久化）。
   * 第九阶段起**跟账号走**：开关与提醒时间在手机上关掉的，桌面上不该继续响。
   */
  const settings = useSyncedStorage<ReminderSettings>(REMINDER_STORAGE_KEY, {
    ...DEFAULT_REMINDER_SETTINGS,
  })

  /**
   * 已通知标记（持久化，**刻意不上云**）。
   * 它是"这台设备已经弹过了"的记账：同步过去会让另一台设备该提醒时被标成已提醒而静默不响。
   */
  const notified = useLocalStorage<NotifiedMap>(REMINDER_NOTIFIED_KEY, {})

  /** 待用户处理的提醒（运行时；铃铛红点与面板用它） */
  const pending = ref<DueReminder[]>([])
  /** 补发摘要：重新打开应用时错过的提醒（运行时） */
  const missed = ref<MissedReminder[]>([])

  const enabled = computed(() => settings.value.enabled)
  const pendingCount = computed(() => pending.value.length)

  function updateSettings(patch: Partial<ReminderSettings>): void {
    settings.value = { ...settings.value, ...patch }
  }

  /** 记一条已通知（防重复的核心；由调度器在发送后调用） */
  function setNotified(next: NotifiedMap): void {
    notified.value = next
  }

  /** 把一条提醒放进待处理列表（同任务只留最新一条） */
  function pushPending(reminder: DueReminder): void {
    pending.value = [...pending.value.filter((p) => p.todoId !== reminder.todoId), reminder]
  }

  function dismiss(todoId: string): void {
    pending.value = pending.value.filter((p) => p.todoId !== todoId)
  }

  /** 记一条「错过」（同任务只留最新） */
  function pushMissed(item: MissedReminder): void {
    missed.value = [...missed.value.filter((m) => m.todoId !== item.todoId), item]
  }

  function clearMissed(): void {
    missed.value = []
  }

  function reset(): void {
    settings.value = { ...DEFAULT_REMINDER_SETTINGS }
    notified.value = {}
    pending.value = []
    missed.value = []
  }

  return {
    settings,
    notified,
    pending,
    missed,
    enabled,
    pendingCount,
    updateSettings,
    setNotified,
    pushPending,
    dismiss,
    pushMissed,
    clearMissed,
    reset,
  }
})
