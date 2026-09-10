<script setup lang="ts">
/**
 * 分子组件：提醒铃铛（第六阶段 6.5 的「应用内兜底」入口）
 *
 * 为什么要有它：系统通知权限可能被拒，微信推送要登录 + 配 UID，
 * 所以**应用内的可见性**才是提醒能不能被看见的底线——红点 + 下拉横幅。
 *
 * 纯展示：提醒列表与「知道了」都由父级通过 props/emit 传入传出，组件不碰 store。
 */

import { computed, ref } from 'vue'

import { onClickOutside } from '@vueuse/core'

import BaseButton from '@/components/atoms/BaseButton.vue'
import type { DueReminder } from '@/types/reminder'
import { formatReminderTime, reminderTimingText } from '@/utils/reminderSchedule'

const props = withDefaults(
  defineProps<{
    /** 待处理提醒（由 useReminder 提供） */
    reminders?: DueReminder[]
    /** 补发摘要：打开应用时错过的提醒 */
    missed?: Array<{ todoId: string; title: string; at: string }>
    /** 现在（用于「还有多久 / 已超时」文案，可注入便于测试） */
    now?: Date
  }>(),
  { reminders: () => [], missed: () => [], now: undefined },
)

const emit = defineEmits<{
  (e: 'dismiss', todoId: string): void
  (e: 'clear-missed'): void
  (e: 'open-todo', todoId: string): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const open = ref(false)

const count = computed(() => props.reminders.length)
const hasAnything = computed(() => count.value > 0 || props.missed.length > 0)

onClickOutside(rootRef, () => {
  open.value = false
})

function toggle() {
  open.value = !open.value
}

function dismiss(todoId: string) {
  emit('dismiss', todoId)
  if (props.reminders.length <= 1) open.value = false
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/60 text-slate-600 transition-colors hover:border-[var(--el-color-primary-light-5)] hover:text-[var(--el-color-primary)] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
      :aria-label="count > 0 ? `提醒（${count} 条待处理）` : '提醒'"
      :title="count > 0 ? `${count} 条待处理提醒` : '提醒'"
      aria-haspopup="dialog"
      :aria-expanded="open"
      data-testid="reminder-bell"
      @click="toggle"
    >
      <span class="text-base leading-none" aria-hidden="true">🔔</span>
      <!-- 红点：只有真有待处理提醒才出现，避免变成常亮的装饰 -->
      <span
        v-if="count > 0"
        class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white"
        data-testid="reminder-badge"
      >
        {{ count > 9 ? '9+' : count }}
      </span>
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
      role="dialog"
      aria-label="提醒列表"
      data-testid="reminder-panel"
    >
      <template v-if="!hasAnything">
        <p class="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
          没有待处理的提醒
        </p>
      </template>

      <template v-else>
        <!-- 补发摘要：打开应用时错过的小时级提醒 -->
        <div v-if="missed.length > 0" class="mb-1 rounded-lg bg-amber-50 p-2 dark:bg-amber-900/20">
          <p
            class="mb-1 flex items-center justify-between text-[11px] font-medium text-amber-700 dark:text-amber-300"
          >
            <span>你错过了 {{ missed.length }} 条提醒</span>
            <button
              type="button"
              class="text-[11px] underline-offset-2 hover:underline"
              data-testid="reminder-clear-missed"
              @click="emit('clear-missed')"
            >
              知道了
            </button>
          </p>
          <ul class="space-y-0.5">
            <li
              v-for="item in missed"
              :key="item.todoId"
              class="truncate text-xs text-amber-800 dark:text-amber-200"
            >
              · {{ item.title }}
            </li>
          </ul>
        </div>

        <!-- 待处理提醒 -->
        <ul v-if="count > 0" class="space-y-1" data-testid="reminder-list">
          <li
            v-for="reminder in reminders"
            :key="reminder.todoId"
            class="rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50"
            :data-testid="`reminder-item-${reminder.todoId}`"
          >
            <p class="truncate text-sm text-slate-700 dark:text-slate-200">
              {{ reminder.seq === 1 ? '⏰' : '🔁' }} {{ reminder.title }}
            </p>
            <p
              class="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500"
            >
              <span>{{ formatReminderTime(reminder.at) }}</span>
              <span>{{ reminderTimingText(reminder.at, now ?? new Date()) }}</span>
            </p>
            <div class="mt-1 flex gap-1">
              <BaseButton
                size="sm"
                variant="secondary"
                :data-testid="`reminder-open-${reminder.todoId}`"
                @click="emit('open-todo', reminder.todoId)"
              >
                去看
              </BaseButton>
              <BaseButton
                size="sm"
                variant="ghost"
                :data-testid="`reminder-dismiss-${reminder.todoId}`"
                @click="dismiss(reminder.todoId)"
              >
                知道了
              </BaseButton>
            </div>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>
