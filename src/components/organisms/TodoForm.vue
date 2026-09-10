<script setup lang="ts">
/**
 * 有机体组件：新建任务表单
 * - 标题 + 优先级 + 截止日期（复用 Base 原子组件与 validation）
 * - **标签**（第六阶段 6.1）：多选已有标签，或就地新建一个（8 色色板选色）
 * - 校验通过发射 create(TodoInput)，随后清空标题与日期
 */

import { computed, ref } from 'vue'

import type { TodoInput, TodoPriority } from '@/types/todo'
import { DEFAULT_PRIORITY } from '@/types/todo'
import { TAG_COLOR_DOT, TAG_COLOR_LABEL, TAG_COLOR_PALETTE } from '@/types/tag'
import type { TagColor } from '@/types/tag'
import { isValidDateKey, validateTodoTitle } from '@/utils/validation'
import { priorityLabel } from '@/utils/priorityHelper'
import { addDays, addMonths, formatShortDate, todayKey } from '@/utils/dateFormatter'
import { useTagStore } from '@/stores/tagStore'
import BaseButton from '@/components/atoms/BaseButton.vue'
import BaseInput from '@/components/atoms/BaseInput.vue'

const emit = defineEmits<{
  (e: 'create', payload: TodoInput): void
}>()

const tagStore = useTagStore()

const title = ref('')
const priority = ref<TodoPriority>(DEFAULT_PRIORITY)
/** 截止日期初始为真实当天 */
const dueDate = ref(todayKey())
/** 已选标签 id（多选） */
const selectedTags = ref<string[]>([])
const error = ref('')

const priorityOptions: TodoPriority[] = ['low', 'medium', 'high']

// ---- 标签 ----
const creatingTag = ref(false)
const newTagName = ref('')
const newTagColor = ref<TagColor>('sky')
const tagError = ref('')
const colorPalette = TAG_COLOR_PALETTE

const canCreateTag = computed(() => newTagName.value.trim().length > 0)

/** 切换某个标签是否选中 */
function toggleTag(id: string) {
  selectedTags.value = selectedTags.value.includes(id)
    ? selectedTags.value.filter((x) => x !== id)
    : [...selectedTags.value, id]
}

/** 就地新建标签并自动选中它 */
function createTagInline() {
  const created = tagStore.addTag({ name: newTagName.value, color: newTagColor.value })
  if (!created) {
    tagError.value = '标签名不能为空、不超过 12 字且不能重名'
    return
  }
  tagError.value = ''
  selectedTags.value = [...selectedTags.value, created.id]
  newTagName.value = ''
  creatingTag.value = false
}

function submit() {
  const check = validateTodoTitle(title.value)
  if (!check.valid) {
    error.value = check.message ?? '任务标题无效'
    return
  }
  // 截止日期若非法（如年份超长/日期不存在），拦截并提示，避免 6 位年份等畸形值进入数据流
  if (dueDate.value && !isValidDateKey(dueDate.value)) {
    error.value = '截止日期格式不正确'
    return
  }
  error.value = ''
  emit('create', {
    title: title.value.trim(),
    priority: priority.value,
    dueDate: dueDate.value || undefined,
    tags: [...selectedTags.value],
    // 只在用户真的改过时才带上这两个字段（默认策略由 dueDate 推导，不必落库）
    reminderAt: reminderOff.value ? undefined : localInputToIso(reminderLocal.value),
    reminderOff: reminderOff.value || undefined,
  })
  title.value = ''
  dueDate.value = todayKey()
  priority.value = DEFAULT_PRIORITY
  selectedTags.value = []
  reminderLocal.value = ''
  reminderOff.value = false
}

function onTitleEnter() {
  submit()
}

/** 快捷调整截止日期：在现有日期上加 N 天/周/月 */
function shiftDue(days: number, months = 0) {
  const base = dueDate.value || todayKey()
  dueDate.value = days !== 0 ? addDays(base, days) : addMonths(base, months)
}

// ---- 提醒（第六阶段 6.5：默认策略自动生成，用户可改可关） ----
/** 自定义提醒时间（datetime-local 的本地串 `YYYY-MM-DDTHH:mm`）；留空 = 走默认策略 */
const reminderLocal = ref('')
/** 关掉这条任务的提醒 */
const reminderOff = ref(false)

/** datetime-local 的本地串 -> ISO（注意不是 UTC 串，否则时区会差几个小时） */
function localInputToIso(value: string): string | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** 默认提醒时间文案：到期日当天 09:00（与 utils/reminderSchedule.ts 的口径一致） */
const defaultReminderHint = computed(() =>
  dueDate.value && isValidDateKey(dueDate.value)
    ? `默认 ${formatShortDate(dueDate.value)} 09:00`
    : '需先设置截止日期',
)

// 暴露内部状态便于单元测试驱动非法日期等场景
defineExpose({
  title,
  priority,
  dueDate,
  error,
  shiftDue,
  selectedTags,
  newTagName,
  newTagColor,
  creatingTag,
  createTagInline,
  reminderLocal,
  reminderOff,
})
</script>

