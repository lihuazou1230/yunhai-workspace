/**
 * 提醒体系领域类型（第六阶段 6.5）。
 *
 * 前提事实：**Web 应用没有常驻后台进程**，所以提醒注定是**分层降级**的——
 * 先承认这个约束，再设计每一层：
 * 1. 系统通知（Notification API）：授权后由浏览器弹出，最接近原生体验
 * 2. 应用内兜底：Toast 横幅 + 顶栏铃铛红点 + document.title 闪烁（权限被拒时唯一依赖）
 * 3. 补发摘要：应用重新打开时扫描错过的小时级提醒，弹「你错过了 N 条提醒」
 * 4.（可选进阶）关页面也能收：Supabase pg_cron + Edge Function + WxPusher
 */

/** 通知通道 */
export interface ReminderChannels {
  /** 系统通知（Notification API，需要授权） */
  system: boolean
  /** 应用内兜底（Toast + 铃铛红点 + 标题闪烁） */
  inApp: boolean
  /** 微信推送（WxPusher，需要登录 + 自备 UID） */
  wxpusher: boolean
}

/** 提醒设置（持久化到 localStorage） */
export interface ReminderSettings extends ReminderChannels {
  /** 总开关 */
  enabled: boolean
  /** WxPusher UID（用户级凭证，BYOK 存本地；appToken 在服务端 Secrets 里） */
  wxpusherUid: string
}

/** localStorage 键 */
export const REMINDER_STORAGE_KEY = 'smart-workspace:reminder-settings'
/** 已通知标记（防重复提醒；与微信通道共用同一份标记，两通道互不重复） */
export const REMINDER_NOTIFIED_KEY = 'smart-workspace:reminder-notified'

/** 默认设置：总开关打开，应用内兜底默认开（它不需要任何授权），系统通知与微信需要用户显式开 */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  system: false,
  inApp: true,
  wxpusher: false,
  wxpusherUid: '',
}

/** 调度器扫描间隔：30 秒一轮（规划口径） */
export const REMINDER_SCAN_INTERVAL = 30_000

/**
 * 每条任务最多提醒 2 次：**到期 + 超时 1 小时催办**。
 * 这个上限是「防骚扰」的硬约束，超过就不再提醒（用户可以去任务里改提醒时间）。
 */
export const MAX_REMINDERS_PER_TODO = 2

/** 默认提醒时刻：到期日当天 09:00（本地时区） */
export const REMINDER_DEFAULT_HOUR = 9

/** 第二次提醒（催办）距第一次的间隔：1 小时 */
export const REMINDER_SNOOZE_MS = 60 * 60 * 1000

/** 补发摘要的统计窗口：只看最近 24 小时错过的小时级提醒，再久就没意义了 */
export const MISSED_WINDOW_MS = 24 * 60 * 60 * 1000

/** 单个任务的已通知记录 */
export interface NotifiedRecord {
  /** 已通知次数（上限 MAX_REMINDERS_PER_TODO） */
  count: number
  /** 最后一次通知时间（ISO） */
  lastAt: string
}

/** todoId -> 已通知记录 */
export type NotifiedMap = Record<string, NotifiedRecord>

/** 待提醒项（调度器算出来、交给各通道发送的单位） */
export interface DueReminder {
  todoId: string
  title: string
  /** 该次提醒的计划时间 */
  at: Date
  /** 距现在已过期多久（> 0 表示是补发的） */
  overdueMs: number
  /** 这是第几次提醒（1 = 到期，2 = 催办） */
  seq: number
}

/** 补发摘要条目 */
export interface MissedReminder {
  todoId: string
  title: string
  at: string
}
