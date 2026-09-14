<script setup lang="ts">
/**
 * 有机体组件：赚钱秒表（EarningsClock）——仪表板 C 位的深绿强调卡，**卡片标题显示为 PayDance**
 *
 * 版式严格照参考稿（PayDance 那屏）：**状态 + 今日入账 + 超大金额 + 三栏统计条 + 底部进度光条**，
 * 卡上不再有「本月已赚 / 明细 / 进度百分比」这些文字——数据层照旧算着（useEarnings 里都有），
 * 只是不在这张卡上展示。
 *
 * - 主指标：今日已赚，**逐位上滑滚动**（odometer）实时跳动、精准到分；金额由「时间戳差值」重算，
 *   不做逐秒累加，所以切到后台再切回来数字依然准确（无跳变、无漂移）
 *   —— 它是整张卡的**主体内容**，字号给到 `text-5xl / sm:text-6xl`
 * - **统计条**：已工作 ｜ 距离午休/下班 ｜ 今日预计（三栏）
 * - 底部：进度光条（`mt-auto` 钉在卡片底端，只留轨道 + 填充 + 末端圆点）
 * - 上班前 / 非计薪日不显示「今日」金额（只给状态文案）
 * - **薪资三模式**（月薪 / 日薪 / 时薪）：统一换算到日薪再按已计薪秒数摊
 * - **自定义每周计薪日**：周一到周日任选，覆盖单休/轮休；月计薪天数保留为月薪模式的换算基准
 * - **跨零点夜班**：下班时间早于上班时间即按「次日下班」处理（如 22:00 → 06:00）
 * - **迷你折叠模式**：折成只显示金额的小条，状态存 localStorage
 * - **高度归仪表板网格管**：本卡在精选布局里不跨行（见 Dashboard.vue 的 BENTO_SPAN 说明），
 *   所以「收起设置」后卡片会跟着内容一起收高，不会留下大片空绿
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useElementSize } from '@vueuse/core'

import BaseInput from '@/components/atoms/BaseInput.vue'
import RollingAmount from '@/components/molecules/RollingAmount.vue'
import { useEarnings } from '@/composables/useEarnings'
import {
  EARNINGS_STATUS_TEXT,
  SALARY_MODE_LABEL,
  WEEKDAY_LABEL,
  WEEKDAY_ORDER,
} from '@/types/earnings'
import type { EarningsNextChange, SalaryMode } from '@/types/earnings'
import { formatDurationCompact, formatFen } from '@/utils/earnings'

const {
  config,
  snapshot,
  amountText,
  isConfigured,
  compact,
  toggleCompact,
  updateConfig,
  resetConfig,
} = useEarnings()

/** 设置区默认在「未配置」时展开，配置好后收起 */
const settingsOpen = ref(!isConfigured.value)

const statusText = computed(() => EARNINGS_STATUS_TEXT[snapshot.value.status])

/** 是否展示今日金额：计薪中 / 午休（冻结）/ 已下班（今日总计）；上班前与非计薪日只给文案 */
const showAmount = computed(
  () =>
    snapshot.value.status === 'working' ||
    snapshot.value.status === 'lunch' ||
    snapshot.value.status === 'after-work',
)

const isRunning = computed(() => snapshot.value.status === 'working')
const progressPercent = computed(() => Math.round(snapshot.value.progress * 100))
/** 统计条右栏「今日预计」＝今日满勤应得（标题上不再单独列日薪/时薪/计薪日明细） */
const dailyAmountText = computed(() => formatFen(snapshot.value.dailyFen))

/** 今天已经计薪多久（统计条左栏，紧凑写法如 8h 30m） */
const workedText = computed(() => formatDurationCompact(snapshot.value.elapsedWorkSeconds))

/**
 * 设置区的实际高度：上面那层背景壳要按它往下延伸（`bottom: -height`），
 * 才能把「卡片 + 展开的设置」画成同一张卡。用 ResizeObserver 跟着量，
 * 面板内容变化（比如夜班提示多一行）时也自动跟上。
 */
