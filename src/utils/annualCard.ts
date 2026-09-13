/**
 * 年度报告分享卡（canvas 绘制）。
 *
 * 为什么自己画而不是截图 DOM：截图要引 html2canvas（几十 KB + 对 CSS 支持有限），
 * 而这张卡的版式是固定的（大标题 + 大数字 + 数据格子 + 页脚），
 * 用 canvas 直接画反而**完全可控**：分辨率、圆角、配色（跟随主题色/深浅色）都不受浏览器差异影响。
 *
 * 可测性设计：绘制逻辑只依赖一个 `CanvasRenderingContext2D` 形状的参数，
 * 单测传一个「记账用的假 ctx」就能逐条断言画了什么（happy-dom 没有真 canvas，
 * 但假 ctx 反而让断言更精确）。真机路径（`renderAnnualCard`）只负责 DPR 与尺寸。
 */

import { formatDateText, formatHoursText } from './stats'
import { round1 } from './numberHelper'
import type { AnnualReport } from '@/types/statistics'

/** 卡片逻辑尺寸（导出 2 倍图时按 DPR 放大，微信/相册里都清晰） */
export const ANNUAL_CARD_WIDTH = 720
export const ANNUAL_CARD_HEIGHT = 1000

/** 绘制用的配色（由页面从 themeStore 生成，因此卡片同样跟随主题色与深浅色） */
export interface AnnualCardPalette {
  /** 主色（大数字、装饰块） */
  primary: string
  /** 背景渐变起止色 */
  bgFrom: string
  bgTo: string
  /** 卡片/数据格的底色 */
  panel: string
  /** 主文字 */
  text: string
  /** 次级文字 */
  subText: string
}

/** 卡片需要的数据（已格式化成文案，绘制函数不再做业务判断） */
export interface AnnualCardData {
  year: number
  completed: number
  activeDays: number
  longestStreak: number
  avgPerActiveDay: number
  workSeconds: number
  /** 最高效月文案，如「3 月」；无数据为「—」 */
  bestMonthText: string
  topTagText: string
  busiestDayText: string
  /** 署名行（登录用户名或「本地模式」） */
  owner: string
  generatedAt: string
}

/** 从年度报告生成卡片数据（空值统一给「—」，避免卡片上出现 null） */
export function buildAnnualCardData(
  report: AnnualReport,
  options: { owner?: string; now?: Date } = {},
): AnnualCardData {
  const now = options.now ?? new Date()
  return {
    year: report.year,
    completed: report.completed,
    activeDays: report.activeDays,
    longestStreak: report.longestStreak,
    avgPerActiveDay: report.avgPerActiveDay,
    workSeconds: report.workSeconds,
    bestMonthText: report.bestMonth ? `${report.bestMonth.month} 月` : '—',
    topTagText: report.topTag ? report.topTag.name : '—',
    busiestDayText: report.busiestDay
      ? `${formatDateText(report.busiestDay.date)} · ${report.busiestDay.completed} 件`
      : '—',
    owner: options.owner?.trim() ? options.owner.trim() : '本地模式',
    generatedAt: formatDateText(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    ),
  }
}

/** 超长文案截断（canvas 里没有 CSS 的 text-overflow，自己量不了宽度就按字数收敛） */
export function truncateText(text: string, max: number): string {
  const limit = Math.max(1, Math.floor(max))
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

/** 绘制圆角矩形路径（`roundRect` 在 2012 R2 时代的浏览器/旧 WebView 里可能没有，留降级） */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius)
    return
  }
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + radius, y + h)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

/** 数据格：标签 + 大值（两行文案 + 一块圆角底板） */
interface CardStat {
  label: string
  value: string
}

/**
 * 把整张卡画到 ctx 上。
 * 版式（720×1000）：顶部标题 → 年度大数字 → 六个数据格（2 列 3 行）→ 页脚。
 */
