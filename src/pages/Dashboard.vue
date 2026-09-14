<script setup lang="ts">
/**
 * 页面：仪表板（打开即看「今天赚了多少、干了多少、外面天气」）
 *
 * 布局按视觉规范「合并后的 Dashboard 布局（定稿版）」+ 第六阶段 6.4 的可自定义布局：
 * - 页头（非卡片）：时段问候 + 日期 ｜ 每日格言 —— 格言合并进页头，不再单独占卡
 * - **两种布局模式**：
 *   · 精选默认（customized=false）：三列 bento，**没有任何卡片跨行**——
 *     第一行 赚钱秒表 ｜ 今日完成度 ｜ 天气，第二行 迷你月历 ｜ Streak ｜ 倒计时，
 *     第三行 今日聚焦（通栏），最后一行 快捷导航（通栏）
 *     —— 这套比例是精调过的，默认状态直接给到最好的观感
 *   · 自定义（customized=true）：切成**等槽网格**（每卡一槽），才能自由拖拽换位
 *     （变跨度卡片无法直接换位，这也是规划里选「等槽化」的原因）
 * - **编辑模式**才开启拖拽，避免日常滚动时误拖；每卡可隐藏、可调大小（小/中/大）
 * - 底部通栏：今日聚焦；最下方是快捷导航
 *
 * 任务增删改与列表搬到 /todos，统计图表搬到 /stats——首页只留「一眼看清」的内容。
 */

import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useEventListener, useIntervalFn } from '@vueuse/core'
import { useSortable } from '@vueuse/integrations/useSortable'
import type { SortableEvent } from 'sortablejs'

import BaseBadge from '@/components/atoms/BaseBadge.vue'
import BaseButton from '@/components/atoms/BaseButton.vue'
import UiIcon from '@/components/atoms/UiIcon.vue'
import CountdownCard from '@/components/organisms/CountdownCard.vue'
import DailyGreeting from '@/components/organisms/DailyGreeting.vue'
import EarningsClock from '@/components/organisms/EarningsClock.vue'
import LinkDock from '@/components/organisms/LinkDock.vue'
import MiniCalendar from '@/components/organisms/MiniCalendar.vue'
import MyDay from '@/components/organisms/MyDay.vue'
import StreakCard from '@/components/organisms/StreakCard.vue'
import TodayProgressCard from '@/components/organisms/TodayProgressCard.vue'
import WeatherWidget from '@/components/organisms/WeatherWidget.vue'
import { DASHBOARD_CARD_IDS, useDashboardStore } from '@/stores/dashboardStore'
import type { DashboardCardId, DashboardCardSize } from '@/stores/dashboardStore'
import { useTodoStore } from '@/stores/todoStore'
import { activityDateKeys } from '@/utils/dashboardStats'
import { holidayDatesOfMonth, makeupWorkdaysOfMonth } from '@/utils/holidays'
import { resolveSortMove } from '@/utils/sortableMove'
import { computeStreak } from '@/utils/streak'

const todoStore = useTodoStore()
const dash = useDashboardStore()
const route = useRoute()
const router = useRouter()

/** 是否处于「编辑布局」模式（只有此时才允许拖拽/隐藏/调大小） */
const editing = ref(false)
const gridRef = ref<HTMLElement | null>(null)

/** 卡片标题（编辑模式的工具条与「已隐藏」列表用） */
const CARD_TITLES: Record<DashboardCardId, string> = {
  earnings: 'PayDance',
  'today-progress': '今日完成度',
  weather: '天气',
  'mini-calendar': '迷你月历',
  streak: '连续打卡',
  countdown: '倒计时',
  'my-day': '今日聚焦',
  'link-dock': '快捷导航',
}

/**
 * 精选 bento 下每张卡的跨度（只有默认布局用得到）。
 * 等槽模式下全部退化成「一卡一槽」，这样拖拽换位才有确定的落点。
 *
 * 赚钱秒表刻意**不跨行**：跨行时行高由同列邻居说了算（第一行的「今日完成度」是 h-36 环形图 ≈ 264px，
 * 第二行的「迷你月历」6 行日期 ≈ 300px），再叠上卡片的 h-full，绿卡就被撑到 ≈ 580px，
 * 而它自己的内容只有 250px 上下——设置面板一收起，剩下 300px 全成了空绿。
 * 收成一行后，行高只由该行最高的那张卡决定，绿卡不再留空洞（设置展开时也只是这一行临时变高）。
 *
 * 今日聚焦是通栏（3 列）：原先它占 2 列、右边 1 列给「任务概览」，任务概览卡撤掉后
 * 通栏的快捷导航挤不进剩下的 1 列，会在第三行留下一个空格子——所以干脆让今日聚焦吃满整行。
 */