const settingsEl = ref<HTMLElement | null>(null)
const { height: settingsHeight } = useElementSize(settingsEl)

/** 统计条中栏的标签：看下一次状态切换是什么（收工后 / 非计薪日没有切换点，就退回「今日班次」） */
const NEXT_CHANGE_LABEL: Record<EarningsNextChange, string> = {
  lunch: '距离午休',
  'off-work': '距离下班',
  'on-work': '距离上班',
  none: '今日班次',
}
const nextChangeLabel = computed(() => NEXT_CHANGE_LABEL[snapshot.value.nextChange])
const nextChangeText = computed(() => {
  const s = snapshot.value
  // 没有下一班可等（收工 / 非计薪日）时显示今天的班次长度，总比一个 0s 有信息量
  return formatDurationCompact(s.nextChange === 'none' ? s.dailyWorkSeconds : s.secondsToNextChange)
})

// ---- 设置表单绑定（输入框为字符串语义，这里做双向换算） ----
const SALARY_MODES: SalaryMode[] = ['monthly', 'daily', 'hourly']

/**
 * 设置区输入框的样式覆写（**按主题分叉**）。
 *
 * 这一层是深绿卡上的浅色面板（`bg-white/10` + backdrop-blur），
 * 而它的最终观感两种主题不同：浅色主题下页面底是浅灰、面板看着是「淡绿玻璃」；
 * 深色主题下页面底是深蓝黑、面板是「深绿玻璃」。所以一套颜色不可能同时成立——
 * · 默认的白底深字：浅色下白块从面板上跳出来，深色下是六个发光白块（都试过了）
 * · 白底白字：浅色下直接变成空白输入框（面板本身已经够亮，白色叠上去就是白）
 * 结论：浅色走「白底深字」，深色走「半透明白 + 白字」，各自与所在主题的卡片材质对齐。
 */
const GLASS_INPUT_LIGHT =
  'border-slate-300/80 bg-white text-slate-800 placeholder:text-slate-400 focus:border-white focus:ring-white/60'
const GLASS_INPUT_DARK =
  'border-white/25 bg-white/12 text-white placeholder:text-emerald-50/50 focus:border-white/70 focus:ring-white/40'

/**
 * 是否深色主题。
 *
 * 刻意**不读 themeStore**：这个组件是纯展示层（`useEarnings` 之外不碰任何 store），
 * 它的单测也不装 Pinia —— 在 setup 里 `useThemeStore()` 会直接抛
 * 「getActivePinia() was called but there was no active Pinia」。
 * 而"当前是不是深色"本来就已经写在 `<html class="dark">` 上了（useTheme 负责维护），
 * 这里直接读它，顺带用 MutationObserver 跟上运行时切换主题的变化。
 */
const isDarkTheme = ref(false)
let darkObserver: MutationObserver | null = null

function syncDark() {
  if (typeof document === 'undefined') return
  isDarkTheme.value = document.documentElement.classList.contains('dark')
}

