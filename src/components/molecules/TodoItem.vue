<script setup lang="ts">
/**
 * 分子组件：单个任务行（视觉规范「方案 A · 行式极简」，Todoist 风）
 *
 * 结构（严格对齐规划里的 TodoItem 样式规格）：
 * 左  完成圆圈 20px，**主操作居左**；hover 主题色边框 + 极浅主题底，勾选后主题色实底 + 白勾
 * 中  内容列 = 标题行(14px/500，已置顶时标题旁小 📌)
 *             → 元信息行(12px 小图标 + 灰字)：日期 / 优先级小旗 / 标签色点 / 子任务进度
 *             → 折叠的「+ 添加子任务」小字按钮
 * 右  操作区（置顶 / 更多 / 删除，28px 图标钮）：桌面端 hover 渐现，移动端常显
 *
 * 卡片：padding 12px 14px、rounded-xl、0.5px 边框、hover 边框加深；完成态标题划线 + 整卡 65% 透明。
 * 设计理由：列表类 UI 留白显高级、操作渐现是现代效率工具通行做法；
 * 元信息降级为小图标灰字，只有异常状态（今日到期 / 逾期）才用颜色发声。
 *
 * 拖拽、滑出动画与礼花沿用原有实现（TodoList / Todos 页依赖这些 emit）。
 */

import { computed, onMounted, ref, watch } from 'vue'

import { onClickOutside, usePreferredReducedMotion } from '@vueuse/core'

import type { Todo, TodoListView } from '@/types/todo'
import type { Tag } from '@/types/tag'
import { TAG_COLOR_DOT, TAG_COLOR_TEXT } from '@/types/tag'
import { formatDueLabel, isOverdue, isToday } from '@/utils/dateFormatter'
import { isValidDateKey } from '@/utils/validation'
import { priorityLabel } from '@/utils/priorityHelper'
import { formatReminderTime } from '@/utils/reminderSchedule'
import { POSTPONE_OPTIONS } from '@/utils/tagHelper'
import BaseButton from '@/components/atoms/BaseButton.vue'
import UiIcon from '@/components/atoms/UiIcon.vue'

const props = withDefaults(
  defineProps<{
    todo: Todo
    /** 是否展示截止日期与逾期标红 */
    showDue?: boolean
    /** 完成时是否向左滑出（进行中视图下完成任务会从列表消失；全部视图下不滑出仅礼花） */
    completeSlide?: boolean
    /** 是否为刚撤销恢复的任务（从右滑入入场动画） */
    revealFromRight?: boolean
    /** 是否为刚新建的任务（从左滑入入场动画） */
    enterFromLeft?: boolean
    /** 是否展示子任务清单 */
    showSubtasks?: boolean
    /** 是否处于多选模式（展示选择框） */
    selectable?: boolean
    /** 是否被选中（多选） */
    selected?: boolean
    /** 是否可拖拽排序 */
    draggable?: boolean
    /**
     * 该任务已解析好的标签（由父级从 tagStore 取好传进来）。
     * 分子层不直接碰全局 store，保持「纯展示 + 事件向上」的分层约定。
     */
    todoTags?: Tag[]
    /** 当前所在视图：决定操作菜单里是「归档 / 恢复」哪一组动作 */
    view?: TodoListView
    /**
     * 是否为「刚从提醒通知跳过来」的那条任务。
     * 高亮一下，否则用户到了任务页还得自己找是哪一条。
     */
    highlighted?: boolean
  }>(),
  {
    showDue: false,
    completeSlide: false,
    revealFromRight: false,
    enterFromLeft: false,
    showSubtasks: true,
    selectable: false,
    selected: false,
    draggable: false,
    todoTags: () => [],
    view: 'main',
    highlighted: false,
  },
)

const emit = defineEmits<{
  (e: 'toggle', id: string): void
  (e: 'remove', id: string): void
  (e: 'toggle-subtask', todoId: string, subtaskId: string): void
  (e: 'add-subtask', todoId: string, title: string): void
  (e: 'remove-subtask', todoId: string, subtaskId: string): void
  (e: 'toggle-pin', id: string): void
  (e: 'toggle-select', id: string): void
  (e: 'archive', id: string): void
  (e: 'unarchive', id: string): void
  (e: 'postpone', id: string, days: number): void
  (e: 'purge', id: string): void
}>()

