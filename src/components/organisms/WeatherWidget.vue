<script setup lang="ts">
/**
 * 有机体组件：天气卡片
 * - 进站自动定位，展示当前位置的天气
 * - **手动切换城市**：城市名经地理编码换 adcode（阶段三要求保留的能力），
 *   输入框 + 六个常用城市快捷键；切换成功后记为「上次的位置」
 * - 定位不可用时按「上次的位置 → 默认城市」逐级回落，并在卡片内说明原因
 * - 本地缓存：30 分钟内命中缓存不请求接口（显示「缓存」标记，可手动刷新）
 * - 未配置 API Key 时给出配置指引
 */

import { onMounted, ref } from 'vue'

import { CITY_ADCODE } from '@/api/weather'
import { useWeather } from '@/composables/useWeather'
import BaseButton from '@/components/atoms/BaseButton.vue'

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
} = useWeather()

onMounted(() => {
  if (configured.value) void init()
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
          @click="refresh"
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
      </div>
    </template>
  </section>
</template>