onMounted(() => {
  syncDark()
  if (typeof MutationObserver !== 'undefined') {
    darkObserver = new MutationObserver(syncDark)
    darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
})

onBeforeUnmount(() => {
  darkObserver?.disconnect()
  darkObserver = null
})

const glassInput = computed(() => (isDarkTheme.value ? GLASS_INPUT_DARK : GLASS_INPUT_LIGHT))
/** 时间输入额外走等宽数字，避免分秒跳动时整行抖 */
const glassInputNum = computed(() => `${glassInput.value} tabular-nums`)

function setSalaryMode(mode: SalaryMode) {
  updateConfig({ salaryMode: mode })
}

/** 当前模式对应的金额字段名（表单只编辑当前模式那一个，切换模式时另外两个保留） */
const salaryField = computed<'monthlySalary' | 'dailySalary' | 'hourlySalary'>(() => {
  if (config.value.salaryMode === 'daily') return 'dailySalary'
  if (config.value.salaryMode === 'hourly') return 'hourlySalary'
  return 'monthlySalary'
})

const salaryLabel = computed(() => `${SALARY_MODE_LABEL[config.value.salaryMode]}（元）`)

const salaryModel = computed({
  get: () => {
    const value = config.value[salaryField.value]
    return value > 0 ? String(value) : ''
  },
  set: (value: string) => updateConfig({ [salaryField.value]: Math.max(0, Number(value) || 0) }),
})

const monthWorkDaysModel = computed({
  get: () => String(config.value.monthWorkDays),
  set: (value: string) => updateConfig({ monthWorkDays: Math.max(0, Number(value) || 0) }),
})

const workStartModel = computed({
  get: () => config.value.workStart,
  set: (value: string) => updateConfig({ workStart: value }),
})

const workEndModel = computed({
  get: () => config.value.workEnd,
  set: (value: string) => updateConfig({ workEnd: value }),
})

const lunchStartModel = computed({
  get: () => config.value.lunchStart,
  set: (value: string) => updateConfig({ lunchStart: value }),
})

const lunchEndModel = computed({
  get: () => config.value.lunchEnd,
  set: (value: string) => updateConfig({ lunchEnd: value }),
})

/** 切换某个星期是否计薪 */
function toggleWorkDay(day: number) {
  const current = config.value.workDays
  const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
  // 一天都不选会让整个秒表归零，拦掉这种状态
  if (next.length === 0) return
  updateConfig({ workDays: next.sort((a, b) => a - b) })
}

function clearLunch() {
  updateConfig({ lunchStart: '', lunchEnd: '' })
}

function restoreDefaults() {
  resetConfig()
}

const workDaysSummary = computed(() => {
  const days = [...config.value.workDays].sort((a, b) => a - b)
  if (days.length === 7) return '每天'
  if (days.join(',') === '1,2,3,4,5') return '周一~周五'
  if (days.join(',') === '1,2,3,4,5,6') return '周一~周六'
  return days.map((d) => `周${WEEKDAY_LABEL[d]}`).join('、')
})
</script>

<template>
  <!-- 迷你折叠模式：只留一条金额小条，点击右侧箭头还原 -->
  <section
    v-if="compact"
    class="card-accent flex items-center gap-3 px-4 py-2.5 text-white"
    aria-label="赚钱秒表（迷你）"
    data-testid="earnings-compact"
  >
    <span class="text-xs text-emerald-100">💰</span>
    <span
      class="font-mono text-lg font-bold tabular-nums tracking-tight"
      data-testid="earnings-compact-amount"
    >
      <span class="text-sm text-emerald-200">¥</span><RollingAmount :value="amountText" />
    </span>
    <span class="truncate text-[11px] text-emerald-100/90">{{ statusText }}</span>
    <button
      type="button"
      class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs text-emerald-50 transition-colors hover:bg-white/15"
      aria-label="展开 PayDance"
      data-testid="earnings-expand"
      @click="toggleCompact"
    >
      展开 ⤢
    </button>
  </section>

  <!--
    展开态。`relative isolate` 给背景壳兜住 z-index（壳是 -10，必须待在卡片自己的层叠上下文里）；
    展开时再加 `z-10`：下方卡片的内部（比如迷你月历那些 `position: relative` 的日期格）在树里更靠后，
    不加正 z-index 的话它们会盖在设置区上面。
  -->
  <section
    v-else
    class="relative isolate flex flex-col p-5 text-white"
    :class="settingsOpen ? 'z-10' : ''"
    aria-label="PayDance"
  >
    <!--
      背景壳：这张卡的深绿渐变 + 边框 + 圆角全由它画，展开设置时**向下延伸**（bottom 取负的设置区高度）。
      所以「展开的内容」不是另拼一块、也不是第二张卡，而是长在同一张背景上的内容：
      一个渐变、一个圆角矩形。
      壳在流外（absolute），网格行高因此完全不受影响 —— 下面那行卡片是被**盖住**，不是被推开。
    -->
    <div
      class="card-accent absolute inset-x-0 top-0 bottom-0 -z-10"
      :class="settingsOpen ? 'shadow-[0_18px_40px_-16px_rgba(15,23,42,0.45)]' : ''"
      :style="settingsOpen ? { bottom: `-${settingsHeight}px` } : undefined"
      aria-hidden="true"
      data-testid="earnings-shell"
    ></div>

    <!-- 顶部：左＝状态（带小圆点），右＝迷你 / 设置（参考稿的顶栏） -->
    <header class="mb-3 flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-emerald-50">
          💰 PayDance
          <span
            v-if="snapshot.nightShift"
            class="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-normal text-emerald-50"
            data-testid="earnings-night"
            :title="`跨零点夜班：${snapshot.shiftStartLabel} → ${snapshot.shiftEndLabel}`"
          >
            夜班
          </span>
        </h2>
        <span class="flex min-w-0 items-center gap-1.5 text-xs text-emerald-100/90">
          <span
            v-if="isRunning"
            class="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-300"
            aria-hidden="true"
          ></span>
          <span class="truncate">{{ statusText }}</span>
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="rounded-full px-2.5 py-1 text-xs font-medium text-emerald-50 transition-colors hover:bg-white/15"
          aria-label="折叠为迷你条"
          data-testid="earnings-compact-toggle"
          @click="toggleCompact"
        >
          迷你 ⤡
        </button>
        <button
          type="button"
          class="rounded-full px-2.5 py-1 text-xs font-medium text-emerald-50 transition-colors hover:bg-white/15"
          data-testid="earnings-settings-toggle"
          @click="settingsOpen = !settingsOpen"
        >
          {{ settingsOpen ? '收起设置' : '设置' }}
        </button>
      </div>
    </header>

    <!--
      主体：一个居中的小标签 + 超大金额（参考稿的版式）。
      `my-auto` 让整块在卡片剩余空间里居中，是打开卡片第一眼看到的内容。
    -->
    <div class="my-auto text-center" data-testid="earnings-hero">
      <p class="text-xs tracking-[0.2em] text-emerald-100/75">今日入账</p>
      <p
        v-if="showAmount"
        data-testid="earnings-today"
        class="mt-1 font-mono text-5xl font-bold tabular-nums tracking-tight sm:text-6xl"
      >
        <span class="mr-0.5 text-4xl text-amber-300">¥</span><RollingAmount :value="amountText" />
      </p>
      <p v-else class="mt-2 text-base font-medium text-emerald-50">
        {{ statusText }}
      </p>

      <!-- 三栏统计条：已工作 ｜ 距离午休/下班 ｜ 今日预计 -->
      <div
        v-if="isConfigured"
        class="mt-3 grid grid-cols-3 divide-x divide-white/15 rounded-2xl bg-white/10 py-2.5"
        data-testid="earnings-stats"
      >
        <div class="px-1">
          <p class="text-[11px] text-emerald-100/70">已工作</p>
          <p class="mt-0.5 font-mono text-sm font-semibold tabular-nums text-white">
            {{ workedText }}
          </p>
        </div>
        <div class="px-1">
          <p class="text-[11px] text-emerald-100/70">{{ nextChangeLabel }}</p>
          <p class="mt-0.5 font-mono text-sm font-semibold tabular-nums text-white">
            {{ nextChangeText }}
          </p>
        </div>
        <div class="px-1">
          <p class="text-[11px] text-emerald-100/70">今日预计</p>
          <p class="mt-0.5 font-mono text-sm font-semibold tabular-nums text-white">
            ¥{{ dailyAmountText }}
          </p>
        </div>
      </div>

      <!-- 未配置引导 -->
      <p v-if="!isConfigured" class="mt-2 text-xs text-emerald-100/80">
        填写月薪与上下班时间后，这里会逐位滚动显示「今日已赚」。
      </p>
    </div>

    <!--
      底部进度光条：只留轨道 + 填充 + 末端圆点（严格照参考稿，不写「今日进度 / 百分比」文字）。
      `mt-auto` 把它钉在卡片底端；圆点用 max(…, 7px) 夹住，0% 与 100% 时都不会跑出轨道。
    -->
    <div v-if="isConfigured" class="group mt-auto pt-4" data-testid="earnings-progress">
      <div
        class="relative h-2.5 w-full rounded-full bg-white/15"
        role="progressbar"
        :aria-valuenow="progressPercent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`今日已赚进度 ${progressPercent}%`"
      >
        <div
          class="absolute inset-y-0 left-0 rounded-full bg-amber-300 transition-all duration-500 ease-out"
          :style="{ width: `${progressPercent}%` }"
        ></div>
        <div
          class="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-200 shadow-sm transition-all duration-500 ease-out"
          :style="{ left: `max(${progressPercent}%, 7px)` }"
        ></div>
        <!--
          鼠标悬浮时在**右侧**浮出进度百分比。绝对定位、不参与布局 ——
          hover 时不会把卡片顶高、也不会让进度条挪位（这卡刚按参考稿清干净，别再引入跳动）。
        -->
        <span
          class="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 rounded-full bg-emerald-950/85 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-emerald-50 opacity-0 shadow-sm transition-opacity duration-200 group-hover:opacity-100"
          data-testid="earnings-progress-hover"
        >
          {{ progressPercent }}%
        </span>
      </div>
    </div>

    <!--
      设置区：**这张卡内容的一部分**（背景由上面的壳统一画成一张，这里自己不带背景），
      只是被绝对定位到了卡片下方：于是它盖住下一行的卡片，而网格行高一点不动。

      版式按「四类字段」分组，而不是全平铺进一张 2 列网格：
        ① 薪资   —— 模式 + 金额 + 换算天数
        ② 工时   —— 上班 / 下班（跨零点夜班在这里读出来）
        ③ 午休   —— 可选项，标题里就写明「留空 = 不扣午休」
        ④ 计薪日 —— 七个圆点
      原来六组字段平铺时，「月薪」的右边是「月计薪天数」、「上班时间」的右边是「下班时间」，
      语义上不相邻的两个字段被并排放在一起，扫读时得逐个读标签才知道自己在哪一组。
    -->
    <div
      v-if="settingsOpen"
      ref="settingsEl"
      class="absolute inset-x-0 top-full z-20 p-5"
      data-testid="earnings-settings"
    >
      <div class="space-y-4 rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
        <!-- ① 薪资：模式 + 金额 + 换算天数 -->
        <section>
          <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 class="text-xs font-medium text-emerald-50/90">薪资</h3>
            <!-- 分段控件：白底药丸在绿卡上对比最高；主色填充反而会和卡片底色糊在一起 -->
            <div
              class="flex gap-1 rounded-full bg-emerald-950/25 p-0.5"
              role="group"
              aria-label="薪资模式"
            >
              <button
                v-for="mode in SALARY_MODES"
                :key="mode"
                type="button"
                class="min-h-[30px] rounded-full px-3 text-xs font-medium transition-colors"
                :class="
                  config.salaryMode === mode
                    ? 'bg-white text-emerald-800'
                    : 'text-emerald-50/75 hover:bg-white/10 hover:text-emerald-50'
                "
                :aria-pressed="config.salaryMode === mode"
                :data-testid="`earnings-mode-${mode}`"
                @click="setSalaryMode(mode)"
              >
                {{ SALARY_MODE_LABEL[mode] }}
              </button>
            </div>
          </div>

          <div class="grid gap-2.5 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-xs text-emerald-50/90">{{ salaryLabel }}</span>
              <BaseInput
                v-model="salaryModel"
                type="number"
                size="sm"
                placeholder="例如 15000"
                :input-class="glassInput"
              />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-emerald-50/90">
                月计薪天数<span class="text-emerald-50/55">（月薪换算基准）</span>
              </span>
              <BaseInput
                v-model="monthWorkDaysModel"
                type="number"
                size="sm"
                placeholder="21.75"
                :input-class="glassInput"
              />
            </label>
          </div>
        </section>

        <!-- ② 工时：跨零点夜班会在下班时间上标「次日」 -->
        <section>
          <h3 class="mb-2 text-xs font-medium text-emerald-50/90">工时</h3>
          <div class="grid gap-2.5 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-xs text-emerald-50/90">上班时间</span>
              <BaseInput
                v-model="workStartModel"
                type="time"
                size="sm"
                :input-class="glassInputNum"
              />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-emerald-50/90">
                下班时间<span v-if="snapshot.nightShift" class="text-amber-200">（次日）</span>
              </span>
              <BaseInput
                v-model="workEndModel"
                type="time"
                size="sm"
                :input-class="glassInputNum"
              />
            </label>
          </div>
        </section>

        <!-- ③ 午休：可留空，留空即不扣 -->
        <section>
          <h3 class="mb-2 flex items-baseline gap-1.5 text-xs font-medium text-emerald-50/90">
            午休
            <span class="text-[11px] font-normal text-emerald-50/55">留空 = 不扣午休</span>
          </h3>
          <div class="grid gap-2.5 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-xs text-emerald-50/90">开始</span>
              <BaseInput
                v-model="lunchStartModel"
                type="time"
                size="sm"
                :input-class="glassInputNum"
              />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-emerald-50/90">结束</span>
              <BaseInput
                v-model="lunchEndModel"
                type="time"
                size="sm"
                :input-class="glassInputNum"
              />
            </label>
          </div>
        </section>

        <!-- ④ 每周计薪日：七个圆点，覆盖单休 / 轮休 -->
        <section>
          <h3 class="mb-2 text-xs font-medium text-emerald-50/90">计薪日</h3>
          <div class="flex flex-wrap gap-1" role="group" aria-label="每周计薪日">
            <button
              v-for="day in WEEKDAY_ORDER"
              :key="day"
              type="button"
              class="h-8 w-8 rounded-full text-xs font-medium transition-colors"
              :class="
                config.workDays.includes(day)
                  ? 'bg-white text-emerald-800'
                  : 'bg-white/10 text-emerald-50/70 hover:bg-white/20 hover:text-emerald-50'
              "
              :aria-pressed="config.workDays.includes(day)"
              :aria-label="`周${WEEKDAY_LABEL[day]}计薪`"
              :data-testid="`earnings-day-${day}`"
              @click="toggleWorkDay(day)"
            >
              {{ WEEKDAY_LABEL[day] }}
            </button>
          </div>
        </section>

        <!--
          底部：口径说明 + 两个「改回来」的动作。
          说明独占一行（`max-w`），动作另起一行——硬塞进同一行时说明会被压到 ~2/3 宽、
          断在「计薪日：」中间，而按钮反而占了视线焦点。

          动作做成**描边药丸**而不是 ghost：这一层是 `bg-white/10` 的浅色面板，
          ghost 的白字在它上面几乎看不见（右边还紧挨着输入框，反差更被吃掉）。
        -->
        <div class="space-y-3 border-t border-white/15 pt-3.5">
          <p class="max-w-[58ch] text-xs leading-relaxed text-emerald-50/70">
            金额按「{{ SALARY_MODE_LABEL[config.salaryMode] }} ÷
            每日计薪时长」换算，只在计薪时间内累计。
            <span class="text-emerald-50/90">计薪日：{{ workDaysSummary }}</span>
            <template v-if="snapshot.nightShift">· 夜班按「次日下班」计算</template>
            。配置自动保存在浏览器。
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full border border-white/30 px-3 py-1 text-xs font-medium text-emerald-50 transition-colors hover:border-white/60 hover:bg-white/15"
              @click="clearLunch"
            >
              不扣午休
            </button>
            <button
              type="button"
              class="rounded-full border border-white/30 px-3 py-1 text-xs font-medium text-emerald-50 transition-colors hover:border-white/60 hover:bg-white/15"
              @click="restoreDefaults"
            >
              恢复默认
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
