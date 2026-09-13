<script setup lang="ts">
/**
 * 有机体组件：赚钱秒表（EarningsClock）——仪表板 C 位的深绿强调卡
 *
 * - 主指标：今日已赚，**逐位上滑滚动**（odometer）实时跳动、精准到分；金额由「时间戳差值」重算，
 *   不做逐秒累加，所以切到后台再切回来数字依然准确（无跳变、无漂移）
 * - 次指标：本月已赚（含今日进度，封顶月薪）+ 相对上月同期的涨跌徽章
 * - 附属元素：「今日已赚 / 目标日收入」进度条 + 免责小字
 * - 上班前 / 非计薪日不显示「今日」金额（只给状态文案）；「本月已赚」是月度累计，始终展示
 * - **薪资三模式**（月薪 / 日薪 / 时薪）：统一换算到日薪再按已计薪秒数摊
 * - **自定义每周计薪日**：周一到周日任选，覆盖单休/轮休；月计薪天数保留为月薪模式的换算基准
 * - **跨零点夜班**：下班时间早于上班时间即按「次日下班」处理（如 22:00 → 06:00）
 * - **迷你折叠模式**：折成只显示金额的小条，状态存 localStorage
 * - **高度归仪表板网格管**：本卡在精选布局里不跨行（见 Dashboard.vue 的 BENTO_SPAN 说明），
 *   所以「收起设置」后卡片会跟着内容一起收高，不会留下大片空绿
 */

import { computed, ref } from 'vue'

import BaseButton from '@/components/atoms/BaseButton.vue'
import BaseInput from '@/components/atoms/BaseInput.vue'
import TrendBadge from '@/components/atoms/TrendBadge.vue'
import RollingAmount from '@/components/molecules/RollingAmount.vue'
import { useEarnings } from '@/composables/useEarnings'
import {
  EARNINGS_DISCLAIMER,
  EARNINGS_STATUS_TEXT,
  SALARY_MODE_LABEL,
  WEEKDAY_LABEL,
  WEEKDAY_ORDER,
} from '@/types/earnings'
import type { SalaryMode } from '@/types/earnings'
import { formatDuration, formatFen } from '@/utils/earnings'