const BENTO_SPAN: Partial<Record<DashboardCardId, string>> = {
  'mini-calendar': 'lg:col-span-1',
  'my-day': 'lg:col-span-3',
  countdown: 'lg:col-span-1',
  'link-dock': 'lg:col-span-3',
}

/**
 * 卡片大小三档：等槽网格里用**最小高度**表达（小=紧凑、中=默认、大=加高）。
 * 不用列跨度是因为列跨度会打破「等槽」这个前提，拖拽落点又会变得不确定。
 */
const SIZE_MIN_HEIGHT: Record<DashboardCardSize, string> = {
  small: 'min-h-[120px]',
  medium: 'min-h-[200px]',
  large: 'min-h-[300px]',
}

const SIZE_LABEL: Record<DashboardCardSize, string> = {
  small: '小',
  medium: '中',
  large: '大',
}
const SIZE_OPTIONS: DashboardCardSize[] = ['small', 'medium', 'large']

/** 展示顺序（已排除隐藏卡片） */
const cards = computed(() => dash.visibleCards as DashboardCardId[])

/** 已隐藏的卡片（编辑模式下提供一键恢复） */
const hiddenCards = computed(() => DASHBOARD_CARD_IDS.filter((id) => dash.hidden.includes(id)))

/** 迷你月历圆点：截止日期 + 完成时间取并集 */
const activityDates = computed(() => activityDateKeys(todoStore.visibleTodos))

/**
 * 统一给月历与 Streak 的「今天」。
 * 挂载时刻算一次是不够的：页面在后台开一整夜，第二天回来月历还停在昨天，
 * 所以每分钟校准一次（跨零点后自动跟着换天）。
 */
const now = ref(new Date())
useIntervalFn(
  () => {
    now.value = new Date()
  },
  60_000,
  { immediate: false },
)
useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState === 'visible') now.value = new Date()
})

/** 连续打卡 + 本周目标进度 */
const streakInfo = computed(() =>
  computeStreak(todoStore.visibleTodos, { now: now.value, weekGoal: dash.weekGoal }),
)

/**
 * 法定节假日与调休（来源见 utils/holidays.ts 的说明，每年初需更新）。
 * 这里只负责「在月历上标出来」——真正的节日提醒在倒计时卡里，两处共用同一份 JSON。
 *
 * 注意看的是**月历当前展示的月份**，不是"今天所在月"：月历可以往回/往前翻，
 * 若一直按今天算，翻到 10 月就看不到国庆 7 天与 10/10 调休了。
 * 初始值取今天所在月，之后由 MiniCalendar 的 viewMonth 事件同步。
 */
const calendarYear = ref(now.value.getFullYear())
const calendarMonth = ref(now.value.getMonth() + 1)

/** 月历翻页时同步（跨零点时月历自己会跟回当月并再报一次，所以这里不必额外监听 now） */
function onViewMonth(year: number, month: number) {
  calendarYear.value = year
  calendarMonth.value = month
}

const holidayNames = computed(() => holidayDatesOfMonth(calendarYear.value, calendarMonth.value))
const makeupDays = computed(() => makeupWorkdaysOfMonth(calendarYear.value, calendarMonth.value))

/** 编辑模式下网格切等槽；非编辑态若用户自定义过布局，也保持等槽（布局是用户定的） */
const useSlotGrid = computed(() => editing.value || dash.customized)

function spanClass(id: DashboardCardId): string {
  if (useSlotGrid.value) return SIZE_MIN_HEIGHT[dash.sizeOf(id)]
  return BENTO_SPAN[id] ?? ''
}

// ---- 拖拽排序（与任务列表同一套 SortableJS 方案，规划明确要求复用） ----
/**
 * 卡片 id 包成 `{ id }` 再交给共用的索引换算函数：
 * `resolveSortMove` 是给「对象数组」写的（任务列表那边要拿 id 去 store 里定位），
 * 这里为了复用它（而不是再写一份等价逻辑）就顺手包一层。
 */
const cardEntries = computed(() => cards.value.map((id) => ({ id })))

function onSortUpdate(evt: SortableEvent) {
  const move = resolveSortMove(cardEntries.value, evt.oldIndex, evt.newIndex)

  // 先把被拖的节点插回原位：SortableJS 已改动真实 DOM，不还原会让 Vue 的 keyed diff 错乱
  const item = evt.item
  const from = evt.from
  if (item && from && item.parentNode === from) {
    from.removeChild(item)
    from.insertBefore(item, from.children[evt.oldIndex ?? 0] ?? null)
  }

  if (move) dash.moveCard(move.movedId, move.targetId)
}

