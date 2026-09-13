/**
 * 统计聚合（纯函数，`now` 可注入，全部纳入单测）。
 *
 * 第八阶段 8.1 的四张新图与年度报告都从这里取数：**页面只做「传 store 数据 → 拿聚合结果」**，
 * 口径全部锁在本文件里，避免出现「统计页和年度报告对同一个数字各算一套」。
 *
 * 统一口径（三处共用，改这里就全改）：
 * - 只统计 **`visibleTodos`**（已归档任务由 store 排除，不参与任何统计）；
 * - **完成时间**归日：按 `completedAt` 落到本地日期键，未来日期一律不计；
 * - 范围只有三种：本周（周一起）/ 本月（1 日起）/ 全部。
 */

import { addDays, startOfWeek, toDateKey, todayKey } from './dateFormatter'
import { countCompletedOn, WEEKDAY_NAMES } from './streak'
import { round1, round2 } from './numberHelper'
import { workHoursOn } from './workLog'
import type { WorkLog } from './workLog'
import type {
  AnnualReport,
  DailyTrendPoint,
  HourlyHeatmap,
  ScatterPoint,
  StatsRange,
  TagShareItem,
} from '@/types/statistics'
import type { Tag } from '@/types/tag'
import type { Todo } from '@/types/todo'

/** 无标签切片的 id（与任何真实标签 id 都不冲突） */
export const UNTAGGED_ID = '__untagged__'

/** 一天的小时数（时段热力图横轴长度） */
export const HEATMAP_HOURS = 24

/** 时段热力图纵轴：周一起（与 startOfWeek / WEEKDAY_NAMES 同一口径） */
export const HEATMAP_WEEKDAYS = WEEKDAY_NAMES

/** 趋势图的「全部」窗口：近 6 周（规划原文口径） */
export const TREND_MAX_DAYS = 42

/** 散点图的「全部」窗口：近 180 天（再往前画就成了一团点云） */
export const SCATTER_MAX_DAYS = 180

/** 移动平均默认窗口（7 日） */
export const MOVING_AVG_WINDOW = 7

// ---- 范围 ----

/** 范围起点日期键；「全部」无起点，返回 null */
export function rangeStartKey(range: StatsRange, now: Date = new Date()): string | null {
  switch (range) {
    case 'week':
      return startOfWeek(now)
    case 'month':
      return toDateKey(new Date(now.getFullYear(), now.getMonth(), 1))
    case 'all':
    default:
      return null
  }
}

/** 日期键是否落在范围内（终点恒为今天：未来日期不参与统计） */
export function isInRange(dateKey: string, range: StatsRange, now: Date = new Date()): boolean {
  if (dateKey > todayKey(now)) return false
  const start = rangeStartKey(range, now)
  return start === null || dateKey >= start
}

/**
 * 趋势图窗口起点。
 * 「全部」口径下若真从开天辟地画起，X 轴会挤成一条毛刺——所以按规划原文收敛到近 6 周：
 * 统计页的「全部」= 其余图表看全历史，趋势图看近 6 周（副标题里写明窗口，不误导）。
 */
export function trendStartKey(range: StatsRange, now: Date = new Date()): string {
  if (range === 'all') return addDays(todayKey(now), -(TREND_MAX_DAYS - 1))
  return rangeStartKey(range, now) ?? addDays(todayKey(now), -(TREND_MAX_DAYS - 1))
}

/** 逐日日期键列表（含首尾）；startKey > endKey 时返回空数组 */
export function eachDay(startKey: string, endKey: string): string[] {
  const keys: string[] = []
  // 上限兜底：即便调用方传了离谱的区间也不会把内存吃光
  for (let key = startKey, guard = 0; key <= endKey && guard < 4000; guard++) {
    keys.push(key)
    key = addDays(key, 1)
  }
  return keys
}

// ---- 完成任务 ----

/** 任务的完成日期键；未完成 / 无完成时间 / 非法时间戳都返回 null */
export function completedDateKey(todo: Todo): string | null {
  if (todo.status !== 'completed' || !todo.completedAt) return null
  const date = new Date(todo.completedAt)
  if (Number.isNaN(date.getTime())) return null
  return toDateKey(date)
}

/** 范围内完成的任务 */
export function filterCompletedInRange(
  todos: readonly Todo[],
  range: StatsRange,
  now: Date = new Date(),
): Todo[] {
  return todos.filter((t) => {
    const key = completedDateKey(t)
    return key !== null && isInRange(key, range, now)
  })
}

