<script setup lang="ts">
/**
 * 有机体组件：迷你月历（仪表板卡片）
 * - **纯展示**：不读任何 store，「有产出的日期」由父级通过 activityDates 传进来
 * - 周一为首列，CSS Grid 七列；跨月空位渲染成不可交互的 span（点不到、也不会画圆点）
 * - `now` 可注入：既方便测试冻结时间，也让父级能统一同一个「今天」口径
 */

import { computed, ref, watch } from 'vue'

import {
  buildMonthGrid,
  countByDate,
  isViewingCurrentMonth,
  shiftMonth,
} from '@/utils/miniCalendar'

const props = withDefaults(
  defineProps<{
    /** 有产出（有完成任务）的日期键 YYYY-MM-DD，用来画小圆点 */
    activityDates?: string[]
    /** 今天（可注入，便于测试）；缺省取挂载时刻 */
    now?: Date
    /**
     * 法定节假日：日期键 -> 节日名（第六阶段 6.4「内置当年节假日+调休 JSON，本月历上同时标出」）。
     * 由父级注入而不是组件自己读数据文件——月历保持纯展示，节日数据源换掉时也不用改这里。
     */
    holidayNames?: Record<string, string>
    /** 调休补班日（周末但要上班）：标出来免得用户误以为是休息日 */
    makeupDays?: string[]
  }>(),
  // now 显式声明为 undefined：「没传」本身就是有效语义（= 取挂载时刻），
  // 写进默认值对象是为了让计时基准有据可查，而不是靠隐式缺省
  { activityDates: () => [], now: undefined, holidayNames: () => ({}), makeupDays: () => [] },
)

const emit = defineEmits<{
  select: [dateKey: string]
  /**
   * 当前展示的月份变化（year 为公历年，month 为 **1~12**）。
   *
   * 为什么需要它：节假日/调休数据由父级注入（组件保持纯展示），
   * 但「用户翻到了哪个月」只有组件自己知道 —— 没有这个事件，父级只能一直喂
   * "今天所在月"的数据，翻到 10 月就看不到国庆与调休了。
   */
  viewMonth: [year: number, month: number]
}>()

/** 表头：与网格一样周一开头 */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const today = computed(() => props.now ?? new Date())
/** 当前展示的月份（只用到年月） */
const viewDate = ref(shiftMonth(today.value, 0))

/**
 * 外部换了「今天」就跟回当月 —— 但**只在年月真的变了**时才重置。
 *
 * 不能直接 `watch(today, ...)`：`today` 是 `props.now ?? new Date()`，
 * 而父级（Dashboard）为了跨零点刷新，每分钟都会把 `now` 换成**新的 Date 对象**，
 * 对象身份一变 watch 就触发 —— 用户翻到 10 月后静置一分钟就被拽回 9 月，
 * 「今天」按钮等于形同虚设。按「年-月」这个真正的语义单位比较即可：
 * 同月内换日期不需要动视图，跨月（含跨零点到次月）才回到当月。
 */
const todayMonthKey = computed(() => `${today.value.getFullYear()}-${today.value.getMonth()}`)
watch(todayMonthKey, () => {
  viewDate.value = shiftMonth(today.value, 0)
})

// 把「正在看的月份」告诉父级：节假日/调休由父级注入，它必须知道该供哪个月的数据。
// immediate：挂载时先报一次，父级不必自己猜初始月份。
watch(viewDate, (date) => emit('viewMonth', date.getFullYear(), date.getMonth() + 1), {
  immediate: true,
})

const grid = computed(() => buildMonthGrid(today.value, viewDate.value))
const viewingCurrentMonth = computed(() => isViewingCurrentMonth(viewDate.value, today.value))

/** 有产出的日期集合：O(1) 查询，免得每个格子都回头遍历一遍 activityDates */
const activitySet = computed(() => new Set(countByDate(props.activityDates).keys()))

/** 调休补班日集合（O(1) 查询） */
const makeupSet = computed(() => new Set(props.makeupDays))

/** 某天的标题：节日名 / 调休提示（无障碍与 hover 都用它） */
function dayTitle(dateKey: string): string | undefined {
  const holiday = props.holidayNames[dateKey]
  if (holiday) return holiday
  if (makeupSet.value.has(dateKey)) return '调休上班'
  return undefined
}

