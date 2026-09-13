/**
 * 赚钱秒表组合式函数：连接配置持久化与实时重算。
 *
 * 实现要点：
 * - tick（默认 **每秒一次**，可传 `tickMs` / `useRaf` 调细）只做一件事：把 `now` 换成最新时间戳，
 *   金额由纯函数重新算一遍（差值式，不做累加），因此后台节流、休眠唤醒都不会产生误差。
 * - 用 VueUse 的 useEventListener 额外监听 `visibilitychange` / `focus`：
 *   标签页切回时立即补算一次，不必等下一个 tick，避免"切回来第一眼是旧数字"。
 * - 配置持久化复用 useLocalStorage，并在读取时做一次 `normalizeEarningsConfig` 迁移
 *   （老版本只有 weekdaysOnly / 没有薪资模式），脏数据也不会把卡片打挂。
 */

import { computed, onScopeDispose, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

import { useSyncedStorage } from '@/composables/useSyncedStorage'
import { useWorkLog } from '@/composables/useWorkLog'
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
  /** tick 间隔（ms），默认 1000（每秒跳一次）；显示精准到分，靠 odometer 滚动过渡 */
  tickMs?: number
  /** 用 requestAnimationFrame 代替定时器（更细腻，但后台标签页会被暂停） */
  useRaf?: boolean
  /**
   * 是否把「当日累计计薪时长」记进投入日志（第八阶段散点图/年度报告的数据源）。
   * 默认开启；单测里想只关心金额时可以关掉。
   */
  recordWorkLog?: boolean
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

/**
 * 默认每秒 tick 一次（而不是 100ms）：金额本来就只在「分」这一位上变化，
 * 10 次/秒的高频重算只会让末位疯狂抖动、看着像在闪；每秒跳一次配合 odometer 滚动更稳。
 * 如果需要更细腻（比如做悬浮窗），传 `tickMs` 或 `useRaf` 即可。
 */
const DEFAULT_TICK_MS = 1000

export function useEarnings(options: UseEarningsOptions = {}): UseEarningsReturn {
  const clock = options.clock ?? (() => new Date())
  const autoTick = options.autoTick !== false
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS
  const useRaf = options.useRaf ?? false

  /**
   * 第九阶段：秒表配置跟账号走（换设备不用重新填薪资与作息）。
   * `normalize` 直接挂在读取路径上——存储里的值本来就是不可信的（老版本没有 salaryMode）。
   */
  const stored = useSyncedStorage<EarningsConfig>(
    EARNINGS_STORAGE_KEY,
    {
      ...DEFAULT_EARNINGS_CONFIG,
    },
    {
      normalize: normalizeEarningsConfig,
      ...(options.storage !== undefined ? { storage: options.storage } : {}),
    },
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
  /**
   * 反方向：**云端同步下来的配置要回灌到 config**。
   * 少了这一步就会出现"登录后金额还是登录前那套"——`config` 是本地 ref，
   * 同步层改的是 `stored`，界面读的却是 `config`。
   * 两边都经过 `normalizeEarningsConfig`，键序一致，所以直接比 JSON 字符串即可；
   * 内容相同时跳过，避免 config→stored→config 的来回抖动。
   */
  watch(
    stored,
    (next) => {
      const normalized = normalizeEarningsConfig(next)
      if (JSON.stringify(normalized) === JSON.stringify(config.value)) return
      config.value = normalized
    },
    { deep: true },
  )

  /** 迷你折叠模式（独立键，避免和配置混在一起；第九阶段起也跟账号走） */
  const compact = useSyncedStorage<boolean>(EARNINGS_COMPACT_KEY, false, {
    ...(options.storage !== undefined ? { storage: options.storage } : {}),
  })

  /** 唯一的时间来源：每次 tick 只是刷新这个时间戳 */
  const now = ref<Date>(clock())
  const snapshot = computed<EarningsSnapshot>(() => computeEarnings(config.value, now.value))
  const amountText = computed(() => formatFen(snapshot.value.earnedFen))
  const monthAmountText = computed(() => formatFen(snapshot.value.monthEarnedFen))
  const isConfigured = computed(() => isEarningsConfigured(config.value))
  const shiftDateKeyRef = computed(() => shiftDateKey(config.value, now.value))

  /**
   * ---- 投入日志（第八阶段 8.1-4）----
   *
   * 为什么按「整分钟」节流：这个快照每 100ms 变一次，直接 watch 就是每秒十次
   * 全量日志写 localStorage。而计薪时长的精度到分钟就够了（散点图只画到 0.1 小时），
   * 所以只在"跨过分钟"时写一次；写的时候取当时的真实秒数，不是分钟数 × 60。
   *
   * immediate 不能省：下午 3 点才打开应用时，初始快照就已经是 5 小时，
   * 没有一次"变化"来触发写入——不 immediate 就整天都记不上。
   *
   * 还要求 `isConfigured`：**没填薪资就等于没告诉过我们作息**，
   * 那时按默认的 09:00~18:00 去累计「投入时长」是在编数据（用户上夜班就全错）。
   * 金额为 0 只是不算钱，日志却会被年度报告当真，所以这里必须拦住。
   */
  if (options.recordWorkLog !== false) {
    const { record } = useWorkLog(options.storage)
    const workedMinute = computed(() => Math.floor(snapshot.value.elapsedWorkSeconds / 60))
    watch(
      workedMinute,
      (minute) => {
        if (minute <= 0 || !isConfigured.value) return
        record(shiftDateKeyRef.value, snapshot.value.elapsedWorkSeconds)
      },
      { immediate: true },
    )
  }

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

  /**
   * 作用域销毁时必须回收定时器。
   *
   * 仪表板被 `<keep-alive>` 缓存：切走只是 deactivate，组件并不卸载，
   * 而这里的 100ms tick 依然在跑（每次都重算月度计薪天数，内含 ~31 天的循环）。
   * 不清理就是一个纯浪费的常驻负担；更糟的是它的 `now` 还在推进，
   * 切回来时看不出异常，所以这种泄漏很容易一直留着。
   */
  onScopeDispose(stop)

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
