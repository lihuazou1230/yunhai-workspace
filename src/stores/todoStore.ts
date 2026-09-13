import { computed, ref, watch } from 'vue'

import { defineStore } from 'pinia'

import { deleteRemoteTodos, fetchRemoteTodos, pushRemoteTodos } from '@/api/todoRemote'
import { describeAuthError } from '@/api/auth'
import { useLocalStorage } from '@/composables/useLocalStorage'
import { filterTodos, sortTodos } from '@/composables/useTodoFilter'
import { todayKey } from '@/utils/dateFormatter'
import {
  applyDiff,
  decideLocalCache,
  diffFromQueue,
  diffTodos,
  enqueueOperations,
  isOnline,
  mergeTodos,
  migrationKey,
  snapshotTodos,
} from '@/utils/todoSync'
import type { CacheOwner, SyncOperation, SyncState } from '@/utils/todoSync'
import type {
  PendingDelete,
  PrioritySelection,
  Subtask,
  Todo,
  TodoFilter,
  TodoInput,
  TodoListView,
  TodoPriority,
} from '@/types/todo'
import { UNDO_DELETE_TIMEOUT } from '@/types/todo'
import {
  archiveTodo,
  isSnoozed,
  snoozeTodo,
  stripTagFromTodos,
  unarchiveTodo,
  unsnoozeTodo,
} from '@/utils/tagHelper'
import { normalizeTodos } from '@/utils/todoNormalize'

export const TODO_STORAGE_KEY = 'smart-workspace:todos'

/** 离线操作队列（持久化：刷新页面不丢，等待补发） */
export const SYNC_QUEUE_KEY = 'smart-workspace:sync-queue'

/** 本地任务缓存的主人（某个 userId / 'guest' / null），用于防止跨账号串数据 */
export const SYNC_OWNER_KEY = 'smart-workspace:todos-owner'

