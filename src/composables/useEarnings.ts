/**
 * 赚钱秒表组合式函数：连接配置持久化与实时重算。
 *
 * 实现要点：
 * - 高频 tick（默认 100ms，可切 requestAnimationFrame）只做一件事：把 `now` 换成最新时间戳，
 *   金额由纯函数重新算一遍（差值式，不做累加），因此后台节流、休眠唤醒都不会产生误差。
 * - 用 VueUse 的 useEventListener 额外监听 `visibilitychange` / `focus`：
 *   标签页切回时立即补算一次，不必等下一个 tick，避免"切回来第一眼是旧数字"。
 * - 配置持久化复用 useLocalStorage，并在读取时做一次 `normalizeEarningsConfig` 迁移
 *   （老版本只有 weekdaysOnly / 没有薪资模式），脏数据也不会把卡片打挂。
 */

import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

import { useLocalStorage } from '@/composables/useLocalStorage'
import {
  DEFAULT_EARNINGS_CONFIG,
  EARNINGS_COMPACT_KEY,
  EARNINGS_STORAGE_KEY,
} from '@/types/earnings'
import type { EarningsConfig, EarningsSnapshot } from '@/types/earnings'
import {
  computeEarnings,
  formatFen,
  isEarningsConfigured,
  normalizeEarningsConfig,
  shiftDateKey,
} from '@/utils/earnings'

export interface UseEarningsOptions {
  /** 可注入存储实现（默认 window.localStorage），便于测试 */
  storage?: Storage | null
  /** 可注入时钟（默认系统时间），便于测试 */
  clock?: () => Date
  /** 是否自动 tick；测试可传 false 后手动 refresh */
  autoTick?: boolean
  /** tick 间隔（ms），默认 100；数字滚动更细腻连贯，显示仍精准到分 */
  tickMs?: number
  /** 用 requestAnimationFrame 代替定时器（更细腻，但后台标签页会被暂停） */
  useRaf?: boolean
}

export interface UseEarningsReturn {
  config: Ref<EarningsConfig>
  snapshot: ComputedRef<EarningsSnapshot>
  /** 今日已赚金额文本（主指标；元，两位小数，千分位） */
  amountText: ComputedRef<string>
  /** 本月已赚金额文本（次指标） */
  monthAmountText: ComputedRef<string>
  /** 是否已配置可用 */
  isConfigured: ComputedRef<boolean>
  /** 当前计薪日的日期键（夜班凌晨算作班次开始那天） */
  shiftDateKey: ComputedRef<string>
  /** 迷你折叠模式（持久化） */
  compact: Ref<boolean>
  toggleCompact: () => void
  /** 立即用最新时间戳重算 */
  refresh: () => void
  /** 合并更新配置 */
  updateConfig: (patch: Partial<EarningsConfig>) => void
  /** 恢复默认配置 */
  resetConfig: () => void
  start: () => void
  stop: () => void
}

const DEFAULT_TICK_MS = 100

export function useEarnings(options: UseEarningsOptions = {}): UseEarningsReturn {
  const clock = options.clock ?? (() => new Date())
  const autoTick = options.autoTick !== false
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS
  const useRaf = options.useRaf ?? false

  const stored = useLocalStorage<EarningsConfig>(
    EARNINGS_STORAGE_KEY,
    { ...DEFAULT_EARNINGS_CONFIG },
    options.storage,
  )

  /**
   * 对外暴露的配置做一次迁移收敛：
   * 老数据没有 salaryMode / workDays（只有 weekdaysOnly），脏值也在这里被夹回合法范围。
   */
  const config = ref<EarningsConfig>(normalizeEarningsConfig(stored.value))
  // 迁移结果立刻写回存储（`immediate` 不能省：否则老数据每次进站都要重新迁移一遍，
  // 因为 config 的初值来自迁移、之后不会被再次赋值，非 immediate 的 watcher 永远不会触发）
  watch(
    config,
    (next) => {
      stored.value = next
    },
    { deep: true, immediate: true },
  )

  /** 迷你折叠模式（独立键，避免和配置混在一起） */
  const compact = useLocalStorage<boolean>(EARNINGS_COMPACT_KEY, false, options.storage)

  /** 唯一的时间来源：每次 tick 只是刷新这个时间戳 */
  const now = ref<Date>(clock())
  const snapshot = computed<EarningsSnapshot>(() => computeEarnings(config.value, now.value))
  const amountText = computed(() => formatFen(snapshot.value.earnedFen))
  const monthAmountText = computed(() => formatFen(snapshot.value.monthEarnedFen))
  const isConfigured = computed(() => isEarningsConfigured(config.value))
  const shiftDateKeyRef = computed(() => shiftDateKey(config.value, now.value))

  function refresh() {
    now.value = clock()
  }

  // ---- 高频 tick ----
  let timer: ReturnType<typeof setInterval> | null = null
  let rafId: number | null = null
  let rafActive = false

  function loopRaf() {
    if (!rafActive) return
    refresh()
    rafId = globalThis.requestAnimationFrame(loopRaf)
  }

  function start() {
    if (timer !== null || rafActive) return
    if (useRaf && typeof globalThis.requestAnimationFrame === 'function') {
      rafActive = true
      rafId = globalThis.requestAnimationFrame(loopRaf)
      return
    }
    timer = setInterval(refresh, tickMs)
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    if (rafId !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(rafId)
      rafId = null
    }
    rafActive = false
  }

  if (autoTick) {
    start()
    refresh()
  }

  // 切回标签页/窗口时立即补算，避免看到上一秒的旧数字
  useEventListener(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh()
  })
  useEventListener(window, 'focus', refresh)

  function updateConfig(patch: Partial<EarningsConfig>) {
    config.value = normalizeEarningsConfig({ ...config.value, ...patch })
    refresh()
  }

  function resetConfig() {
    config.value = { ...DEFAULT_EARNINGS_CONFIG, workDays: [...DEFAULT_EARNINGS_CONFIG.workDays] }
    refresh()
  }

  function toggleCompact() {
    compact.value = !compact.value
  }

  return {
    config,
    snapshot,
    amountText,
    monthAmountText,
    isConfigured,
    shiftDateKey: shiftDateKeyRef,
    compact,
    toggleCompact,
    refresh,
    updateConfig,
    resetConfig,
    start,
    stop,
  }
}
