<script setup lang="ts">
/**
 * 有机体组件：AI 任务拆解（第六阶段 6.3）
 *
 * 交互原则：大目标 → LLM 返回 3~6 条子任务 → **预览清单可勾选、可编辑、可删减**
 * → 确认后才写入该任务的 subtasks；整体放弃不产生任何写入。
 *
 * 复用与「智能添加」同一条链路（同一套 BYOK 配置 + 可靠性三件套），
 * 只多了一条 system prompt 与一种预览 UI 变体。
 */

import { computed, ref, watch } from 'vue'

import { breakdownWithAi, AiError } from '@/api/ai'
import { useAiStore } from '@/stores/aiStore'
import { AI_SUBTASK_MAX, AI_SUBTASK_MIN } from '@/types/ai'
import type { AiSubtaskDraft } from '@/types/ai'
import type { Todo } from '@/types/todo'
import { PRIORITY_ORDER, priorityLabel } from '@/utils/priorityHelper'
import BaseButton from '@/components/atoms/BaseButton.vue'

const props = defineProps<{
  /** 是否展示弹窗 */
  modelValue: boolean
  /** 要拆解的任务（null 时不展示内容） */
  todo: Todo | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', todoId: string, titles: string[]): void
}>()

const aiStore = useAiStore()

const goal = ref('')
const loading = ref(false)
const error = ref('')
/** 预览清单：每条带「是否勾选」与可编辑标题 */
interface DraftRow extends AiSubtaskDraft {
  checked: boolean
}
const rows = ref<DraftRow[]>([])

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

// 每次打开时清空上一次的痕迹，并用任务标题预填目标。
// `immediate` 不能省：父级若一开始就是「打开」状态（例如直接挂载或恢复状态），
// 没有它就不会预填，用户会看到一个空输入框。
watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    error.value = ''
    rows.value = []
    goal.value = props.todo?.title ?? ''
  },
  { immediate: true },
)

const selectedCount = computed(() => rows.value.filter((r) => r.checked).length)

async function run() {
  const value = goal.value.trim()
  if (!value || loading.value) return

  loading.value = true
  error.value = ''
  rows.value = []
  try {
    const drafts = await breakdownWithAi(aiStore.config, value)
    rows.value = drafts.map((d) => ({ ...d, checked: true }))
  } catch (e) {
    error.value = e instanceof AiError ? e.message : 'AI 拆解失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function removeRow(index: number) {
  rows.value = rows.value.filter((_, i) => i !== index)
}

/** 改某一条的优先级（在 低→中→高 之间循环，点一下换一档） */
function cyclePriority(row: DraftRow) {
  const next = PRIORITY_ORDER[(PRIORITY_ORDER.indexOf(row.priority) + 1) % PRIORITY_ORDER.length]
  row.priority = next
}

/** 确认写入：只写勾选且标题非空的项 */
function confirm() {
  const todo = props.todo
  if (!todo) return
  const titles = rows.value
    .filter((r) => r.checked)
    .map((r) => r.title.trim())
    .filter((t) => t !== '')
  if (titles.length === 0) return

  emit('confirm', todo.id, titles)
  open.value = false
}

/** 整体放弃：不产生任何写入 */
function discard() {
  rows.value = []
  error.value = ''
  open.value = false
}

const hintText = computed(
  () => `拆出 ${AI_SUBTASK_MIN}~${AI_SUBTASK_MAX} 条可执行步骤，勾选保留、可改优先级或删除`,
)
</script>

<template>
  <el-dialog v-model="open" title="✨ AI 拆解大目标" width="560px">
    <div v-if="!aiStore.configured" class="text-sm text-slate-500 dark:text-slate-400">
      还没配置 AI API Key，去「设置 → AI 助手」填一个就能用。
    </div>

    <div v-else class="space-y-3">
      <div class="flex gap-2">
        <input
          v-model="goal"
          type="text"
          maxlength="500"
          placeholder="要拆解的大目标，例如：准备前端面试"
          aria-label="要拆解的目标"
          data-testid="ai-breakdown-goal"
          class="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[var(--el-color-primary)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          @keydown.enter.prevent="run"
        />
        <BaseButton
          variant="primary"
          :disabled="loading || !goal.trim()"
          data-testid="ai-breakdown-run"
          @click="run"
        >
          {{ loading ? '拆解中…' : '拆解' }}
        </BaseButton>
      </div>

      <p class="text-xs text-slate-400 dark:text-slate-500">{{ hintText }}</p>

      <div
        v-if="error"
        class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        role="alert"
        data-testid="ai-breakdown-error"
      >
        <p>{{ error }}</p>
        <p class="mt-1 opacity-80">也可以直接手动添加子任务，AI 只是加速器。</p>
      </div>

      <!-- 预览清单：可勾选 / 可编辑 / 可删除 -->
      <ul v-if="rows.length > 0" class="space-y-1.5" data-testid="ai-breakdown-preview">
        <li
          v-for="(row, index) in rows"
          :key="index"
          class="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-1.5 dark:border-slate-700"
        >
          <input
            v-model="row.checked"
            type="checkbox"
            class="h-4 w-4 shrink-0 accent-[var(--el-color-primary)]"
            :aria-label="`保留「${row.title}」`"
            :data-testid="`ai-breakdown-check-${index}`"
          />
          <input
            v-model="row.title"
            type="text"
            :aria-label="`编辑第 ${index + 1} 条`"
            :data-testid="`ai-breakdown-title-${index}`"
            class="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-slate-700 outline-none hover:border-slate-200 focus:border-[var(--el-color-primary)] dark:text-slate-200 dark:hover:border-slate-600"
          />
          <button
            type="button"
            class="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            :aria-label="`切换「${row.title}」优先级`"
            :data-testid="`ai-breakdown-priority-${index}`"
            @click="cyclePriority(row)"
          >
            {{ priorityLabel(row.priority) }}
          </button>
          <button
            type="button"
            class="shrink-0 px-1 text-slate-300 transition-colors hover:text-rose-500 dark:text-slate-600"
            aria-label="删除这一条"
            :data-testid="`ai-breakdown-remove-${index}`"
            @click="removeRow(index)"
          >
            ×
          </button>
        </li>
      </ul>
    </div>

    <template #footer>
      <span class="mr-auto text-xs text-slate-400 dark:text-slate-500">
        <template v-if="rows.length > 0">已选 {{ selectedCount }} / {{ rows.length }} 条</template>
      </span>
      <BaseButton variant="secondary" data-testid="ai-breakdown-discard" @click="discard">
        放弃
      </BaseButton>
      <BaseButton
        variant="primary"
        :disabled="selectedCount === 0"
        data-testid="ai-breakdown-confirm"
        @click="confirm"
      >
        写入子任务
      </BaseButton>
    </template>
  </el-dialog>
</template>
