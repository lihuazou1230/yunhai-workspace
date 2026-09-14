import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import {
  DEFAULT_EARNINGS_CONFIG,
  EARNINGS_COMPACT_KEY,
  EARNINGS_STATUS_TEXT,
  EARNINGS_STORAGE_KEY,
} from '@/types/earnings'
import EarningsClock from './EarningsClock.vue'

/** 21750 元 / 21.75 天 = 1000 元/天；09:00-18:00 扣 1 小时午休 = 8 小时 */
const CONFIG = { ...DEFAULT_EARNINGS_CONFIG, monthlySalary: 21750 }

function seed(config: unknown) {
  window.localStorage.setItem(EARNINGS_STORAGE_KEY, JSON.stringify(config))
}

/** 2026-09-10 是周四；12 日为周六 */
function freezeTime(hours: number, minutes = 0, seconds = 0, day = 10) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, day, hours, minutes, seconds))
}

/** 主指标元素：今日已赚金额（只在展示今日金额的状态下渲染） */
function amountElement(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid="earnings-today"]')
}

async function openSettings(wrapper: ReturnType<typeof mount>) {
  const button = wrapper.findAll('button').find((b) => b.text() === '设置')
  expect(button).toBeTruthy()
  await button!.trigger('click')
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('EarningsClock', () => {
  it('未配置月薪：默认展开设置、给出引导且不渲染金额', () => {
    freezeTime(11)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT['not-configured'])
    expect(wrapper.text()).toContain('填写月薪与上下班时间')
    expect(wrapper.find('input[type="number"]').exists()).toBe(true)
    expect(amountElement(wrapper).exists()).toBe(false)
  })

  it('展开的设置是「同一张卡的内容」：一张背景壳 + 一个圆角矩形，不是拼接也不是第二张卡', async () => {
    seed(CONFIG)
    freezeTime(11)
    const wrapper = mount(EarningsClock)

    const card = wrapper.find('section[aria-label="PayDance"]')
    expect(card.classes()).toContain('relative')
    expect(card.classes()).toContain('isolate')

    // 背景壳：整张卡的渐变/边框/圆角由它画（卡片本体自己不带背景色）
    const shell = wrapper.find('[data-testid="earnings-shell"]')
    expect(shell.exists()).toBe(true)
    expect(shell.classes()).toContain('card-accent')
    expect(shell.classes()).toContain('absolute')
    expect(shell.classes()).toContain('-z-10')
    // 收起时壳正好等于卡片本身（没有往下延伸的样子）
    expect(shell.attributes('style') ?? '').not.toContain('bottom')
    expect(card.classes()).not.toContain('card-accent')

    await openSettings(wrapper)

    const panel = wrapper.find('[data-testid="earnings-settings"]')
    // 设置区贴着卡片下沿（top-full）、不带自己的背景/边框/圆角：视觉上是同一张卡往下长
    expect(panel.classes()).toContain('absolute')
    expect(panel.classes()).toContain('top-full')
    expect(panel.classes()).toContain('z-20')
    expect(panel.classes()).not.toContain('card-accent')
    // 壳按设置区高度往下延伸（量到的高度接到 bottom 负值上）
    expect(wrapper.find('[data-testid="earnings-shell"]').attributes('style')).toContain('bottom')
    // 卡片自己依然没有为"接缝"做任何妥协
    expect(card.attributes('style')).toBeUndefined()
  })

  it('工作中：显示精准到分的金额、状态、三栏统计条与进度', () => {
    seed(CONFIG)
    freezeTime(11)
    const wrapper = mount(EarningsClock)

    expect(amountElement(wrapper).text()).toContain('250.00')
    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT.working)

    // 统计条（参考稿的中间那块）：已工作 ｜ 距离午休 ｜ 今日预计
    const stats = wrapper.find('[data-testid="earnings-stats"]').text()
    expect(stats).toContain('已工作')
    expect(stats).toContain('2h 0m')
    expect(stats).toContain('距离午休')
    expect(stats).toContain('1h 0m')
    expect(stats).toContain('今日预计')
    expect(stats).toContain('¥1,000.00')

    // 时薪/日薪/每日计薪这些明细已经不上卡（参考稿里没有），口径改由数据层用例兜住
    expect(wrapper.text()).not.toContain('时薪 ¥')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
  })

  it('严格照参考稿：卡上只有「今日入账 + 金额 + 三栏统计条 + 进度光条」，不再有本月已赚/明细/百分比文字', () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)

    // 今日：09:00-10:00 计薪 1 小时 => 125.00 元
    expect(amountElement(wrapper).text()).toContain('125.00')
    // 今日金额是卡片主体（text-5xl 起步、宽屏 text-6xl）
    expect(amountElement(wrapper).classes().join(' ')).toContain('text-5xl')
    // 深绿强调卡（C 位）：渐变画在背景壳上（组件是多根，迷你模式与完整卡二选一）
    expect(wrapper.find('[data-testid="earnings-shell"]').classes()).toContain('card-accent')

    // 参考稿里没有的几块：本月已赚（含涨跌徽章）、时薪/日薪明细、进度文字，一律不出现在卡上
    expect(wrapper.find('[data-testid="earnings-month"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="earnings-month-trend"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('本月已赚')
    expect(wrapper.text()).not.toContain('时薪')
    expect(wrapper.text()).not.toContain('今日进度')
    // 进度条本身还在（只有轨道 + 填充 + 圆点，没有文字）
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true)
  })

  it('卡片标题是 PayDance；金额居中作为主体、三栏统计条在下、进度光条钉在卡片底端', () => {
    seed(CONFIG)
    freezeTime(11)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain('💰 PayDance')

    // 主体：今日入账 + 金额居中；统计条在同一块居中区域里
    const hero = wrapper.find('[data-testid="earnings-hero"]')
    expect(hero.classes()).toContain('text-center')
    expect(hero.classes()).toContain('my-auto')
    expect(hero.text()).toContain('今日入账')
    expect(hero.find('[data-testid="earnings-today"]').exists()).toBe(true)
    expect(hero.find('[data-testid="earnings-stats"]').exists()).toBe(true)

    // 进度光条是最后一个参与布局的块（设置面板是绝对定位的悬浮层，不算布局块），且被 mt-auto 钉到底端
    const progress = wrapper.find('[data-testid="earnings-progress"]')
    expect(progress.exists()).toBe(true)
    expect(progress.classes()).toContain('mt-auto')

    const flow = [...wrapper.find('section[aria-label="PayDance"]').element.children].filter(
      (el) => el.getAttribute('data-testid') !== 'earnings-settings',
    )
    expect(flow[flow.length - 1]).toBe(progress.element)
  })

  it('进度光条：平时只留图形，鼠标悬浮时在右侧浮出百分比（且不参与布局、不顶高卡片）', () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)

    // 悬浮组：hover 在进度条那一块（含内边距）都能触发
    const block = wrapper.find('[data-testid="earnings-progress"]')
    expect(block.classes()).toContain('group')

    const badge = wrapper.find('[data-testid="earnings-progress-hover"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('13%')
    // 默认透明 + group-hover 才显形（fade，不改布局：absolute + pointer-events-none）
    expect(badge.classes()).toContain('opacity-0')
    expect(badge.classes()).toContain('group-hover:opacity-100')
    expect(badge.classes()).toContain('absolute')
    expect(badge.classes()).toContain('right-0')
    expect(badge.classes()).toContain('pointer-events-none')
  })

  it('今日金额逐位上滑滚动（odometer）：每位停在正确的数字上', () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)

    // 125.00 => 6 个数字位（含 2 位小数），位移分别是 -1em/-2em/-5em/-0em/-0em
    const transforms = amountElement(wrapper)
      .findAll('.digit-strip')
      .map((s) => /translateY\(([^)]+)\)/.exec(s.attributes('style') ?? '')?.[1])
    expect(transforms).toEqual(['-1em', '-2em', '-5em', '-0em', '-0em'])
    // 等宽防抖靠 CSS 类（custom.css 里给 .digit-window/.digit-strip 统一加 tabular-nums）
    expect(amountElement(wrapper).find('.digit-window').exists()).toBe(true)
  })

  it('进度光条只留图形：aria 里仍带百分比，卡上不再写「今日进度 / 目标日收入」文字', () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)

    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('13')
    expect(bar.attributes('aria-label')).toContain('今日已赚进度 13%')
    // 卡面上唯一带百分比的只有悬浮徽标（默认透明），没有常驻文字
    expect(wrapper.find('[data-testid="earnings-progress"]').text().trim()).toBe('13%')
    expect(wrapper.text()).not.toContain('今日进度')
  })

  it('周末：不渲染金额，只给状态文案（本月已赚这类月度信息已不在这张卡上）', () => {
    seed(CONFIG)
    freezeTime(14, 0, 0, 12)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT.weekend)
    expect(amountElement(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="earnings-month"]').exists()).toBe(false)
  })

  it('午休期间：金额冻结在午休开始时刻', () => {
    seed(CONFIG)
    freezeTime(12, 30)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT.lunch)
    expect(amountElement(wrapper).text()).toContain('375.00')
    // 统计条中栏：午休时等的是下午上班
    expect(wrapper.find('[data-testid="earnings-stats"]').text()).toContain('距离上班')
    expect(wrapper.find('[data-testid="earnings-stats"]').text()).toContain('30m 0s')
  })

  it('上班前：只显示状态文案与倒计时，不渲染金额', () => {
    seed(CONFIG)
    freezeTime(7)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT['before-work'])
    expect(wrapper.find('[data-testid="earnings-stats"]').text()).toContain('距离上班')
    expect(wrapper.find('[data-testid="earnings-stats"]').text()).toContain('2h 0m')
    expect(amountElement(wrapper).exists()).toBe(false)
  })

  it('周末：不渲染金额（数据层也已归零）', () => {
    seed(CONFIG)
    freezeTime(14, 0, 0, 12)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT.weekend)
    expect(amountElement(wrapper).exists()).toBe(false)
  })

  it('下班后：显示今日总计金额（统计条中栏退回「今日班次」）', () => {
    seed(CONFIG)
    freezeTime(19)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT['after-work'])
    expect(amountElement(wrapper).text()).toContain('1,000.00')
    const stats = wrapper.find('[data-testid="earnings-stats"]').text()
    expect(stats).toContain('今日班次')
    expect(stats).toContain('8h 0m')
  })

  it('修改月薪即时生效并写入 localStorage', async () => {
    freezeTime(11)
    const wrapper = mount(EarningsClock)

    await wrapper.find('input[type="number"]').setValue('21750')
    await nextTick()

    expect(amountElement(wrapper).text()).toContain('250.00')
    await nextTick()
    const persisted = JSON.parse(
      window.localStorage.getItem(EARNINGS_STORAGE_KEY) ?? '{}',
    ) as typeof CONFIG
    expect(persisted.monthlySalary).toBe(21750)
  })

  it('「不扣午休」快捷操作清空午休时段', async () => {
    seed(CONFIG)
    freezeTime(11)
    const wrapper = mount(EarningsClock)
    await openSettings(wrapper)

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '不扣午休')!
      .trigger('click')
    await nextTick()

    // 两个午休输入框被清空
    const timeInputs = wrapper.findAll('input[type="time"]')
    expect((timeInputs[2].element as HTMLInputElement).value).toBe('')
    expect((timeInputs[3].element as HTMLInputElement).value).toBe('')

    // 卡上不再列「每日计薪」时长，改看统计条：午休一取消，11 点时的下一个节点从「距离午休 1h」
    // 变成「距离下班 7h」（月薪模式下日薪不随时长变，仍是 ¥1,000.00）
    const stats = wrapper.find('[data-testid="earnings-stats"]').text()
    expect(stats).toContain('距离下班')
    expect(stats).toContain('7h 0m')
    expect(stats).toContain('¥1,000.00')
  })

  it('「恢复默认」把月薪重置为未配置状态', async () => {
    seed(CONFIG)
    freezeTime(11)
    const wrapper = mount(EarningsClock)
    await openSettings(wrapper)

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '恢复默认')!
      .trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT['not-configured'])
  })

  it('设置区可折叠，且与工作时间输入联动', async () => {
    seed(CONFIG)
    freezeTime(11)
    const wrapper = mount(EarningsClock)

    // 已配置时默认收起
    expect(wrapper.text()).not.toContain('月薪（元）')

    await openSettings(wrapper)
    expect(wrapper.text()).toContain('月薪（元）')

    // 把下班时间提前到 10:00 → 11 点时已下班，金额为满勤
    const endInput = wrapper.findAll('input[type="time"]')[1]
    await endInput.setValue('10:00')
    await nextTick()
    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT['after-work'])

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '收起设置')!
      .trigger('click')
    expect(wrapper.text()).not.toContain('月薪（元）')
  })

  // ---- 第六阶段 6.2：秒表 Pro ----

  it('薪资模式可切换：切到时薪后日薪随时长反推，标签也跟着变', async () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)
    await openSettings(wrapper)

    await wrapper.find('[data-testid="earnings-mode-hourly"]').trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('时薪（元）')
    expect(wrapper.text()).not.toContain('月薪（元）')

    // 输入时薪 125 → 每日 8 小时 → 日薪 1000（统计条「今日预计」可见），今日（1 小时）125
    const salaryInput = wrapper.find('input[type="number"]')
    await salaryInput.setValue('125')
    await nextTick()

    expect(wrapper.find('[data-testid="earnings-stats"]').text()).toContain('¥1,000.00')
    expect(amountElement(wrapper).text()).toContain('125.00')
  })

  it('切换模式不改动另外两个模式的输入值（切回去还在）', async () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)
    await openSettings(wrapper)

    await wrapper.find('[data-testid="earnings-mode-daily"]').trigger('click')
    await nextTick()
    await wrapper.find('input[type="number"]').setValue('800')
    await nextTick()

    await wrapper.find('[data-testid="earnings-mode-monthly"]').trigger('click')
    await nextTick()
    // 月薪仍是原值 21750 → 今日 125 元
    expect(amountElement(wrapper).text()).toContain('125.00')

    await wrapper.find('[data-testid="earnings-mode-daily"]').trigger('click')
    await nextTick()
    expect((wrapper.find('input[type="number"]').element as HTMLInputElement).value).toBe('800')
  })

  it('自定义每周计薪日：点掉周五后周五变成不计薪（weekend）', async () => {
    seed(CONFIG)
    // ⚠️ 必须先冻结时间再挂载：组件在 setup 时就用 `new Date()` 取「现在」，
    // 反过来写会让这条用例偷偷依赖「真实系统日期恰好是工作日」——周末跑必红
    // （2026-09-12 是周六，曾经因此暴露）。
    freezeTime(10, 0, 0, 11) // 2026-09-11 是周五，默认计薪 → working

    const wrapper = mount(EarningsClock)
    await openSettings(wrapper)
    await nextTick()
    expect(wrapper.text()).not.toContain(EARNINGS_STATUS_TEXT.weekend)

    // 去掉周五
    await wrapper.find('[data-testid="earnings-day-5"]').trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT.weekend)

    // 再加回来 → 恢复计薪
    await wrapper.find('[data-testid="earnings-day-5"]').trigger('click')
    await nextTick()
    expect(wrapper.text()).not.toContain(EARNINGS_STATUS_TEXT.weekend)
  })

  it('不允许把计薪日全部点掉（否则整个秒表归零）', async () => {
    seed({ ...CONFIG, workDays: [1] })
    freezeTime(10, 0, 0, 7) // 2026-09-07 是周一
    const wrapper = mount(EarningsClock)
    await openSettings(wrapper)

    await wrapper.find('[data-testid="earnings-day-1"]').trigger('click')
    await nextTick()

    // 最后一天被拦下，仍是计薪日
    expect(wrapper.text()).not.toContain(EARNINGS_STATUS_TEXT.weekend)
  })

  it('夜班：显示「夜班」标记且凌晨仍在工作中', async () => {
    seed({ ...CONFIG, workStart: '22:00', workEnd: '06:00' })
    freezeTime(3)
    const wrapper = mount(EarningsClock)

    expect(wrapper.find('[data-testid="earnings-night"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT.working)
    // 凌晨 3 点 = 满勤 5/8 → 625 元
    expect(amountElement(wrapper).text()).toContain('625.00')
  })

  it('迷你折叠模式：折成小条后只显示金额，状态持久化且可还原', async () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)

    expect(wrapper.find('[data-testid="earnings-compact"]').exists()).toBe(false)

    await wrapper.find('[data-testid="earnings-compact-toggle"]').trigger('click')
    await nextTick()

    const bar = wrapper.find('[data-testid="earnings-compact"]')
    expect(bar.exists()).toBe(true)
    expect(bar.find('[data-testid="earnings-compact-amount"]').text()).toContain('125.00')
    // 完整卡不再渲染
    expect(wrapper.find('[data-testid="earnings-today"]').exists()).toBe(false)

    // 状态落盘
    await nextTick()
    expect(window.localStorage.getItem(EARNINGS_COMPACT_KEY)).toBe('true')

    await wrapper.find('[data-testid="earnings-expand"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="earnings-compact"]').exists()).toBe(false)
    // 还原成完整卡：主体与统计条回来
    expect(wrapper.find('[data-testid="earnings-today"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="earnings-stats"]').exists()).toBe(true)
  })

  it('迷你模式状态从本地恢复（刷新后仍然是迷你条）', async () => {
    seed(CONFIG)
    window.localStorage.setItem(EARNINGS_COMPACT_KEY, 'true')
    freezeTime(10)
    const wrapper = mount(EarningsClock)

    expect(wrapper.find('[data-testid="earnings-compact"]').exists()).toBe(true)
  })
})
