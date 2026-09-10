/**
 * 赚钱秒表：纯函数计算层（now 可注入，便于单测）。
 *
 * 两条硬性约束（也是面试话术的核心）：
 * 1. **金额永远由时间戳差值重算**，不做 setInterval 累加计数 —— 浏览器后台标签页
 *    会把定时器节流到 1 次/分钟，累加式实现切回页面时误差巨大；差值式实现任意
 *    时刻切回来数字都是准的（无跳变、无漂移）。
 * 2. **金额内部一律用整数「分」运算**，只在最后格式化成「元.分」展示，避免
 *    `0.1 + 0.2` 这类浮点误差在长时间累计后显形。
 */

import type {
  EarningsConfig,
  EarningsNextChange,
  EarningsSnapshot,
  EarningsStatus,
  SalaryMode,
} from '@/types/earnings'
import { DEFAULT_EARNINGS_CONFIG, WEEKDAY_WORK_DAYS } from '@/types/earnings'
import { todayKey } from '@/utils/dateFormatter'

const SECONDS_PER_HOUR = 3600
const SECONDS_PER_MINUTE = 60
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const DAY_SECONDS = 24 * SECONDS_PER_HOUR

/** HH:mm -> 当天 0 点起的秒数；非法输入返回 null */
export function parseTimeToSeconds(time: string): number | null {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!matched) return null
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  if (hour >= HOURS_PER_DAY || minute >= MINUTES_PER_HOUR) return null
  return hour * SECONDS_PER_HOUR + minute * SECONDS_PER_MINUTE
}

/** 当天 0 点起已过的秒数（含秒，用于精确到秒的差值计算） */
export function secondsOfDay(date: Date): number {
  return (
    date.getHours() * SECONDS_PER_HOUR + date.getMinutes() * SECONDS_PER_MINUTE + date.getSeconds()
  )
}

/** 元 -> 分（四舍五入到整数分） */
export function yuanToFen(yuan: number): number {
  if (!Number.isFinite(yuan)) return 0
  return Math.round(yuan * 100)
}

/** 分 -> 「1,234.56」字符串（元，固定两位小数，千分位分组） */
export function formatFen(fen: number): string {
  const rounded = Math.round(Number.isFinite(fen) ? fen : 0)
  const sign = rounded < 0 ? '-' : ''
  const abs = Math.abs(rounded)
  const yuan = Math.floor(abs / 100)
  const cents = (abs % 100).toString().padStart(2, '0')
  const grouped = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${grouped}.${cents}`
}

/** 秒 -> 「3 小时 24 分」/「24 分 12 秒」/「12 秒」 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / SECONDS_PER_HOUR)
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const secs = total % SECONDS_PER_MINUTE
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分 ${secs} 秒`
  return `${secs} 秒`
}

// ---- 班次（含跨零点夜班） ----

/**
 * 是否跨零点夜班：下班时间**早于**上班时间（如 22:00 → 06:00）。
 * 注意 end === start 是「零长度班次」，属于无效配置而不是夜班。
 */
export function isNightShift(config: EarningsConfig): boolean {
  const start = parseTimeToSeconds(config.workStart)
  const end = parseTimeToSeconds(config.workEnd)
  if (start === null || end === null) return false
  return end < start
}

/** 班次总长（秒）：夜班为「次日下班」，所以是 end + 24h − start */
export function shiftLengthSeconds(config: EarningsConfig): number {
  const start = parseTimeToSeconds(config.workStart)
  const end = parseTimeToSeconds(config.workEnd)
  if (start === null || end === null || end === start) return 0
  return end > start ? end - start : end + DAY_SECONDS - start
}

/**
 * 把「一天中的秒数」换算成**班次内相对秒数**（班次开始 = 0）。
 *
 * 这是整套跨零点逻辑的核心：夜班用取模把凌晨的时刻折回同一个班次里，
 * 于是「22:00 → 06:00 的午休 02:00-03:00」在班次坐标里就是 4h~5h，
 * 午休重叠、已计薪时长、状态判定全部可以复用同一套公式，不必到处写 if。
 */
