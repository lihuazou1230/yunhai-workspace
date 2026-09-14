<script setup lang="ts">
/**
 * 原子组件：基础输入框（v-model + 可清空 + 回车事件）
 * 纯展示语义，不绑定业务数据
 */

const model = defineModel<string>({ default: '' })

withDefaults(
  defineProps<{
    type?: 'text' | 'date' | 'time' | 'number' | 'password' | 'search'
    placeholder?: string
    disabled?: boolean
    /** 可清空 */
    clearable?: boolean
    /** 无边框（内嵌场景） */
    bare?: boolean
    /**
     * 尺寸：默认 md（表单主输入）。
     * `sm` 给「设置面板 / 侧栏」这类高密度场景用——面板里一行有六七个字段时，
     * 32px 高的输入框能让整块在一屏内读完，40px 的会把面板撑到需要滚动。
     */
    size?: 'sm' | 'md'
    /** 追加到 input 的 class（如搜索图标留白 pl-9、在深色底上覆写填充与描边） */
    inputClass?: string
  }>(),
  {
    type: 'text',
    placeholder: '',
    disabled: false,
    clearable: false,
    bare: false,
    size: 'md',
    inputClass: '',
  },
)

const emit = defineEmits<{
  (e: 'enter', value: string): void
  (e: 'clear'): void
}>()

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Enter') emit('enter', model.value)
}

function onClear() {
  model.value = ''
  emit('clear')
}

const sizeClass: Record<'sm' | 'md', string> = {
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-3 py-2 text-sm',
}
</script>

<template>
  <div class="relative w-full">
    <input
      v-model="model"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      class="w-full rounded-xl border border-slate-300 bg-white text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[var(--el-color-primary)] focus:ring-2 focus:ring-[var(--el-color-primary-light-7)] disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-[var(--el-color-primary-dark-2)]"
      :class="[
        sizeClass[size],
        bare ? 'border-transparent bg-transparent focus:ring-0' : '',
        inputClass,
      ]"
      @keydown="onKeydown"
    />
    <button
      v-if="clearable && model.length > 0"
      type="button"
      aria-label="清空输入"
      class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      @click="onClear"
    >
      <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path
          d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm2.47 8.03a.75.75 0 1 1-1.06 1.06L8 9.06l-1.41 1.41a.75.75 0 1 1-1.06-1.06L6.94 8 5.53 6.59a.75.75 0 1 1 1.06-1.06L8 6.94l1.41-1.41a.75.75 0 1 1 1.06 1.06L9.06 8l1.41 1.53z"
        />
      </svg>
    </button>
  </div>
</template>
