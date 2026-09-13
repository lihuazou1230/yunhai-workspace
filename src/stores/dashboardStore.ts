/**
 * 仪表板偏好 store（第六阶段 6.4）
 *
 * 这里只放「仪表板自己的偏好」：卡片顺序 / 尺寸 / 隐藏、周目标、是否自定义布局。
 * 任务数据仍归 todoStore，卡片内容各自由 composable 提供——仪表板只是布局的宿主。
 *
 * 设计要点：**所有持久化偏好读出来都要能被老数据兼容**。
 * 卡片清单会随版本增减，老用户 localStorage 里的顺序/尺寸不该让页面错乱，
 * 所以顺序统一走 reconcileOrder 对齐，尺寸/隐藏只认识当前清单里的 id。
 */

import { computed, watch } from 'vue'

import { defineStore } from 'pinia'

import { useSyncedStorage } from '@/composables/useSyncedStorage'
import { DEFAULT_WEEK_GOAL, clampWeekGoal } from '@/utils/streak'

/** 仪表板卡片 id（数组顺序 = 首次进入时的默认顺序） */
export const DASHBOARD_CARD_IDS = [
  'earnings',
  'today-progress',
  'weather',
  'mini-calendar',
  'streak',
  'countdown',
  'my-day',
  'link-dock',
] as const

export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number]

/** 卡片在网格里占的槽位大小 */
export type DashboardCardSize = 'small' | 'medium' | 'large'

export const DASHBOARD_CARD_SIZES: readonly DashboardCardSize[] = ['small', 'medium', 'large']

/** 未单独设置过的卡片一律按 medium 渲染 */
export const DEFAULT_CARD_SIZE: DashboardCardSize = 'medium'

/** 持久化键（沿用 smart-workspace: 前缀，与其它偏好互不干扰） */
export const DASHBOARD_ORDER_KEY = 'smart-workspace:dashboard-order'
export const DASHBOARD_CUSTOMIZED_KEY = 'smart-workspace:dashboard-customized'
export const DASHBOARD_HIDDEN_KEY = 'smart-workspace:dashboard-hidden'
export const DASHBOARD_SIZES_KEY = 'smart-workspace:dashboard-sizes'
export const DASHBOARD_WEEK_GOAL_KEY = 'smart-workspace:dashboard-week-goal'

/** id 是否属于当前版本的卡片清单（老版本的 id 一律当作不存在） */
function isKnownCardId(id: string): boolean {
  return (DASHBOARD_CARD_IDS as readonly string[]).includes(id)
}

function isCardSize(value: unknown): value is DashboardCardSize {
  return DASHBOARD_CARD_SIZES.includes(value as DashboardCardSize)
}

/**
 * 把持久化的顺序对齐到当前卡片清单：未知 id 丢掉（去重后保留相对顺序），
 * 清单里缺的卡片追加到末尾。
 * 这样「以后新增一张卡」不需要写迁移脚本，老用户的顺序也不会让新卡消失。
 */
export function reconcileOrder(saved: readonly string[]): string[] {
  const kept = [...new Set(saved.filter(isKnownCardId))]
  const missing = DASHBOARD_CARD_IDS.filter((id) => !kept.includes(id))
  return [...kept, ...missing]
}