const { option: sortableOption } = useSortable(gridRef, cards, {
  animation: 150,
  /**
   * **不设 handle**：编辑态下整张卡片都是拖拽区。
   * 原来只认左上角那个 ⠿ 小把手，命中面积只有十来个像素，实际用起来就是「拖不动」；
   * 网格的直接子节点是卡片外壳（含编辑工具条），所以从卡片任意位置按下都能起拖。
   *
   * 配套的 `filter` 把交互控件排除在拖拽之外：按钮/输入框/链接/月历日期格上按下时不该起拖，
   * 否则点「小/中/大/隐藏」、点某一天、在 Streak 里输周目标都会被拖拽吃掉。
   * `[data-no-drag]` 留给以后需要额外豁免的元素。
   */
  filter: 'button, a, input, select, textarea, [data-no-drag]',
  // 保持 false：默认的 true 会在命中 filter 时 preventDefault 掉 mousedown，输入框会点不进焦点
  preventOnFilter: false,
  // 触屏：先按住 200ms 才起拖，否则单指上下滑会被当成拖拽，页面滚不动
  delay: 200,
  delayOnTouchOnly: true,
  /**
   * **不走浏览器原生拖拽**，改用 SortableJS 自带的 fallback 实现。
   *
   * Tauri 的桌面窗口默认开着系统级 drag-drop（`dragDropEnabled` 默认 true），而 Tauri 官方 schema
   * 对它的原话是：「Disabling it is required to use HTML5 drag and drop on the frontend on Windows」。
   * SortableJS 在 Chromium 下默认 `nativeDraggable: true`，也就是完全依赖浏览器原生 dragstart/drop——
   * 结果就是浏览器里能拖、桌面窗口里按住卡片怎么拖都不动（真实鼠标会走 OS 拖放会话，被窗口的
   * drop target 吃掉；用合成事件自动化时又复现不出来，这个坑很会骗人）。
   * fallback 模式只用 pointerdown/pointermove/pointerup + DOM 操作，不产生任何原生拖放会话，
   * 所以不受窗口 drop target 影响，网页端与桌面端也是同一套行为。
   *
   * `fallbackOnBody`：跟随指针的那份副本挂到 body。副本是 `position: fixed`，而 fixed 的包含块会被
   * 祖先的 transform / backdrop-filter 改写（卡片与顶栏里就有 backdrop-blur），挂 body 最保险。
   */
  forceFallback: true,
  fallbackOnBody: true,
  ghostClass: 'sortable-ghost',
  /**
   * 初始必须显式 disabled。
   * `editing` 的 watch 带 immediate，在 setup 阶段就执行了，那时 Sortable 实例还没在
   * onMounted 里建出来，那次 `option('disabled', true)` 会被 VueUse 静默丢掉，
   * 实例就会以「可拖」的状态建出来。以前靠「把手只在编辑态渲染」侥幸兜住，现在整卡可拖，
   * 只能靠这个初始值把非编辑态钉死。
   */
  disabled: true,
  onUpdate: onSortUpdate,
})

// 只有编辑模式能拖：平时滚动页面不该把卡片拖走
watch(
  editing,
  (on) => {
    sortableOption('disabled', !on)
  },
  { immediate: true },
)

/** 进入编辑即切等槽网格，让卡片之间有确定的落点 */
function startEditing() {
  dash.setCustomized(true)
  editing.value = true
}

/**
 * 迷你月历点某天 → 去任务页看那天到期的事。
 * 走 store 的 setFilterDate（而不是拼 query），切页后筛选状态由 Pinia + keep-alive 保住。
 */
function onPickDate(dateKey: string) {
  todoStore.setFilterDate(dateKey)
  if (route.name !== 'todos') void router.push({ name: 'todos' })
}
</script>

