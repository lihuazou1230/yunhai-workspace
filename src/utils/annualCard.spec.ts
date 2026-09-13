import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  annualCardFileName,
  buildAnnualCardData,
  downloadAnnualCard,
  drawAnnualCard,
  renderAnnualCard,
  truncateText,
  ANNUAL_CARD_HEIGHT,
  ANNUAL_CARD_WIDTH,
} from './annualCard'
import type { AnnualCardData, AnnualCardPalette } from './annualCard'
import type { AnnualReport } from '@/types/statistics'

/** 画布假上下文：把「画了什么」记下来，比真 canvas 更好断言（happy-dom 没有 2D 上下文） */
function createFakeCtx(options: { roundRect?: boolean } = {}) {
  const texts: string[] = []
  const calls: string[] = []
  const gradient = { addColorStop: vi.fn() }

  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    createLinearGradient: vi.fn(() => gradient),
    fillRect: vi.fn(() => calls.push('fillRect')),
    fillText: (text: string) => {
      texts.push(text)
    },
    beginPath: vi.fn(() => calls.push('beginPath')),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    roundRect: options.roundRect === false ? undefined : vi.fn(() => calls.push('roundRect')),
    fill: vi.fn(() => calls.push('fill')),
    setTransform: vi.fn(),
  }

  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, calls, gradient }
}

const DATA: AnnualCardData = {
  year: 2026,
  completed: 128,
  activeDays: 96,
  longestStreak: 21,
  avgPerActiveDay: 1.3,
  workSeconds: 8.5 * 3600,
  bestMonthText: '3 月',
  topTagText: '工作',
  busiestDayText: '3 月 2 日 · 7 件',
  owner: '张三',
  generatedAt: '12 月 31 日',
}

const PALETTE: AnnualCardPalette = {
  primary: '#10b981',
  bgFrom: '#ffffff',
  bgTo: '#f1f5f9',
  panel: 'rgba(15,23,42,0.05)',
  text: '#0f172a',
  subText: '#64748b',
}

function report(partial: Partial<AnnualReport> = {}): AnnualReport {
  return {
    year: 2026,
    completed: 12,
    created: 20,
    completionRate: 60,
    activeDays: 9,
    avgPerActiveDay: 1.3,
    bestMonth: { month: 3, completed: 5 },
    longestStreak: 4,
    busiestDay: { date: '2026-03-02', completed: 3 },
    workSeconds: 3600,
    workDays: 1,
    topTag: { name: '工作', completed: 6 },
    hasData: true,
    ...partial,
  }
}

describe('truncateText', () => {
  it('超长才截断，并在末尾加省略号', () => {
    expect(truncateText('工作', 8)).toBe('工作')
    expect(truncateText('一二三四五六七八九十', 5)).toBe('一二三四…')
    // 上限非法时收敛到 1（宁可只剩省略号，也不要吐出一整屏文字）
    expect(truncateText('abc', 0)).toBe('…')
  })
})

describe('buildAnnualCardData', () => {
  it('把报告翻成卡片文案（含日期与署名）', () => {
    const data = buildAnnualCardData(report(), {
      owner: ' 张三 ',
      now: new Date(2026, 11, 31, 10, 0),
    })
    expect(data).toMatchObject({
      year: 2026,
      completed: 12,
      activeDays: 9,
      longestStreak: 4,
      bestMonthText: '3 月',
      topTagText: '工作',
      busiestDayText: '3 月 2 日 · 3 件',
      owner: '张三',
      generatedAt: '12 月 31 日',
    })
  })

  it('空数据用「—」占位，未登录署名「本地模式」', () => {
    const data = buildAnnualCardData(report({ bestMonth: null, topTag: null, busiestDay: null }), {
      owner: '   ',
    })
    expect(data.bestMonthText).toBe('—')
    expect(data.topTagText).toBe('—')
    expect(data.busiestDayText).toBe('—')
    expect(data.owner).toBe('本地模式')
  })
})