export function shiftRelativeSeconds(
  secondsOfDayValue: number,
  startSeconds: number,
  night: boolean,
): number {
  const rel = secondsOfDayValue - startSeconds
  if (!night) return rel
  return ((rel % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS
}

/** 某个时刻所在的班次开始日期（夜班凌晨属于「昨天开始」的那个班） */
export function shiftStartDate(config: EarningsConfig, now: Date): Date {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!isNightShift(config)) return dayStart
  const start = parseTimeToSeconds(config.workStart) ?? 0
  if (secondsOfDay(now) >= start) return dayStart
  return new Date(dayStart.getTime() - DAY_SECONDS * 1000)
}

/** 午休在班次坐标里的区间（无效/不在班次内返回 null） */
function lunchRange(config: EarningsConfig): { from: number; to: number } | null {
  const startSec = parseTimeToSeconds(config.workStart)
  const lunchStart = parseTimeToSeconds(config.lunchStart)
  const lunchEnd = parseTimeToSeconds(config.lunchEnd)
  if (startSec === null || lunchStart === null || lunchEnd === null) return null
  if (lunchEnd === lunchStart) return null

  const night = isNightShift(config)
  const length = shiftLengthSeconds(config)
  if (length <= 0) return null

  const raw = lunchEnd > lunchStart ? lunchEnd - lunchStart : lunchEnd + DAY_SECONDS - lunchStart
  const from = shiftRelativeSeconds(lunchStart, startSec, night)
  // 午休长度用原始差值（跨零点的午休也算对），但整段必须落在班次区间内才算数
  if (from + raw > length) return null
  return { from, to: from + raw }
}

/** 午休与 [0, limit] 的重叠秒数 */
function lunchOverlapUpTo(config: EarningsConfig, limit: number): number {
  const range = lunchRange(config)
  if (!range || limit <= 0) return 0
  const to = Math.min(limit, range.to)
  const from = Math.max(0, range.from)
  return Math.max(0, to - from)
}

/** 今日计薪总秒数：班次总长 − 与班次重叠的午休；配置无效返回 0 */
export function dailyWorkSeconds(config: EarningsConfig): number {
  const length = shiftLengthSeconds(config)
  if (length <= 0) return 0
  return Math.max(0, length - lunchOverlapUpTo(config, length))
}

/** 截至 now 已计薪的秒数（扣除午休、封顶到班次结束） */
export function elapsedWorkSeconds(config: EarningsConfig, now: Date): number {
  const length = shiftLengthSeconds(config)
  if (length <= 0) return 0

  const start = parseTimeToSeconds(config.workStart)
  if (start === null) return 0

  const rel = shiftRelativeSeconds(secondsOfDay(now), start, isNightShift(config))
  if (rel <= 0) return 0

  const capped = Math.min(rel, length)
  return Math.max(0, capped - lunchOverlapUpTo(config, capped))
}

// ---- 薪资三模式换算 ----

/** 当前模式下的名义金额（元） */
export function salaryOf(config: EarningsConfig): number {
  switch (config.salaryMode) {
    case 'daily':
      return config.dailySalary
    case 'hourly':
      return config.hourlySalary
    case 'monthly':
    default:
      return config.monthlySalary
  }
}

/**
 * 今日满勤应得（分）。
 * 三种模式统一收敛到「日薪」这一个中间量：
 * - monthly：月薪 ÷ 月计薪天数
 * - daily：直接用日薪
 * - hourly：时薪 × 每日计薪小时数（每日计薪小时数由班次−午休得出）
 */
export function dailyEarnedFen(config: EarningsConfig): number {
  if (config.salaryMode === 'daily') return Math.max(0, yuanToFen(config.dailySalary))

  if (config.salaryMode === 'hourly') {
    const seconds = dailyWorkSeconds(config)
    if (seconds <= 0) return 0
    return Math.round((yuanToFen(config.hourlySalary) * seconds) / SECONDS_PER_HOUR)
  }

  const monthly = yuanToFen(config.monthlySalary)
  if (monthly <= 0 || config.monthWorkDays <= 0) return 0
  return Math.round(monthly / config.monthWorkDays)
}

/** 时薪（分）：时薪模式直接用；其余用「日薪 ÷ 每日计薪小时数」反推 */
export function hourlyEarnedFen(config: EarningsConfig): number {
  if (config.salaryMode === 'hourly') return Math.max(0, yuanToFen(config.hourlySalary))

  const seconds = dailyWorkSeconds(config)
  if (seconds <= 0) return 0
  return Math.round((dailyEarnedFen(config) * SECONDS_PER_HOUR) / seconds)
}

/**
 * 今日已赚（分）。
 *
 * 两条硬性约束（也是面试话术的核心）：
 * 1. **金额永远由时间戳差值重算**，不做 setInterval 累加计数 —— 浏览器后台标签页
 *    会把定时器节流到 1 次/分钟，累加式实现切回页面时误差巨大；差值式实现任意
 *    时刻切回来数字都是准的（无跳变、无漂移）。
 * 2. **金额内部一律用整数「分」运算**，只在最后格式化成「元.分」展示，避免
 *    `0.1 + 0.2` 这类浮点误差在长时间累计后显形。
 *
 * monthly 模式刻意保留「月薪分 × 已计薪秒 ÷ (月计薪天数 × 每日计薪秒)」这种
 * 一次性整数除到底的写法则：中间不落「日薪」的取整误差，长时间跨度下更准。
 */
export function earnedFen(config: EarningsConfig, now: Date): number {
  const totalSeconds = dailyWorkSeconds(config)
  if (totalSeconds <= 0) return 0
  if (!isPaidDay(config, now)) return 0

  const elapsed = Math.min(elapsedWorkSeconds(config, now), totalSeconds)
  if (elapsed <= 0) return 0

  if (config.salaryMode === 'monthly') {
    const monthly = yuanToFen(config.monthlySalary)
    if (monthly <= 0 || config.monthWorkDays <= 0) return 0
    return Math.round((monthly * elapsed) / (config.monthWorkDays * totalSeconds))
  }

  return Math.round((dailyEarnedFen(config) * elapsed) / totalSeconds)
}

/**
 * 某个**日期本身**是否计薪（按它的星期几判断）。
 * 月计薪天数这类「按日历数日子」的场景用它；而「今天赚了多少」用 isPaidDay
 * （夜班的凌晨属于前一天的班次）。
 */
export function isWorkDate(config: EarningsConfig, date: Date): boolean {
  const days = config.workDays?.length ? config.workDays : WEEKDAY_WORK_DAYS
  return days.includes(date.getDay())
}

/**
 * 当前时刻所在**班次**是否计薪。
 * 夜班按班次开始那天判定（凌晨 3 点属于「昨天开始」的班），
 * 所以周五晚上的夜班到周六凌晨仍然计薪。
 */
export function isPaidDay(config: EarningsConfig, now: Date): boolean {
  return isWorkDate(config, shiftStartDate(config, now))
}

/**
 * 上月同期已赚（分）：把「同一天同一时刻」搬到上个月再算一遍，用于月度趋势对比。
 * 上月没有这一天时（如 3/31 → 2 月）取上月最后一天，时间部分保持不变。
 */
export function lastMonthSamePeriodFen(config: EarningsConfig, now: Date): number {
  if (dailyEarnedFen(config) <= 0) return 0

  const year = now.getFullYear()
  const month = now.getMonth()
  const lastMonthDate = new Date(year, month - 1, 1)
  const lastMonthYear = lastMonthDate.getFullYear()
  const lastMonth = lastMonthDate.getMonth()
  const lastMonthDays = new Date(lastMonthYear, lastMonth + 1, 0).getDate()

  const sameMoment = new Date(
    lastMonthYear,
    lastMonth,
    Math.min(now.getDate(), lastMonthDays),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  )
  return monthlyEarnedFen(config, sameMoment)
}

/** 本月计薪天数（整月，含尚未到来的日子） */
export function paidDaysInMonth(config: EarningsConfig, now: Date): number {
  const year = now.getFullYear()
  const month = now.getMonth()
  const total = new Date(year, month + 1, 0).getDate()
  let count = 0
  for (let day = 1; day <= total; day++) {
    if (isWorkDate(config, new Date(year, month, day, 12, 0, 0))) count += 1
  }
  return count
}

/** 本月截至「昨天」已完整过去的计薪天数 */
export function completedPaidDaysBefore(config: EarningsConfig, now: Date): number {
  const year = now.getFullYear()
  const month = now.getMonth()
  const today = now.getDate()
  let count = 0
  for (let day = 1; day < today; day++) {
    if (isWorkDate(config, new Date(year, month, day, 12, 0, 0))) count += 1
  }
  return count
}

/** 本月已计薪天数：已完整过去的天数 + 今天（今天是计薪日时） */
export function elapsedPaidDays(config: EarningsConfig, now: Date): number {
  return completedPaidDaysBefore(config, now) + (isPaidDay(config, now) ? 1 : 0)
}

/**
 * 本月已赚（分）——次要指标。
 * 与「今日已赚」共用同一个日薪基准，保证两个数字对得上账：
 * `已完整计薪天数 × 日薪 + 今日已赚`，并**封顶在「本月应得」**——
 * 手填月计薪天数时常按月平均 21.75 天，个别月份有 22~23 个工作日，
 * 按位累计会略微超过工资，而实际发放额就是那么多。
 */
export function monthlyEarnedFen(config: EarningsConfig, now: Date): number {
  const daily = dailyEarnedFen(config)
  if (daily <= 0) return 0

  const days = completedPaidDaysBefore(config, now)
  const past = daily * days
  const cap =
    config.salaryMode === 'monthly' && config.monthWorkDays > 0
      ? yuanToFen(config.monthlySalary)
      : daily * paidDaysInMonth(config, now)

  return Math.min(cap, past + earnedFen(config, now))
}

/** 当前计薪状态 */
export function resolveEarningsStatus(config: EarningsConfig, now: Date): EarningsStatus {
  if (dailyEarnedFen(config) <= 0) return 'not-configured'

  const length = shiftLengthSeconds(config)
  if (length <= 0) return 'not-configured'
  if (!isPaidDay(config, now)) return 'weekend'

  const start = parseTimeToSeconds(config.workStart)
  if (start === null) return 'not-configured'

  const night = isNightShift(config)
  const rel = shiftRelativeSeconds(secondsOfDay(now), start, night)

  // 夜班的 rel 永远落在 [0, 24h)，班次结束后 rel 会「绕回」下一次班次之前 ——
  // 两者都归入 after-work（见 nextChange 与 README 的口径说明）
  if (rel >= length) return 'after-work'
  if (!night && rel < 0) return 'before-work'

  const range = lunchRange(config)
  if (range && rel >= range.from && rel < range.to) return 'lunch'

  return 'working'
}

/**
 * 下一次状态切换：目标 + 剩余秒数。
 * 上班前 → 上班；工作中 → 午休（若还没到）否则下班；午休 → 午后上班；其余无。
 */
export function nextChange(
  config: EarningsConfig,
  now: Date,
): { target: EarningsNextChange; seconds: number } {
  const status = resolveEarningsStatus(config, now)
  const length = shiftLengthSeconds(config)
  const start = parseTimeToSeconds(config.workStart)
  if (start === null || length <= 0) return { target: 'none', seconds: 0 }

  const night = isNightShift(config)
  const rel = shiftRelativeSeconds(secondsOfDay(now), start, night)
  const until = (point: number) => Math.max(0, point - rel)

  const range = lunchRange(config)

  if (status === 'before-work') {
    // 日班：距今天上班还有多久
    return { target: 'on-work', seconds: Math.max(0, start - secondsOfDay(now)) }
  }
  if (status === 'lunch' && range) {
    return { target: 'on-work', seconds: until(range.to) }
  }
  if (status === 'working') {
    if (range && rel < range.from) return { target: 'lunch', seconds: range.from - rel }
    return { target: 'off-work', seconds: until(length) }
  }
  return { target: 'none', seconds: 0 }
}

/** 汇总快照：组件渲染的唯一数据来源 */
export function computeEarnings(config: EarningsConfig, now: Date = new Date()): EarningsSnapshot {
  const totalSeconds = dailyWorkSeconds(config)
  const elapsed = elapsedWorkSeconds(config, now)
  const status = resolveEarningsStatus(config, now)
  const change = nextChange(config, now)
  const monthEarned = monthlyEarnedFen(config, now)
  const lastMonth = lastMonthSamePeriodFen(config, now)

  return {
    status,
    earnedFen: earnedFen(config, now),
    monthEarnedFen: monthEarned,
    monthDeltaPercent: lastMonth > 0 ? ((monthEarned - lastMonth) / lastMonth) * 100 : 0,
    monthPaidDays: paidDaysInMonth(config, now),
    monthElapsedPaidDays: elapsedPaidDays(config, now),
    dailyFen: dailyEarnedFen(config),
    hourlyFen: hourlyEarnedFen(config),
    dailyWorkSeconds: totalSeconds,
    elapsedWorkSeconds: elapsed,
    progress: totalSeconds <= 0 ? 0 : Math.min(1, elapsed / totalSeconds),
    nextChange: change.target,
    secondsToNextChange: change.seconds,
    nightShift: isNightShift(config),
    shiftStartLabel: config.workStart,
    shiftEndLabel: isNightShift(config) ? `${config.workEnd}（次日）` : config.workEnd,
  }
}

/** 配置是否完整可用（当前模式金额 > 0 且工作时段合法） */
export function isEarningsConfigured(config: EarningsConfig): boolean {
  return dailyEarnedFen(config) > 0 && dailyWorkSeconds(config) > 0
}

/**
 * 旧版本数据迁移 + 脏数据收敛。
 *
 * 需要迁移的两处：
 * - 老配置只有 `weekdaysOnly: boolean`，没有 `workDays: number[]`
 * - 老配置没有 `salaryMode` / `dailySalary` / `hourlySalary`
 */
export function normalizeEarningsConfig(raw: unknown): EarningsConfig {
  const base = { ...DEFAULT_EARNINGS_CONFIG }
  if (!raw || typeof raw !== 'object') return base
  const input = raw as Partial<EarningsConfig> & { weekdaysOnly?: unknown }

  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const time = (value: unknown, fallback: string): string =>
    typeof value === 'string' && parseTimeToSeconds(value) !== null ? value : fallback

  const workDays = Array.isArray(input.workDays)
    ? input.workDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
    : []
  // 老数据：weekdaysOnly === false 表示「每天都计薪」
  const migratedDays =
    workDays.length > 0
      ? workDays
      : input.weekdaysOnly === false
        ? [0, 1, 2, 3, 4, 5, 6]
        : [...WEEKDAY_WORK_DAYS]

  const mode: SalaryMode =
    input.salaryMode === 'daily' || input.salaryMode === 'hourly' || input.salaryMode === 'monthly'
      ? input.salaryMode
      : 'monthly'

  return {
    salaryMode: mode,
    monthlySalary: Math.max(0, num(input.monthlySalary, 0)),
    dailySalary: Math.max(0, num(input.dailySalary, 0)),
    hourlySalary: Math.max(0, num(input.hourlySalary, 0)),
    workStart: time(input.workStart, base.workStart),
    workEnd: time(input.workEnd, base.workEnd),
    lunchStart: input.lunchStart === '' ? '' : time(input.lunchStart, base.lunchStart),
    lunchEnd: input.lunchEnd === '' ? '' : time(input.lunchEnd, base.lunchEnd),
    monthWorkDays: num(input.monthWorkDays, base.monthWorkDays),
    workDays: [...new Set(migratedDays)].sort((a, b) => a - b),
  }
}

/** 供 UI 展示：今天是否计薪（用于迷你模式文案与设置页提示） */
export function isTodayPaid(config: EarningsConfig, now: Date = new Date()): boolean {
  return isPaidDay(config, now)
}

/** 当前计薪日的日期键（夜班凌晨算作班次开始那天） */
export function shiftDateKey(config: EarningsConfig, now: Date = new Date()): string {
  return todayKey(shiftStartDate(config, now))
}