const isDone = computed(() => props.todo.status === 'completed')
/** 截止日期是否存在且格式合法（拦截 6 位年份等畸形值） */
const hasValidDue = computed(
  () => props.showDue === true && !!props.todo.dueDate && isValidDateKey(props.todo.dueDate),
)
const overdue = computed(() => hasValidDue.value && !isDone.value && isOverdue(props.todo.dueDate!))
const dueToday = computed(() => hasValidDue.value && !isDone.value && isToday(props.todo.dueDate!))
const dueLabel = computed(() => (hasValidDue.value ? formatDueLabel(props.todo.dueDate!) : ''))
/**
 * 日期文案（元信息行）：只有异常状态才发声——
 * 逾期=红、今日到期=琥珀、其余=普通灰字。
 */
const dueText = computed(() => {
  if (!hasValidDue.value) return ''
  if (overdue.value) return `已逾期 · ${dueLabel.value}`
  if (dueToday.value) return `今日到期 · ${dueLabel.value}`
  return dueLabel.value
})
const dueClass = computed(() => {
  if (overdue.value) return 'text-rose-600 dark:text-rose-400'
  if (dueToday.value) return 'text-amber-600 dark:text-amber-400'
  return 'text-slate-400 dark:text-slate-500'
})

/** 自定义提醒时间的展示文案（解析失败就不显示，避免出现 Invalid Date） */
const customReminderText = computed(() => {
  const iso = props.todo.reminderAt
  if (!iso) return ''
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : formatReminderTime(at)
})

/** 优先级小旗：高=红 / 中=橙 / 低=灰 */ const priorityText = computed(
  () => `${priorityLabel(props.todo.priority)}优先级`,
)
const priorityClass = computed(() => {
  switch (props.todo.priority) {
    case 'high':
      return 'text-rose-500 dark:text-rose-400'
    case 'medium':
      return 'text-amber-500 dark:text-amber-400'
    case 'low':
    default:
      return 'text-slate-400 dark:text-slate-500'
  }
})

/** 动画状态：none | complete（左滑+礼花）| remove（右滑） */
type Anim = 'none' | 'complete' | 'remove'
const anim = ref<Anim>('none')
const celebrate = ref(false)

/** 从右滑入入场动画（撤销恢复） */
const revealing = ref(false)
const REVEAL_MS = 600
function reveal() {
  revealing.value = true
  setTimeout(() => {
    revealing.value = false
  }, REVEAL_MS)
}

// 撤销恢复：组件挂载时若已标记，播放一次；此后 revealFromRight 变 true 也播放
onMounted(() => {
  if (props.revealFromRight) reveal()
})
watch(
  () => props.revealFromRight,
  (val) => {
    if (val) reveal()
  },
)

/** 从左滑入入场动画（新建任务） */
const entering = ref(false)
const ENTER_MS = 600
function enter() {
  entering.value = true
  setTimeout(() => {
    entering.value = false
  }, ENTER_MS)
}

// 新建任务：挂载时若已标记，播放一次；此后 enterFromLeft 变 true 也播放
onMounted(() => {
  if (props.enterFromLeft) enter()
})
watch(
  () => props.enterFromLeft,
  (val) => {
    if (val) enter()
  },
)

/**
 * 完成：**礼花先放完，再左滑离场**。
 *
 * 时序写在 CSS 里（`.anim-slide-left` 的 keyframes），不靠 JS 串定时器：
 * 用 keyframes 前段的保持 + `fill-mode: both` 就能表达「先播礼花、保持住、再滑走」，
 * 少一处 JS 与动画时长不同步就会出现的错位。
 *
 * 为什么不是"礼花和滑动同时开始"：两者叠在一起时，卡片在礼花刚炸开的那一刻就在位移，
 * 视觉上礼花像是被"拖走"了，开心的一下变得很仓促。
 *
 * ⚠️ 减少动效（prefers-reduced-motion）下改用**淡出**替代滑动：
 * 位移是前庭敏感用户真正受不了的那一类效果，而"点完没有任何反馈"同样糟。
 * 全局样式会关掉 `.anim-slide-left` 的动画，所以这里要换一个只改 opacity 的类，
 * 并同步把等待时长降下来 —— 否则会白等 1.1s（动画没了，定时器还在跑）。
 */
const COMPLETE_MS = 1100
const FADE_MS = 260
const REMOVE_MS = 600

