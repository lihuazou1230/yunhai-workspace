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

/** 次指标元素：本月已赚 */
function monthElement(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid="earnings-month"]')
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

  it('工作中：显示精准到分的金额、状态、进度与倒计时', () => {
    seed(CONFIG)
    freezeTime(11)
    const wrapper = mount(EarningsClock)

    expect(amountElement(wrapper).text()).toContain('250.00')
    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT.working)
    expect(wrapper.text()).toContain('距离午休还有 1 小时 0 分')
    expect(wrapper.text()).toContain('时薪 ¥125.00')
    expect(wrapper.text()).toContain('日薪 ¥1,000.00')
    expect(wrapper.text()).toContain('每日计薪 8 小时')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
  })

  it('主指标是「今日已赚」、次指标是「本月已赚」，两者同屏且层级分明', () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)

    // 今日：09:00-10:00 计薪 1 小时 => 125.00 元
    expect(amountElement(wrapper).text()).toContain('125.00')
    // 本月：9/1 ~ 9/9 完整计薪 7 天（7000.00）+ 今日 125.00 = 7125.00 元
    expect(monthElement(wrapper).text()).toContain('本月已赚')
    expect(monthElement(wrapper).text()).toContain('7,125.00')
    expect(monthElement(wrapper).text()).toContain('已计薪 8/22 天')

    // 层级：今日金额 text-4xl 起步，月金额是 text-sm
    expect(amountElement(wrapper).classes().join(' ')).toContain('text-4xl')
    expect(monthElement(wrapper).classes().join(' ')).toContain('text-sm')
    // 深绿强调卡（C 位）；组件是多根（迷你模式与完整卡二选一），所以定位到 section 再取类名
    expect(wrapper.find('section[aria-label="赚钱秒表"]').classes()).toContain('card-accent')
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

  it('目标进度条展示「今日已赚 / 目标日收入」', () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain('今日进度 · 目标日收入 ¥1,000.00')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('13')
  })

  it('本月已赚展示相对上月同期的涨跌徽章', () => {
    seed(CONFIG)
    freezeTime(12)
    const wrapper = mount(EarningsClock)

    const trend = wrapper.find('[data-testid="earnings-month-trend"]')
    expect(trend.exists()).toBe(true)
    expect(trend.text()).toContain('+37.2%')
    expect(trend.attributes('aria-label')).toContain('较上月同期')
  })

  it('周末：今日金额隐藏，但本月已赚（月度累计）仍然展示', () => {
    seed(CONFIG)
    freezeTime(14, 0, 0, 12)
    const wrapper = mount(EarningsClock)

    expect(amountElement(wrapper).exists()).toBe(false)
    // 9/1 ~ 9/11 完整计薪 9 天 => 9000.00 元（周末当天不计薪）
    expect(monthElement(wrapper).text()).toContain('9,000.00')
    expect(monthElement(wrapper).text()).toContain('已计薪 9/22 天')
  })

  it('本月已赚封顶在月薪（月计薪天数取月平均，工作日多的月份不会超发）', () => {
    seed(CONFIG)
    // 2026-09-30（周三）下班后：21 个完整计薪日 + 今日满勤
    freezeTime(19, 0, 0, 30)
    const wrapper = mount(EarningsClock)

    expect(monthElement(wrapper).text()).toContain('21,750.00')
    expect(monthElement(wrapper).text()).toContain('已计薪 22/22 天')
  })

  it('午休期间：金额冻结在午休开始时刻', () => {
    seed(CONFIG)
    freezeTime(12, 30)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT.lunch)
    expect(amountElement(wrapper).text()).toContain('375.00')
    expect(wrapper.text()).toContain('距离下午上班还有 30 分 0 秒')
  })

  it('上班前：只显示状态文案与倒计时，不渲染金额', () => {
    seed(CONFIG)
    freezeTime(7)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT['before-work'])
    expect(wrapper.text()).toContain('距离上班还有 2 小时 0 分')
    expect(amountElement(wrapper).exists()).toBe(false)
  })

  it('周末：不渲染金额（数据层也已归零）', () => {
    seed(CONFIG)
    freezeTime(14, 0, 0, 12)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT.weekend)
    expect(amountElement(wrapper).exists()).toBe(false)
  })

  it('下班后：显示今日总计金额', () => {
    seed(CONFIG)
    freezeTime(19)
    const wrapper = mount(EarningsClock)

    expect(wrapper.text()).toContain(EARNINGS_STATUS_TEXT['after-work'])
    expect(amountElement(wrapper).text()).toContain('1,000.00')
    expect(wrapper.text()).toContain('今日总计 ¥1,000.00')
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

    // 清空午休后，每日计薪时长由 8 小时变为 9 小时
    expect(wrapper.text()).toContain('每日计薪 9 小时')
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

    // 输入时薪 125 → 每日 8 小时 → 日薪 1000，今日（1 小时）125
    const salaryInput = wrapper.find('input[type="number"]')
    await salaryInput.setValue('125')
    await nextTick()

    expect(wrapper.text()).toContain('日薪 ¥1,000.00')
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
    expect(wrapper.find('[data-testid="earnings-month"]').exists()).toBe(false)

    // 状态落盘
    await nextTick()
    expect(window.localStorage.getItem(EARNINGS_COMPACT_KEY)).toBe('true')

    await wrapper.find('[data-testid="earnings-expand"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="earnings-compact"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="earnings-month"]').exists()).toBe(true)
  })

  it('迷你模式状态从本地恢复（刷新后仍然是迷你条）', async () => {
    seed(CONFIG)
    window.localStorage.setItem(EARNINGS_COMPACT_KEY, 'true')
    freezeTime(10)
    const wrapper = mount(EarningsClock)

    expect(wrapper.find('[data-testid="earnings-compact"]').exists()).toBe(true)
  })

  it('底部有免责声明', () => {
    seed(CONFIG)
    freezeTime(10)
    const wrapper = mount(EarningsClock)
    expect(wrapper.find('[data-testid="earnings-disclaimer"]').text()).toContain('估算值')
  })
})
