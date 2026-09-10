<script setup lang="ts">
/**
 * 有机体组件：天气卡片
 * - 进站自动定位，展示当前位置的天气
 * - **手动切换城市**：城市名经地理编码换 adcode（阶段三要求保留的能力），
 *   输入框 + 六个常用城市快捷键；切换成功后记为「上次的位置」
 * - 定位不可用时按「上次的位置 → 默认城市」逐级回落，并在卡片内说明原因
 * - 本地缓存：30 分钟内命中缓存不请求接口（显示「缓存」标记，可手动刷新）
 * - **未来 3 日预报条**：与实况并行请求，跟随当前城市；拿不到就不渲染，绝不影响实况卡片
 * - 未配置 API Key 时给出配置指引
 */

import { computed, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

import { CITY_ADCODE, fetchWeatherForecast } from '@/api/weather'
import { useWeather } from '@/composables/useWeather'
import type { WeatherForecast } from '@/types/weather'
import BaseButton from '@/components/atoms/BaseButton.vue'

const weatherApi = useWeather()
const {
  weather,
  state,
  error,
  configured,
  fromCache,
  locating,
  located,
  locateHint,
  placeLabel,
  init,
  locate,
  setCity,
  refresh,
  retry,
} = weatherApi

/**
 * useWeather 实例上可选的预报能力。
 * 若集成方已经在 useWeather 里加载好预报，这里直接复用，避免同一份数据请求两次；
 * 当前它只提供实况，取不到时由本组件自行请求（见 loadForecast）——两条路径对模板完全一致。
 */
const sharedForecast = (weatherApi as { forecast?: Ref<WeatherForecast | null> }).forecast

/** 本组件自己请求到的预报 */
const localForecast = ref<WeatherForecast | null>(null)

/** 预报数据源：两处只可能有一处是「活」的（见上方注释） */
const forecast = computed<WeatherForecast | null>(() =>
  sharedForecast ? sharedForecast.value : localForecast.value,
)

/**
 * 预报条最多 3 列（「未来 3 日」的口径）。
 * 高德免费档返回「当天 + 未来 3 天」共 4 条，这里只渲染前 3 条，保证一行三列不换行；
 * 数据条数不足（接口只给 2 条/测试数据）就有几条显示几条。
 */
const forecastDays = computed(() => {
  const days = forecast.value?.days
  return Array.isArray(days) ? days.slice(0, 3) : []
})

/** 当前查询目标（adcode 或城市名）：预报必须和实况查同一个城市，否则两处对不上 */
function currentTarget(): string {
  const target = (weatherApi as { query?: Ref<string> }).query
  return typeof target?.value === 'string' ? target.value.trim() : ''
}

/** 已经成功请求过的目标：免费 Key 的 QPS 很紧，同一个城市不重复请求 */
let loadedTarget = ''

/**
 * 拉取未来 3 日预报。预报是增强信息：未配置 Key / 限流 / 该地区无预报数据，
 * 都只是「不显示预报条」，绝不改 state/error —— 预报失败不能把实况卡片一起拖下水。
 */
async function loadForecast(): Promise<void> {
  if (sharedForecast) return
  const target = currentTarget()
  if (!target || target === loadedTarget) return
  try {
    localForecast.value = await fetchWeatherForecast(target)
    loadedTarget = target
  } catch {
    localForecast.value = null
  }
}

// 切换城市 / 重新定位 / 刷新后查询目标会变，预报跟着换城市
watch(currentTarget, () => void loadForecast())

/**
 * 「↻ 刷新」：实况强制刷新；预报只在还没拿到时顺带重试
 * （已经拿到就不重复占额度 —— 免费 Key 一天 5000 次，省着点用）。
 */
function onRefresh(): Promise<boolean> {
  void loadForecast()
  return refresh()
}

onMounted(() => {
  if (!configured.value) return
  // 预报与实况并行发起：预报慢或失败都不阻塞实况出内容
  void loadForecast()
  void init()
})

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 常用城市快捷键（与 api/weather 的 adcode 快查表同源，避免两处各写一份） */
const quickCities = Object.keys(CITY_ADCODE)

const cityInput = ref('')
const switching = ref(false)
/** 城市切换面板是否展开 */
const showCityPicker = ref(false)

async function onSubmitCity() {
  const name = cityInput.value.trim()
  if (!name || switching.value) return
  switching.value = true
  const ok = await setCity(name)
  switching.value = false
  if (ok) {
    cityInput.value = ''
    showCityPicker.value = false
  }
}

async function onQuickCity(name: string) {
  if (switching.value) return
  switching.value = true
  await setCity(name)
  switching.value = false
  showCityPicker.value = false
}
</script>

<template>
  <section class="card p-5" aria-label="天气">
    <header class="mb-3 flex items-center justify-between gap-2">
      <h2
        class="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200"
      >
        ☀️ 天气
        <span
          v-if="located"
          class="text-[10px] font-normal text-[var(--el-color-primary)]"
          title="当前展示的是定位到的位置"
          >📍 当前位置</span
        >
      </h2>
      <div class="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <span v-if="weather && state === 'success'">
          更新于 {{ formatTime(weather.updatedAt) }}
          <span
            v-if="fromCache"
            class="ml-1 rounded bg-slate-100 px-1 text-[10px] dark:bg-slate-700"
            title="10 分钟内命中本地缓存，未请求接口"
            >缓存</span
          >
        </span>
        <button
          v-if="configured"
          type="button"
          class="rounded px-1 transition-colors hover:text-[var(--el-color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="locating"
          title="重新定位到当前位置"
          aria-label="重新定位"
          @click="locate"
        >
          {{ locating ? '定位中…' : '📍 定位' }}
        </button>
        <button
          v-if="configured"
          type="button"
          class="rounded px-1 transition-colors hover:text-[var(--el-color-primary)]"
          aria-label="切换城市"
          title="手动切换城市"
          @click="showCityPicker = !showCityPicker"
        >
          🏙 城市
        </button>
        <button
          v-if="weather && state === 'success'"
          type="button"
          class="rounded px-1 transition-colors hover:text-[var(--el-color-primary)]"
          title="跳过缓存，重新获取"
          aria-label="刷新天气"
          @click="onRefresh"
        >
          ↻ 刷新
        </button>
      </div>
    </header>

    <!-- 手动切换城市：输入城市名（地理编码换 adcode）+ 常用城市快捷键 -->
    <div
      v-if="showCityPicker && configured"
      class="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700"
      data-testid="weather-city-picker"
    >
      <form class="flex items-center gap-1" @submit.prevent="onSubmitCity">
        <input
          v-model="cityInput"
          type="text"
          placeholder="输入城市名，如 杭州"
          aria-label="输入城市名"
          class="w-36 rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-slate-400 focus:border-[var(--el-color-primary)] dark:border-slate-600"
        />
        <BaseButton size="sm" variant="secondary" :disabled="switching" @click="onSubmitCity">
          {{ switching ? '切换中…' : '切换' }}
        </BaseButton>
      </form>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="name in quickCities"
          :key="name"
          type="button"
          class="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 transition-colors hover:border-[var(--el-color-primary-light-5)] hover:text-[var(--el-color-primary)] dark:border-slate-700 dark:text-slate-400"
          @click="onQuickCity(name)"
        >
          {{ name }}
        </button>
      </div>
    </div>

    <!-- 定位提示：成功 / 失败原因 / 回落说明 -->
    <p v-if="configured && locateHint" class="mb-2 text-xs text-slate-400 dark:text-slate-500">
      {{ locateHint }}
    </p>

    <!-- 未配置 API Key -->
    <div
      v-if="!configured"
      class="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-400 dark:border-slate-600 dark:text-slate-500"
    >
      未配置天气 API Key<br />
      <span class="text-xs"
        >请在项目根目录 <code>.env.local</code> 中设置 <code>VITE_AMAP_KEY</code> 后刷新页面。</span
      >
    </div>

    <template v-else>
      <!-- 定位 / 加载中 -->
      <div v-if="state === 'loading'" class="space-y-2" role="status" aria-busy="true">
        <p v-if="locating" class="text-xs text-slate-400 dark:text-slate-500">正在获取你的位置…</p>
        <div class="h-8 w-40 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700/50"></div>
        <div class="h-4 w-56 animate-pulse rounded bg-slate-200 dark:bg-slate-700/50"></div>
        <div class="h-4 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700/50"></div>
      </div>

      <!-- 错误 -->
      <div
        v-else-if="state === 'error'"
        class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200"
        role="alert"
      >
        <p class="mb-2">{{ error }}</p>
        <BaseButton size="sm" variant="secondary" @click="retry">重试</BaseButton>
      </div>

      <!-- 天气展示 -->
      <div v-else-if="weather" class="space-y-2">
        <div class="flex items-center gap-3">
          <span class="text-4xl leading-none" aria-hidden="true">{{ weather.icon }}</span>
          <div class="min-w-0">
            <p class="flex items-baseline gap-2">
              <span
                class="text-4xl font-bold tracking-tight tabular-nums text-slate-800 dark:text-slate-100"
                >{{ Math.round(weather.temperature) }}°C</span
              >
            </p>
            <p class="text-sm text-slate-500 dark:text-slate-400">{{ weather.description }}</p>
          </div>
        </div>
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ placeLabel }}</p>
        <div class="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span v-if="weather.feelsLike !== undefined">
            体感 {{ Math.round(weather.feelsLike) }}°C
          </span>
          <span>湿度 {{ weather.humidity }}%</span>
          <span v-if="weather.windDirection || weather.windPower">
            {{ weather.windDirection }}{{ weather.windDirection ? '风' : ''
            }}{{ weather.windPower ? ` ${weather.windPower}级` : '' }}
          </span>
          <span v-else-if="weather.windSpeed !== undefined">
            风速 {{ weather.windSpeed }} m/s
          </span>
        </div>
        <p class="text-[10px] text-slate-400 dark:text-slate-500">数据来源：高德地图</p>

        <!-- 未来 3 日预报条：拿不到预报（未配置 / 请求失败 / 无数据）整块不渲染，实况卡片照常 -->
        <div
          v-if="forecastDays.length > 0"
          class="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-slate-700/60"
          data-testid="weather-forecast"
        >
          <div
            v-for="day in forecastDays"
            :key="day.date"
            class="min-w-0 text-center"
            :data-testid="`forecast-day-${day.date}`"
          >
            <p class="text-xs text-slate-400 dark:text-slate-500">{{ day.week }}</p>
            <p class="text-base leading-tight" aria-hidden="true">{{ day.icon }}</p>
            <p class="text-xs tabular-nums text-slate-600 dark:text-slate-300">
              {{ day.dayTemp }}°/{{ day.nightTemp }}°
            </p>
            <p class="truncate text-xs text-slate-400 dark:text-slate-500" :title="day.dayWeather">
              {{ day.dayWeather }}
            </p>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