/** 用户是否要求减少动效（跟随系统设置，运行时会变） */
const reducedMotion = usePreferredReducedMotion()

/** 完成动画触发后延迟 emit toggle（让礼花与滑出都播完再移除该项） */
function onToggle() {
  if (anim.value !== 'none') return
  // 只有 未完成 -> 完成 才触发礼花；已完成取消勾选直接恢复
  if (!isDone.value) {
    // 减少动效下不放礼花：粒子飞散本身就是"大幅位移"，正是要避免的那类效果
    if (reducedMotion.value === 'reduce') {
      if (props.completeSlide) {
        anim.value = 'complete'
        setTimeout(() => {
          emit('toggle', props.todo.id)
          anim.value = 'none'
        }, FADE_MS)
      } else {
        emit('toggle', props.todo.id)
      }
      return
    }

    celebrate.value = true
    if (props.completeSlide) {
      // 进行中视图：这一行要给「完成」一个痛快的高光时刻，所以先爆炸再退场
      anim.value = 'complete'
      setTimeout(() => {
        emit('toggle', props.todo.id)
        anim.value = 'none'
        celebrate.value = false
      }, COMPLETE_MS)
    } else {
      // 全部视图：任务不消失，只放礼花；立刻 emit 让勾选状态即时生效
      emit('toggle', props.todo.id)
      setTimeout(() => {
        celebrate.value = false
      }, BURST_MS)
    }
  } else {
    emit('toggle', props.todo.id)
  }
}

/** 删除动画触发后延迟 emit remove */
function onRemove() {
  if (anim.value !== 'none') return
  anim.value = 'remove'
  setTimeout(() => {
    emit('remove', props.todo.id)
    anim.value = 'none'
  }, REMOVE_MS)
}

// ---- 礼花粒子参数 ----
/** 礼花总时长：CSS 里 .particle 的 duration 必须与它一致，否则 celebrate 会被提前摘掉 */
const BURST_MS = 700

const COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#a855f7', '#ec4899']

/**
 * 礼花的可读性靠三件事，而不是单纯加数量：
 * 1. **两波**：内圈 16 颗（0~30ms 出发，飞 66~96px）+ 外圈 12 颗（70~170ms 出发，飞 104~150px），
 *    一波全同刻出发会读成"一个圆环瞬间放大"，两波才有炸开的手感
 * 2. **不等大不等速**：6/8/10px 三档，duration 460~700ms —— 等大等速是"粒子系统"的塑料味来源
 * 3. **自旋**：每颗带自己的旋转角，矩形粒子翻起来才看得出是"纸屑"而不是"圆点"
 *
 * 全部只走 transform（外加 opacity），不碰布局属性，60fps 无压力；
 * 数量控制在 28 颗以内，`.popper` 又是 `pointer-events: none`，不挡任何交互。
 */
const particles = computed(() => {
  const inner = 16
  const outer = 12
  return Array.from({ length: inner + outer }, (_, i) => {
    const isOuter = i >= inner
    // 两波各自均匀分布，但外圈整体错开半个格，避免内外同角度叠成一条线
    const idx = isOuter ? i - inner : i
    const count = isOuter ? outer : inner
    const angle = (idx / count) * Math.PI * 2 + (isOuter ? Math.PI / outer : 0)
    const radius = isOuter ? 104 + (idx % 4) * 15 : 66 + (idx % 4) * 10

    return {
      key: i,
      color: COLORS[i % COLORS.length],
      tx: `${Math.round(Math.cos(angle) * radius)}px`,
      ty: `${Math.round(Math.sin(angle) * radius * 0.82)}px`,
      // 三档尺寸：外圈偏大，飞得远的粒子太小会看不见
      size: `${[6, 8, 10][i % 3]}px`,
      rotate: `${Math.round(angle * 57.3 + (i % 5) * 36)}deg`,
      delay: `${isOuter ? 70 + (idx % 5) * 25 : (idx % 3) * 15}ms`,
      duration: `${460 + (i % 4) * 80}ms`,
    }
  })
})

// ---- 子任务清单 ----
const subtaskTotal = computed(() => props.todo.subtasks.length)
const subtaskDone = computed(() => props.todo.subtasks.filter((s) => s.completed).length)
/**
 * 子任务区是否展开。
 * 规格要求「默认折叠为一行小字，不再每卡常驻」：无子任务时只露「+ 添加子任务」，
 * 点击才展开输入框；已有子任务时点击进度可展开清单核对。
 */
