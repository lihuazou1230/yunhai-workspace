<script setup lang="ts">
/**
 * 有机体组件：倒计时（发薪日 + 纪念日/自定义 + 法定节假日提醒）
 *
 * - 发薪日：`距离发薪日还有 N 天`，编辑态可改「每月几号发薪」（短月自动钳到月末）
 * - 纪念日/自定义：未来在前按天数升序，今天高亮、过期变暗并标「已过去」
 * - 法定节假日：内置数据里接下来的 3 个假期（同一节日的连续放假合并成一条）；
 *   当年数据没内置就直说，不假装有数据
 * - 时钟取自 countdownStore.now（可注入），本组件只负责「跨天时把时钟往前拨」
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'

import BaseButton from '@/components/atoms/BaseButton.vue'
import { useCountdownStore } from '@/stores/countdownStore'
import { formatCountdown } from '@/utils/countdown'
import { formatShortDate, todayKey } from '@/utils/dateFormatter'
import { HOLIDAY_DATA_SOURCE, hasHolidayData, upcomingFestivals } from '@/utils/holidays'
import { isValidDateKey } from '@/utils/validation'

const store = useCountdownStore()

/** 编辑态：默认收起，避免误删/误改 */
const editMode = ref(false)

/** 当前时刻（跟随 store，仪表板 refresh() 后本卡自动重算） */
const now = computed(() => store.now)

/** 输入框统一样式（原生 input 才好在测试里直接 setValue，所以没包 BaseInput） */
const INPUT_CLASS =
  'rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[var(--el-color-primary)] focus:ring-2 focus:ring-[var(--el-color-primary-light-7)] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

// ---- 发薪日 ----
const paydayModel = computed<string | number>({
  get: () => store.paydayDay,
  set: (value) => {
    // type="number" 的 v-model 会自动套 number 修饰符：正常输入收到的是数字
    if (typeof value === 'number') {
      store.setPaydayDay(value)
      return
    }
    // 清空输入时收到空串（NaN 已被转回原字符串）：直接忽略，别把发薪日跳到 1 号
    const trimmed = value.trim()
    if (trimmed === '') return
    store.setPaydayDay(Number(trimmed))
  },
})

// ---- 新增表单 ----
const draftTitle = ref('')
const draftDate = ref('')
const draftYearly = ref(false)
const addError = ref('')

/** 切换编辑态时清掉上一次的报错，避免旧提示挂在新表单上 */
function toggleEdit() {
  editMode.value = !editMode.value
  if (!editMode.value) addError.value = ''
}

/** 列表行配色：今天高亮（主题色）> 已过去变暗 > 普通 */
function rowClass(entry: { isToday: boolean; isPast: boolean }): string {
  if (entry.isToday) {
    return 'bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)] dark:bg-slate-800'
  }
  if (entry.isPast) return 'text-slate-400 opacity-50 dark:text-slate-500'
  return 'text-slate-700 dark:text-slate-200'
}

/** 提交新增：先本地校验给出精准提示，再交给 store（store 侧还有一道同样的校验兜底） */
function submitAdd() {
  const title = draftTitle.value.trim()
  if (!title) {
    addError.value = '请填写倒计时名称'
    return
  }
  if (!isValidDateKey(draftDate.value)) {
    addError.value = '请选择有效日期'
    return
  }
  const created = store.addItem({
    title,
    date: draftDate.value,
    // 每年重复的多半是纪念日/生日，一次性的算自定义
    kind: draftYearly.value ? 'anniversary' : 'custom',
    yearly: draftYearly.value,
  })
  if (!created) {
    addError.value = '保存失败，请检查名称与日期'
    return
  }
  // 成功后清空表单，方便连着录几条
  draftTitle.value = ''
  draftDate.value = ''
  draftYearly.value = false
  addError.value = ''
}

// ---- 法定节假日 ----
const holidayYear = computed(() => now.value.getFullYear())
const holidayDataReady = computed(() => hasHolidayData(holidayYear.value))
const holidays = computed(() =>
  holidayDataReady.value ? upcomingFestivals(todayKey(now.value), 3) : [],
)

/** 假期提示：数据没有就说没有，假期过完就说已过完——不编造日期 */
const holidayNote = computed(() => {
  if (!holidayDataReady.value) {
    return `暂未内置 ${holidayYear.value} 年放假安排（每年国务院公布后更新）`
  }
  if (holidays.value.length === 0) return '今年的法定假期已全部过完'
  return ''
})

/**
 * 跨天自动刷新：只在「系统日期 ≠ store 里的日期」时才重置时钟。
 * 刻意不做秒级刷新——那会覆盖外部注入的时钟（单测、其他卡片），也让整张卡每秒重渲染。
 */
let dayTicker: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  dayTicker = setInterval(() => {
    if (todayKey(new Date()) !== todayKey(store.now)) store.refresh()
  }, 60_000)
})

onUnmounted(() => {
  if (dayTicker) clearInterval(dayTicker)
  dayTicker = null
})
</script>

