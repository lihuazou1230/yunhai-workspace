/**
 * 投入时长日志（纯函数，全部纳入单测）。
 *
 * **为什么需要它**：第八阶段的「投入产出散点图」要的是**每日**投入时长，
 * 而赚钱秒表的快照（`EarningsSnapshot`）天生只描述「此刻」——
 * 关闭页面后，昨天到底计薪了多久就无从得知了。
 * 所以在秒表 tick 时把当日累计计薪秒数**按天落一份最小日志**（dateKey -> 秒），
 * 图表与年度报告的「投入总时长」都读它。
 *
 * 三个设计约束：
 * - **取较大值而不是覆盖**：秒表的「已计薪秒数」在一天内是单调递增的，
 *   取大值天然幂等——同一分钟重复写、两个实例乱序写都不会把数字写小（写小＝数据丢失）。
 * - **不写 0**：非计薪日、上班前都不落记录，保持日志稀疏（散点图才能把
 *   「没投入」和「没数据」区分开）。
 * - **键必须是合法日期键**：日志是 localStorage 里的不可信输入，脏键一律丢弃。
 */

import { addDays } from './dateFormatter'
import { round1 } from './numberHelper'

/** localStorage 键 */
export const WORKLOG_STORAGE_KEY = 'smart-workspace:worklog'

/**
 * 保留窗口（天）。
 * 一天一条、一年 365 条，每条不过十几字节；留 400 天既能覆盖「去年同期」对比，
 * 又不会让 localStorage 无限长胖（写入时按这个窗口裁剪）。
 */
export const WORKLOG_KEEP_DAYS = 400

/** 投入日志：日期键 YYYY-MM-DD -> 当日累计计薪秒数 */
export type WorkLog = Record<string, number>

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 归一化存储里的日志（不可信输入）。
 * 非法日期键、非数字、负数、NaN/Infinity 全部丢弃——一条脏数据就足以让散点图
 * 画出 NaN 坐标（整张图空白），而这类脏数据可能来自手改 localStorage 或旧版本。
 */
export function normalizeWorkLog(raw: unknown): WorkLog {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: WorkLog = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!DATE_KEY_RE.test(key)) continue
    const seconds = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(seconds) || seconds <= 0) continue
    out[key] = Math.round(seconds)
  }
  return out
}

/**
 * 记录某天的计薪秒数。
 * @returns 新日志；**值没有变大时原样返回入参对象**（引用相等），
 *   调用方据此跳过无意义的存储写入——秒表 100ms 一次 tick，不做这层拦截
 *   就是每秒十次 JSON.stringify 全量日志。
 */
export function recordWorkSeconds(log: WorkLog, dateKey: string, seconds: number): WorkLog {
  if (!DATE_KEY_RE.test(dateKey)) return log
  if (!Number.isFinite(seconds) || seconds <= 0) return log
  const next = Math.round(seconds)
  if ((log[dateKey] ?? 0) >= next) return log
  return { ...log, [dateKey]: next }
}

/**
 * 裁剪日志：只保留 `beforeKey` 当天及之后的记录，并按日期倒序最多留 `maxKeys` 天。
 * 两个条件都留着——只按时间窗裁，遇到系统时钟被改到过去时会一次留下几千条；
 * 只按条数裁，则长期不用时最老的记录会一直被顶掉。
 */
export function pruneWorkLog(
  log: WorkLog,
  beforeKey: string,
  maxKeys = WORKLOG_KEEP_DAYS,
): WorkLog {
  const limit = Math.max(0, Math.floor(maxKeys))
  const kept = Object.entries(log).filter(([key, seconds]) => key >= beforeKey && seconds > 0)
  // 注意不能只看「有没有被窗口裁掉」：条数上限是**另一条**约束，
  // 全都落在窗口内但数量超限时同样要裁（否则一次导入就能把日志堆到几千条）。
  if (kept.length === Object.keys(log).length && kept.length <= limit) return log
  kept.sort(([a], [b]) => (a < b ? 1 : -1))
  return Object.fromEntries(kept.slice(0, limit))
}

/** 某天的投入秒数（缺失记 0） */
export function workSecondsOn(log: WorkLog, dateKey: string): number {
  const seconds = log[dateKey]
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

/** 某天的投入小时数（1 位小数，用于散点图 X 轴） */
export function workHoursOn(log: WorkLog, dateKey: string): number {
  return round1(workSecondsOn(log, dateKey) / 3600)
}

/**
 * 区间累计秒数。
 * @param fromKey 起点（含）；传 null 表示不限起点（「全部」口径）
 */
export function sumWorkSeconds(log: WorkLog, fromKey: string | null, toKey: string): number {
  let total = 0
  for (const [key, seconds] of Object.entries(log)) {
    if (key > toKey) continue
    if (fromKey !== null && key < fromKey) continue
    total += seconds
  }
  return total
}

/** 当前日志的裁剪窗口起点（相对某天的 400 天前） */
export function workLogKeepFrom(dateKey: string): string {
  return addDays(dateKey, -WORKLOG_KEEP_DAYS)
}

/**
 * 合并两份投入日志（第九阶段的多设备同步用）。
 *
 * 逐日取较大值，而不是"后写的那一份整份覆盖"：两台设备各自记不同的日子，
 * 整份覆盖会把另一台记的那几天直接抹掉（用户看到「投入总时长凭空少了几十小时」，
 * 而且再也找不回来）。取大值与 `recordWorkSeconds` 同一语义——单日时长单调递增，
 * 同一天谁记的多谁的更完整。
 */
export function mergeWorkLogs(local: WorkLog, cloud: WorkLog): WorkLog {
  const merged: WorkLog = { ...cloud }
  for (const [key, seconds] of Object.entries(local)) {
    if (seconds > (merged[key] ?? 0)) merged[key] = seconds
  }
  return merged
}
