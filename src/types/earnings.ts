/**
 * 赚钱秒表（Earnings）领域类型。
 *
 * 设计要点：金额一律以**整数「分」**存储与运算，避免浮点累加误差；
 * 所有计算由 utils/earnings.ts 的纯函数完成（now 可注入，便于单测）。
 */

/** 计薪状态 */
export type EarningsStatus =
  /** 未设置薪资或工作时段无效：展示设置引导 */
  | 'not-configured'
  /** 非计薪日（按 workDays 判定）：不累计 */
  | 'weekend'
  /** 上班前：不累计 */
  | 'before-work'
  /** 工作中：按时间戳差值累计 */
  | 'working'
  /** 午休中：金额冻结在午休开始时刻 */
  | 'lunch'
  /** 已下班：展示今日满勤金额 */
  | 'after-work'

/**
 * 薪资模式（第六阶段 6.2 秒表 Pro）：
 * - monthly：月薪 ÷ 月计薪天数 = 日薪（换算基准是月计薪天数）
 * - daily：日薪直接给定
 * - hourly：时薪 × 每日计薪小时数 = 日薪（换算基准是每日工作时长）
 */
export type SalaryMode = 'monthly' | 'daily' | 'hourly'

/** 赚钱秒表配置（持久化到 localStorage） */
export interface EarningsConfig {
  /** 薪资模式 */
  salaryMode: SalaryMode
  /** 月薪（元）—— monthly 模式使用 */
  monthlySalary: number
  /** 日薪（元）—— daily 模式使用 */
  dailySalary: number
  /** 时薪（元）—— hourly 模式使用 */
  hourlySalary: number
  /** 上班时间 HH:mm（跨零点夜班的开始时刻，如 22:00） */
  workStart: string
  /** 下班时间 HH:mm；**小于上班时间表示跨零点夜班**（次日下班，如 06:00） */
  workEnd: string
  /** 午休开始 HH:mm；留空表示不扣午休 */
  lunchStart: string
  /** 午休结束 HH:mm；留空表示不扣午休 */
  lunchEnd: string
  /**
   * 月计薪天数（默认 21.75）。
   * 规划口径：自定义每周工作日取代它作为「哪几天计薪」的主开关，
   * 它在 monthly 模式下仍作为「月薪 → 日薪」的换算基准保留为高级选项。
   */
  monthWorkDays: number
  /**
   * 每周哪几天计薪（0=周日 … 6=周六），默认周一~周五。
   * 覆盖单休、轮休人群；取代原来的单一 weekdaysOnly 布尔值。
   */
  workDays: number[]
}

/** 下一次状态切换的目标（用于生成倒计时文案） */
export type EarningsNextChange = 'none' | 'on-work' | 'lunch' | 'off-work'

/** 某一时刻的赚钱秒表快照（全部金额单位为「分」） */
export interface EarningsSnapshot {
  status: EarningsStatus
  /** 今日已赚（分）——主指标 */
  earnedFen: number
  /** 本月已赚（分）——次要指标 */
  monthEarnedFen: number
  /** 本月已赚相对「上月同期」的涨跌百分比（上月同期为 0 时为 0） */
  monthDeltaPercent: number
  /** 本月计薪天数（整月） */
  monthPaidDays: number
  /** 本月已计薪天数（已完整过去 + 今天，非计薪日不加） */
  monthElapsedPaidDays: number
  /** 今日满勤应得（分） */
  dailyFen: number
  /** 时薪（分） */
  hourlyFen: number
  /** 今日计薪总秒数（已扣除午休） */
  dailyWorkSeconds: number
  /** 今日已计薪秒数 */
  elapsedWorkSeconds: number
  /** 今日进度 0 ~ 1 */
  progress: number
  /** 下一次状态切换的目标 */
  nextChange: EarningsNextChange
  /** 距下一次状态切换的秒数（非工作状态为 0） */
  secondsToNextChange: number
  /** 是否跨零点夜班（workEnd <= workStart 且合法） */
  nightShift: boolean
  /** 当前班次的开始时刻（夜班可能是「昨天」的 HH:mm） */
  shiftStartLabel: string
  /** 当前班次的结束时刻 */
  shiftEndLabel: string
}

/** localStorage 键 */
export const EARNINGS_STORAGE_KEY = 'smart-workspace:earnings'

/** 周一到周五（0=周日 … 6=周六） */
export const WEEKDAY_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5]

/** 默认配置：朝九晚六、午休 1 小时、周一~周五计薪、月计薪 21.75 天；金额待用户填写 */
export const DEFAULT_EARNINGS_CONFIG: EarningsConfig = {
  salaryMode: 'monthly',
  monthlySalary: 0,
  dailySalary: 0,
  hourlySalary: 0,
  workStart: '09:00',
  workEnd: '18:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  monthWorkDays: 21.75,
  workDays: [...WEEKDAY_WORK_DAYS],
}

/** 状态文案（非工作中状态展示文案而非金额） */
export const EARNINGS_STATUS_TEXT: Record<EarningsStatus, string> = {
  'not-configured': '设置薪资后开始计时',
  weekend: '今天不计薪，好好休息 🌴',
  'before-work': '还没开张，先喝杯咖啡 ☕',
  working: '今日进账中',
  lunch: '带薪摸鱼中 🍜',
  'after-work': '收工',
}

/** 迷你折叠模式（只显示金额的小条）持久化键 */
export const EARNINGS_COMPACT_KEY = 'smart-workspace:earnings-compact'

/** 薪资模式文案 */
export const SALARY_MODE_LABEL: Record<SalaryMode, string> = {
  monthly: '月薪',
  daily: '日薪',
  hourly: '时薪',
}

/** 星期文案（0=周日 … 6=周六） */
export const WEEKDAY_LABEL: Record<number, string> = {
  0: '日',
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
}

/** 展示顺序：周一 ~ 周日 */
export const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0]