<template>
  <section class="card p-5" aria-label="倒计时">
    <header class="mb-3 flex items-center justify-between gap-2">
      <h2
        class="text-sm font-semibold text-slate-500 dark:text-slate-400"
        :title="`节假日数据：${HOLIDAY_DATA_SOURCE}`"
      >
        ⏳ 倒计时
      </h2>
      <button
        type="button"
        class="rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        :aria-pressed="editMode"
        data-testid="countdown-edit-toggle"
        @click="toggleEdit"
      >
        {{ editMode ? '完成' : '编辑' }}
      </button>
    </header>

    <!-- 发薪日 -->
    <div
      class="flex flex-wrap items-baseline gap-x-2 rounded-2xl bg-[var(--el-color-primary-light-9)] px-3 py-2 dark:bg-slate-800"
    >
      <span class="text-xs text-slate-500 dark:text-slate-400">💰 发薪日</span>
      <p
        class="text-sm font-medium"
        :class="
          store.paydayDays === 0
            ? 'text-[var(--el-color-primary)]'
            : 'text-slate-700 dark:text-slate-200'
        "
        data-testid="countdown-payday"
      >
        距离发薪日还有 <span class="font-semibold tabular-nums">{{ store.paydayDays }}</span> 天
      </p>
      <span class="text-xs text-slate-400 dark:text-slate-500">
        {{ formatShortDate(store.paydayDate, now) }}
      </span>
    </div>

    <label
      v-if="editMode"
      class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
    >
      每月
      <input
        v-model="paydayModel"
        type="number"
        min="1"
        max="31"
        class="w-16 text-center"
        :class="INPUT_CLASS"
        aria-label="每月发薪日"
        data-testid="countdown-payday-input"
      />
      号发薪（1-31，短月顺延到月末）
    </label>

    <!-- 纪念日 / 自定义 -->
    <ul v-if="store.resolved.length > 0" class="mt-3 space-y-1.5">
      <li
        v-for="entry in store.resolved"
        :key="entry.item.id"
        class="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm"
        :class="rowClass(entry)"
        :data-testid="`countdown-item-${entry.item.id}`"
      >
        <span class="truncate">{{ entry.item.title }}</span>
        <span class="shrink-0 text-xs text-slate-400 dark:text-slate-500">
          {{ formatShortDate(entry.date, now) }}
        </span>
        <span
          class="ml-auto shrink-0 tabular-nums"
          :data-testid="`countdown-days-${entry.item.id}`"
        >
          {{ formatCountdown(entry.days) }}
        </span>
        <button
          v-if="editMode"
          type="button"
          class="shrink-0 rounded-full px-2 py-0.5 text-xs text-rose-500 transition-colors hover:bg-rose-50 dark:hover:bg-rose-500/10"
          :aria-label="`删除 ${entry.item.title}`"
          :data-testid="`countdown-remove-${entry.item.id}`"
          @click="store.removeItem(entry.item.id)"
        >
          删除
        </button>
      </li>
    </ul>
    <p v-else class="mt-3 text-xs text-slate-400 dark:text-slate-500" data-testid="countdown-empty">
      还没有纪念日/自定义倒计时，点右上角「编辑」添加
    </p>

    <!-- 新增表单（编辑态） -->
    <form
      v-if="editMode"
      class="mt-3 space-y-2 rounded-2xl border border-dashed border-slate-300 p-3 dark:border-slate-600"
      data-testid="countdown-add-form"
      @submit.prevent="submitAdd"
    >
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="draftTitle"
          type="text"
          placeholder="纪念日名称（如 生日）"
          class="min-w-[8rem] flex-1"
          :class="INPUT_CLASS"
          aria-label="倒计时名称"
          data-testid="countdown-add-title"
        />
        <input
          v-model="draftDate"
          type="date"
          class="flex-1"
          :class="INPUT_CLASS"
          aria-label="倒计时日期"
          data-testid="countdown-add-date"
        />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <label class="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input
            v-model="draftYearly"
            type="checkbox"
            class="h-4 w-4 accent-[var(--el-color-primary)]"
            data-testid="countdown-add-yearly"
          />
          每年重复
        </label>
        <BaseButton size="sm" native-type="submit" data-testid="countdown-add-submit">
          添加
        </BaseButton>
      </div>
      <p v-if="addError" class="text-xs text-rose-500" data-testid="countdown-add-error">
        {{ addError }}
      </p>
    </form>

    <!-- 法定节假日 -->
    <div class="mt-4 border-t border-slate-200/70 pt-3 dark:border-slate-700/60">
      <h3 class="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">🎉 法定节假日</h3>
      <ul v-if="holidays.length > 0" class="space-y-1">
        <li
          v-for="holiday in holidays"
          :key="holiday.date"
          class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
          :data-testid="`countdown-holiday-${holiday.date}`"
        >
          <span class="truncate">{{ holiday.name }}</span>
          <span class="shrink-0 text-xs text-slate-400 dark:text-slate-500">
            {{ formatShortDate(holiday.date, now) }}
          </span>
          <span
            class="ml-auto shrink-0 tabular-nums"
            :class="holiday.days === 0 ? 'text-[var(--el-color-primary)]' : ''"
          >
            {{ formatCountdown(holiday.days) }}
          </span>
        </li>
      </ul>
      <p
        v-else
        class="text-xs text-slate-400 dark:text-slate-500"
        data-testid="countdown-holiday-note"
      >
        {{ holidayNote }}
      </p>
    </div>
  </section>
</template>
