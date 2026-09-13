/**
 * 数值收敛小工具（纯函数）。
 *
 * 为什么要单独一个文件：统计与投入日志都要把浮点结果收敛成「能进图表和文案」的样子
 * （散点图 X 轴 1 位小数、相关系数 2 位小数、时长 1 位小数）。
 * 如果各处各写一遍 `Math.round(x * 10) / 10`，迟早会出现两处精度不一致，
 * 同一天的数据在两个页面上显示成 8.5 和 8.53。
 */

/** 保留 1 位小数 */
export function round1(value: number): number {
  return roundTo(value, 1)
}

/** 保留 2 位小数 */
export function round2(value: number): number {
  return roundTo(value, 2)
}

/** 保留 n 位小数（n < 0 视为 0；非法数值原样返回 NaN 由调用方判定） */
export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** Math.max(0, Math.floor(digits))
  return Math.round(value * factor) / factor
}
