<script setup lang="ts">
/**
 * 分子组件：一条消息的完整呈现（气泡 + 引用 + 依据标签 + 工具调用过程）
 *
 * 把"一条消息由哪些原子组成"收在这里，ChatPanel 只负责列表与输入框。
 * 第十一阶段的 BaseToolTag、第十三阶段的 BaseDiffCard 都挂在这一层，不用动 ChatPanel。
 */

import BaseBadge from '@/components/atoms/BaseBadge.vue'
import BaseChatBubble from '@/components/atoms/BaseChatBubble.vue'
import BaseCitationChip from '@/components/atoms/BaseCitationChip.vue'
import BaseToolTag from '@/components/atoms/BaseToolTag.vue'
import { AGENT_FALLBACK_LABELS } from '@/types/agent'
import type { AgentChatMessage } from '@/types/agent'

const props = defineProps<{ message: AgentChatMessage }>()

const fallbackTone: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  kb: 'success',
  // 工具结果也算"有依据"，但用主题色和知识库区分开：来源不同，可信度的含义也不同
  tool: 'primary',
  chat: 'info',
  refuse: 'info',
  bare: 'warning',
  web: 'warning',
  guardrail: 'warning',
}

/** 引用块只在助手消息上出现；空态也画，用来说清"这次没有来源" */
const showCitations = () => props.message.role === 'assistant' && !props.message.streaming
</script>

<template>
  <div data-testid="message-group" class="space-y-1.5" :data-role="message.role">
    <BaseChatBubble
      :role="message.role"
      :content="message.content"
      :streaming="message.streaming"
      :error="message.error"
    />

    <!-- 工具调用过程：谁在查什么、成没成，都摆出来（第十一阶段） -->
    <div v-if="message.tools?.length" class="flex flex-wrap gap-1.5 pl-1">
      <BaseToolTag
        v-for="(tool, index) in message.tools"
        :key="tool.id ?? `${tool.name}-${index}`"
        :tool="tool"
      />
    </div>

    <div v-if="showCitations()" class="flex flex-wrap items-center gap-1.5 pl-1">
      <BaseCitationChip
        v-for="citation in message.citations"
        :key="citation.index"
        :citation="citation"
      />
      <BaseCitationChip v-if="!message.citations.length" :citation="null" />
    </div>

    <div
      v-if="message.role === 'assistant' && (message.fallback || message.latencyMs !== undefined)"
      class="flex flex-wrap items-center gap-2 pl-1 text-[11px] text-slate-400 dark:text-slate-500"
    >
      <BaseBadge v-if="message.fallback" :tone="fallbackTone[message.fallback] ?? 'info'" size="xs">
        {{ AGENT_FALLBACK_LABELS[message.fallback] }}
      </BaseBadge>
      <span v-if="message.hitCount !== undefined">命中 {{ message.hitCount }} 块</span>
      <span v-if="message.latencyMs !== undefined"
        >{{ (message.latencyMs / 1000).toFixed(2) }}s</span
      >
    </div>
  </div>
</template>
