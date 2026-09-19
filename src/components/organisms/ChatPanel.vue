<script setup lang="ts">
/**
 * 有机体组件：AI 助手对话面板（规划 10.4「知识库页」，页面后更名 AI 助手）
 *
 * 三条实现要点：
 * 1. **状态全在 store**：侧栏（文档管理）与这里共享同一份 `agentStore`，
 *    文件刚入库就能问，不用手动刷新；
 * 2. **停止是真的取消**：`AbortController` 断开 fetch，后端随之停止生成——
 *    流式体验里"能停"和"能出字"一样重要；
 * 3. **依据与引用常显**：每条回答下面都标出「基于知识库 / 不基于知识库 / 拒答」，
 *    以及命中的来源块——RAG 的可信度全靠这两样撑，藏起来等于没有。
 */

import { computed, nextTick, ref, watch } from 'vue'

import BaseButton from '@/components/atoms/BaseButton.vue'
import BaseMessageGroup from '@/components/molecules/BaseMessageGroup.vue'
import { useAgentStore } from '@/stores/agentStore'
import { AGENT_FALLBACK_LABELS, AGENT_LIMITS, AGENT_MODE_LABELS } from '@/types/agent'
import type { AgentFallback, AgentRetrievalMode } from '@/types/agent'

const store = useAgentStore()

const draft = ref('')
const listRef = ref<HTMLElement | null>(null)

const MODES: AgentRetrievalMode[] = ['semantic', 'lexical']
const FALLBACKS: AgentFallback[] = ['refuse', 'bare', 'web']

/** 示例问题覆盖三类能力：查知识库、拆解建任务、查工作台数据 */
const EXAMPLES = [
  '分块默认的块长和重叠是多少？',
  '帮我把「准备前端面试」拆成可执行的步骤',
  '今天还剩哪些活？',
]

const remaining = computed(() => AGENT_LIMITS.maxQuestionLength - draft.value.length)
const canSend = computed(
  () => draft.value.trim().length > 0 && !store.streaming && remaining.value >= 0,
)

const ACTIVE_CLASS =
  'bg-[var(--el-color-primary-light-9)] font-medium text-[var(--el-color-primary-dark-2)]'
const IDLE_CLASS = 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'

async function send() {
  if (!canSend.value) return
  const question = draft.value
  draft.value = ''
  await store.ask(question)
  await scrollToBottom()
}

/** Ctrl/Cmd + Enter 发送；单独 Enter 换行（长问题要能分行写） */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    void send()
  }
}

function useExample(text: string) {
  draft.value = text
}

async function scrollToBottom() {
  await nextTick()
  const element = listRef.value
  if (element) element.scrollTop = element.scrollHeight
}

// 新消息 / 逐字输出都要跟着滚（否则长回答时用户得自己拖）
watch(
  () => [store.messages.length, store.messages.at(-1)?.content.length ?? 0],
  () => void scrollToBottom(),
)
</script>

<template>
  <section
    data-testid="chat-panel"
    class="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white/70 dark:border-slate-700 dark:bg-slate-900/60"
  >
    <!-- 顶栏：会话控制 -->
    <header
      class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-700"
    >
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">对话</h2>
        <span
          v-if="store.activeSessionId"
          class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
        >
          会话 {{ store.activeSessionId.slice(0, 6) }}
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <!-- 检索策略：语义 / 字面（对比实验用，切换即时生效） -->
        <div
          role="group"
          aria-label="检索策略"
          class="inline-flex items-center gap-1 rounded-xl bg-slate-100/70 p-0.5 dark:bg-slate-800/70"
        >
          <button
            v-for="item in MODES"
            :key="item"
            type="button"
            :data-testid="`agent-mode-${item}`"
            :aria-pressed="store.mode === item"
            class="rounded-lg px-2.5 py-1 text-[11px] transition-colors"
            :class="store.mode === item ? ACTIVE_CLASS : IDLE_CLASS"
            @click="store.setMode(item)"
          >
            {{ AGENT_MODE_LABELS[item] }}
          </button>
        </div>

        <label class="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
          兜底
          <select
            data-testid="agent-fallback"
            class="rounded-lg border border-slate-200 bg-transparent px-1.5 py-1 text-[11px] text-slate-600 outline-none dark:border-slate-700 dark:text-slate-300"
            :value="store.fallbackMode"
            @change="
              store.setFallbackMode(($event.target as HTMLSelectElement).value as AgentFallback)
            "
          >
            <option v-for="item in FALLBACKS" :key="item" :value="item">
              {{ AGENT_FALLBACK_LABELS[item] }}
            </option>
          </select>
        </label>

        <BaseButton
          variant="ghost"
          size="sm"
          data-testid="agent-new-session"
          @click="store.newSession()"
        >
          新会话
        </BaseButton>
      </div>
    </header>

    <!-- 状态提示：连不上后端 / 没配 Key，两种情况给两套不同的引导 -->
    <p
      v-if="store.connectionError"
      data-testid="chat-connection-error"
      class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
    >
      {{ store.connectionError }}
    </p>
    <p
      v-else-if="store.reachable && !store.llmConfigured"
      data-testid="chat-key-hint"
      class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
    >
      后端未配置 LLM Key：在 yunhai-agent/.env 里填 LLM_API_KEY 并重启服务；当前的「拒答」兜底不需要
      Key 也能用。
    </p>

    <!-- 消息区 -->
    <div
      ref="listRef"
      data-testid="chat-messages"
      class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
    >
      <div
        v-if="!store.hasMessages"
        class="flex h-full flex-col items-center justify-center gap-3 text-center"
      >
        <p class="text-sm text-slate-500 dark:text-slate-400">
          上传文档后就能就着它提问；库里没有的问题会直接拒答，不会编。
        </p>
        <div class="flex flex-wrap justify-center gap-1.5">
          <button
            v-for="example in EXAMPLES"
            :key="example"
            type="button"
            data-testid="chat-example"
            class="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            @click="useExample(example)"
          >
            {{ example }}
          </button>
        </div>
      </div>

      <BaseMessageGroup v-for="message in store.messages" :key="message.id" :message="message" />
    </div>

    <!-- 输入区 -->
    <footer class="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
      <div class="flex items-end gap-2">
        <textarea
          v-model="draft"
          data-testid="chat-input"
          rows="2"
          :maxlength="AGENT_LIMITS.maxQuestionLength"
          placeholder="问点什么…（Ctrl/Cmd + Enter 发送）"
          class="min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-[var(--el-color-primary)] dark:border-slate-700 dark:text-slate-200"
          @keydown="onKeydown"
        />
        <BaseButton
          v-if="store.streaming"
          variant="secondary"
          data-testid="chat-stop"
          @click="store.stop()"
        >
          停止
        </BaseButton>
        <BaseButton v-else :disabled="!canSend" data-testid="chat-send" @click="send()"
          >发送</BaseButton
        >
      </div>
      <p class="mt-1 text-right text-[11px] text-slate-400 dark:text-slate-500">
        剩余 {{ remaining }} 字
      </p>
    </footer>
  </section>
</template>
