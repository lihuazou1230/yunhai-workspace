<script setup lang="ts">
/**
 * 原子组件：Cloudflare Turnstile 人机验证 widget（显式渲染）
 *
 * 组件只做一件事：把容器交给 `useTurnstile()` 状态机，并把状态播出去。
 * - 向上：`v-model` 播一次性 token，`@status` 播状态机（父组件据此置灰注册按钮）
 * - 向下：暴露 `reset()`——**注册失败后父组件必须调它**（token 一次性，不重取必被拒）
 *
 * 三种降级都在这一层收口（父组件不用关心）：
 * - 未配置 siteKey → 不渲染 widget、不拦注册（本地开发/没申请站点时不该把注册锁死）
 * - 脚本加载失败 → 明确提示 + 「重试」，父组件同时置灰注册按钮（不放行 = 不绕过服务端校验）
 * - 脚本加载慢/验证中 → 「正在校验…」，让用户知道这里在等
 */

import { inject, onMounted, ref, watch } from 'vue'

import {
  TURNSTILE_DISABLED_HINT,
  TURNSTILE_LOADER_KEY,
  useTurnstile,
} from '@/composables/useTurnstile'
import type { TurnstileStatus } from '@/composables/useTurnstile'

const props = withDefaults(
  defineProps<{
    /** 一次性 token（v-model） */
    modelValue?: string
    /** 覆盖 siteKey（默认读环境变量；测试用） */
    siteKey?: string
    theme?: 'auto' | 'light' | 'dark'
    action?: string
  }>(),
  { modelValue: '', siteKey: undefined, theme: 'auto', action: undefined },
)

const emit = defineEmits<{
  (e: 'update:modelValue', token: string): void
  (e: 'status', status: TurnstileStatus): void
}>()

/** 测试可注入假 loader（生产走 CDN 默认加载器） */
const loader = inject(TURNSTILE_LOADER_KEY, undefined)
const containerRef = ref<HTMLElement | null>(null)

const { enabled, status, token, message, mount, reset, remount } = useTurnstile({
  siteKey: props.siteKey,
  loader,
  theme: props.theme,
  action: props.action,
})

watch(token, (next) => emit('update:modelValue', next))
watch(status, (next) => emit('status', next), { immediate: true })

onMounted(() => {
  if (containerRef.value) void mount(containerRef.value)
})

defineExpose({ reset, remount })
</script>

<template>
  <div data-testid="turnstile-captcha">
    <!-- widget 容器（未配置时为空白，不留占位洞） -->
    <div v-if="enabled" ref="containerRef" data-testid="turnstile-widget"></div>

    <p
      v-if="!enabled"
      data-testid="turnstile-disabled"
      class="text-xs text-slate-400 dark:text-slate-500"
    >
      {{ TURNSTILE_DISABLED_HINT }}
    </p>

    <!-- 加载失败 / widget 报错：给出原因 + 重试入口，注册按钮会同时置灰 -->
    <div
      v-else-if="status === 'unavailable' || status === 'error'"
      data-testid="turnstile-error"
      class="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
    >
      <p>{{ message }}</p>
      <button
        type="button"
        data-testid="turnstile-retry"
        class="mt-1.5 font-medium underline-offset-2 hover:underline"
        @click="remount"
      >
        重试
      </button>
    </div>

    <!-- token 过期：不会自动续，得让用户点一下重新验证 -->
    <div
      v-else-if="status === 'expired'"
      data-testid="turnstile-expired"
      class="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400"
    >
      <span>{{ message }}</span>
      <button
        type="button"
        data-testid="turnstile-reverify"
        class="font-medium underline-offset-2 hover:underline"
        @click="reset"
      >
        重新验证
      </button>
    </div>

    <!-- 等待中（脚本加载 + managed 模式验证通常都在 1 秒内） -->
    <p
      v-else-if="status === 'loading' || status === 'verifying'"
      data-testid="turnstile-verifying"
      class="text-xs text-slate-400 dark:text-slate-500"
    >
      正在校验人机验证…
    </p>

    <p
      v-else-if="status === 'passed'"
      data-testid="turnstile-passed"
      class="text-xs text-emerald-600 dark:text-emerald-400"
    >
      ✓ 已通过人机验证
    </p>
  </div>
</template>