<template>
  <form class="space-y-3" @submit.prevent="submit">
    <div class="flex gap-2">
      <BaseInput
        v-model="title"
        placeholder="添加新任务，回车即可…"
        input-class="flex-1"
        class="flex-1"
        @enter="onTitleEnter"
      />
      <BaseButton native-type="submit">添加</BaseButton>
    </div>

    <p v-if="error" class="text-xs text-rose-500" role="alert">{{ error }}</p>

    <div class="flex flex-wrap items-center gap-4">
      <fieldset class="flex items-center gap-1">
        <legend class="sr-only">优先级</legend>
        <BaseButton
          v-for="p in priorityOptions"
          :key="p"
          size="sm"
          :variant="priority === p ? 'primary' : 'secondary'"
          type="button"
          @click="priority = p"
        >
          {{ priorityLabel(p) }}
        </BaseButton>
      </fieldset>

      <div class="ml-auto flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span class="flex items-center gap-1">
          <BaseButton size="sm" variant="secondary" @click="shiftDue(1)">1天</BaseButton>
          <BaseButton size="sm" variant="secondary" @click="shiftDue(7)">1周</BaseButton>
          <BaseButton size="sm" variant="secondary" @click="shiftDue(0, 1)">1月</BaseButton>
        </span>
        <span>截止</span>
        <el-date-picker
          v-model="dueDate"
          type="date"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          placeholder="选择日期"
          clearable
          class="!w-40"
        />
      </div>
    </div>

    <!-- 标签：点选已有标签；没有合适的就地新建（8 色色板选色） -->
    <div class="flex flex-wrap items-center gap-2 text-xs" data-testid="todo-form-tags">
      <span class="text-slate-400 dark:text-slate-500">标签</span>

      <button
        v-for="tag in tagStore.tags"
        :key="tag.id"
        type="button"
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors"
        :class="
          selectedTags.includes(tag.id)
            ? 'border-[var(--el-color-primary)] bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary-dark-2)]'
            : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:text-slate-400'
        "
        :aria-pressed="selectedTags.includes(tag.id)"
        @click="toggleTag(tag.id)"
      >
        <span class="h-2 w-2 rounded-full" :class="TAG_COLOR_DOT[tag.color]"></span>
        {{ tag.name }}
      </button>

      <span v-if="!creatingTag">
        <BaseButton
          size="sm"
          variant="ghost"
          data-testid="todo-form-new-tag"
          @click="creatingTag = true"
        >
          + 新标签
        </BaseButton>
      </span>

      <span v-else class="flex flex-wrap items-center gap-1">
        <input
          v-model="newTagName"
          type="text"
          placeholder="标签名"
          aria-label="新标签名"
          class="w-24 rounded-md border border-slate-200 bg-transparent px-2 py-1 outline-none placeholder:text-slate-400 focus:border-[var(--el-color-primary)] dark:border-slate-600"
          @keydown.enter.prevent="createTagInline"
        />
        <button
          v-for="color in colorPalette"
          :key="color"
          type="button"
          class="h-4 w-4 rounded-full ring-offset-1 transition-all"
          :class="[TAG_COLOR_DOT[color], newTagColor === color ? 'ring-2 ring-slate-400' : '']"
          :aria-label="`选择${TAG_COLOR_LABEL[color]}色`"
          :title="TAG_COLOR_LABEL[color]"
          @click="newTagColor = color"
        />
        <BaseButton
          size="sm"
          variant="secondary"
          :disabled="!canCreateTag"
          data-testid="todo-form-create-tag"
          @click="createTagInline"
        >
          创建
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="creatingTag = false">取消</BaseButton>
      </span>
    </div>

    <p v-if="tagError" class="text-xs text-rose-500" role="alert">{{ tagError }}</p>

    <!-- 提醒：留空走默认策略（到期日 09:00），也可以指定具体时间或直接关掉 -->
    <div class="flex flex-wrap items-center gap-2 text-xs" data-testid="todo-form-reminder">
      <span class="text-slate-400 dark:text-slate-500">提醒</span>
      <input
        v-model="reminderLocal"
        type="datetime-local"
        aria-label="自定义提醒时间"
        data-testid="todo-form-reminder-at"
        :disabled="reminderOff"
        class="rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs text-slate-600 outline-none focus:border-[var(--el-color-primary)] disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
      />
      <label class="flex items-center gap-1 text-slate-500 dark:text-slate-400">
        <input
          v-model="reminderOff"
          type="checkbox"
          class="h-3.5 w-3.5 accent-[var(--el-color-primary)]"
          data-testid="todo-form-reminder-off"
        />
        不提醒
      </label>
      <span class="text-slate-400 dark:text-slate-500">
        {{ reminderOff ? '这条任务不会打扰你' : defaultReminderHint }}
      </span>
    </div>
  </form>
</template>