export function drawAnnualCard(
  ctx: CanvasRenderingContext2D,
  data: AnnualCardData,
  palette: AnnualCardPalette,
  width = ANNUAL_CARD_WIDTH,
  height = ANNUAL_CARD_HEIGHT,
): void {
  const pad = Math.round(width * 0.09)

  // 背景渐变
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, palette.bgFrom)
  gradient.addColorStop(1, palette.bgTo)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // 顶部主色装饰条
  ctx.fillStyle = palette.primary
  roundedRect(ctx, pad, pad, width - pad * 2, 10, 5)
  ctx.fill()

  // 标题区
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = palette.subText
  ctx.font = `500 ${Math.round(width * 0.033)}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(`${data.owner} 的年度报告`, width / 2, pad + 80)

  ctx.fillStyle = palette.text
  ctx.font = `bold ${Math.round(width * 0.14)}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(String(data.year), width / 2, pad + 190)

  ctx.fillStyle = palette.primary
  ctx.font = `bold ${Math.round(width * 0.2)}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(String(data.completed), width / 2, pad + 330)

  ctx.fillStyle = palette.subText
  ctx.font = `400 ${Math.round(width * 0.038)}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText('件事被你完成了', width / 2, pad + 380)

  // 数据格（2 列 × 3 行）
  const stats: CardStat[] = [
    { label: '有产出的日子', value: `${data.activeDays} 天` },
    { label: '最长连续完成', value: `${data.longestStreak} 天` },
    { label: '最高效的月份', value: truncateText(data.bestMonthText, 8) },
    { label: '最常用标签', value: truncateText(data.topTagText, 8) },
    { label: '投入总时长', value: formatHoursText(data.workSeconds) },
    { label: '最猛的一天', value: truncateText(data.busiestDayText, 12) },
  ]

  const gap = Math.round(width * 0.045)
  const cellW = Math.round((width - pad * 2 - gap) / 2)
  const cellH = Math.round(height * 0.105)
  const top = pad + 450

  stats.forEach((stat, index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const x = pad + col * (cellW + gap)
    const y = top + row * (cellH + gap)

    ctx.fillStyle = palette.panel
    roundedRect(ctx, x, y, cellW, cellH, 18)
    ctx.fill()

    ctx.textAlign = 'left'
    ctx.fillStyle = palette.subText
    ctx.font = `400 ${Math.round(width * 0.026)}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(stat.label, x + 24, y + 40)

    ctx.fillStyle = palette.text
    ctx.font = `bold ${Math.round(width * 0.042)}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(stat.value, x + 24, y + 82)
  })

  // 页脚
  ctx.textAlign = 'center'
  ctx.fillStyle = palette.subText
  ctx.font = `400 ${Math.round(width * 0.026)}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(
    `日均 ${round1(data.avgPerActiveDay)} 件 · 生成于 ${data.generatedAt}`,
    width / 2,
    height - pad - 60,
  )

  ctx.fillStyle = palette.primary
  ctx.font = `bold ${Math.round(width * 0.03)}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText('Vue 3 智能工作台', width / 2, height - pad - 16)
}

/**
 * 把卡片渲染进真实 canvas（按 DPR 放大，避免高分屏发虚）。
 * @returns 是否画成功（无 2D 上下文时返回 false，由调用方给出提示而不是白屏）
 */
export function renderAnnualCard(
  canvas: HTMLCanvasElement,
  data: AnnualCardData,
  palette: AnnualCardPalette,
  scale?: number,
): boolean {
  // 不写 `= null` 初值：catch 分支直接返回，所有到达下面的路径都已经赋过值（eslint 的 no-useless-assignment）
  let ctx: CanvasRenderingContext2D | null
  try {
    ctx = canvas.getContext('2d')
  } catch {
    // 某些环境（或画布已被跨域内容污染）会在这里直接抛错：当作拿不到上下文
    return false
  }
  if (!ctx) return false

  const ratio =
    scale ??
    (typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
      ? Math.min(3, Math.max(1, window.devicePixelRatio))
      : 1)

  canvas.width = Math.round(ANNUAL_CARD_WIDTH * ratio)
  canvas.height = Math.round(ANNUAL_CARD_HEIGHT * ratio)
  /*
   * 用 `setTransform` 而不是 `scale`：同一个 canvas 上「重新生成」会复用同一个 2D 上下文，
   * `scale` 是**叠加**的（第二次点就变成 4 倍，图被裁掉大半）；`setTransform` 是绝对赋值，
   * 点多少次都是同一套坐标。改canvas.width 虽然按规范会重置上下文状态，但不该把正确性
   * 押在"浏览器一定会重置"上。
   */
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  drawAnnualCard(ctx, data, palette, ANNUAL_CARD_WIDTH, ANNUAL_CARD_HEIGHT)
  return true
}

/** 导出文件名（带年份，方便一年一张） */
export function annualCardFileName(year: number): string {
  return `年度报告-${year}.png`
}

/**
 * 触发下载。
 * 不用 `URL.createObjectURL`：png 是 dataURL，直接给 `<a download>` 即可，
 * 少一个对象 URL 的生命周期要管（忘记 revoke 就是内存泄漏）。
 */
export function downloadAnnualCard(canvas: HTMLCanvasElement, fileName: string): boolean {
  if (typeof document === 'undefined') return false
  let url: string
  try {
    url = canvas.toDataURL('image/png')
  } catch {
    return false
  }
  if (!url || !url.startsWith('data:image')) return false

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return true
}