/** 范围内完成数（页面顶部小结用） */
export function countCompletedInRange(
  todos: readonly Todo[],
  range: StatsRange,
  now: Date = new Date(),
): number {
  return filterCompletedInRange(todos, range, now).length
}

// ---- 1. 标签占比 ----

/** 「创建 → 完成」耗时（小时，1 位小数）；时间戳非法或为负时返回 null（不污染平均） */
export function todoDurationHours(todo: Todo): number | null {
  if (!todo.completedAt || !todo.createdAt) return null
  const start = new Date(todo.createdAt).getTime()
  const end = new Date(todo.completedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return round1((end - start) / 3_600_000)
}

interface TagBucket {
  completed: number
  hoursSum: number
  hoursCount: number
}

/**
 * 标签占比（环形图数据）。
 * 归类口径见 `TagShareItem` 的注释：按**首个标签**归类，保证各切片占比之和 = 100%。
 */
export function aggregateTagShare(
  todos: readonly Todo[],
  tags: readonly Tag[],
  range: StatsRange,
  now: Date = new Date(),
): TagShareItem[] {
  const done = filterCompletedInRange(todos, range, now)
  const total = done.length
  const buckets = new Map<string, TagBucket>()

  for (const todo of done) {
    const id = todo.tags[0] ?? UNTAGGED_ID
    const bucket = buckets.get(id) ?? { completed: 0, hoursSum: 0, hoursCount: 0 }
    bucket.completed++
    const hours = todoDurationHours(todo)
    if (hours !== null) {
      bucket.hoursSum += hours
      bucket.hoursCount++
    }
    buckets.set(id, bucket)
  }

  const byId = new Map(tags.map((t) => [t.id, t]))
  return [...buckets.entries()]
    .map(([id, bucket]): TagShareItem => {
      const tag = byId.get(id)
      return {
        id,
        // 标签被删掉但任务上还留着 id（或手改存储）时给个兜底文案，而不是空名字
        name: id === UNTAGGED_ID ? '无标签' : (tag?.name ?? '已删除标签'),
        color: tag?.color ?? null,
        completed: bucket.completed,
        share: total === 0 ? 0 : Math.round((bucket.completed / total) * 100),
        avgHours: bucket.hoursCount === 0 ? null : round1(bucket.hoursSum / bucket.hoursCount),
      }
    })
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

// ---- 2. 完成时段热力图 ----

/**
 * 7×24 完成时段分布。
 * 用 `completedAt` 的**本地小时**（getHours）落格——用户看的是自己的作息，
 * 不是 UTC 作息；跨时区同步来的任务也会在本地时区里重新归位。
 */
export function aggregateHourly(
  todos: readonly Todo[],
  range: StatsRange,
  now: Date = new Date(),
): HourlyHeatmap {
  const counts: number[][] = Array.from({ length: HEATMAP_WEEKDAYS.length }, () =>
    Array.from({ length: HEATMAP_HOURS }, () => 0),
  )
  let total = 0
  let max = 0

  for (const todo of filterCompletedInRange(todos, range, now)) {
    const date = new Date(todo.completedAt as string)
    // getDay(): 周日=0 → 转成周一=0，与热力图纵轴顺序一致
    const weekday = (date.getDay() + 6) % 7
    const hour = date.getHours()
    const next = counts[weekday][hour] + 1
    counts[weekday][hour] = next
    total++
    if (next > max) max = next
  }

  return { counts, max, total }
}

/** 时段热力图 -> ECharts heatmap 的 data（[小时, 星期, 完成数]，跳过 0 值格） */
export function toHeatmapSeriesData(heatmap: HourlyHeatmap): [number, number, number][] {
  const data: [number, number, number][] = []
  heatmap.counts.forEach((row, weekday) => {
    row.forEach((value, hour) => {
      if (value > 0) data.push([hour, weekday, value])
    })
  })
  return data
}

// ---- 3. 每日趋势 + 移动平均 ----

/**
 * 移动平均。
 * 第 i 项 = 最近 `window` 项的平均值；**起点不足 window 时用已有项**（而不是留空），
 * 这样曲线从第一天起就是连续的，不会出现前 6 天断头。
 */
export function movingAverage(values: readonly number[], window = MOVING_AVG_WINDOW): number[] {
  const size = Math.max(1, Math.floor(window))
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= size) sum -= values[i - size]
    const count = Math.min(size, i + 1)
    out.push(round1(sum / count))
  }
  return out
}

