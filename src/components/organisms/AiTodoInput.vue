<script setup lang="ts">
/**
 * 有机体组件：AI 智能添加任务（第六阶段 6.3）
 *
 * 交互原则（规划原文）：**AI 只建议、不落库**——解析结果先做成预览卡片，
 * 用户点「确认添加」才真正入库；解析失败则提示并引导回手动表单，绝不阻塞添加。
 *
 * 未配置 Key 时不渲染输入框（入口隐藏），只留一行去设置页的引导。
 */

import { computed, ref } from 'vue'

import { useAiStore } from '@/stores/aiStore'
import { parseTodoWithAi } from '@/api/ai'
import { AiError } from '@/api/ai'
import type { AiTodoDraft } from '@/types/ai'
import { AI_FALLBACK_HINT } from '@/types/ai'
import type { TodoInput } from '@/types/todo'
import { formatShortDate, isOverdue, isToday } from '@/utils/dateFormatter'
import { priorityLabel } from '@/utils/priorityHelper'
import BaseButton from '@/components/atoms/BaseButton.vue'

const emit = defineEmits<{
  (e: 'create', payload: TodoInput): void
}>()

const aiStore = useAiStore()

const text = ref('')
const loading = ref(false)
/** 解析出的草稿（非 null 时展示预览卡片） */
const draft = ref<AiTodoDraft | null>(null)
const error = ref('')

/** 例句：点一下就能试，降低「不知道该说啥」的门槛 */
const EXAMPLES = [
  '明天下午3点提醒我交周报，高优先级',
  '下周一提交季度总结',
  '有空的时候整理一下书桌',
]

function useExample(example: string) {
  text.value = example
  void parse()
}

async function parse() {
  const value = text.value.trim()
  if (!value || loading.value) return

  loading.value = true
  error.value = ''
  draft.value = null
  try {
    draft.value = await parseTodoWithAi(aiStore.config, value)
  } catch (e) {
    error.value = e instanceof AiError ? e.message : 'AI 解析失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/** 丢弃草稿（不产生任何写入） */
function discard() {
  draft.value = null
  error.value = ''
}

/** 确认入库 */
function confirm() {
  const current = draft.value
  if (!current) return
  emit('create', {
    title: current.title,
    priority: current.priority,
    dueDate: current.dueDate,
  })
  draft.value = null
  text.value = ''
  error.value = ''
}

/** 日期展示（今日到期/逾期用颜色发声，与列表口径一致） */
const dueText = computed(() => {
  const date = draft.value?.dueDate
  if (!date) return ''
  if (isToday(date)) return `今天（${formatShortDate(date)}）`
  if (isOverdue(date)) return `已过期日期（${formatShortDate(date)}）`
  return formatShortDate(date)
})
</script>

<template>
  <!-- 未配置 Key：入口隐藏，只留一行引导 -->
  <p
    v-if="!aiStore.configured"
    class="text-xs text-slate-400 dark:text-slate-500"
    data-testid="ai-todo-hint"
  >
    ✨ AI 智能添加未启用 ——
    <router-link
      :to="{ name: 'settings' }"
      class="text-[var(--el-color-primary)] underline-offset-2 hover:underline"
    >
      去设置填一个 API Key
    </router-link>
    就能用自然语言添加任务（Key 只存在你自己的浏览器里）。
  </p>

  <div v-else class="space-y-2" data-testid="ai-todo">
    <div class="flex gap-2">
      <input
        v-model="text"
        type="text"
        maxlength="500"
        placeholder="用一句话描述任务，例如：明天下午3点提醒我交周报，高优先级"
        aria-label="AI 任务描述"
        data-testid="ai-todo-input"
        class="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[var(--el-color-primary)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        @keydown.enter.prevent="parse"
      />
      <BaseButton
        variant="primary"
        :disabled="loading || !text.trim()"
        data-testid="ai-todo-parse"
        @click="parse"
      >
        {{ loading ? '解析中…' : '✨ AI 解析' }}
      </BaseButton>
    </div>

    <!-- 例句 -->
    <div v-if="!draft && !error" class="flex flex-wrap items-center gap-1.5 text-xs">
      <span class="text-slate-400 dark:text-slate-500">试试：</span>
      <button
        v-for="example in EXAMPLES"
        :key="example"
        type="button"
        class="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500 transition-colors hover:border-[var(--el-color-primary-light-5)] hover:text-[var(--el-color-primary)] dark:border-slate-700 dark:text-slate-400"
        @click="useExample(example)"
      >
        {{ example }}
      </button>
    </div>

    <!-- 预览卡片：确认后才入库 -->
    <div
      v-if="draft"
      class="rounded-xl border border-[var(--el-color-primary-light-7)] bg-[var(--el-color-primary-light-9)] p-3"
      data-testid="ai-todo-preview"
    >
      <p class="mb-1 text-[11px] font-medium text-[var(--el-color-primary-dark-2)]">
        ✨ AI 解析结果（确认后才会添加）
      </p>
      <p
        class="text-sm font-medium text-slate-800 dark:text-slate-100"
        data-testid="ai-preview-title"
      >
        {{ draft.title }}
      </p>
      <p
        class="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500 dark:text-slate-400"
      >
        <span v-if="draft.dueDate" data-testid="ai-preview-due">📅 {{ dueText }}</span>
        <span v-else>📅 未指定日期</span>
        <span data-testid="ai-preview-priority">🚩 {{ priorityLabel(draft.priority) }}优先级</span>
        <span v-if="draft.note" class="text-slate-400 dark:text-slate-500">· {{ draft.note }}</span>
      </p>
      <div class="mt-2 flex gap-2">
        <BaseButton size="sm" variant="primary" data-testid="ai-preview-confirm" @click="confirm">
          确认添加
        </BaseButton>
        <BaseButton size="sm" variant="secondary" data-testid="ai-preview-discard" @click="discard">
          放弃
        </BaseButton>
      </div>
    </div>

    <!-- 失败：说清原因并引导手动表单（不阻塞添加） -->
    <div
      v-if="error"
      class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
      role="alert"
      data-testid="ai-todo-error"
    >
      <p>{{ error }}</p>
      <p class="mt-1 opacity-80">{{ AI_FALLBACK_HINT }}</p>
    </div>
  </div>
</template>