function goPrev() {
  viewDate.value = shiftMonth(viewDate.value, -1)
}

function goNext() {
  viewDate.value = shiftMonth(viewDate.value, 1)
}

function goToday() {
  viewDate.value = shiftMonth(today.value, 0)
}
</script>

<template>
  <section class="card p-5" aria-label="迷你月历">
    <header class="mb-3 flex items-center justify-between gap-2">
      <h2
        class="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200"
      >
        <span aria-hidden="true">📅</span>迷你月历
      </h2>

      <div class="flex items-center gap-1">
        <!-- 只有翻到别的月份才给「今天」快捷入口，当月时它是多余的一个按钮 -->
        <button
          v-if="!viewingCurrentMonth"
          type="button"
          class="rounded-full px-2 py-0.5 text-[11px] font-medium text-[var(--el-color-primary)] transition-colors hover:bg-[var(--el-color-primary-light-9)]"
          data-testid="cal-today"
          @click="goToday"
        >
          今天
        </button>
        <span
          class="text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400"
          data-testid="cal-label"
          >{{ grid.label }}</span
        >
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-[var(--el-color-primary-light-9)] hover:text-[var(--el-color-primary)] dark:text-slate-400"
          aria-label="上个月"
          data-testid="cal-prev"
          @click="goPrev"
        >
          ‹
        </button>
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-[var(--el-color-primary-light-9)] hover:text-[var(--el-color-primary)] dark:text-slate-400"
          aria-label="下个月"
          data-testid="cal-next"
          @click="goNext"
        >
          ›
        </button>
      </div>
    </header>

    <!-- 七列 CSS Grid：表头 + 每周 7 格，行内顺序即渲染顺序 -->
    <div class="grid grid-cols-7 gap-y-1" data-testid="cal-grid">
      <span
        v-for="label in WEEKDAY_LABELS"
        :key="label"
        class="pb-1 text-center text-[10px] leading-none text-slate-400 dark:text-slate-500"
      >
        {{ label }}
      </span>

      <template v-for="(week, weekIndex) in grid.weeks" :key="weekIndex">
        <template v-for="(cell, dayIndex) in week" :key="`${weekIndex}-${dayIndex}`">
          <!-- 跨月空位：占位但不可交互 -->
          <span v-if="!cell" class="h-9" data-testid="cal-pad" aria-hidden="true"></span>

          <button
            v-else
            type="button"
            class="relative mx-auto flex h-9 w-9 flex-col items-center justify-center rounded-full text-xs transition-colors"
            :class="
              cell.isToday
                ? 'bg-[var(--el-color-primary)] font-semibold text-white'
                : holidayNames[cell.date]
                  ? 'font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30'
                  : makeupSet.has(cell.date)
                    ? 'text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/30'
                    : 'text-slate-700 hover:bg-[var(--el-color-primary-light-9)] dark:text-slate-200'
            "
            :title="dayTitle(cell.date)"
            :aria-label="`${cell.date}${dayTitle(cell.date) ? `（${dayTitle(cell.date)}）` : ''}${
              activitySet.has(cell.date) ? '（有完成任务）' : ''
            }`"
            :aria-current="cell.isToday ? 'date' : undefined"
            :data-testid="`cal-day-${cell.date}`"
            @click="emit('select', cell.date)"
          >
            {{ cell.day }}
            <!-- 节日/调休角标：一个点也会和「有产出」的圆点混淆，所以用文字记号 -->
            <span
              v-if="holidayNames[cell.date] || makeupSet.has(cell.date)"
              class="absolute right-0.5 top-0.5 text-[8px] leading-none"
              :class="
                cell.isToday
                  ? 'text-white'
                  : holidayNames[cell.date]
                    ? 'text-rose-500'
                    : 'text-amber-500'
              "
              :data-testid="`cal-holiday-${cell.date}`"
              aria-hidden="true"
            >
              {{ holidayNames[cell.date] ? '休' : '班' }}
            </span>
            <span
              v-if="activitySet.has(cell.date)"
              class="absolute bottom-0.5 h-1 w-1 rounded-full"
              :class="cell.isToday ? 'bg-white' : 'bg-[var(--el-color-primary)]'"
              :data-testid="`cal-dot-${cell.date}`"
              aria-hidden="true"
            ></span>
          </button>
        </template>
      </template>
    </div>
  </section>
</template>
