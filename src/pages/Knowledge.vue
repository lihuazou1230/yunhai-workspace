<script setup lang="ts">
/**
 * 页面：AI 助手（第十阶段 10.4 建页时叫「知识库」）
 *
 * 一屏三件事，顺序就是数据流向：
 * 1. 左栏（KnowledgeSidebar）：后端连接 + 文档入库与删除；
 * 2. 中栏历史：会话列表（点开回看当时的回答与引用）；
 * 3. 主区（ChatPanel）：流式问答，回答下面挂着引用来源块。
 *
 * 进入页面只做**两次轻请求**：/api/health 与 /api/documents；
 * 会话历史单独拉，失败也不阻塞问答（后端没起时页面仍然可用，只是会提示）。
 */

import { computed, onMounted } from 'vue'

import BaseBadge from '@/components/atoms/BaseBadge.vue'
import ChatPanel from '@/components/organisms/ChatPanel.vue'
import KnowledgeSidebar from '@/components/organisms/KnowledgeSidebar.vue'
import PageHeader from '@/components/organisms/PageHeader.vue'
import { useAgentStore } from '@/stores/agentStore'
import { AGENT_FALLBACK_LABELS } from '@/types/agent'

const store = useAgentStore()

const subtitle = computed(() => {
  const health = store.health
  if (!health) return '文档问答 + 任务操作：上传文档 → 分块入库 → 检索 → 带引用的流式回答'
  return `${health.documents} 篇文档 · ${health.chunks} 块向量 · 分块 ${health.chunk_size}/${health.chunk_overlap} · top-${health.top_k}`
})

const recentSessions = computed(() => store.sessions.slice(0, 8))

onMounted(async () => {
  const ok = await store.checkHealth()
  if (!ok) return
  await Promise.all([store.refreshDocuments(), store.loadSessions()])
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="AI 助手" :subtitle="subtitle">
      <template #actions>
        <BaseBadge v-if="store.health" :tone="store.llmConfigured ? 'success' : 'warning'">
          {{ store.llmConfigured ? store.health.llm_model : '未配置 LLM Key' }}
        </BaseBadge>
        <BaseBadge tone="info">{{ AGENT_FALLBACK_LABELS[store.fallbackMode] }}</BaseBadge>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      <KnowledgeSidebar />

      <div class="flex min-h-[520px] min-w-0 flex-1 flex-col gap-3 lg:h-[calc(100vh-13rem)]">
        <!-- 会话历史：一行 chips，点开即回到当时的对话 -->
        <div v-if="recentSessions.length" class="flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] text-slate-400 dark:text-slate-500">历史会话</span>
          <div
            v-for="session in recentSessions"
            :key="session.id"
            class="group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors"
            :class="
              store.activeSessionId === session.id
                ? 'border-[var(--el-color-primary)] bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary-dark-2)]'
                : 'border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
            "
          >
            <button
              type="button"
              :data-testid="`agent-session-${session.id}`"
              class="max-w-[160px] truncate"
              :title="session.title"
              @click="store.openSession(session.id)"
            >
              {{ session.title || '未命名会话' }}
            </button>
            <span class="text-slate-400">{{ session.message_count }}</span>
            <button
              type="button"
              :data-testid="`agent-session-delete-${session.id}`"
              class="text-slate-400 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100 focus-visible:opacity-100"
              :aria-label="`删除会话 ${session.title}`"
              @click="store.removeSession(session.id)"
            >
              ×
            </button>
          </div>
        </div>

        <ChatPanel />
      </div>
    </div>
  </div>
</template>
