<script setup lang="ts">
/**
 * 有机体组件：知识库侧栏（文档管理，规划 10.4）
 *
 * 这一侧回答三个问题：**后端连上了吗、库里有什么、怎么往里加东西**。
 * - 连接区：基地址可改（本机，不同步）+ 检测按钮 + 向量模型自检；
 * - 文档区：清单（来源 / 块数 / 页数 / 时间）+ 删除，删除是按来源清全部向量；
 * - 上传区：类型与大小在**前端先拦一次**（省一次白传），真正的边界仍在后端。
 */

import { computed, ref } from 'vue'

import BaseButton from '@/components/atoms/BaseButton.vue'
import { useAgentStore } from '@/stores/agentStore'
import { AGENT_LIMITS } from '@/types/agent'

const store = useAgentStore()

const fileInput = ref<HTMLInputElement | null>(null)
const confirmClear = ref(false)
const dragActive = ref(false)

const endpointDraft = ref(store.endpoint)

const acceptAttr = computed(() => AGENT_LIMITS.allowedExtensions.join(','))

const healthSummary = computed(() => {
  const health = store.health
  if (!health) return '未连接'
  return `${health.documents} 篇文档 · ${health.chunks} 块向量`
})

const modelSummary = computed(() => {
  const health = store.health
  if (!health) return ''
  const model = health.embedder_model || health.embedder
  return `${model} · 阈值 ${health.score_threshold} / ${health.lexical_score_threshold}`
})

const maxUploadMb = computed(() => Math.round(AGENT_LIMITS.maxUploadBytes / 1024 / 1024))

function formatTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pickFile() {
  fileInput.value?.click()
}

/**
 * 「检测」：把输入框里的地址写回 store 再自检。
 * 刻意抽成方法而不是写在模板里——两条语句的内联处理器会被 prettier 折成多行，
 * 而 Vue 的模板表达式解析器不接受没有分号的两条语句（渲染直接报 SyntaxError）。
 */
async function connect() {
  store.setEndpoint(endpointDraft.value ?? '')
  await store.checkHealth()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 同一个文件连传两次也要能触发 change
  if (file) await store.upload(file)
}

async function onDrop(event: DragEvent) {
  dragActive.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) await store.upload(file)
}

async function clearAll() {
  if (!confirmClear.value) {
    confirmClear.value = true
    return
  }
  confirmClear.value = false
  await store.clearKnowledge()
}
</script>