const expandSubtasks = ref(false)
const newSubtask = ref('')

function toggleExpandSubtask() {
  expandSubtasks.value = !expandSubtasks.value
}

function onToggleSubtask(subtaskId: string) {
  emit('toggle-subtask', props.todo.id, subtaskId)
}

function onRemoveSubtask(subtaskId: string) {
  emit('remove-subtask', props.todo.id, subtaskId)
}

function onAddSubtask() {
  const title = newSubtask.value.trim()
  if (!title) return
  emit('add-subtask', props.todo.id, title)
  newSubtask.value = ''
}

// ---- 更多操作菜单（归档 / 推后 / 恢复 / 彻底删除） ----
const menuRef = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
/** 「推后」子菜单（1 天 / 1 周 / 1 月） */
const postponeOpen = ref(false)

onClickOutside(menuRef, () => {
  menuOpen.value = false
  postponeOpen.value = false
})

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) postponeOpen.value = false
}

function onArchive() {
  menuOpen.value = false
  emit('archive', props.todo.id)
}

function onUnarchive() {
  menuOpen.value = false
  emit('unarchive', props.todo.id)
}

/**
 * 推后到期日 N 天。
 *
 * 日期计算放在 store 的纯函数里（`postponeTodo`），这里只抛「推几天」这个意图 ——
 * 组件不该知道「基准取当前 dueDate、过期要兜底到今天」这些规则。
 */
function onPostpone(days: number) {
  menuOpen.value = false
  postponeOpen.value = false
  emit('postpone', props.todo.id, days)
}

/**
 * 彻底删除：归档视图里的「真删」。
 * 仍走父级的软删除 + 撤销保护（store.removeTodo），所以这里只负责发出意图。
 */
function onPurge() {
  menuOpen.value = false
  emit('purge', props.todo.id)
}

// ---- 拖拽排序 ----
// 拖拽由父级 TodoList 的 SortableJS 实例接管（`handle: '.drag-handle'`），
// 这里只负责渲染把手，不再走原生 HTML5 DnD。
</script>

