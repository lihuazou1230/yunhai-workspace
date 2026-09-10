/**
 * 倒计时状态（Pinia）：发薪日 + 纪念日/自定义倒计时，localStorage 持久化。
 *
 * 「现在几点」由 store 持有（now ref）而不是渲染时各自 new Date()：
 * - 仪表板定时 refresh() 就能整体跨天，各卡片不用自己养时钟
 * - 单测可以 refresh(new Date(2026, 8, 15)) 钉住日期，断言的天数是确定的
 *   （组件测试同样走这条路：先 refresh 再 mount）
 */

import { computed, ref } from 'vue'

import { defineStore } from 'pinia'

import { useLocalStorage } from '@/composables/useLocalStorage'
import type { CountdownItem, CountdownKind } from '@/utils/countdown'
import { clampPaydayDay, daysUntil, nextPayday, sortCountdowns } from '@/utils/countdown'
import { isValidDateKey } from '@/utils/validation'

/** 倒计时条目持久化键 */
export const COUNTDOWN_ITEMS_KEY = 'smart-workspace:countdown-items'

/** 发薪日持久化键 */
export const COUNTDOWN_PAYDAY_KEY = 'smart-workspace:countdown-payday'

/** 默认发薪日（大多数公司的发薪日） */
export const DEFAULT_PAYDAY_DAY = 15

/** 新建条目入参 */
export interface CountdownInput {
  title: string
  date: string
  kind: CountdownKind
  yearly: boolean
}

/** 条目 id（crypto 不可用时退化为时间戳 + 随机串，与 tagHelper 同一策略） */
function createId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `cd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const useCountdownStore = defineStore('countdown', () => {
  const items = useLocalStorage<CountdownItem[]>(COUNTDOWN_ITEMS_KEY, [])
  const paydayDayRaw = useLocalStorage<number>(COUNTDOWN_PAYDAY_KEY, DEFAULT_PAYDAY_DAY)

  /** 当前时刻（时钟注入点）：默认系统时间，refresh() 可覆盖 */
  const now = ref(new Date())

  /** 刷新「现在」；不传参数即取系统时间 */
  function refresh(clock: Date = new Date()) {
    now.value = clock
  }

  /**
   * 发薪日（1..31）。读写都过钳制：localStorage 里的旧数据被手改成 99
   * 也不会把「下次发薪日」算到不存在的日期上。
   */
  const paydayDay = computed({
    get: () => clampPaydayDay(paydayDayRaw.value),
    set: (day: number) => setPaydayDay(day),
  })

  /** 设置发薪日：越界钳制，NaN/Infinity 忽略（输入框清空时是 NaN，保留原值比跳到 1 号更不打扰） */
  function setPaydayDay(day: number) {
    if (!Number.isFinite(day)) return
    paydayDayRaw.value = clampPaydayDay(day)
  }

  /** 下次发薪日（短月自动钳到月末） */
  const paydayDate = computed(() => nextPayday(paydayDay.value, now.value))

  /** 距下次发薪日还有几天 */
  const paydayDays = computed(() => daysUntil(paydayDate.value, now.value))

  /** 已解析 + 已排序的条目（未来在前，已过去的沉底） */
  const resolved = computed(() => sortCountdowns(items.value, now.value))

  /**
   * 新建条目。
   * @returns 新建的条目；标题为空或 date 不是真实存在的 YYYY-MM-DD 时返回 null（由 UI 提示）
   */
  function addItem(input: CountdownInput): CountdownItem | null {
    const title = input.title.trim()
    if (!title) return null
    if (!isValidDateKey(input.date)) return null
    const item: CountdownItem = {
      id: createId(),
      title,
      kind: input.kind,
      date: input.date,
      yearly: input.yearly,
    }
    items.value = [...items.value, item]
    return item
  }

  /**
   * 修改条目。
   * @returns 是否成功（id 不存在、标题空白或日期非法都失败，且不改动原数据）
   */
  function updateItem(id: string, patch: Partial<Omit<CountdownItem, 'id'>>): boolean {
    const current = items.value.find((i) => i.id === id)
    if (!current) return false
    if (patch.title !== undefined && !patch.title.trim()) return false
    if (patch.date !== undefined && !isValidDateKey(patch.date)) return false

    items.value = items.value.map((i) =>
      i.id === id ? { ...i, ...patch, title: (patch.title ?? i.title).trim() } : i,
    )
    return true
  }

  /** 删除条目 */
  function removeItem(id: string) {
    items.value = items.value.filter((i) => i.id !== id)
  }

  /** 重置为初始状态（条目清空 + 发薪日回默认） */
  function reset() {
    items.value = []
    paydayDayRaw.value = DEFAULT_PAYDAY_DAY
  }

  return {
    items,
    paydayDay,
    paydayDate,
    paydayDays,
    now,
    refresh,
    resolved,
    addItem,
    updateItem,
    removeItem,
    setPaydayDay,
    reset,
  }
})
