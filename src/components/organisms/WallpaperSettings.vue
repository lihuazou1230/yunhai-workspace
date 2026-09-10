<script setup lang="ts">
/**
 * 有机体组件：壁纸设置（第六阶段 6.4）
 *
 * 三种来源，覆盖「想换换样子」的全部常见诉求：
 * - 纯色 / 渐变：预设即点即用，几乎零成本
 * - 本地上传：走 IndexedDB 存 blob（与头像同一套方案，绝不 base64 塞 localStorage）
 *
 * 每日一图（Bing）刻意留在候选池里没做：那需要一个代理转发，
 * 而本项目的服务端能力统一收口在 Supabase，不值得为一张背景图单开一条链路。
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'

import BaseButton from '@/components/atoms/BaseButton.vue'
import { useWallpaperStore } from '@/stores/wallpaperStore'
import { GRADIENT_PRESETS, SOLID_PRESETS } from '@/utils/wallpaper'

const store = useWallpaperStore()

const fileInputRef = ref<HTMLInputElement | null>(null)
const fileError = ref('')
const saving = ref(false)

onMounted(() => {
  void store.init()
})
onUnmounted(() => {
  store.dispose()
})

const activeLabel = computed(() => {
  switch (store.config.kind) {
    case 'solid':
      return '纯色'
    case 'gradient':
      return '渐变'
    case 'image':
      return '本地上传'
    default:
      return '未启用'
  }
})

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  saving.value = true
  fileError.value = ''
  const result = await store.saveImage(file)
  saving.value = false
  if (!result.ok) fileError.value = result.error

  // 清空 input，否则选同一个文件不会再触发 change
  input.value = ''
}

function pickFile() {
  fileInputRef.value?.click()
}
</script>

<template>
  <div class="space-y-4" data-testid="wallpaper-settings">
    <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span
        >当前：<span class="font-medium">{{ activeLabel }}</span></span
      >
      <BaseButton
        v-if="store.isActive"
        size="sm"
        variant="secondary"
        data-testid="wallpaper-clear"
        @click="store.clear()"
      >
        恢复默认背景
      </BaseButton>
    </div>

    <!-- 纯色 -->
    <div>
      <p class="mb-1.5 text-xs text-slate-500 dark:text-slate-400">纯色</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="preset in SOLID_PRESETS"
          :key="preset.value"
          type="button"
          class="h-7 w-7 rounded-lg border transition-transform hover:scale-110"
          :class="
            store.config.kind === 'solid' && store.config.color === preset.value
              ? 'border-[var(--el-color-primary)] ring-2 ring-[var(--el-color-primary-light-7)]'
              : 'border-slate-200 dark:border-slate-600'
          "
          :style="{ backgroundColor: preset.value }"
          :title="preset.label"
          :aria-label="`纯色背景：${preset.label}`"
          :data-testid="`wallpaper-solid-${preset.value.replace('#', '')}`"
          @click="store.setSolid(preset.value)"
        />
      </div>
    </div>

    <!-- 渐变 -->
    <div>
      <p class="mb-1.5 text-xs text-slate-500 dark:text-slate-400">渐变</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="(preset, index) in GRADIENT_PRESETS"
          :key="preset.value"
          type="button"
          class="h-9 w-14 rounded-lg border transition-transform hover:scale-105"
          :class="
            store.config.kind === 'gradient' && store.config.gradient === preset.value
              ? 'border-[var(--el-color-primary)] ring-2 ring-[var(--el-color-primary-light-7)]'
              : 'border-slate-200 dark:border-slate-600'
          "
          :style="{ backgroundImage: preset.value }"
          :title="preset.label"
          :aria-label="`渐变背景：${preset.label}`"
          :data-testid="`wallpaper-gradient-${index}`"
          @click="store.setGradient(preset.value)"
        />
      </div>
    </div>

    <!-- 本地上传 -->
    <div>
      <p class="mb-1.5 text-xs text-slate-500 dark:text-slate-400">
        自定义图片（jpg / png / webp / avif，≤ 8MB）
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <input
          ref="fileInputRef"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          class="hidden"
          data-testid="wallpaper-file-input"
          @change="onFileChange"
        />
        <BaseButton size="sm" variant="secondary" :disabled="saving" @click="pickFile">
          {{ saving ? '处理中…' : '选择图片' }}
        </BaseButton>
        <img
          v-if="store.config.kind === 'image' && store.imageUrl"
          :src="store.imageUrl"
          alt="当前壁纸预览"
          class="h-10 w-16 rounded-lg border border-slate-200 object-cover dark:border-slate-600"
          data-testid="wallpaper-preview"
        />
        <BaseButton
          v-if="store.config.kind === 'image'"
          size="sm"
          variant="danger"
          data-testid="wallpaper-remove-image"
          @click="store.removeImage()"
        >
          移除图片
        </BaseButton>
      </div>
      <p
        v-if="fileError"
        class="mt-1 text-xs text-rose-500"
        role="alert"
        data-testid="wallpaper-error"
      >
        {{ fileError }}
      </p>
    </div>
  </div>
</template>
