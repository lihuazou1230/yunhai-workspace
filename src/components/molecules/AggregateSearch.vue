<script setup lang="ts">
/**
 * 分子组件：聚合搜索（第六阶段 6.4）
 *
 * 双通道：
 * - **任务结果**：从父级传入的命中列表里选一条 → emit `select-todo`（父级负责跳转）
 * - **网页跳转**：把关键字交给搜索引擎，新标签页打开；引擎按钮可一键轮换
 *
 * 为什么不改造 `SearchBar.vue` 而是要一个独立组件：那个是「任务页里的搜索框」，
 * 语义就是搜任务；顶栏这个才是全局入口（搜索 + 跳转 + 引擎切换）。
 * 两者混在一起做条件分支，只会让两边的用法都变复杂。
 *
 * 分子层不读 store：任务结果与关键字都由父级注入，弹层只管展示与选择。
 */

import { computed, nextTick, ref, watch } from 'vue'

import { onClickOutside, useEventListener } from '@vueuse/core'

import BaseBadge from '@/components/atoms/BaseBadge.vue'
import { SEARCH_ENGINES } from '@/types/search'
import type { SearchEngineId } from '@/types/search'
import type { Todo } from '@/types/todo'
import { buildSearchUrl, nextEngine, shouldFocusSearch } from '@/utils/searchEngine'
import { openExternal } from '@/utils/platform'
import { priorityLabel } from '@/utils/priorityHelper'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** 命中的任务（父级已按关键字筛过） */
    results?: Todo[]
    engine: SearchEngineId
    placeholder?: string
  }>(),
  { results: () => [], placeholder: '搜索任务，或直接搜索网页…' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:engine', value: SearchEngineId): void
  (e: 'select-todo', id: string): void
  (e: 'submit', value: string): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const open = ref(false)

const keyword = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})

const engineMeta = computed(() => SEARCH_ENGINES[props.engine])
const searchUrl = computed(() => buildSearchUrl(props.engine, props.modelValue))

/**
 * 有内容时才展开弹层，空关键字等于"什么都没在搜"。
 * `immediate` 不能省：从别处回到本页时关键字可能**已经**在 store 里（例如刚点过一条任务），
 * 没有它就不会展开弹层，用户会以为搜索失效了。
 */
watch(
  () => props.modelValue,
  (value) => {
    open.value = value.trim() !== ''
  },
  { immediate: true },
)

onClickOutside(rootRef, () => {
  open.value = false
})

function selectTodo(id: string) {
  open.value = false
  emit('select-todo', id)
}

/**
 * 打开搜索引擎。走统一的 `openExternal`：
 * 桌面版交给系统默认浏览器（在壳里导航会让用户「走丢」回不来），
 * 浏览器版就是普通的 window.open 新标签页。
 */
function searchWeb() {
  const url = searchUrl.value
  if (!url) return
  void openExternal(url)
  open.value = false
  emit('submit', props.modelValue.trim())
}

function cycleEngine() {
  emit('update:engine', nextEngine(props.engine))
}

/** 暴露给父级：快捷键需要把焦点打到输入框上 */
function focus() {
  inputRef.value?.focus()
  inputRef.value?.select()
}

defineExpose({ focus })

// Ctrl/Cmd+K 与 `/` 全局聚焦（`/` 在输入框里不抢，见 shouldFocusSearch）
useEventListener(window, 'keydown', (ev: KeyboardEvent) => {
  if (!shouldFocusSearch(ev)) return
  ev.preventDefault()
  void nextTick(() => focus())
})
</script>

<template>
  <div ref="rootRef" class="relative w-full" data-testid="aggregate-search">
    <div class="flex items-center gap-1.5">
      <div class="relative flex-1">
        <span
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        >
          🔍
        </span>
        <input
          ref="inputRef"
          v-model="keyword"
          type="search"
          :placeholder="placeholder"
          aria-label="聚合搜索"
          data-testid="aggregate-search-input"
          class="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[var(--el-color-primary)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          @keydown.enter.prevent="searchWeb"
          @keydown.esc="open = false"
          @focus="open = modelValue.trim() !== ''"
        />
      </div>
      <button
        type="button"
        class="shrink-0 rounded-xl border border-slate-200 px-2 py-1.5 text-xs text-slate-500 transition-colors hover:border-[var(--el-color-primary-light-5)] hover:text-[var(--el-color-primary)] dark:border-slate-700 dark:text-slate-400"
        :title="`当前引擎：${engineMeta.label}（点击切换）`"
        :aria-label="`切换搜索引擎，当前 ${engineMeta.label}`"
        data-testid="aggregate-search-engine"
        @click="cycleEngine"
      >
        {{ engineMeta.label }}
      </button>
    </div>

    <!-- 结果弹层 -->
    <div
      v-if="open"
      class="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
      role="listbox"
      data-testid="aggregate-search-panel"
    >
      <!-- 通道一：任务结果 -->
      <div class="border-b border-slate-100 p-1.5 dark:border-slate-700">
        <p class="px-2 py-1 text-[11px] text-slate-400 dark:text-slate-500">
          任务{{ results.length > 0 ? `（${results.length}）` : '' }}
        </p>
        <p v-if="results.length === 0" class="px-2 pb-1 text-xs text-slate-400 dark:text-slate-500">
          没有匹配的任务
        </p>
        <button
          v-for="todo in results"
          :key="todo.id"
          type="button"
          role="option"
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
          :data-testid="`aggregate-result-${todo.id}`"
          @click="selectTodo(todo.id)"
        >
          <span class="min-w-0 flex-1 truncate">{{ todo.title }}</span>
          <BaseBadge :tone="todo.status === 'completed' ? 'success' : 'info'" size="xs">
            {{ todo.status === 'completed' ? '已完成' : priorityLabel(todo.priority) }}
          </BaseBadge>
        </button>
      </div>

      <!-- 通道二：网页跳转 -->
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
        data-testid="aggregate-search-web"
        @click="searchWeb"
      >
        <span aria-hidden="true">🌐</span>
        <span class="min-w-0 flex-1 truncate">
          用<span class="font-medium">{{ engineMeta.label }}</span
          >搜索「{{ modelValue.trim() }}」
        </span>
        <span class="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">↵</span>
      </button>

      <p
        class="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400 dark:border-slate-700 dark:text-slate-500"
      >
        <kbd class="rounded bg-slate-100 px-1 dark:bg-slate-700">Ctrl</kbd> +
        <kbd class="rounded bg-slate-100 px-1 dark:bg-slate-700">K</kbd> 唤起 · 回车搜索网页
      </p>
    </div>
  </div>
</template>
