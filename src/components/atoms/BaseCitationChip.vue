<script setup lang="ts">
/**
 * 原子组件：引用来源块（规划 10.4 的 BaseCitationChip）
 *
 * 空态是**一等公民**：`citation` 为空时显示「无知识库来源」——
 * 这正是"库外问题"在界面上的样子，比什么都不显示更诚实。
 *
 * 引用块由后端按检索结果生成，模型不能自己编来源；这里如实展示
 * 来源文件名 + 位置（页码或块号）+ 相似度分数，点开看片段原文。
 */

import { computed, ref } from 'vue'

import type { AgentCitation } from '@/types/agent'

const props = defineProps<{ citation?: AgentCitation | null }>()

const open = ref(false)

const location = computed(() => {
  const citation = props.citation
  if (!citation) return ''
  return citation.page ? `第 ${citation.page} 页` : `第 ${citation.chunk_index + 1} 块`
})

/** 相似度用百分比更直观；两位小数够看，不至于让人以为精度真这么高 */
const scoreText = computed(() =>
  props.citation ? `${Math.round(props.citation.score * 100)}%` : '',
)
</script>

<template>
  <div
    data-testid="citation-chip"
    class="inline-flex max-w-full flex-col rounded-xl border border-slate-200 bg-white/70 text-xs dark:border-slate-700 dark:bg-slate-900/60"
  >
    <button
      type="button"
      class="flex items-center gap-2 px-2 py-1 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span
        v-if="citation"
        class="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[var(--el-color-primary)] text-[10px] font-semibold text-white"
        >{{ citation.index }}</span
      >
      <span v-if="citation" class="truncate font-medium text-slate-600 dark:text-slate-300">
        {{ citation.source }}
      </span>
      <span v-if="citation" class="shrink-0 text-slate-400 dark:text-slate-500">{{
        location
      }}</span>
      <span v-if="citation" class="shrink-0 text-slate-400 dark:text-slate-500">{{
        scoreText
      }}</span>
      <span v-else data-testid="citation-empty" class="text-slate-400 dark:text-slate-500">
        无知识库来源
      </span>
    </button>
    <p
      v-if="citation && open"
      data-testid="citation-snippet"
      class="max-w-[520px] border-t border-slate-200 px-2 py-1.5 leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400"
    >
      {{ citation.snippet }}
    </p>
  </div>
</template>
