<script setup lang="ts">
/**
 * 原子组件：工具调用标签（规划 11.1 的 BaseToolTag）
 *
 * 为什么要让用户看见这一步：agent 的回答是"思考 + 调工具"拼出来的，
 * 只给最终答案，用户无法判断它是查了知识库、读了本地任务，还是纯凭记忆瞎答。
 * 所以每个工具调用都留一个小标签：干了什么（中文标签）、结果如何（状态点 + 一行摘要）、
 * 参数与完整结果（点开看）。
 *
 * 与 BaseCitationChip 同一套视觉：rounded-xl + 极小的字 + dark: 变体，
 * 让"引用块"和"工具块"看起来是同一种东西——都是回答的依据。
 */

import { computed, ref } from 'vue'

import { agentToolLabel } from '@/types/agent'
import type { AgentToolCall } from '@/types/agent'

const props = defineProps<{ tool: AgentToolCall }>()

const open = ref(false)

/**
 * 状态点配色。
 * 没有 status 的多半是早期会话里的记录（那时只有工具名），给个中性灰——
 * 显示成"运行中"会让人以为它还在跑。
 */
const DOT_CLASS: Record<string, string> = {
  running: 'animate-pulse bg-[var(--el-color-primary)]',
  ok: 'bg-emerald-500',
  error: 'bg-rose-500',
  awaiting_client: 'bg-amber-500',
  unknown: 'bg-slate-300 dark:bg-slate-600',
}

const dotClass = computed(() => DOT_CLASS[props.tool.status ?? 'unknown'] ?? DOT_CLASS.unknown)

const label = computed(() => agentToolLabel(props.tool.name))

/** 参数压成一行（展开后才格式化）；没有参数就是空串 */
const argsText = computed(() => {
  const args = props.tool.arguments
  if (!args || Object.keys(args).length === 0) return ''
  return JSON.stringify(args)
})

const argsPretty = computed(() => {
  const args = props.tool.arguments
  if (!args || Object.keys(args).length === 0) return ''
  return JSON.stringify(args, null, 2)
})

/** 结果文本：字符串原样，其它结构格式化（后端把结构化结果放在 meta 里） */
const resultText = computed(() => {
  const result = props.tool.result
  if (result === undefined || result === null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
})

/** 一行摘要的优先级：执行结果 > 失败原因 > 状态占位 > 参数 */
const summary = computed(() => {
  if (props.tool.summary) return props.tool.summary
  if (props.tool.error) return props.tool.error
  if (props.tool.status === 'awaiting_client') return '等待前端执行…'
  if (props.tool.status === 'running') return '执行中…'
  return argsText.value || '（无参数）'
})

const hasDetail = computed(() => !!(argsPretty.value || resultText.value || props.tool.error))

/** 悬停提示：参数与完整结果，不想展开的人也能一眼看到 */
const titleText = computed(() => {
  const parts = [`${label.value}（${props.tool.name}）`]
  if (argsPretty.value) parts.push(`参数：${argsPretty.value}`)
  if (props.tool.summary) parts.push(`结果：${props.tool.summary}`)
  if (props.tool.error) parts.push(`错误：${props.tool.error}`)
  return parts.join('\n')
})
</script>

<template>
  <div
    data-testid="tool-tag"
    :data-tool="tool.name"
    :data-status="tool.status ?? 'unknown'"
    :title="titleText"
    class="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-white/70 text-xs dark:border-slate-700 dark:bg-slate-900/60"
  >
    <button
      type="button"
      class="flex max-w-full items-center gap-2 px-2 py-1 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span
        data-testid="tool-tag-dot"
        class="h-1.5 w-1.5 shrink-0 rounded-full"
        :class="dotClass"
        aria-hidden="true"
      />
      <span class="shrink-0 font-medium text-slate-600 dark:text-slate-300">{{ label }}</span>
      <span class="truncate text-slate-400 dark:text-slate-500">{{ summary }}</span>
    </button>

    <div
      v-if="open && hasDetail"
      data-testid="tool-tag-detail"
      class="max-w-[520px] space-y-1 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700"
    >
      <pre
        v-if="argsPretty"
        data-testid="tool-tag-args"
        class="overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
        >{{ argsPretty }}</pre>
      <p
        v-if="tool.summary"
        data-testid="tool-tag-summary"
        class="leading-relaxed text-slate-500 dark:text-slate-400"
      >
        {{ tool.summary }}
      </p>
      <pre
        v-if="resultText"
        data-testid="tool-tag-result"
        class="overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
        >{{ resultText }}</pre>
      <p
        v-if="tool.error"
        data-testid="tool-tag-error"
        class="leading-relaxed text-rose-600 dark:text-rose-300"
      >
        {{ tool.error }}
      </p>
    </div>
  </div>
</template>
