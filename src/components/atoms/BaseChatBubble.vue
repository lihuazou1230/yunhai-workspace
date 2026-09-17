<script setup lang="ts">
/**
 * 原子组件：对话气泡（纯展示）
 *
 * 为什么不用 markdown 渲染库：回答被 prompt 约束成"先结论、再依据、编号引用"的短文本，
 * 引 markdown-it + XSS 清洗只为渲染几个换行不划算。这里按纯文本 + `whitespace-pre-wrap` 渲染，
 * 需要时再把 [1] 这样的引用编号高亮出来。
 */

import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    role: 'user' | 'assistant'
    content: string
    /** 正在逐字渲染（右下角显示光标） */
    streaming?: boolean
    /** 流里收到的错误（红色提示，不弹全局 toast） */
    error?: string
    /** 空内容时的占位（等待首个 token） */
    placeholder?: string
  }>(),
  { streaming: false, error: '', placeholder: '正在检索知识库…' },
)

const isUser = computed(() => props.role === 'user')

/** 把 [1] [2][3] 这类引用编号拆出来，渲染时给它们一点主题色，方便和引用块对照 */
const segments = computed(() => {
  const parts: Array<{ text: string; cite: boolean }> = []
  const pattern = /\[(\d{1,2})\]/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(props.content)) !== null) {
    if (match.index > last)
      parts.push({ text: props.content.slice(last, match.index), cite: false })
    parts.push({ text: match[0], cite: true })
    last = match.index + match[0].length
  }
  if (last < props.content.length) parts.push({ text: props.content.slice(last), cite: false })
  return parts
})

const showPlaceholder = computed(() => !props.content && !props.error && props.streaming)
</script>

<template>
  <div class="flex w-full" :class="isUser ? 'justify-end' : 'justify-start'">
    <div
      data-testid="chat-bubble"
      :data-role="role"
      class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
      :class="
        isUser
          ? 'bg-[var(--el-color-primary)] text-white'
          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
      "
    >
      <span v-if="showPlaceholder" class="text-slate-400 dark:text-slate-500">{{
        placeholder
      }}</span>
      <template v-else>
        <template v-for="(segment, index) in segments" :key="index">
          <span
            v-if="segment.cite"
            class="font-medium"
            :class="isUser ? 'text-white/90' : 'text-[var(--el-color-primary)]'"
            >{{ segment.text }}</span
          >
          <span v-else>{{ segment.text }}</span>
        </template>
      </template>
      <span
        v-if="streaming && content"
        class="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-current align-middle"
        aria-hidden="true"
      />
      <p
        v-if="error"
        data-testid="chat-bubble-error"
        class="mt-2 rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300"
      >
        {{ error }}
      </p>
    </div>
  </div>
</template>
