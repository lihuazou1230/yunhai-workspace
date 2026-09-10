import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import {
  COUNTDOWN_ITEMS_KEY,
  COUNTDOWN_PAYDAY_KEY,
  DEFAULT_PAYDAY_DAY,
  useCountdownStore,
} from './countdownStore'

/** 2026-09-15（周二） */
const NOW = new Date(2026, 8, 15, 10, 0, 0)

describe('countdownStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('默认状态：发薪日 15 号、条目为空', () => {
    const store = useCountdownStore()
    store.refresh(NOW)

    expect(store.items).toEqual([])
    expect(store.resolved).toEqual([])
    expect(store.paydayDay).toBe(DEFAULT_PAYDAY_DAY)
    expect(store.paydayDate).toBe('2026-09-15')
    expect(store.paydayDays).toBe(0)
  })

  it('新增条目：去空白、生成 id、写入 localStorage', async () => {
    const store = useCountdownStore()
    const item = store.addItem({
      title: '  结婚纪念日  ',
      date: '2020-10-01',
      kind: 'anniversary',
      yearly: true,
    })

    expect(item).not.toBeNull()
    expect(item!.title).toBe('结婚纪念日')
    expect(item!.yearly).toBe(true)
    expect(item!.id).toBeTruthy()
    expect(store.items).toHaveLength(1)

    // useLocalStorage 走 watch 落盘，要等一个 tick
    await nextTick()
    const raw = localStorage.getItem(COUNTDOWN_ITEMS_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)[0].title).toBe('结婚纪念日')
  })

  it('标题为空或日期非法时拒绝新增并返回 null', () => {
    const store = useCountdownStore()

    expect(
      store.addItem({ title: '', date: '2026-09-20', kind: 'custom', yearly: false }),
    ).toBeNull()
    expect(
      store.addItem({ title: '   ', date: '2026-09-20', kind: 'custom', yearly: false }),
    ).toBeNull()
    // 格式不对、以及「格式对但日子不存在」（2026 平年没有 2/30）
    expect(
      store.addItem({ title: '假的', date: '2026/09/20', kind: 'custom', yearly: false }),
    ).toBeNull()
    expect(
      store.addItem({ title: '假的', date: '2026-02-30', kind: 'custom', yearly: false }),
    ).toBeNull()
    expect(store.addItem({ title: '空的', date: '', kind: 'custom', yearly: false })).toBeNull()

    expect(store.items).toHaveLength(0)
  })

  it('修改条目：成功改标题/日期/重复开关，非法值失败且不改动原数据', () => {
    const store = useCountdownStore()
    const item = store.addItem({
      title: '生日',
      date: '1995-10-01',
      kind: 'anniversary',
      yearly: true,
    })!

    expect(store.updateItem(item.id, { title: '  我的生日  ' })).toBe(true)
    expect(store.items[0].title).toBe('我的生日')

    expect(store.updateItem(item.id, { yearly: false, kind: 'custom' })).toBe(true)
    expect(store.items[0].yearly).toBe(false)
    expect(store.items[0].kind).toBe('custom')

    expect(store.updateItem(item.id, { date: '1995-10-02' })).toBe(true)
    expect(store.items[0].date).toBe('1995-10-02')

    // 非法值：返回 false 且数据不动
    expect(store.updateItem(item.id, { title: '   ' })).toBe(false)
    expect(store.updateItem(item.id, { date: '1995-13-01' })).toBe(false)
    expect(store.updateItem('not-exist', { title: 'x' })).toBe(false)
    expect(store.items[0].title).toBe('我的生日')
    expect(store.items[0].date).toBe('1995-10-02')
  })

  it('删除条目只删自己', () => {
    const store = useCountdownStore()
    const a = store.addItem({ title: 'A', date: '2026-09-20', kind: 'custom', yearly: false })!
    store.addItem({ title: 'B', date: '2026-09-25', kind: 'custom', yearly: false })

    store.removeItem(a.id)
    expect(store.items.map((i) => i.title)).toEqual(['B'])
    // 删不存在的 id 是空操作
    store.removeItem('not-exist')
    expect(store.items).toHaveLength(1)
  })

  it('修改条目只动那一条：同列表里其它条目原样保留', () => {
    const store = useCountdownStore()
    const a = store.addItem({ title: 'A', date: '2026-09-20', kind: 'custom', yearly: false })!
    const b = store.addItem({ title: 'B', date: '2026-09-25', kind: 'anniversary', yearly: true })!
    const beforeB = { ...b }

    expect(store.updateItem(a.id, { title: 'A2' })).toBe(true)

    // 只改标题的补丁不该把日期/重复开关顺手清掉，也不该波及邻居条目
    expect(store.items.find((i) => i.id === a.id)).toMatchObject({
      title: 'A2',
      date: '2026-09-20',
      yearly: false,
    })
    expect(store.items.find((i) => i.id === b.id)).toEqual(beforeB)
  })

  it('发薪日钳制到 1..31，NaN 被忽略（保留原值）', async () => {
    const store = useCountdownStore()

    store.setPaydayDay(0)
    expect(store.paydayDay).toBe(1)
    store.setPaydayDay(32)
    expect(store.paydayDay).toBe(31)
    store.setPaydayDay(20.7)
    expect(store.paydayDay).toBe(20)

    store.setPaydayDay(Number.NaN)
    expect(store.paydayDay).toBe(20)
    store.setPaydayDay(Number.POSITIVE_INFINITY)
    expect(store.paydayDay).toBe(20)

    await nextTick()
    expect(JSON.parse(localStorage.getItem(COUNTDOWN_PAYDAY_KEY)!)).toBe(20)
  })

  it('paydayDay 可直接赋值（写入口同样走钳制）', () => {
    const store = useCountdownStore()

    store.paydayDay = 99
    expect(store.paydayDay).toBe(31)
    store.paydayDay = -3
    expect(store.paydayDay).toBe(1)
  })

  it('localStorage 里的脏发薪日（99）读出来也被钳制', () => {
    localStorage.setItem(COUNTDOWN_PAYDAY_KEY, JSON.stringify(99))
    setActivePinia(createPinia())
    const store = useCountdownStore()

    expect(store.paydayDay).toBe(31)
    store.refresh(new Date(2026, 8, 15))
    expect(store.paydayDate).toBe('2026-09-30')
  })

  it('resolved 按注入的时钟解析并排序（未来在前，过期沉底）', () => {
    const store = useCountdownStore()
    store.addItem({ title: '过期', date: '2026-09-01', kind: 'custom', yearly: false })
    store.addItem({ title: '今天', date: '2026-09-15', kind: 'custom', yearly: false })
    store.addItem({ title: '远', date: '2026-12-01', kind: 'custom', yearly: false })
    store.addItem({ title: '近', date: '2026-09-18', kind: 'custom', yearly: false })

    store.refresh(NOW)
    expect(store.resolved.map((e) => e.item.title)).toEqual(['今天', '近', '远', '过期'])
    expect(store.resolved.map((e) => e.days)).toEqual([0, 3, 77, -14])
    expect(store.resolved[0].isToday).toBe(true)
    expect(store.resolved[3].isPast).toBe(true)
  })

  it('yearly 条目的解析日期跟随时钟：今年已过顺延到明年', () => {
    const store = useCountdownStore()
    store.addItem({ title: '生日', date: '1995-03-05', kind: 'anniversary', yearly: true })

    store.refresh(NOW)
    expect(store.resolved[0].date).toBe('2027-03-05')

    // 同一条目换个时钟（跨年后）就落到当年
    store.refresh(new Date(2027, 0, 10))
    expect(store.resolved[0].date).toBe('2027-03-05')
    expect(store.resolved[0].days).toBe(54)
  })

  it('refresh 默认取系统时间（不传参数也能用）', () => {
    const store = useCountdownStore()
    store.refresh(NOW)
    expect(store.now).toEqual(NOW)

    store.refresh()
    // 只断言「回到了系统时间」这一语义，避免依赖跑测试的钟点
    expect(Math.abs(store.now.getTime() - Date.now())).toBeLessThan(5000)
  })

  it('reset 清空条目并恢复默认发薪日', async () => {
    const store = useCountdownStore()
    store.addItem({ title: 'A', date: '2026-09-20', kind: 'custom', yearly: false })
    store.setPaydayDay(5)

    store.reset()
    expect(store.items).toEqual([])
    expect(store.paydayDay).toBe(DEFAULT_PAYDAY_DAY)

    await nextTick()
    expect(JSON.parse(localStorage.getItem(COUNTDOWN_ITEMS_KEY)!)).toEqual([])
    expect(JSON.parse(localStorage.getItem(COUNTDOWN_PAYDAY_KEY)!)).toBe(DEFAULT_PAYDAY_DAY)
  })

  it('crypto.randomUUID 不可用（非安全上下文 / 老浏览器）时退化为本地 id，功能照旧', () => {
    // http:// 部署或旧内核下 globalThis.crypto 存在但没有 randomUUID
    vi.stubGlobal('crypto', {})
    const store = useCountdownStore()

    const item = store.addItem({
      title: '生日',
      date: '2026-09-20',
      kind: 'anniversary',
      yearly: true,
    })!

    expect(item.id).toMatch(/^cd-\d+-[a-z0-9]+$/)
    expect(store.items[0].id).toBe(item.id)
    // 降级 id 也必须唯一：同毫秒内连加两条不能撞（否则删除/修改会误伤另一条）
    const second = store.addItem({
      title: '纪念日',
      date: '2026-09-21',
      kind: 'custom',
      yearly: false,
    })!
    expect(second.id).not.toBe(item.id)
    expect(store.removeItem(item.id))
    expect(store.items.map((i) => i.id)).toEqual([second.id])
  })
})