/**
 * 每日完成趋势（柱线混合图的柱）+ 移动平均线。
 * @param startKey 起点（含）；趋势窗口由 range 决定，见 `trendStartKey`
 */
export function aggregateDailyTrend(
  todos: readonly Todo[],
  startKey: string,
  now: Date = new Date(),
  window = MOVING_AVG_WINDOW,
): DailyTrendPoint[] {
  const endKey = todayKey(now)
  const dayKeys = eachDay(startKey, endKey)
  if (dayKeys.length === 0) return []

  const counts = new Map<string, number>(dayKeys.map((key) => [key, 0]))
  for (const todo of todos) {
    const key = completedDateKey(todo)
    if (key !== null && counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const values = dayKeys.map((key) => counts.get(key) ?? 0)
  const averages = movingAverage(values, window)
  return dayKeys.map((date, index) => ({
    date,
    completed: values[index],
    movingAvg: averages[index],
  }))
}

// ---- 4. 投入产出散点 ----

/**
 * 投入产出散点：X = 当日计薪时长（小时），Y = 当日完成数。
 *
 * 日期集合取「有完成记录的日子」∪「有投入记录的日子」：
 * 只看有投入的日子会把「没记投入但完成了任务」的点丢掉，而那恰恰是最值得看的一类
 * （休息日顺手清了两条）。两端都是 0 的日子才跳过——那种点在图上没有信息量。
 */
export function aggregateScatter(
  todos: readonly Todo[],
  workLog: WorkLog,
  range: StatsRange,
  now: Date = new Date(),
): ScatterPoint[] {
  const endKey = todayKey(now)
  const rangeStart = rangeStartKey(range, now)
  // 「全部」窗口收敛到近 180 天，避免一位老用户画出几百个点
  const floorKey = addDays(endKey, -(SCATTER_MAX_DAYS - 1))
  const startKey = rangeStart === null ? floorKey : rangeStart

  const keys = new Set<string>()
  for (const todo of todos) {
    const key = completedDateKey(todo)
    if (key !== null) keys.add(key)
  }
  for (const key of Object.keys(workLog)) keys.add(key)

  const points: ScatterPoint[] = []
  for (const key of [...keys].sort()) {
    if (key > endKey || key < startKey) continue
    const completed = countCompletedOn(todos, key)
    const hours = workHoursOn(workLog, key)
    if (completed === 0 && hours === 0) continue
    points.push({ date: key, hours, completed })
  }
  return points
}

/**
 * 皮尔逊相关系数（投入时长 ↔ 完成数）。
 * 样本不足 2 个、或任一维方差为 0（例如全年每天都只投入 0 小时）时返回 null——
 * 那种情况下相关系数没有定义，硬算出来的是 NaN 或 ±1 的假结论。
 */
export function pearsonCorrelation(points: readonly ScatterPoint[]): number | null {
  const n = points.length
  if (n < 2) return null
  let sumX = 0
  let sumY = 0
  for (const p of points) {
    sumX += p.hours
    sumY += p.completed
  }
  const meanX = sumX / n
  const meanY = sumY / n

  let cov = 0
  let varX = 0
  let varY = 0
  for (const p of points) {
    const dx = p.hours - meanX
    const dy = p.completed - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  if (varX === 0 || varY === 0) return null
  return round2(cov / Math.sqrt(varX * varY))
}

// ---- 5/7. 年度报告 ----

/** 年份前缀 `YYYY-` */
function yearPrefix(year: number): string {
  return `${year}-`
}

/** 生成该年全部日期键（闰年自然多一天） */
function daysOfYear(year: number): string[] {
  return eachDay(`${year}-01-01`, `${year}-12-31`)
}

/** 最长连续完成天数（按该年逐日回看，闰年 366 天也只是 366 次循环） */
export function longestStreakOfYear(
  dailyCounts: ReadonlyMap<string, number>,
  year: number,
): number {
  let best = 0
  let run = 0
  for (const key of daysOfYear(year)) {
    if ((dailyCounts.get(key) ?? 0) > 0) {
      run++
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  return best
}

/**
 * 年度报告聚合。
 * @param tags 标签表（用于把 topTag 的 id 翻成名字）
 */
export function computeAnnualReport(
  todos: readonly Todo[],
  workLog: WorkLog,
  tags: readonly Tag[],
  year: number,
): AnnualReport {
  const prefix = yearPrefix(year)
  const inYear = (key: string | null): key is string => key !== null && key.startsWith(prefix)

  // 完成：完成时间落在该年的任务（同时按首个标签归集，供 topTag 用——口径与统计页一致）
  const dailyCounts = new Map<string, number>()
  const byTag = new Map<string, number>()
  for (const todo of todos) {
    const key = completedDateKey(todo)
    if (!inYear(key)) continue
    dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1)
    const id = todo.tags[0] ?? UNTAGGED_ID
    byTag.set(id, (byTag.get(id) ?? 0) + 1)
  }
  const completed = [...dailyCounts.values()].reduce((sum, n) => sum + n, 0)
  const activeDays = dailyCounts.size

  // 最高效月
  const byMonth = Array.from({ length: 12 }, () => 0)
  for (const [key, count] of dailyCounts) byMonth[Number(key.slice(5, 7)) - 1] += count
  const maxMonth = Math.max(...byMonth)
  const bestMonth =
    maxMonth > 0 ? { month: byMonth.indexOf(maxMonth) + 1, completed: maxMonth } : null

  // 完成最多的一天（并列取更早的那天：同样的数据永远给同样的答案）
  let busiestDay: { date: string; completed: number } | null = null
  for (const key of [...dailyCounts.keys()].sort()) {
    const count = dailyCounts.get(key) ?? 0
    if (!busiestDay || count > busiestDay.completed) busiestDay = { date: key, completed: count }
  }

  // 投入：读投入日志（按天记，含夜班归到班次开始那天）
  let workSeconds = 0
  let workDays = 0
  for (const [key, seconds] of Object.entries(workLog)) {
    if (!key.startsWith(prefix)) continue
    workSeconds += seconds
    if (seconds > 0) workDays++
  }

  // 最常用标签（byTag 已在上面那次遍历里一并归集）
  let topTag: { name: string; completed: number } | null = null
  const tagById = new Map(tags.map((t) => [t.id, t]))
  for (const [id, count] of byTag) {
    if (!topTag || count > topTag.completed) {
      topTag = {
        name: id === UNTAGGED_ID ? '无标签' : (tagById.get(id)?.name ?? '已删除标签'),
        completed: count,
      }
    }
  }

  // 该年新建任务的完成率
  const createdTodos = todos.filter((t) => (t.createdAt ?? '').startsWith(prefix))
  const created = createdTodos.length
  const createdCompleted = createdTodos.filter((t) => t.status === 'completed').length

  return {
    year,
    completed,
    created,
    completionRate: created === 0 ? 0 : Math.round((createdCompleted / created) * 100),
    activeDays,
    avgPerActiveDay: activeDays === 0 ? 0 : round1(completed / activeDays),
    bestMonth,
    longestStreak: longestStreakOfYear(dailyCounts, year),
    busiestDay,
    workSeconds,
    workDays,
    topTag,
    hasData: completed > 0 || workSeconds > 0,
  }
}

/** 有数据的年份（倒序，最多 6 个），用于年度报告的年份切换 */
export function reportYears(
  todos: readonly Todo[],
  workLog: WorkLog,
  now: Date = new Date(),
  limit = 6,
): number[] {
  const years = new Set<number>([now.getFullYear()])
  for (const todo of todos) {
    const key = completedDateKey(todo)
    if (key !== null) years.add(Number(key.slice(0, 4)))
  }
  for (const key of Object.keys(workLog)) {
    if (/^\d{4}-/.test(key)) years.add(Number(key.slice(0, 4)))
  }
  return [...years]
    .filter((y) => Number.isFinite(y) && y > 1970)
    .sort((a, b) => b - a)
    .slice(0, Math.max(1, Math.floor(limit)))
}

// ---- 文案 ----

/** 月份文案：「3 月」 */
export function formatMonthText(month: number): string {
  return `${month} 月`
}

/** 日期键 -> 「3 月 14 日」 */
export function formatDateText(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)} 月 ${Number(day)} 日`
}

/**
 * 秒 -> 时长文案（年度报告用）。
 * 一年动辄几百小时，小数点后一位到 100 小时以上就没有意义了，所以分档：
 * ≥ 100 小时取整（「312 小时」），不到 100 小时保留一位（「8.5 小时」比「9 小时」有信息量）。
 */
export function formatHoursText(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const hours = safe / 3600
  if (hours === 0) return '0 小时'
  if (hours >= 100) return `${Math.round(hours)} 小时`
  return `${round1(hours)} 小时`
}