describe('drawAnnualCard', () => {
  it('按 720×1000 版式画出标题、大数字与六个数据格', () => {
    const { ctx, texts, gradient } = createFakeCtx()
    drawAnnualCard(ctx, DATA, PALETTE)

    // 背景渐变两个色标
    expect(gradient.addColorStop).toHaveBeenCalledTimes(2)
    // 关键文案都在
    expect(texts).toContain('张三 的年度报告')
    expect(texts).toContain('2026')
    expect(texts).toContain('128')
    expect(texts).toContain('件事被你完成了')
    expect(texts).toContain('96 天')
    expect(texts).toContain('21 天')
    expect(texts).toContain('8.5 小时')
    expect(texts).toContain('Vue 3 智能工作台')
    // 6 个数据格 + 顶部装饰条
    expect(texts.filter((t) => t === '工作').length).toBeGreaterThan(0)
  })

  it('没有 roundRect 的旧环境走 arcTo 降级路径（不抛错、照样画完）', () => {
    const { ctx, texts, calls } = createFakeCtx({ roundRect: false })
    expect(() => drawAnnualCard(ctx, DATA, PALETTE)).not.toThrow()
    expect(calls).toContain('beginPath')
    expect(texts).toContain('128')
  })

  it('超长标签文案被截断，不会溢出格子', () => {
    const { ctx, texts } = createFakeCtx()
    drawAnnualCard(ctx, { ...DATA, topTagText: '一个非常非常长的标签名' }, PALETTE)
    expect(texts.some((t) => t.endsWith('…'))).toBe(true)
  })
})

describe('renderAnnualCard', () => {
  it('按 DPR 放大画布尺寸（高清屏不发虚）', () => {
    const { ctx } = createFakeCtx()
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
    } as unknown as HTMLCanvasElement

    expect(renderAnnualCard(canvas, DATA, PALETTE, 2)).toBe(true)
    expect(canvas.width).toBe(ANNUAL_CARD_WIDTH * 2)
    expect(canvas.height).toBe(ANNUAL_CARD_HEIGHT * 2)
    // 绝对赋值而不是叠加的 scale：同一张 canvas 上「重新生成」不会越画越大
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
  })

  it('同一张 canvas 上重复生成，变换矩阵始终是同一套（不会累积成 4 倍）', () => {
    const { ctx } = createFakeCtx()
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement

    renderAnnualCard(canvas, DATA, PALETTE, 2)
    renderAnnualCard(canvas, DATA, PALETTE, 2)
    const calls = (ctx.setTransform as unknown as { mock: { calls: number[][] } }).mock.calls
    expect(calls).toEqual([
      [2, 0, 0, 2, 0, 0],
      [2, 0, 0, 2, 0, 0],
    ])
  })

  it('不传倍率时用 devicePixelRatio（并夹在 1~3）', () => {
    const { ctx } = createFakeCtx()
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
    expect(renderAnnualCard(canvas, DATA, PALETTE)).toBe(true)
    // happy-dom 的 devicePixelRatio 是 1
    expect(canvas.width).toBe(ANNUAL_CARD_WIDTH)
  })

  it('没有 window（预渲染环境）时按 1 倍画，不抛错', () => {
    vi.stubGlobal('window', undefined)
    const { ctx } = createFakeCtx()
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
    expect(renderAnnualCard(canvas, DATA, PALETTE)).toBe(true)
    expect(canvas.width).toBe(ANNUAL_CARD_WIDTH)
    vi.unstubAllGlobals()
  })

  it('没有 2D 上下文（测试环境/老 WebView）返回 false，由页面给提示', () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement
    expect(renderAnnualCard(canvas, DATA, PALETTE)).toBe(false)
  })

  it('getContext 抛错也返回 false，不让异常把页面打挂', () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => {
        throw new Error('boom')
      },
    } as unknown as HTMLCanvasElement
    expect(renderAnnualCard(canvas, DATA, PALETTE)).toBe(false)
  })
})

describe('annualCardFileName', () => {
  it('文件名带年份', () => {
    expect(annualCardFileName(2026)).toBe('年度报告-2026.png')
  })
})

describe('downloadAnnualCard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('导出成功：交给 <a download> 点击下载', () => {
    const canvas = {
      toDataURL: vi.fn(() => 'data:image/png;base64,AAAA'),
    } as unknown as HTMLCanvasElement
    const click = vi.fn()
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a') el.click = click
      return el
    })

    expect(downloadAnnualCard(canvas, 'x.png')).toBe(true)
    expect(click).toHaveBeenCalled()
    // 临时节点不能留在 DOM 里
    expect(document.querySelector('a[download="x.png"]')).toBeNull()
  })

  it('导出的不是 data:image（被污染的画布）时返回 false', () => {
    const canvas = { toDataURL: () => 'data:,' } as unknown as HTMLCanvasElement
    expect(downloadAnnualCard(canvas, 'x.png')).toBe(false)
  })

  it('toDataURL 抛错时返回 false（跨域图片污染画布会走到这里）', () => {
    const canvas = {
      toDataURL: () => {
        throw new Error('tainted')
      },
    } as unknown as HTMLCanvasElement
    expect(downloadAnnualCard(canvas, 'x.png')).toBe(false)
  })
})