export const useDashboardStore = defineStore('dashboard', () => {
  // ---- 持久化偏好（第九阶段：全部跟账号走 —— 换设备后布局与目标也是自己那套） ----
  /** 每周完成目标（个） */
  const weekGoal = useSyncedStorage<number>(DASHBOARD_WEEK_GOAL_KEY, DEFAULT_WEEK_GOAL)
  /** 卡片顺序 */
  const order = useSyncedStorage<string[]>(DASHBOARD_ORDER_KEY, [...DASHBOARD_CARD_IDS])
  /** 是否自定义过布局：false = 精选 bento 默认布局，true = 用户自己的等分槽位布局 */
  const customized = useSyncedStorage<boolean>(DASHBOARD_CUSTOMIZED_KEY, false)
  /** 已隐藏的卡片 id */
  const hidden = useSyncedStorage<string[]>(DASHBOARD_HIDDEN_KEY, [])
  /** 卡片 id -> 尺寸（未出现的按 DEFAULT_CARD_SIZE） */
  const sizes = useSyncedStorage<Record<string, DashboardCardSize>>(DASHBOARD_SIZES_KEY, {})

  // 读盘即纠正：老版本或手工改坏的 localStorage 不该带进运行时。
  // 目标为 0 会让完成率除零；幽灵 id 会让「隐藏列表」越攒越长、卡片尺寸永远不生效。
  weekGoal.value = clampWeekGoal(weekGoal.value)
  hidden.value = [...new Set(hidden.value.filter(isKnownCardId))]
  sizes.value = Object.fromEntries(
    Object.entries(sizes.value).filter(([id, size]) => isKnownCardId(id) && isCardSize(size)),
  )

  // 顺序无论被谁改（本 store 的 action、导入配置、修 localStorage）都对同一份清单对齐。
  // 用 flush: 'sync' 而不是 computed，是为了让 order 依旧可写，同时「写坏」的瞬间就被修回来。
  watch(
    order,
    () => {
      const next = reconcileOrder(order.value)
      const changed =
        next.length !== order.value.length || next.some((id, i) => id !== order.value[i])
      if (changed) order.value = next
    },
    { immediate: true, deep: true, flush: 'sync' },
  )

  /** 可见卡片（按展示顺序，已排除隐藏的）——拖拽排序应当只在这份列表上做 */
  const visibleCards = computed<string[]>(() =>
    order.value.filter((id) => !hidden.value.includes(id)),
  )

  /** 某张卡片的尺寸 */
  function sizeOf(id: string): DashboardCardSize {
    return sizes.value[id] ?? DEFAULT_CARD_SIZE
  }

  function setWeekGoal(value: number) {
    weekGoal.value = clampWeekGoal(value)
  }

  /** 直接切换布局模式（精选 bento / 等分槽位） */
  function setCustomized(value: boolean) {
    customized.value = value
  }

  /**
   * 隐藏 / 显示某张卡片。
   * 刻意**不动 order**：位置留给它，取消隐藏就回到原处，而不是被甩到末尾。
   */
  function toggleHidden(id: string) {
    if (!isKnownCardId(id)) return
    hidden.value = hidden.value.includes(id)
      ? hidden.value.filter((x) => x !== id)
      : [...hidden.value, id]
    customized.value = true
  }

  /** 设置卡片尺寸；未知 id / 非法尺寸直接忽略，避免往持久化里塞垃圾 */
  function setCardSize(id: string, size: DashboardCardSize) {
    if (!isKnownCardId(id) || !isCardSize(size)) return
    sizes.value = { ...sizes.value, [id]: size }
    customized.value = true
  }

  /**
   * 把 movedId 挪到 targetId 所在的位置。
   * 索引换算与 todoStore.moveTodo 完全一致（拖拽落点 = 目标原地索引），
   * 这样仪表板与任务列表的拖拽手感相同；未知 id 或原地不动时什么都不做。
   */
  function moveCard(movedId: string, targetId: string) {
    const list = [...order.value]
    const movedIdx = list.indexOf(movedId)
    const targetIdx = list.indexOf(targetId)
    if (movedIdx < 0 || targetIdx < 0 || movedIdx === targetIdx) return
    const [moved] = list.splice(movedIdx, 1)
    list.splice(targetIdx, 0, moved)
    order.value = list
    customized.value = true
  }

  /** 恢复精选默认布局：顺序、隐藏、尺寸、自定义标记一起回到出厂状态 */
  function resetLayout() {
    order.value = [...DASHBOARD_CARD_IDS]
    hidden.value = []
    sizes.value = {}
    customized.value = false
  }

  return {
    // 状态
    weekGoal,
    order,
    customized,
    hidden,
    sizes,
    // getters
    visibleCards,
    sizeOf,
    // actions
    setWeekGoal,
    setCustomized,
    toggleHidden,
    setCardSize,
    moveCard,
    resetLayout,
  }
})