const {
  config,
  snapshot,
  amountText,
  monthAmountText,
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
const dailyAmountText = computed(() => formatFen(snapshot.value.dailyFen))
const hourlyAmountText = computed(() => formatFen(snapshot.value.hourlyFen))
/** 仅在能算出上月同期（> 0）时展示涨跌，避免月初第一个工作日显示无意义的 0% */
const showMonthTrend = computed(
  () => snapshot.value.monthEarnedFen > 0 && snapshot.value.monthDeltaPercent !== 0,
)

const workHoursText = computed(() => {
  const total = snapshot.value.dailyWorkSeconds
  const hours = Math.floor(total / 3600)
  const minutes = Math.round((total % 3600) / 60)
  return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
})

/** 副文案：倒计时或今日总计 */
const hintText = computed(() => {
  const s = snapshot.value
  const duration = formatDuration(s.secondsToNextChange)
  if (s.status === 'after-work') return `今日总计 ¥${dailyAmountText.value}`
  if (s.status === 'lunch') return `距离下午上班还有 ${duration}`
  if (s.status === 'before-work') return `距离上班还有 ${duration}`
  if (s.status === 'working') {
    return s.nextChange === 'lunch' ? `距离午休还有 ${duration}` : `距离下班还有 ${duration}`
  }
  return ''
})

// ---- 设置表单绑定（输入框为字符串语义，这里做双向换算） ----
const SALARY_MODES: SalaryMode[] = ['monthly', 'daily', 'hourly']

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
    :title="EARNINGS_DISCLAIMER"
  >
    <span class="text-xs text-emerald-100">💰</span>
    <!--
      折叠条也必须能读到免责声明：长期保持折叠的用户此前永远看不到
      「金额是估算、不是实际到手」这句（展开态才渲染）。
      迷你条放不下整句，所以走悬停提示 + 读屏文本两条通道。
    -->
    <span class="sr-only">{{ EARNINGS_DISCLAIMER }}</span>
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
      aria-label="展开赚钱秒表"
      data-testid="earnings-expand"
      @click="toggleCompact"
    >
      展开 ⤢
    </button>
  </section>

  <section v-else class="card-accent flex flex-col p-5 text-white" aria-label="赚钱秒表">
    <header class="mb-3 flex items-center justify-between gap-2">
      <h2 class="flex items-center gap-1.5 text-sm font-semibold text-emerald-50">
        💰 赚钱秒表
        <span
          v-if="isRunning"
          class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-200"
          aria-hidden="true"
        ></span>
        <span
          v-if="snapshot.nightShift"
          class="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-normal text-emerald-50"
          data-testid="earnings-night"
          :title="`跨零点夜班：${snapshot.shiftStartLabel} → ${snapshot.shiftEndLabel}`"
        >
          夜班
        </span>
      </h2>
      <div class="flex items-center gap-1">
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
          @click="settingsOpen = !settingsOpen"
        >
          {{ settingsOpen ? '收起设置' : '设置' }}
        </button>
      </div>
    </header>

    <!-- 主指标：今日已赚（逐位滚动） -->
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <template v-if="showAmount">
        <p
          data-testid="earnings-today"
          class="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl"
        >
          <span class="text-2xl text-emerald-200">¥</span><RollingAmount :value="amountText" />
        </p>
        <span class="text-xs text-emerald-100">{{ statusText }}</span>
      </template>
      <p v-else class="text-base font-medium text-emerald-50">
        {{ statusText }}
      </p>
    </div>

    <!-- 次指标：本月已赚（月度累计，非计薪日也保留展示） -->
    <p
      v-if="isConfigured"
      data-testid="earnings-month"
      class="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-emerald-100"
    >
      <span>本月已赚</span>
      <span class="font-mono font-semibold tabular-nums text-white"
        >¥<RollingAmount :value="monthAmountText"
      /></span>
      <span class="text-xs text-emerald-200/90"
        >已计薪 {{ snapshot.monthElapsedPaidDays }}/{{ snapshot.monthPaidDays }} 天</span
      >
      <TrendBadge
        v-if="showMonthTrend"
        :value="snapshot.monthDeltaPercent"
        label="较上月同期"
        data-testid="earnings-month-trend"
      />
    </p>

    <!-- 倒计时 / 总计 -->
    <p v-if="hintText" class="mt-1 text-xs text-emerald-100/90">{{ hintText }}</p>

    <!-- 目标进度条：今日已赚 / 目标日收入 -->
    <div v-if="isConfigured" class="mt-3">
      <div class="mb-1 flex items-center justify-between text-xs text-emerald-100/90">
        <span>今日进度 · 目标日收入 ¥{{ dailyAmountText }}</span>
        <span class="tabular-nums">{{ progressPercent }}%</span>
      </div>
      <div
        class="h-1.5 w-full overflow-hidden rounded-full bg-white/20"
        role="progressbar"
        :aria-valuenow="progressPercent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`今日已赚进度 ${progressPercent}%`"
      >
        <div
          class="h-full rounded-full bg-white/90 transition-all duration-500 ease-out"
          :style="{ width: `${progressPercent}%` }"
        ></div>
      </div>
    </div>

    <!-- 明细 -->
    <p v-if="isConfigured" class="mt-2 text-xs text-emerald-100/80">
      时薪 ¥{{ hourlyAmountText }} · 日薪 ¥{{ dailyAmountText }} · 每日计薪 {{ workHoursText }} ·
      计薪日 {{ workDaysSummary }}
      <template v-if="config.salaryMode === 'monthly'">
        · 月计薪 {{ config.monthWorkDays }} 天</template
      >
    </p>

    <!-- 未配置引导 -->
    <p v-if="!isConfigured" class="mt-2 text-xs text-emerald-100/80">
      填写月薪与上下班时间后，这里会逐位滚动显示「今日已赚」。
    </p>

    <!-- 免责声明（对标 PayDance 的诚实口径） -->
    <p
      class="mt-3 text-[10px] leading-relaxed text-emerald-100/60"
      data-testid="earnings-disclaimer"
    >
      {{ EARNINGS_DISCLAIMER }}
    </p>

    <!-- 设置表单 -->
    <div
      v-if="settingsOpen"
      class="mt-4 space-y-3 rounded-2xl bg-white/10 p-4 backdrop-blur-sm"
      data-testid="earnings-settings"
    >
      <!-- 薪资三模式 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-emerald-50/90">薪资模式</span>
        <div class="flex gap-1" role="group" aria-label="薪资模式">
          <BaseButton
            v-for="mode in SALARY_MODES"
            :key="mode"
            size="sm"
            :variant="config.salaryMode === mode ? 'primary' : 'secondary'"
            :data-testid="`earnings-mode-${mode}`"
            @click="setSalaryMode(mode)"
          >
            {{ SALARY_MODE_LABEL[mode] }}
          </BaseButton>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-xs text-emerald-50/90">{{ salaryLabel }}</span>
          <BaseInput v-model="salaryModel" type="number" placeholder="例如 15000" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-emerald-50/90">月计薪天数（月薪换算基准）</span>
          <BaseInput v-model="monthWorkDaysModel" type="number" placeholder="21.75" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-emerald-50/90">上班时间</span>
          <BaseInput v-model="workStartModel" type="time" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-emerald-50/90">
            下班时间<template v-if="snapshot.nightShift">（次日）</template>
          </span>
          <BaseInput v-model="workEndModel" type="time" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-emerald-50/90">午休开始（留空 = 不扣午休）</span>
          <BaseInput v-model="lunchStartModel" type="time" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-emerald-50/90">午休结束</span>
          <BaseInput v-model="lunchEndModel" type="time" />
        </label>
      </div>

      <!-- 自定义每周计薪日 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-emerald-50/90">每周计薪日</span>
        <div class="flex gap-1" role="group" aria-label="每周计薪日">
          <button
            v-for="day in WEEKDAY_ORDER"
            :key="day"
            type="button"
            class="h-7 w-7 rounded-full text-xs transition-colors"
            :class="
              config.workDays.includes(day)
                ? 'bg-white text-emerald-800'
                : 'bg-white/10 text-emerald-50/80 hover:bg-white/20'
            "
            :aria-pressed="config.workDays.includes(day)"
            :aria-label="`周${WEEKDAY_LABEL[day]}计薪`"
            :data-testid="`earnings-day-${day}`"
            @click="toggleWorkDay(day)"
          >
            {{ WEEKDAY_LABEL[day] }}
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-emerald-50/80">
          当前口径：<span class="font-semibold">{{ workDaysSummary }}</span> 计薪
          <template v-if="snapshot.nightShift">· 夜班按「次日下班」计算</template>
        </span>
        <div class="flex gap-2">
          <BaseButton size="sm" variant="secondary" @click="clearLunch">不扣午休</BaseButton>
          <BaseButton size="sm" variant="secondary" @click="restoreDefaults">恢复默认</BaseButton>
        </div>
      </div>

      <p class="text-xs text-emerald-100/80">
        金额按「{{ SALARY_MODE_LABEL[config.salaryMode] }} ÷
        每日计薪时长」换算，只在计薪时间内累计，配置自动保存在浏览器。
      </p>
    </div>
  </section>
</template>
