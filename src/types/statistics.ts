import type { TagColor } from './tag'
import type { TodoPriority } from './todo'

// ---- 第八阶段 8.1：可视化强化新增的聚合口径 ----

/** 统计时间范围：本周（周一起）/ 本月（1 日起）/ 全部 */
export type StatsRange = 'week' | 'month' | 'all'

/** 范围切换器的选项顺序（本周 → 本月 → 全部，由细到粗） */
export const STATS_RANGES: readonly StatsRange[] = ['week', 'month', 'all']

/** 范围文案（页面标题、图表副标题共用，避免各写一遍） */
export const STATS_RANGE_LABEL: Record<StatsRange, string> = {
  week: '本周',
  month: '本月',
  all: '全部',
}

/** 单日任务统计（热力图数据单元） */
export interface DailyStat {
  /** 日期键 YYYY-MM-DD */
  date: string
  /** 当日完成数 */
  completed: number
}

/** 按优先级聚合的统计 */
export interface PriorityStat {
  priority: TodoPriority
  total: number
  completed: number
}

/** 任务总览统计 */
export interface TaskStatistics {
  total: number
  completed: number
  active: number
  /** 完成率 0-100 */
  completionRate: number
  byPriority: PriorityStat[]
  /** 近 90 天每日完成情况 */
  daily: DailyStat[]
}

/**
 * 标签占比项（环形图）。
 *
 * 归类口径：**按任务的第一个标签**（`tags[0]`）归类，没有标签的进「无标签」切片。
 * 为什么不做「多标签各计一次」：那样各切片占比之和会超过 100%，环形图会撒谎；
 * 一任务一片才能让「占比」这两个字站得住（口径在图表副标题里也写明了）。
 */
export interface TagShareItem {
  /** 标签 id；无标签切片为 `UNTAGGED_ID` */
  id: string
  name: string
  /** 标签色；无标签切片为 null（由图表取中性灰） */
  color: TagColor | null
  /** 范围内该标签的完成数 */
  completed: number
  /** 占范围内完成总数的百分比 0-100 */
  share: number
  /** 平均「创建 → 完成」耗时（小时，1 位小数）；无有效样本时为 null */
  avgHours: number | null
}

/** 7×24 完成时段分布（ECharts heatmap：x=小时，y=星期） */
export interface HourlyHeatmap {
  /** counts[weekday][hour]：weekday 0=周一 … 6=周日，hour 0~23 */
  counts: number[][]
  /** 单格最大值（色阶上限）；无数据时为 0 */
  max: number
  /** 范围内完成总数 */
  total: number
}

/** 每日完成趋势点（柱线混合图：柱=当日完成数，线=移动平均） */
export interface DailyTrendPoint {
  /** 日期键 YYYY-MM-DD */
  date: string
  completed: number
  /** 移动平均（默认 7 日；窗口起点不足 7 天时取已有天数） */
  movingAvg: number
}

/** 投入产出散点：X = 当日计薪时长（小时），Y = 当日完成数 */
export interface ScatterPoint {
  date: string
  /** 当日累计计薪时长（小时，1 位小数）——来自赚钱秒表的投入日志 */
  hours: number
  completed: number
}

/** 年度报告（/annual 页面与 canvas 分享卡的数据源） */
export interface AnnualReport {
  year: number
  /** 全年完成数 */
  completed: number
  /** 全年新建任务数 */
  created: number
  /** 全年新建任务的完成率 0-100 */
  completionRate: number
  /** 有完成记录的天数 */
  activeDays: number
  /** 有完成记录的天数里平均每天完成多少（1 位小数） */
  avgPerActiveDay: number
  /** 最高效的月份（完成数最多的月份）；全年无完成时为 null */
  bestMonth: { month: number; completed: number } | null
  /** 全年最长连续完成天数 */
  longestStreak: number
  /** 完成最多的一天 */
  busiestDay: { date: string; completed: number } | null
  /** 投入总时长（秒）——赚钱秒表投入日志在该年的累计 */
  workSeconds: number
  /** 有投入记录（> 0 秒）的天数 */
  workDays: number
  /** 全年完成数最多的标签（按首个标签归类；无标签时 name 为「无标签」） */
  topTag: { name: string; completed: number } | null
  /** 该年是否存在任何可展示的数据（决定整页是否走空状态） */
  hasData: boolean
}