<template>
  <div class="space-y-6">
    <!--
      页头 = 问候 + 格言 + 当前时间（DailyGreeting），右侧只挂一个「编辑布局」入口。
      刻意**没有「今日概览」这样的眉标标题**：页头已经承担了定位，卡片标题各自说明内容，
      再加一行小字只是把视觉重量从真正的信息上分走（原来那一行的作用只剩下承载按钮）。
    -->
    <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <DailyGreeting class="min-w-0 flex-1" />

      <BaseButton
        v-if="!editing"
        size="sm"
        variant="ghost"
        class="shrink-0 text-slate-500 dark:text-slate-400"
        data-testid="dashboard-edit-layout"
        @click="startEditing"
      >
        <UiIcon name="pencil" class="h-4 w-4" />
        编辑布局
      </BaseButton>
    </div>

    <!-- 编辑模式工具条：只在编辑态出现，占据一行说明 + 两个出口动作 -->
    <div
      v-if="editing"
      class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70"
    >
      <p class="text-xs text-slate-500 dark:text-slate-400">
        按住卡片任意位置拖动换位 · 可隐藏或调整大小
      </p>
      <div class="ml-auto flex items-center gap-2">
        <BaseButton
          size="sm"
          variant="secondary"
          data-testid="dashboard-reset-layout"
          @click="dash.resetLayout()"
        >
          恢复默认
        </BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          data-testid="dashboard-finish-editing"
          @click="editing = false"
        >
          完成
        </BaseButton>
      </div>
    </div>

    <!-- 编辑态下把已隐藏的卡片放回来（没有隐藏卡片时整行不渲染） -->
    <div
      v-if="editing && hiddenCards.length > 0"
      class="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
      data-testid="dashboard-hidden-cards"
    >
      <span>已隐藏：</span>
      <button
        v-for="id in hiddenCards"
        :key="id"
        type="button"
        class="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500 transition-colors hover:border-[var(--el-color-primary-light-5)] hover:text-[var(--el-color-primary)] dark:border-slate-600 dark:text-slate-400"
        :data-testid="`dashboard-restore-${id}`"
        @click="dash.toggleHidden(id)"
      >
        ＋ {{ CARD_TITLES[id] }}
      </button>
    </div>

    <!-- 卡片网格：默认三列 bento，自定义/编辑态切等槽 -->
    <div
      ref="gridRef"
      class="grid grid-cols-1 gap-4"
      :class="useSlotGrid ? 'md:grid-cols-2 xl:grid-cols-3' : 'lg:grid-cols-3'"
      data-testid="dashboard-grid"
    >
      <div
        v-for="id in cards"
        :key="id"
        class="min-w-0"
        :class="[spanClass(id), editing ? 'cursor-grab active:cursor-grabbing' : '']"
        :data-card-id="id"
        :data-testid="`dashboard-card-${id}`"
      >
        <!-- 编辑模式的卡片工具条 -->
        <div
          v-if="editing"
          class="mb-1 flex flex-wrap items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 dark:bg-slate-800"
        >
          <span
            class="drag-handle cursor-grab select-none text-slate-400"
            title="按住卡片任意位置拖动"
            aria-hidden="true"
            >⠿</span
          >
          <span class="text-xs font-medium text-slate-600 dark:text-slate-300">
            {{ CARD_TITLES[id] }}
          </span>
          <div class="ml-auto flex items-center gap-1">
            <button
              v-for="size in SIZE_OPTIONS"
              :key="size"
              type="button"
              class="rounded px-1.5 py-0.5 text-[11px] transition-colors"
              :class="
                dash.sizeOf(id) === size
                  ? 'bg-[var(--el-color-primary)] text-white'
                  : 'text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700'
              "
              :aria-pressed="dash.sizeOf(id) === size"
              :aria-label="`${CARD_TITLES[id]}大小：${SIZE_LABEL[size]}`"
              :data-testid="`dashboard-size-${id}-${size}`"
              @click="dash.setCardSize(id, size)"
            >
              {{ SIZE_LABEL[size] }}
            </button>
            <button
              type="button"
              class="rounded px-1.5 py-0.5 text-[11px] text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-900/30"
              :aria-label="`隐藏${CARD_TITLES[id]}`"
              :data-testid="`dashboard-hide-${id}`"
              @click="dash.toggleHidden(id)"
            >
              隐藏
            </button>
          </div>
        </div>

        <!-- 卡片本体：按 id 渲染对应组件 -->
        <EarningsClock v-if="id === 'earnings'" class="h-full" />
        <TodayProgressCard v-else-if="id === 'today-progress'" class="h-full" />
        <WeatherWidget v-else-if="id === 'weather'" class="h-full" />
        <MiniCalendar
          v-else-if="id === 'mini-calendar'"
          class="h-full"
          :activity-dates="activityDates"
          :now="now"
          :holiday-names="holidayNames"
          :makeup-days="makeupDays"
          @select="onPickDate"
          @view-month="onViewMonth"
        />
        <StreakCard
          v-else-if="id === 'streak'"
          v-model:week-goal="dash.weekGoal"
          class="h-full"
          :info="streakInfo"
        />
        <CountdownCard v-else-if="id === 'countdown'" class="h-full" />
        <MyDay v-else-if="id === 'my-day'" class="h-full" />
        <LinkDock v-else-if="id === 'link-dock'" class="h-full" />
      </div>
    </div>

    <!-- 卡片全被隐藏时的兜底提示（否则页面会是一片空白，看着像坏了） -->
    <div
      v-if="cards.length === 0"
      class="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 dark:border-slate-600 dark:text-slate-500"
      data-testid="dashboard-empty"
    >
      <p>所有卡片都被隐藏了</p>
      <BaseBadge tone="info" size="sm" class="mt-2">点右上角「编辑布局」可以放回来</BaseBadge>
    </div>
  </div>
</template>