<template>
  <aside
    data-testid="knowledge-sidebar"
    class="flex w-full shrink-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 lg:w-72 dark:border-slate-700 dark:bg-slate-900/60"
  >
    <!-- 连接 -->
    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">后端连接</h2>
        <span
          data-testid="knowledge-status-dot"
          class="inline-flex items-center gap-1 text-[11px]"
          :class="store.reachable ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'"
        >
          <span
            class="h-1.5 w-1.5 rounded-full"
            :class="store.reachable ? 'bg-emerald-500' : 'bg-slate-400'"
          />
          {{ store.reachable ? '已连接' : '未连接' }}
        </span>
      </div>

      <div class="flex items-center gap-1.5">
        <input
          v-model="endpointDraft"
          data-testid="knowledge-endpoint"
          class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-transparent px-2 py-1 text-xs text-slate-600 outline-none focus:border-[var(--el-color-primary)] dark:border-slate-700 dark:text-slate-300"
          placeholder="http://127.0.0.1:8000"
          @keydown.enter="store.setEndpoint(endpointDraft)"
        />
        <BaseButton
          variant="secondary"
          size="sm"
          data-testid="knowledge-connect"
          :loading="store.checking"
          @click="connect()"
        >
          检测
        </BaseButton>
      </div>

      <p class="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        {{ healthSummary }}
        <template v-if="modelSummary"><br />{{ modelSummary }}</template>
      </p>
      <p
        v-if="store.health && !store.embedderReady"
        data-testid="knowledge-embedder-hint"
        class="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
      >
        向量模型尚未就绪（当前 {{ store.health.embedder }}）
        <button
          type="button"
          data-testid="knowledge-warmup"
          class="ml-1 underline hover:text-[var(--el-color-primary)]"
          @click="store.warmup()"
        >
          {{ store.warmingUp ? '加载中…' : '立即加载' }}
        </button>
      </p>
      <p
        v-if="store.health?.degraded_reason"
        data-testid="knowledge-degraded"
        class="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
      >
        {{ store.health.degraded_reason }}
      </p>
    </section>

    <hr class="border-slate-200 dark:border-slate-700" />

    <!-- 上传 -->
    <section class="space-y-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">上传文档</h2>
      <div
        data-testid="knowledge-dropzone"
        class="cursor-pointer rounded-xl border border-dashed px-3 py-4 text-center text-[11px] transition-colors"
        :class="
          dragActive
            ? 'border-[var(--el-color-primary)] bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary-dark-2)]'
            : 'border-slate-300 text-slate-400 dark:border-slate-600 dark:text-slate-500'
        "
        @click="pickFile"
        @dragover.prevent="dragActive = true"
        @dragleave="dragActive = false"
        @drop.prevent="onDrop"
      >
        {{ store.uploading ? '入库中…' : '点击或拖拽文件到这里' }}
        <br />
        支持 {{ AGENT_LIMITS.allowedExtensions.join(' / ') }}，单文件 ≤ {{ maxUploadMb }}MB
      </div>
      <input
        ref="fileInput"
        data-testid="knowledge-file-input"
        type="file"
        class="hidden"
        :accept="acceptAttr"
        @change="onFileChange"
      />
      <p
        v-if="store.uploadHint"
        data-testid="knowledge-upload-hint"
        class="text-[11px] text-emerald-600 dark:text-emerald-400"
      >
        {{ store.uploadHint }}
      </p>
      <p
        v-if="store.documentsError"
        data-testid="knowledge-documents-error"
        class="text-[11px] text-rose-600 dark:text-rose-400"
      >
        {{ store.documentsError }}
      </p>
    </section>

    <hr class="border-slate-200 dark:border-slate-700" />

    <!-- 文档清单 -->
    <section class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">库内文档</h2>
        <button
          type="button"
          data-testid="knowledge-refresh"
          class="text-[11px] text-slate-400 underline hover:text-[var(--el-color-primary)]"
          @click="store.refreshDocuments()"
        >
          刷新
        </button>
      </div>

      <p
        v-if="!store.documents.length"
        class="rounded-lg bg-slate-100 px-2 py-3 text-center text-[11px] text-slate-400 dark:bg-slate-800 dark:text-slate-500"
      >
        还没有文档，先上传一份（docs 里的三份样本可以直接用）
      </p>

      <ul class="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        <li
          v-for="doc in store.documents"
          :key="doc.doc_id"
          data-testid="knowledge-document"
          class="group rounded-xl border border-slate-200 px-2.5 py-2 dark:border-slate-700"
        >
          <div class="flex items-start justify-between gap-2">
            <p
              class="min-w-0 flex-1 truncate text-xs font-medium text-slate-600 dark:text-slate-300"
            >
              {{ doc.source }}
            </p>
            <button
              type="button"
              :data-testid="`knowledge-delete-${doc.doc_id}`"
              class="shrink-0 text-[11px] text-slate-400 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100 focus-visible:opacity-100"
              :aria-label="`删除 ${doc.source}`"
              @click="store.removeDocument(doc.doc_id)"
            >
              删除
            </button>
          </div>
          <p class="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            {{ doc.chunks }} 块<template v-if="doc.pages"> · {{ doc.pages }} 页</template> ·
            {{ formatTime(doc.uploaded_at) }}
          </p>
        </li>
      </ul>

      <BaseButton
        v-if="store.documents.length"
        variant="ghost"
        size="sm"
        block
        data-testid="knowledge-clear"
        @click="clearAll"
      >
        {{ confirmClear ? '再点一次确认清空' : '清空知识库' }}
      </BaseButton>
    </section>
  </aside>
</template>