function createId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const useTodoStore = defineStore('todo', () => {
  // ---- 持久化状态 ----
  /**
   * 完整任务列表；软删除期间不落盘，真正删除（commitDelete）才写入。
   *
   * 第 4 个参数是**归一化**：存储里的值不可信（手改过、或来自只含 6 个字段的旧版本），
   * 而下面 `liveTodos` 直接 `.filter(...)` —— 少了它，一条 `'{"a":1}'` 就能让任务页白屏。
   */
  const todos = useLocalStorage<Todo[]>(TODO_STORAGE_KEY, [], undefined, normalizeTodos)

  // ---- 运行时状态（不持久化） ----
  /** 当前筛选视图（默认进行中；运行时，进入页面即重置为进行中） */
  const filter = ref<TodoFilter>('active')
  /** 已选中的优先级（多选；空数组 = 全部） */
  const priority = ref<PrioritySelection>([])
  /** 搜索关键字 */
  const keyword = ref('')
  /** `filter === 'date'` 时要看的日期键（迷你月历点某天跳过来） */
  const filterDate = ref<string | null>(null)
  /**
   * 「今天」的**响应式副本**。
   *
   * 为什么不让各个 computed 直接调 `todayKey()`：那样 snooze 的「到期自动回归」就只会在
   * **有任务写入**时才重算（computed 依赖里只有 todos）——页面开着一整夜、第二天回来，
   * 已到期的任务仍会被当成 snoozed 藏着。把它做成响应式状态、由 App.vue 定时/回前台刷新，
   * 「今天」才会自己走。
   */
  const today = ref(todayKey())
  /** 是否处于多选模式（批量操作；运行时） */
  const selectionMode = ref(false)
  /** 已选中的任务 id（多选；运行时） */
  const selectedIds = ref<string[]>([])
  /** 是否已手动排序（拖拽后关闭自动排序） */
  const manualOrder = ref(false)
  /** 列表视图：主列表 / 已归档 / 已隐藏（snooze 中）；与筛选 tab 是两条正交的轴 */
  const listView = ref<TodoListView>('main')
  /** 已选中的标签筛选（多选；空数组 = 不过滤标签） */
  const tagFilter = ref<string[]>([])
  /** 撤销删除队列：软删除中的任务（1 分钟窗口，运行时，刷新即清空） */
  const pendingDeletes = ref<PendingDelete[]>([])
  /** id -> 真正删除定时器（运行时） */
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  // ---- getters ----
  /** 未被软删除的任务（底层全集：含归档与 snooze 中的任务） */
  const liveTodos = computed<Todo[]>(() => {
    const pendingIds = new Set(pendingDeletes.value.map((p) => p.todo.id))
    return todos.value.filter((t) => !pendingIds.has(t.id))
  })

  /** 已归档任务（归档视图用） */
  const archivedTodos = computed<Todo[]>(() => liveTodos.value.filter((t) => t.archived === true))

  /**
   * 可见任务（统计口径）：排除软删除中 + **已归档**的任务。
   * 注意 snooze 的任务**不算掉**——规划明确「snooze 不影响任何统计」，只是不在列表里露面。
   */
  const visibleTodos = computed<Todo[]>(() => liveTodos.value.filter((t) => t.archived !== true))

  /** snooze 中的任务（已隐藏视图用） */
  const snoozedTodos = computed<Todo[]>(() =>
    liveTodos.value.filter((t) => isSnoozed(t, today.value)),
  )

  /** 当前视图对应的基础集合 */
  const listBaseTodos = computed<Todo[]>(() => {
    if (listView.value === 'archived') return archivedTodos.value
    if (listView.value === 'snoozed') return snoozedTodos.value
    // 主列表：排除归档 + 排除 snooze 中（snoozedUntil 到期当天自动回归）
    return visibleTodos.value.filter((t) => !isSnoozed(t, today.value))
  })

  /** 过滤 + 搜索后的展示列表（按优先级高→低、截止日期早→晚排序；手动排序后不再重排） */
  const filteredTodos = computed<Todo[]>(() => {
    const base = filterTodos(listBaseTodos.value, {
      // 归档 / 已隐藏视图不套「完成状态」筛选：这两个视图看的是**生命周期状态**，
      // 再叠一层「进行中」会把已完成但已归档的任务藏掉，看起来像被误删了。
      filter: listView.value === 'main' ? filter.value : 'all',
      keyword: keyword.value,
      priority: priority.value,
      tags: tagFilter.value,
      date: filterDate.value ?? undefined,
    })
    return manualOrder.value ? base : sortTodos(base)
  })

  /** 今日聚焦（My Day）：置顶 或 今日到期 的任务（snooze 中的不出现） */
  const myDayTodos = computed<Todo[]>(() => {
    const current = today.value
    return visibleTodos.value.filter(
      (t) => !isSnoozed(t, current) && (t.pinned || (t.dueDate && t.dueDate === current)),
    )
  })

  const totalCount = computed(() => visibleTodos.value.length)
  const activeCount = computed(() => visibleTodos.value.filter((t) => t.status === 'active').length)
  const completedCount = computed(
    () => visibleTodos.value.filter((t) => t.status === 'completed').length,
  )
  /** 已归档条数（任务页入口文案用） */
  const archivedCount = computed(() => archivedTodos.value.length)
  /** 已隐藏（snooze 中）条数 */
  const snoozedCount = computed(() => snoozedTodos.value.length)
  /** 撤销条展示用：最近的待撤销任务 */
  const latestPendingDelete = computed<PendingDelete | null>(
    () => pendingDeletes.value[pendingDeletes.value.length - 1] ?? null,
  )

  // ---- actions ----
  function addTodo(input: TodoInput): Todo {
    const todo: Todo = {
      id: createId(),
      title: input.title.trim(),
      status: 'active',
      priority: input.priority,
      dueDate: input.dueDate,
      createdAt: new Date().toISOString(),
      pinned: false,
      subtasks: [],
      tags: input.tags ?? [],
      // 只在用户真的改过时才写这两个字段：默认提醒时间可以由 dueDate 推导出来，
      // 写进每条任务只会让存储与云同步 payload 平白变胖（见 types/todo.ts 的说明）
      ...(input.reminderAt ? { reminderAt: input.reminderAt } : {}),
      ...(input.reminderOff ? { reminderOff: true } : {}),
    }
    todos.value = [...todos.value, todo]
    return todo
  }

  function updateTodo(id: string, patch: Partial<Pick<Todo, 'title' | 'priority' | 'dueDate'>>) {
    todos.value = todos.value.map((t) => (t.id === id ? { ...t, ...patch } : t))
  }

  function toggleComplete(id: string) {
    todos.value = todos.value.map((t) =>
      t.id === id
        ? {
            ...t,
            status: t.status === 'active' ? 'completed' : 'active',
            completedAt: t.status === 'active' ? new Date().toISOString() : undefined,
          }
        : t,
    )
  }

  /** 软删除：进入撤销队列，1 分钟后真正移除并落盘 */
  function removeTodo(id: string) {
    if (pendingDeletes.value.some((p) => p.todo.id === id)) return
    const todo = todos.value.find((t) => t.id === id)
    if (!todo) return

    pendingDeletes.value = [
      ...pendingDeletes.value,
      { todo, expiresAt: Date.now() + UNDO_DELETE_TIMEOUT },
    ]
    const timer = setTimeout(() => commitDelete(id), UNDO_DELETE_TIMEOUT)
    timers.set(id, timer)
  }

  /** 撤销删除：取消定时器并移出队列（todos 未被改动，无需恢复数据） */
  function undoDelete(id: string) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    pendingDeletes.value = pendingDeletes.value.filter((p) => p.todo.id !== id)
  }

  /** 真正删除：从 todos 移除（触发持久化），清理队列与定时器 */
  function commitDelete(id: string) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    pendingDeletes.value = pendingDeletes.value.filter((p) => p.todo.id !== id)
    todos.value = todos.value.filter((t) => t.id !== id)
  }

  /** 立即清理所有软删除（组件销毁等场景） */
  function flushPendingDeletes() {
    for (const id of [...timers.keys()]) commitDelete(id)
  }

  function setFilter(next: TodoFilter) {
    filter.value = next
    manualOrder.value = false
    clearSelection()
  }

  /**
   * 按指定日期筛选（迷你月历点某天 → 任务页看那天的事）。
   * 会顺手把视图切回主列表，否则用户从「已归档」点过去会看到一个空的归档视图。
   */
  function setFilterDate(dateKey: string) {
    filterDate.value = dateKey
    filter.value = 'date'
    listView.value = 'main'
    manualOrder.value = false
    clearSelection()
  }

  /**
   * 切换某个优先级是否选中（多选）。
   * 特殊规则：当高/中/低三者都被选中时，自动清空选择（即回到"全部"），
   * 使三个按钮均不被选中。
   */
  function togglePriority(p: TodoPriority) {
    const cur = priority.value
    const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]
    priority.value = next.length === 3 ? [] : next
    manualOrder.value = false
  }

  /** 清空优先级选择（显示全部） */
  function clearPriority() {
    priority.value = []
    manualOrder.value = false
  }

  function setKeyword(next: string) {
    keyword.value = next
    manualOrder.value = false
  }

  // ---- 子任务 ----
  function toggleSubtask(todoId: string, subtaskId: string) {
    todos.value = todos.value.map((t) =>
      t.id === todoId
        ? {
            ...t,
            subtasks: t.subtasks.map((s) =>
              s.id === subtaskId ? { ...s, completed: !s.completed } : s,
            ),
          }
        : t,
    )
  }

  function addSubtask(todoId: string, title: string) {
    const text = title.trim()
    if (!text) return
    const subtask: Subtask = { id: createId(), title: text, completed: false }
    todos.value = todos.value.map((t) =>
      t.id === todoId ? { ...t, subtasks: [...t.subtasks, subtask] } : t,
    )
  }

  function removeSubtask(todoId: string, subtaskId: string) {
    todos.value = todos.value.map((t) =>
      t.id === todoId ? { ...t, subtasks: t.subtasks.filter((s) => s.id !== subtaskId) } : t,
    )
  }

  // ---- 置顶（今日聚焦/My Day） ----
  function togglePinned(id: string) {
    todos.value = todos.value.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t))
  }

  // ---- 多选批量 ----
  function toggleSelectionMode() {
    selectionMode.value = !selectionMode.value
    clearSelection()
  }

  function toggleSelect(id: string) {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((x) => x !== id)
      : [...selectedIds.value, id]
  }

  function clearSelection() {
    selectedIds.value = []
  }

  function getSelectedTodos(): Todo[] {
    return todos.value.filter((t) => selectedIds.value.includes(t.id))
  }

  /** 批量设置完成状态 */
  function bulkSetStatus(ids: string[], completed: boolean) {
    todos.value = todos.value.map((t) => {
      if (!ids.includes(t.id)) return t
      const target = completed ? 'completed' : 'active'
      if (t.status === target) return t
      return {
        ...t,
        status: target,
        completedAt: completed ? (t.completedAt ?? new Date().toISOString()) : undefined,
      }
    })
    clearSelection()
  }

  /** 批量删除（复用软删除 + 撤销） */
  function bulkRemove(ids: string[]) {
    ids.forEach((id) => removeTodo(id))
    clearSelection()
  }

  /** 批量修改优先级 */
  function bulkSetPriority(ids: string[], priority: TodoPriority) {
    todos.value = todos.value.map((t) => (ids.includes(t.id) ? { ...t, priority } : t))
    clearSelection()
  }

  // ---- 拖拽排序 ----
  /** 将 movedId 移动到 targetId 之前的位置（按底层数组顺序），并开启手动排序 */
  function moveTodo(movedId: string, targetId: string) {
    const list = [...todos.value]
    const movedIdx = list.findIndex((t) => t.id === movedId)
    const targetIdx = list.findIndex((t) => t.id === targetId)
    if (movedIdx < 0 || targetIdx < 0 || movedIdx === targetIdx) return
    const [moved] = list.splice(movedIdx, 1)
    list.splice(targetIdx, 0, moved)
    todos.value = list
    manualOrder.value = true
  }

  // ---- 标签筛选（第六阶段 6.1） ----
  function setListView(view: TodoListView) {
    listView.value = view
    manualOrder.value = false
    clearSelection()
  }

  /** 切换某个标签是否在筛选中（多选） */
  function toggleTagFilter(tagId: string) {
    tagFilter.value = tagFilter.value.includes(tagId)
      ? tagFilter.value.filter((x) => x !== tagId)
      : [...tagFilter.value, tagId]
    manualOrder.value = false
  }

  function clearTagFilter() {
    tagFilter.value = []
    manualOrder.value = false
  }

  /**
   * 删除标签时摘掉所有任务上的引用（**任务本身不删**）。
   * 由调用方在 tagStore.removeTag 之后调用，两个 store 各自管好自己的数据。
   */
  function removeTagReference(tagId: string) {
    todos.value = stripTagFromTodos(todos.value, tagId)
    tagFilter.value = tagFilter.value.filter((x) => x !== tagId)
  }

  // ---- 归档（第六阶段 6.1） ----
  function archive(id: string) {
    todos.value = todos.value.map((t) => (t.id === id ? archiveTodo(t) : t))
  }

  function unarchive(id: string) {
    todos.value = todos.value.map((t) => (t.id === id ? unarchiveTodo(t) : t))
  }

  /** 批量归档（用于「归档所有已完成任务」） */
  function bulkArchive(ids: string[]) {
    const set = new Set(ids)
    todos.value = todos.value.map((t) => (set.has(t.id) ? archiveTodo(t) : t))
    clearSelection()
  }

  // ---- 稍后再做 / Snooze（第六阶段 6.1） ----
  /** 藏到 until（YYYY-MM-DD）之前，不改变任何统计口径 */
  function snooze(id: string, until: string) {
    todos.value = todos.value.map((t) => (t.id === id ? snoozeTodo(t, until) : t))
  }

  /** 提前召回：立刻回到主列表 */
  function unsnooze(id: string) {
    todos.value = todos.value.map((t) => (t.id === id ? unsnoozeTodo(t) : t))
  }

  /**
   * 校准「今天」（由 App.vue 定时与回前台调用）。
   * 跨零点后 snooze 到期的任务会自动回到主列表 —— 不需要任何任务写入来触发重算。
   */
  function refreshToday() {
    const next = todayKey()
    if (next !== today.value) today.value = next
  }

  /** 批量召回 */
  function bulkUnsnooze(ids: string[]) {
    const set = new Set(ids)
    todos.value = todos.value.map((t) => (set.has(t.id) ? unsnoozeTodo(t) : t))
    clearSelection()
  }

  // ---- 云同步（第五阶段） ----
  /**
   * 同步模型：**云端为准 + 本地缓存 + 离线队列**
   * - 未登录（local 模式）：行为与以前完全一致，只写 localStorage
   * - 已登录：激活时拉取云端并覆盖本地（首次登录则把本地旧数据一次性迁移上去）
   * - 之后每次改动用「指纹差异」算出要推送的任务，写进队列后异步补发；
   *   断网时队列持久化在 localStorage，恢复网络或下次进入时自动补发
   */
  const syncState = ref<SyncState>('local')
  /** 当前同步所属账号（null = 未登录 / 未激活） */
  const syncUserId = ref<string | null>(null)
  /** 同步提示（面向用户，如「离线模式」「已迁移 N 条」） */
  const syncMessage = ref('')
  /** 最近一次同步成功时间（ISO） */
  const lastSyncedAt = ref<string | null>(null)
  /** 本地缓存主人标记 */
  const syncOwner = useLocalStorage<CacheOwner>(SYNC_OWNER_KEY, null)
  /** 待补发的操作队列（持久化，刷新不丢） */
  const syncQueue = useLocalStorage<SyncOperation[]>(SYNC_QUEUE_KEY, [])

  /** 上次已同步快照（id → 指纹），差异推送的基准 */
  let syncedSnapshot = new Map<string, string>()
  /** 是否正在补发（避免并发 flush 重复推送） */
  let flushing = false
  /**
   * 是否正在激活云同步。
   * 激活期间用户可能仍在操作，这些改动由激活结束后的「补差」统一处理，
   * 所以 watcher 要先让路——否则「拉取云端」这一步的 await 会让激活前积压的
   * watcher 回调在错误的时间点跑（基准快照还是空的），把整份列表误判成新改动重复推送。
   */
  let activating = false

  /** 某个账号是否已完成旧数据一次性迁移 */
  function isMigrated(userId: string): boolean {
    try {
      return localStorage.getItem(migrationKey(userId)) === 'done'
    } catch {
      return false
    }
  }

  function markMigrated(userId: string) {
    try {
      localStorage.setItem(migrationKey(userId), 'done')
    } catch {
      // 隐私模式等场景：忽略，下次激活时会再走一次迁移（迁移本身是幂等 upsert）
    }
  }

  /** 把队列里的操作补发到云端（串行，保证顺序） */
  async function flushSync(): Promise<boolean> {
    const userId = syncUserId.value
    if (!userId || flushing) return false

    if (!isOnline()) {
      syncState.value = 'offline'
      syncMessage.value = '当前处于离线模式：改动已保存在本地，恢复网络后自动同步'
      return false
    }

    if (syncQueue.value.length === 0) {
      if (syncState.value === 'offline') syncState.value = 'synced'
      return true
    }

    flushing = true
    syncState.value = 'syncing'
    try {
      // 逐条串行：后一条依赖前一条的写入结果（删除与新增可能针对同一条）
      while (syncQueue.value.length > 0) {
        const op = syncQueue.value[0]
        if (op.type === 'delete') {
          await deleteRemoteTodos([op.todoId])
        } else {
          const position = todos.value.findIndex((t) => t.id === op.todoId)
          // 已被删除（队列里可能还没轮到这条 delete）则跳过，避免推送幽灵数据
          if (position >= 0) {
            await pushRemoteTodos(userId, [{ todo: todos.value[position], position }])
          }
        }
        syncQueue.value = syncQueue.value.slice(1)
      }
      syncState.value = 'synced'
      syncMessage.value = ''
      lastSyncedAt.value = new Date().toISOString()
      return true
    } catch (error) {
      // 失败：保留队列，降级为离线（本地照常可写），下次自动重试
      syncState.value = 'offline'
      syncMessage.value = describeAuthError(error)
      return false
    } finally {
      flushing = false
    }
  }

  /** 手动「立即同步」（设置页按钮 / 网络恢复时调用） */
  async function syncNow(): Promise<boolean> {
    return flushSync()
  }

  /**
   * 激活云同步（登录后调用）。
   * @returns 是否成功（失败时进入离线降级，本地照常可用）
   */
  async function activateCloud(userId: string): Promise<boolean> {
    if (!userId) return false
    if (syncUserId.value === userId) return flushSync()

    activating = true
    try {
      syncState.value = 'syncing'
      syncMessage.value = ''

      // 数据安全：本地缓存若属于另一个账号，必须先清掉，否则会把 A 的任务推进 B 的账号
      const decision = decideLocalCache(syncOwner.value, userId)
      if (decision === 'wipe-foreign') {
        todos.value = []
        syncQueue.value = []
      }

      syncUserId.value = userId
      syncOwner.value = userId

      /**
       * 拉取云端**之前**先拍一份快照。
       *
       * 为什么要它：`await fetchRemoteTodos()` 期间用户仍可新增/编辑任务，而那些改动
       * 比云端数据更新。没有这份基准，「云端为准」的那次赋值会把它们直接吞掉
       * （既没进同步队列、也没留在界面上）——那是真实的数据丢失。
       */
      const beforeFetch = snapshotTodos(todos.value)

      const remote = await fetchRemoteTodos(userId)
      let next = remote

      // 一次性迁移：本地有游客/上一版本数据且该账号还没迁移过 → 合并后整体写入云端
      if (decision === 'keep-local' && todos.value.length > 0 && !isMigrated(userId)) {
        const localCount = todos.value.length
        next = mergeTodos(todos.value, remote)
        await pushRemoteTodos(
          userId,
          next.map((todo, position) => ({ todo, position })),
        )
        markMigrated(userId)
        syncMessage.value = `已把本地 ${localCount} 条任务迁移到云端`
      }

      /**
       * 离线队列里攒下的改动，也必须在「云端为准」赋值**之前**合进来。
       *
       * 队列只存 `{todoId, type}` 不含内容，而 flushSync 是拿 id 去**当前的** `todos` 里现取要推的任务：
       * 少了这一步，赋值之后补发推的就是云端那一份 —— 本地编辑静默蒸发、
       * 本地已删的任务反而在本地复活（详细论证见 utils/todoSync.ts 的 diffFromQueue）。
       *
       * 顺序：先合队列（离线期间、较旧），再合 during（拉取期间、较新，应当覆盖前者）。
       * 队列本身不动 —— 它随后会在 flushSync 里被真正推上去，而那时 todos 已经是本地版本了。
       */
      const queued = diffFromQueue(syncQueue.value, todos.value)
      if (queued.upserts.length > 0 || queued.deletes.length > 0) {
        next = applyDiff(next, queued)
      }

      /**
       * 补差：拉取期间用户改了什么。
       * 基准是**拉取前**的快照（不是赋值后的列表——那样比的是同一份数据，差异恒为空，
       * 这段代码就成了摆设）。用户改动覆盖到云端结果上，再入队推回云端。
       */
      const during = diffTodos(beforeFetch, todos.value)
      if (during.upserts.length > 0 || during.deletes.length > 0) {
        next = applyDiff(next, during)
      }

      // 先更新快照再赋值：避免这次「云端覆盖本地」被差异逻辑误判为用户改动而重复推送
      syncedSnapshot = snapshotTodos(next)
      todos.value = next

      // 用户的改动已经合进 next，把它们推回云端（否则只落在本机，别的设备看不到）
      if (during.upserts.length > 0 || during.deletes.length > 0) {
        syncQueue.value = enqueueOperations(syncQueue.value, [
          ...during.upserts.map((entry) => ({ todoId: entry.todo.id, type: 'upsert' as const })),
          ...during.deletes.map((id) => ({ todoId: id, type: 'delete' as const })),
        ])
      }

      syncState.value = 'synced'
      lastSyncedAt.value = new Date().toISOString()

      // 离线期间攒下的操作补发
      await flushSync()
      return true
    } catch (error) {
      syncState.value = 'offline'
      syncMessage.value = describeAuthError(error)
      return false
    } finally {
      activating = false
    }
  }

  /**
   * 退出登录：把待补发操作尽量送出去，然后清空本地缓存。
   * 清缓存是有意为之——任务属于账号，不能留在浏览器里给下一个登录者看见。
   */
  async function deactivateCloud(): Promise<void> {
    if (syncUserId.value) await flushSync()

    syncUserId.value = null
    syncOwner.value = null
    syncedSnapshot = new Map()
    todos.value = []
    syncQueue.value = []
    syncState.value = 'local'
    syncMessage.value = ''
    lastSyncedAt.value = null
  }

  /** 绑定网络状态：恢复联网自动补发，断网立刻提示（由 App.vue 调用一次，返回解绑函数） */
  function bindConnectivity(): () => void {
    if (typeof window === 'undefined') return () => {}

    const handleOnline = () => {
      if (syncUserId.value) void flushSync()
    }
    const handleOffline = () => {
      if (syncUserId.value) {
        syncState.value = 'offline'
        syncMessage.value = '当前处于离线模式：改动已保存在本地，恢复网络后自动同步'
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }

  // 任务列表的任何变化（增删改、子任务、置顶、拖拽排序）都走这一处差异计算，
  // 好处：新增业务动作时不需要记得「顺手写一句同步代码」，不会漏推。
  watch(
    todos,
    (next) => {
      if (!syncUserId.value || activating) return

      const diff = diffTodos(syncedSnapshot, next)
      if (diff.upserts.length === 0 && diff.deletes.length === 0) return

      syncedSnapshot = snapshotTodos(next)
      syncQueue.value = enqueueOperations(syncQueue.value, [
        ...diff.upserts.map((entry) => ({ todoId: entry.todo.id, type: 'upsert' as const })),
        ...diff.deletes.map((id) => ({ todoId: id, type: 'delete' as const })),
      ])
      void flushSync()
    },
    { deep: true },
  )

  return {
    // 状态
    todos,
    filter,
    priority,
    keyword,
    filterDate,
    pendingDeletes,
    latestPendingDelete,
    selectionMode,
    selectedIds,
    manualOrder,
    listView,
    tagFilter,
    today,
    // getters
    liveTodos,
    archivedTodos,
    snoozedTodos,
    visibleTodos,
    filteredTodos,
    myDayTodos,
    totalCount,
    activeCount,
    completedCount,
    archivedCount,
    snoozedCount,
    // actions
    addTodo,
    updateTodo,
    toggleComplete,
    removeTodo,
    undoDelete,
    commitDelete,
    flushPendingDeletes,
    setFilter,
    setFilterDate,
    togglePriority,
    clearPriority,
    setKeyword,
    toggleSubtask,
    addSubtask,
    removeSubtask,
    togglePinned,
    toggleSelectionMode,
    toggleSelect,
    clearSelection,
    getSelectedTodos,
    bulkSetStatus,
    bulkRemove,
    bulkSetPriority,
    moveTodo,
    // 标签 / 归档 / snooze（第六阶段 6.1）
    setListView,
    toggleTagFilter,
    clearTagFilter,
    removeTagReference,
    archive,
    unarchive,
    bulkArchive,
    snooze,
    unsnooze,
    bulkUnsnooze,
    refreshToday,
    // 云同步
    syncState,
    syncUserId,
    syncMessage,
    lastSyncedAt,
    syncOwner,
    syncQueue,
    isMigrated,
    activateCloud,
    deactivateCloud,
    flushSync,
    syncNow,
    bindConnectivity,
  }
})