<template>
  <li
    class="item-surface group relative flex items-start gap-3 border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
    :class="[
      overdue ? 'border-rose-300 dark:border-rose-700' : '',
      isDone ? 'opacity-[0.65]' : '',
      highlighted
        ? 'border-[var(--el-color-primary)] ring-2 ring-[var(--el-color-primary)] ring-offset-1 dark:ring-offset-slate-900'
        : '',
      anim === 'complete' ? (reducedMotion === 'reduce' ? 'anim-fade-out' : 'anim-slide-left') : '',
      anim === 'remove' ? 'anim-slide-right' : '',
      revealing ? 'anim-reveal-right' : '',
      entering ? 'anim-enter-left' : '',
    ]"
    :data-highlighted="highlighted ? 'true' : undefined"
    :data-testid="`todo-item-${todo.id}`"
  >
    <!-- 拖拽把手（SortableJS 的 handle；移动端没有 hover，所以小屏常显） -->
    <span
      v-if="draggable"
      class="drag-handle mt-0.5 shrink-0 cursor-grab select-none text-slate-300 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 dark:text-slate-600"
      aria-hidden="true"
    >
      ⠿
    </span>
    <!-- 礼花（完成时爆发）：两层——粒子本体 + 一圈扩散光环，让"炸开"这件事有体积感 -->
    <span v-if="celebrate" class="popper" aria-hidden="true">
      <span class="burst-ring" />
      <span
        v-for="p in particles"
        :key="p.key"
        class="particle"
        :style="{
          '--p-color': p.color,
          '--p-tx': p.tx,
          '--p-ty': p.ty,
          '--p-size': p.size,
          '--p-rotate': p.rotate,
          '--p-duration': p.duration,
          animationDelay: p.delay,
        }"
      />
    </span>

    <!-- 多选模式的复选框（数据流由父级连接 store） -->
    <button
      v-if="selectable"
      type="button"
      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors"
      :class="
        selected
          ? 'border-[var(--el-color-primary)] bg-[var(--el-color-primary)] text-white'
          : 'border-slate-300 text-transparent hover:border-[var(--el-color-primary-light-3)] dark:border-slate-600'
      "
      :aria-label="selected ? '取消选中' : '选中'"
      @click="emit('toggle-select', todo.id)"
    >
      <svg class="h-3 w-3" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3.5 8.5l3 3 6-7"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <!-- 左：完成圆圈 20px（主操作居左） -->
    <button
      type="button"
      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
      :class="
        isDone
          ? 'border-[var(--el-color-primary)] bg-[var(--el-color-primary)] text-white'
          : 'border-slate-300 text-transparent hover:border-[var(--el-color-primary)] hover:bg-[var(--el-color-primary-light-9)] hover:text-[var(--el-color-primary)] dark:border-slate-600'
      "
      :aria-label="isDone ? '标记为未完成' : '标记为已完成'"
      @click="onToggle"
    >
      <svg class="h-3 w-3" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3.5 8.5l3 3 6-7"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <!-- 中：内容列 -->
    <div class="min-w-0 flex-1">
      <!-- 标题行（14px/500，已置顶时标题旁小 📌） -->
      <p
        class="flex items-center gap-1 truncate text-sm font-medium"
        :class="
          isDone
            ? 'text-slate-400 line-through dark:text-slate-500'
            : 'text-slate-800 dark:text-slate-100'
        "
      >
        <span v-if="todo.pinned" class="shrink-0 text-xs" title="已置顶到今日聚焦">📌</span>
        <span class="truncate">{{ todo.title }}</span>
      </p>

      <!--
        元信息行（13px 灰字）。
        一行的容量是有限的：日期/优先级/子任务/标签/提醒全挤在同一行时，
        任何一条都会被淹没。所以按「权重」分两层——第一行只放**会改变行动决策**的信息
        （何时到期、多重要），第二行放附加状态（子任务进度、标签、提醒）。
      -->
      <div class="mt-1.5 space-y-1 text-[13px] leading-5">
        <!-- 第一层：到期 + 优先级 -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            v-if="hasValidDue"
            class="inline-flex items-center gap-1.5"
            :class="dueClass"
            :title="dueText"
            data-testid="todo-due"
          >
            <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect
                x="2.5"
                y="3.5"
                width="11"
                height="10"
                rx="2"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            {{ dueText }}
          </span>

          <span
            class="inline-flex items-center gap-1.5"
            :class="priorityClass"
            :aria-label="priorityText"
            :title="priorityText"
          >
            <!--
              优先级用**旗帜的填充度**表达，而不是一个「P」字：
              「P 高优先级」既占宽度又要用户去读字母才懂，旗帜实心/空心一眼就能扫。
            -->
            <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 14V2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              <path
                d="M4 3h7.5l-1.5 2.5 1.5 2.5H4"
                :fill="todo.priority === 'high' ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ priorityText }}
          </span>
        </div>

        <!-- 第二层：子任务进度 / 标签 / 归档与提醒状态 -->
        <div
          v-if="
            subtaskTotal > 0 ||
            todoTags.length > 0 ||
            view === 'archived' ||
            todo.reminderOff ||
            todo.reminderAt
          "
          class="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400"
        >
          <button
            v-if="subtaskTotal > 0"
            type="button"
            class="inline-flex items-center gap-1 transition-colors hover:text-[var(--el-color-primary)]"
            :aria-label="expandSubtasks ? '收起子任务' : '展开子任务'"
            @click="toggleExpandSubtask"
          >
            <span
              class="text-[10px] transition-transform"
              :class="expandSubtasks ? 'rotate-90' : ''"
              >▶</span
            >
            {{ subtaskDone }}/{{ subtaskTotal }}
          </button>

          <!-- 标签：彩色小点 + 文字（Finexy 风格的「彩色小点+文字」语言） -->
          <span
            v-for="tag in todoTags"
            :key="tag.id"
            class="inline-flex items-center gap-1"
            :class="TAG_COLOR_TEXT[tag.color]"
            :title="`标签：${tag.name}`"
            :data-testid="`todo-tag-${tag.id}`"
          >
            <span class="h-2 w-2 shrink-0 rounded-full" :class="TAG_COLOR_DOT[tag.color]"></span>
            {{ tag.name }}
          </span>

          <!-- 归档状态提示（让用户知道这条为什么不在主列表） -->
          <span v-if="view === 'archived'" class="inline-flex items-center gap-1"> 📦 已归档 </span>

          <!-- 提醒状态：关掉了就明说（否则用户会以为是提醒坏了）；自定义时间才显示具体时刻 -->
          <span
            v-if="todo.reminderOff"
            class="inline-flex items-center gap-1"
            :title="'这条任务已关闭提醒'"
            data-testid="todo-reminder-off"
          >
            🔕 不提醒
          </span>
          <span
            v-else-if="todo.reminderAt"
            class="inline-flex items-center gap-1"
            :title="`自定义提醒时间：${todo.reminderAt}`"
            data-testid="todo-reminder-at"
          >
            🔔 {{ customReminderText }}
          </span>
        </div>
      </div>

      <!-- 子任务清单（默认折叠，不再每卡常驻） -->
      <div v-if="showSubtasks" class="mt-1.5 space-y-1.5">
        <!-- 进度条（有子任务时才出现） -->
        <div
          v-if="subtaskTotal > 0"
          class="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
          aria-hidden="true"
        >
          <div
            class="h-full rounded-full bg-[var(--el-color-primary)] transition-all"
            :style="{
              width: `${subtaskTotal === 0 ? 0 : Math.round((subtaskDone / subtaskTotal) * 100)}%`,
            }"
          ></div>
        </div>

        <ul v-if="expandSubtasks && subtaskTotal > 0" class="space-y-1">
          <li v-for="st in todo.subtasks" :key="st.id" class="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors"
              :class="
                st.completed
                  ? 'border-[var(--el-color-primary)] bg-[var(--el-color-primary)] text-white'
                  : 'border-slate-300 hover:border-[var(--el-color-primary)] dark:border-slate-600'
              "
              :aria-label="st.completed ? '标记子任务未完成' : '标记子任务完成'"
              @click="onToggleSubtask(st.id)"
            >
              <svg class="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M3.5 8.5l3 3 6-7"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <span
              class="flex-1 truncate"
              :class="st.completed ? 'text-slate-400 line-through dark:text-slate-500' : ''"
              >{{ st.title }}</span
            >
            <button
              type="button"
              class="text-slate-300 hover:text-rose-500 dark:text-slate-600"
              aria-label="删除子任务"
              @click="onRemoveSubtask(st.id)"
            >
              ×
            </button>
          </li>
        </ul>

        <!-- 折叠态：一行「+ 添加子任务」小字；展开后变输入框 -->
        <div class="flex items-center gap-1">
          <input
            v-if="expandSubtasks"
            v-model="newSubtask"
            type="text"
            placeholder="添加子任务，回车…"
            class="w-full max-w-xs rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-slate-400 focus:border-[var(--el-color-primary)] dark:border-slate-600"
            @keydown.enter.prevent="onAddSubtask"
          />
          <button
            v-else
            type="button"
            class="text-xs text-slate-400 transition-colors hover:text-[var(--el-color-primary)] dark:text-slate-500"
            @click="expandSubtasks = true"
          >
            + 添加子任务
          </button>
        </div>
      </div>
    </div>

    <!--
      右：操作区。
      - 图标从 16px 提到 20px（按钮 32px）：16px 在 1.6px 描边下细节糊成一团，
        而这一列是高频操作区，值得占这点宽度
      - 三个图标共用 UiIcon 的同一套笔触；置顶另有实心态（见下）；
        删除是纯轮廓线条、视觉重量最轻，单独再大一档（24px），见该按钮的注释
    -->
    <div
      class="flex shrink-0 items-center gap-1 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
    >
      <!--
        置顶按钮：**激活态同时改「形状 + 底色 + 颜色」三样**。
        之前只把 📌 的 color 从浅灰换成 amber，而 emoji 本色就是红的，
        几乎看不出变化 —— 用户点了以为没生效（实际 pinned 已落库）。
        现在：轮廓图钉 → 实心图钉 + 琥珀底 chip，远距离也能一眼分辨。
      -->
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
        :class="
          todo.pinned
            ? 'bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-400'
            : 'text-slate-400 hover:bg-slate-100 hover:text-amber-500 dark:text-slate-500 dark:hover:bg-slate-700'
        "
        :aria-label="todo.pinned ? '取消置顶' : '置顶到今日聚焦'"
        :aria-pressed="todo.pinned"
        :title="todo.pinned ? '已置顶到今日聚焦（点一下取消）' : '置顶到今日聚焦'"
        data-testid="todo-pin"
        @click="emit('toggle-pin', todo.id)"
      >
        <UiIcon name="pin" :filled="todo.pinned" size="h-5 w-5" />
      </button>

      <!--
        删除按钮：图标 **24px**，比置顶/更多那两个（20px）大一号。
        垃圾桶是纯轮廓线条，同样的外框尺寸下视觉重量明显比实心的图钉轻 ——
        等到一样大的框里，它看起来还是偏小，所以这里单独放大一档补偿。

        ⚠️ 必须写 `!p-0` 而不是 `p-0`：Tailwind 把 `padding` 的规则排在
        `padding-left/right` 之后，同一个元素上 `p-0` **打不过** BaseButton 的
        `px-2.5 py-1`。之前就是因此残留了 10px 内边距，可用宽度只剩 16px，
        把 24px 的图标压成了 16×24（形变，比尺寸偏小更难看）。
      -->
      <BaseButton
        variant="ghost"
        size="sm"
        class="h-9 w-9 !p-0"
        aria-label="删除任务"
        title="删除任务（1 分钟内可撤销）"
        data-testid="todo-remove"
        @click="onRemove"
      >
        <UiIcon name="trash" size="h-6 w-6" />
      </BaseButton>

      <!-- 更多：归档 / 推后（主列表）、恢复 / 彻底删除（归档视图） -->
      <div ref="menuRef" class="relative">
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
          :aria-label="menuOpen ? '收起更多操作' : '更多操作'"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          data-testid="todo-more"
          @click="toggleMenu"
        >
          <UiIcon name="more" size="h-5 w-5" />
        </button>

        <div
          v-if="menuOpen"
          class="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-slate-200 bg-white p-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
          role="menu"
        >
          <template v-if="view === 'archived'">
            <button
              type="button"
              role="menuitem"
              class="w-full rounded-lg px-2 py-1.5 text-left text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              data-testid="todo-unarchive"
              @click="onUnarchive"
            >
              ♻️ 恢复任务
            </button>
            <button
              type="button"
              role="menuitem"
              class="w-full rounded-lg px-2 py-1.5 text-left text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
              data-testid="todo-purge"
              @click="onPurge"
            >
              🗑 彻底删除
            </button>
          </template>

          <template v-else>
            <button
              type="button"
              role="menuitem"
              class="w-full rounded-lg px-2 py-1.5 text-left text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              data-testid="todo-archive"
              @click="onArchive"
            >
              📦 归档
            </button>
            <button
              type="button"
              role="menuitem"
              class="w-full rounded-lg px-2 py-1.5 text-left text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              data-testid="todo-postpone"
              @click="postponeOpen = !postponeOpen"
            >
              ⏩ 推后到期日
            </button>

            <!--
              推后子菜单：1 天 / 1 周 / 1 月，与「新建任务」表单里的快捷键一致。
              只给天数，具体日期由 store 的 postponeTodo 按「当前 dueDate + N 天」算 ——
              组件不重复实现日期规则（也不需要在菜单里预告日期，那会引入第二次实现）。
            -->
            <div
              v-if="postponeOpen"
              class="mt-0.5 space-y-0.5 border-t border-slate-100 pt-1 dark:border-slate-700"
            >
              <button
                v-for="opt in POSTPONE_OPTIONS"
                :key="opt.key"
                type="button"
                role="menuitem"
                class="w-full rounded-lg px-2 py-1 text-left text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                :data-testid="`todo-postpone-${opt.key}`"
                @click="onPostpone(opt.days)"
              >
                推后 {{ opt.label }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </li>
</template>

<style scoped>
/* 拖拽把手 */
.drag-handle {
  cursor: grab;
}
.drag-handle:active {
  cursor: grabbing;
}

/*
  完成：**先放礼花，再左滑离场**。

  用一条 keyframes 表达完整时序，而不是 JS 串两个定时器：
  `animation-fill-mode: both` + keyframes 前段的 `transform: translateX(0)` 保持，
  让位移推迟到礼花播完之后；延迟期间卡片纹丝不动。
  （必须是 `both`：只写 `forwards` 的话，延迟期间会退回"无动画"状态，位移会闪一下。）

  保持段取 **68%**（≈0.75s）而不是更早：实测 62% 时缓动曲线已经起步，
  520ms 处就出现了 -22px 的位移 —— 数值不大，但礼花最舒展的那一刻卡片已经在挪，
  读起来还是"被拖走"。0.75s 之后礼花末段基本透明，再滑走就不抢戏了。
*/
.anim-slide-left {
  animation: burst-then-slide-left 1.1s cubic-bezier(0.4, 0, 0.2, 1) both;
}
@keyframes burst-then-slide-left {
  0%,
  68% {
    transform: translateX(0);
    opacity: 1;
  }
  100% {
    transform: translateX(-120%);
    opacity: 0;
  }
}

/*
  减少动效下的完成反馈：**只淡出，不位移**。
  它替代 `.anim-slide-left`（全局 reduced-motion 规则会关掉滑动的动画），
  让「这条完成了」有可见的收尾。全局样式会把动画压到 0.01ms，
  所以 custom.css 里对 `.anim-fade-out` 有一条把它恢复成 0.25s 的例外
  —— 只改 opacity 的动画本来就不属于"要避免的位移类效果"。
*/
.anim-fade-out {
  animation: fade-out 0.25s ease-out forwards;
}
@keyframes fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

/* 删除：向右滑出 + 渐隐 */
.anim-slide-right {
  animation: slide-out-right 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes slide-out-right {
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(120%);
    opacity: 0;
  }
}

/* 撤销恢复：从右滑入 */
.anim-reveal-right {
  animation: reveal-right 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes reveal-right {
  from {
    transform: translateX(120%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* 新建任务：从左滑入 */
.anim-enter-left {
  animation: enter-left 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes enter-left {
  from {
    transform: translateX(-120%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* ---- 礼花 ---- */

/*
  容器锚在这一行的中心：`li` 本身没有 position（避免影响既有层叠），
  所以这里是绝对定位 + 自居中（left/top 50% + 位移 -50%），粒子再相对它飞出去。
  用 -50% 而不是 `translate(-50%,-50%)`：后者会和粒子自身的 transform 抢同一个属性。
*/
.popper {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  margin-left: 0;
  margin-top: 0;
  pointer-events: none;
  z-index: 5;
}

/*
  扩散光环：一圈从 0 涨到 ~150px 并淡出的背景色圆环。
  它给"炸开"一个体积感——只有粒子的话，快速扫一眼容易只看到几个零星的点。
*/
.burst-ring {
  position: absolute;
  left: 0;
  top: 0;
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  border-radius: 9999px;
  border: 2px solid var(--el-color-primary);
  opacity: 0;
  animation: burst-ring 0.5s cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
}
@keyframes burst-ring {
  0% {
    transform: scale(0.3);
    opacity: 0.75;
  }
  100% {
    transform: scale(5.4);
    opacity: 0;
  }
}

/*
  粒子：矩形小纸屑（不再是纯圆点），自旋着飞出去。
  尺寸/位移/旋转/时长都由内联 CSS 变量驱动 —— 参数在 JS 里算，
  这里只负责"怎么动"，两边职责分开。
*/
.particle {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--p-size, 8px);
  height: var(--p-size, 8px);
  margin-top: -4px;
  margin-left: -4px;
  border-radius: 2px;
  background: var(--p-color);
  will-change: transform, opacity;
  animation: burst var(--p-duration, 0.6s) cubic-bezier(0.18, 0.72, 0.28, 1) forwards;
}
@keyframes burst {
  0% {
    transform: translate3d(0, 0, 0) rotate(0deg) scale(0.4);
    opacity: 1;
  }
  /* 先"弹"出来：20% 处略微过冲，再漂移减速，比线性飞散更有生命感 */
  20% {
    transform: translate3d(calc(var(--p-tx) * 0.34), calc(var(--p-ty) * 0.34), 0)
      rotate(calc(var(--p-rotate) * 0.3)) scale(1.12);
    opacity: 1;
  }
  100% {
    transform: translate3d(var(--p-tx), var(--p-ty), 0) rotate(var(--p-rotate)) scale(0.35);
    opacity: 0;
  }
}

/* 尊重「减少动效」：粒子不飞、光环不涨，只留一个瞬时的完成反馈 */
@media (prefers-reduced-motion: reduce) {
  .particle,
  .burst-ring {
    animation: none;
    opacity: 0;
  }
}
</style>
