<script setup lang="ts">
/**
 * 原子组件：基础按钮（纯展示，发射 click）
 * 样式走 Tailwind；primary 用 `--el-color-primary` 系列 CSS 变量，
 * 因此主题色（emerald/lavender/自定义取色）一改，全站按钮立即跟随
 */

const props = withDefaults(
  defineProps<{
    /** 视觉类型 */
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
    /** 尺寸 */
    size?: 'sm' | 'md'
    disabled?: boolean
    /**
     * 加载中：左侧转圈动画 + 自动禁用（防重复提交）。
     * 文案仍由调用方提供（如「注册中…」）——只有动画和禁用是通用行为，措辞不是。
     */
    loading?: boolean
    /** 原生按钮类型 */
    nativeType?: 'button' | 'submit' | 'reset'
    /** 撑满容器 */
    block?: boolean
  }>(),
  {
    variant: 'primary',
    size: 'md',
    disabled: false,
    loading: false,
    nativeType: 'button',
    block: false,
  },
)

const emit = defineEmits<{
  (e: 'click', ev: MouseEvent): void
}>()

const variantClass: Record<NonNullable<typeof props.variant>, string> = {
  primary:
    'bg-[var(--el-color-primary)] text-white hover:bg-[var(--el-color-primary-dark-2)] active:bg-[var(--el-color-primary-dark-2)] disabled:bg-[var(--el-color-primary-light-5)]',
  secondary:
    'bg-slate-200 text-slate-700 hover:bg-slate-300 active:bg-slate-400 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600',
  danger: 'bg-rose-600 text-white hover:bg-rose-500 active:bg-rose-700 disabled:bg-rose-300',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-200/70 active:bg-slate-300/70 dark:text-slate-300 dark:hover:bg-slate-700/60',
}

const sizeClass: Record<NonNullable<typeof props.size>, string> = {
  sm: 'px-2.5 py-1 text-xs rounded-lg',
  md: 'px-4 py-2 text-sm rounded-xl',
}

function onClick(ev: MouseEvent) {
  if (props.disabled || props.loading) return
  emit('click', ev)
}
</script>

<template>
  <button
    :type="nativeType"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    class="inline-flex select-none items-center justify-center gap-1 font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--el-color-primary-light-5)] focus-visible:ring-offset-2 disabled:cursor-not-allowed"
    :class="[variantClass[variant], sizeClass[size], block ? 'w-full' : '']"
    @click="onClick"
  >
    <!-- 转圈：用当前文字色描边，天然适配 primary/secondary/ghost 各种底色 -->
    <span
      v-if="loading"
      class="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    ></span>
    <slot />
  </button>
</template>
