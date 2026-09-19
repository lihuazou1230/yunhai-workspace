/**
 * 前端工具执行器（第十一阶段 11.1 的 client 半边）。
 *
 * 分工的由来：`task_crud` / `get_weather` 的数据**只存在于用户的工作台里**
 * （localStorage 的任务、本机缓存的天气）。后端为了"能调工具"去复制一份真相，
 * 只会得到两份迟早不一致的数据。所以后端只声明工具（名称 + JSON Schema + 描述），
 * 真正执行发生在这里，结果再用 `/api/ask/resume` 回传。
 *
 * 一条硬约束：**`runClientTool` 永不抛异常**。
 * 工具失败对循环来说是一条观察结果（"这条路走不通"），不是流程终止——
 * 抛出去会打断整轮回答，而返回 `ok:false` 能让模型换个参数再试或如实告诉用户。
 *
 * 返回值的 `summary` 是**给模型和用户看同一份文本**：模型靠它做下一步推理，
 * 界面上的 BaseToolTag 也直接显示它，两边说法不一致才是 bug。
 */

import { CITY_ADCODE } from '@/api/weather'
import { normalizeCityKey, weatherCache } from '@/api/weatherCache'
import { sortTodos } from '@/composables/useTodoFilter'
import { readRememberedPlace } from '@/composables/useWeather'
import { useTodoStore } from '@/stores/todoStore'
import { agentToolLabel } from '@/types/agent'
import { DEFAULT_PRIORITY } from '@/types/todo'
import { PRIORITY_LABEL, isTodoPriority } from '@/utils/priorityHelper'
import { isValidDateKey } from '@/utils/validation'
import type { Todo, TodoPriority } from '@/types/todo'
import type { WeatherData } from '@/types/weather'

/** 前端要执行的工具调用（来自 `done.pending` 或 `tool_call` 事件） */
export interface ClientToolCall {
  id: string
  name: string
  arguments?: Record<string, unknown>
}

/** 回传给 `/api/ask/resume` 的观察结果 */
export interface ClientToolResult {
  tool_call_id: string
  name: string
  ok: boolean
  summary: string
  result?: unknown
  error?: string
}

/** task_crud 的 action（与后端 app/agent/builtin.py 的 schema 一字不差） */
type TaskAction = 'list' | 'create' | 'update' | 'complete' | 'uncomplete' | 'delete' | 'archive'

/** list 的筛选口径 */
type TaskFilter = 'all' | 'today' | 'active' | 'completed' | 'overdue'

const FILTER_LABELS: Record<TaskFilter, string> = {
  all: '全部',
  today: '今天',
  active: '进行中',
  completed: '已完成',
  overdue: '已逾期',
}

/** 一屏列表最多列几条：再多模型也用不上，只会把上下文吃掉 */
const MAX_LIST_ROWS = 20

function ok(call: ClientToolCall, summary: string, result?: unknown): ClientToolResult {
  return { tool_call_id: call.id, name: call.name, ok: true, summary, result }
}

function fail(call: ClientToolCall, error: string): ClientToolResult {
  // summary 也填上：失败原因既要回灌给模型，也要能显示在工具标签上
  return { tool_call_id: call.id, name: call.name, ok: false, summary: error, error }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : '未知错误'
}

/**
 * 执行一个前端工具，返回可回传的观察结果。
 * @param call 工具 id / 名称 / 参数（参数缺失时按空对象处理，由各执行器给出缺参提示）
 */
export async function runClientTool(call: ClientToolCall): Promise<ClientToolResult> {
  try {
    switch (call.name) {
      case 'task_crud':
        return runTaskCrud(call)
      case 'get_weather':
        return runGetWeather(call)
      default:
        return fail(call, `前端还没有实现工具 ${call.name}`)
    }
  } catch (error) {
    // 兜底：任何没预料到的异常都降级成一条观察结果，绝不把整轮对话打断
    return fail(call, `${agentToolLabel(call.name)}执行失败：${describeError(error)}`)
  }
}

// ---------------- task_crud ----------------

function runTaskCrud(call: ClientToolCall): ClientToolResult {
  const args = call.arguments ?? {}
  const action = String(args.action ?? '') as TaskAction | ''

  switch (action) {
    case 'list':
      return runList(call, args)
    case 'create':
      return runCreate(call, args)
    case 'update':
      return runUpdate(call, args)
    case 'complete':
    case 'uncomplete':
      return runToggleComplete(call, args, action === 'complete')
    case 'delete':
      return runDelete(call, args)
    case 'archive':
      return runArchive(call, args)
    default:
      return fail(
        call,
        `不认识的 action「${action || '（空）'}」：只能是 list / create / update / complete / uncomplete / delete / archive`,
      )
  }
}

/** 未归档任务：归档是"软删除"，agent 不该看见也不该改它们 */
function activePool(todo: ReturnType<typeof useTodoStore>): Todo[] {
  return todo.visibleTodos
}

/** 一行任务摘要：`- [id] 标题（截止 2026-01-01，高，未完成）` */
function formatRow(todo: Todo): string {
  const bits: string[] = []
  if (todo.dueDate) bits.push(`截止 ${todo.dueDate}`)
  bits.push(PRIORITY_LABEL[todo.priority])
  bits.push(todo.status === 'completed' ? '已完成' : '未完成')
  return `- [${todo.id}] ${todo.title}（${bits.join('，')}）`
}

/** 认不出来的优先级给一句说明：静默降级会让模型的判断和实际存储对不上 */
function toPriority(value: unknown): { priority: TodoPriority; note: string } {
  if (isTodoPriority(value)) return { priority: value, note: '' }
  // 后端的枚举比工作台多一档 urgent，工作台最高只有 high
  if (typeof value === 'string' && value.trim().toLowerCase() === 'urgent') {
    return { priority: 'high', note: '（urgent 按最高档「高」记录）' }
  }
  return { priority: DEFAULT_PRIORITY, note: '' }
}

/** 解析 due_date；给了但不是合法日期时返回错误，让模型自己改对再试 */
function toDueDate(value: unknown): { dueDate?: string; error?: string } {
  if (value === undefined || value === null || value === '') return {}
  const text = String(value).trim()
  if (!isValidDateKey(text)) {
    return { error: `due_date「${text}」不是合法日期，需要 YYYY-MM-DD 格式` }
  }
  return { dueDate: text }
}

/** 候选任务的提示文案：id + 标题都给出，模型才能反过来问用户"是哪一条" */
function candidatesText(todos: Todo[]): string {
  return todos.map((todo) => `「${todo.title}」(id=${todo.id})`).join('、')
}

/**
 * 定位要操作的任务：先认 `ids`（模型上一轮从 list 结果里见过，最准），再按 `query` 模糊匹配。
 * 匹配到多条一律不猜——猜错就是改错用户的数据，返回候选让模型去问。
 */
function resolveTarget(
  todo: ReturnType<typeof useTodoStore>,
  args: Record<string, unknown>,
): { target: Todo } | { error: string } {
  const pool = activePool(todo)
  const ids = Array.isArray(args.ids) ? args.ids.map((id) => String(id)) : []

  if (ids.length > 0) {
    const found = ids
      .map((id) => pool.find((item) => item.id === id))
      .filter((item): item is Todo => item !== undefined)
    if (found.length === 0)
      return { error: `没有找到 id 为 ${ids.join('、')} 的任务（未归档的任务）` }
    if (found.length > 1) {
      return {
        error: `一次只能改一条任务，但给出了 ${found.length} 个 id：${candidatesText(found)}`,
      }
    }
    return { target: found[0] }
  }

  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) return { error: '需要 ids 或 query 才能定位要操作的任务' }

  const lowered = query.toLowerCase()
  const matched = pool.filter((item) => item.title.toLowerCase().includes(lowered))
  if (matched.length === 0) return { error: `没有找到标题包含「${query}」的任务` }
  if (matched.length > 1) {
    return {
      error: `有 ${matched.length} 条任务都匹配「${query}」：${candidatesText(matched)}。请先问用户指的是哪一条（拿到 id 后再调用）`,
    }
  }
  return { target: matched[0] }
}

function runList(call: ClientToolCall, args: Record<string, unknown>): ClientToolResult {
  const todo = useTodoStore()
  const filter = String(args.filter ?? 'all') as TaskFilter
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const today = todo.today

  let rows = activePool(todo)
  switch (filter) {
    case 'today':
      // 「今天要做什么」= 今天到期 + 已经逾期的，且都还没完成
      rows = rows.filter((t) => t.status === 'active' && !!t.dueDate && t.dueDate <= today)
      break
    case 'active':
      rows = rows.filter((t) => t.status === 'active')
      break
    case 'completed':
      rows = rows.filter((t) => t.status === 'completed')
      break
    case 'overdue':
      rows = rows.filter((t) => t.status === 'active' && !!t.dueDate && t.dueDate < today)
      break
    default:
      // all（含模型给了个没见过的值）：不额外筛
      break
  }
  if (query) {
    const lowered = query.toLowerCase()
    rows = rows.filter((t) => t.title.toLowerCase().includes(lowered))
  }

  const label = FILTER_LABELS[filter] ?? FILTER_LABELS.all
  const ids = rows.map((t) => t.id)
  if (rows.length === 0) {
    return ok(call, `没有符合条件的任务（${label}${query ? `，关键字「${query}」` : ''}）`, {
      count: 0,
      ids: [],
    })
  }

  // 与任务页同一套排序：未完成在前、优先级高→低、截止早→晚
  const shown = sortTodos(rows).slice(0, MAX_LIST_ROWS)
  const lines = shown.map(formatRow)
  if (rows.length > shown.length) lines.push(`…还有 ${rows.length - shown.length} 条`)
  const head = `共 ${rows.length} 条（${label}${query ? `，关键字「${query}」` : ''}）`
  return ok(call, `${head}\n${lines.join('\n')}`, { count: rows.length, ids })
}

/**
 * 拆解出的步骤：清洗成非空字符串列表。
 *
 * 上限 12 条是防"模型抽风灌 50 条"的兜底——拆解本来就要求 3~6 条，
 * 超了截断并在摘要里说清截了几条，而不是静默丢掉。
 */
const MAX_SUBTASKS = 12

function toSubtasks(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((text) => text !== '')
  return cleaned.slice(0, MAX_SUBTASKS)
}

function runCreate(call: ClientToolCall, args: Record<string, unknown>): ClientToolResult {
  const todo = useTodoStore()
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!title) return fail(call, '缺少 title：新建任务必须给出标题')

  const due = toDueDate(args.due_date)
  if (due.error) return fail(call, due.error)

  const { priority, note } = toPriority(args.priority)
  const created = todo.addTodo({ title, priority, dueDate: due.dueDate })

  // 拆解（第十一阶段起由 agent 承担）：目标建成任务、步骤作为子任务落进工作台
  const subtasks = toSubtasks(args.subtasks)
  subtasks.forEach((text) => todo.addSubtask(created.id, text))

  const bits = [`id=${created.id}`]
  if (created.dueDate) bits.push(`截止 ${created.dueDate}`)
  bits.push(`优先级 ${PRIORITY_LABEL[created.priority]}${note}`)
  const steps = subtasks.length
    ? `\n拆成 ${subtasks.length} 个步骤：\n${subtasks.map((text, index) => `  ${index + 1}. ${text}`).join('\n')}`
    : ''
  return ok(call, `已创建任务「${created.title}」（${bits.join('，')}）${steps}`, {
    id: created.id,
    title: created.title,
    subtasks,
  })
}

function runUpdate(call: ClientToolCall, args: Record<string, unknown>): ClientToolResult {
  const todo = useTodoStore()
  const resolved = resolveTarget(todo, args)
  if ('error' in resolved) return fail(call, resolved.error)
  const target = resolved.target

  const patch: Partial<Pick<Todo, 'title' | 'priority' | 'dueDate'>> = {}
  const changes: string[] = []

  if (typeof args.title === 'string' && args.title.trim()) {
    patch.title = args.title.trim()
    changes.push(`标题改为「${patch.title}」`)
  }
  if (args.due_date !== undefined && args.due_date !== null && args.due_date !== '') {
    const due = toDueDate(args.due_date)
    if (due.error) return fail(call, due.error)
    patch.dueDate = due.dueDate
    changes.push(`截止改为 ${due.dueDate}`)
  }
  if (args.priority !== undefined && args.priority !== null && args.priority !== '') {
    const { priority, note } = toPriority(args.priority)
    patch.priority = priority
    changes.push(`优先级改为 ${PRIORITY_LABEL[priority]}${note}`)
  }

  // 往已有任务上加/换步骤（"把这条拆一下"走的就是这条路）
  const subtasks = toSubtasks(args.subtasks)
  const replace = args.subtasks_mode === 'replace'
  if (subtasks.length && replace) {
    const existing = [...target.subtasks]
    existing.forEach((item) => todo.removeSubtask(target.id, item.id))
    changes.push(`子任务整体替换为 ${subtasks.length} 条`)
  }
  if (subtasks.length) {
    subtasks.forEach((text) => todo.addSubtask(target.id, text))
    if (!replace) changes.push(`追加 ${subtasks.length} 条子任务`)
  }

  if (changes.length === 0) {
    return fail(call, '没有要改的字段：title / due_date / priority / subtasks 至少要给一个')
  }

  todo.updateTodo(target.id, patch)
  const steps = subtasks.length
    ? `\n当前步骤：\n${subtasks.map((text, index) => `  ${index + 1}. ${text}`).join('\n')}`
    : ''
  return ok(call, `已更新任务「${patch.title ?? target.title}」：${changes.join('，')}${steps}`, {
    id: target.id,
    subtasks,
  })
}

function runToggleComplete(
  call: ClientToolCall,
  args: Record<string, unknown>,
  completed: boolean,
): ClientToolResult {
  const todo = useTodoStore()
  const resolved = resolveTarget(todo, args)
  if ('error' in resolved) return fail(call, resolved.error)
  const target = resolved.target

  const want = completed ? 'completed' : 'active'
  const stateText = completed ? '已完成' : '未完成'
  if (target.status === want) {
    return ok(call, `任务「${target.title}」（id=${target.id}）本来就是${stateText}，没有改动`, {
      id: target.id,
    })
  }

  todo.toggleComplete(target.id)
  return ok(call, `已把任务「${target.title}」（id=${target.id}）标记为${stateText}`, {
    id: target.id,
  })
}

function runDelete(call: ClientToolCall, args: Record<string, unknown>): ClientToolResult {
  const todo = useTodoStore()
  const resolved = resolveTarget(todo, args)
  if ('error' in resolved) return fail(call, resolved.error)
  const target = resolved.target

  todo.removeTodo(target.id)
  return ok(
    call,
    `已删除任务「${target.title}」（id=${target.id}）：界面上还有一分钟的撤销窗口，反悔了可以点「撤销」`,
    { id: target.id },
  )
}

function runArchive(call: ClientToolCall, args: Record<string, unknown>): ClientToolResult {
  const todo = useTodoStore()
  const resolved = resolveTarget(todo, args)
  if ('error' in resolved) return fail(call, resolved.error)
  const target = resolved.target

  todo.archive(target.id)
  return ok(
    call,
    `已归档任务「${target.title}」（id=${target.id}）：它不再出现在主列表，可在「已归档」视图里恢复`,
    { id: target.id },
  )
}

// ---------------- get_weather ----------------

/** 只查本地：6 位 adcode 直接用，城市名查 adcode 缓存与内置快查表（**不发任何请求**） */
function localAdcode(city: string): string | undefined {
  if (/^\d{6}$/.test(city)) return city
  return weatherCache.getAdcode(city) ?? CITY_ADCODE[normalizeCityKey(city)]
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `上海 晴 24°C（体感 26°C，湿度 60%，更新于 10:20）` */
function formatWeather(data: WeatherData): string {
  const bits: string[] = []
  if (typeof data.feelsLike === 'number') bits.push(`体感 ${data.feelsLike}°C`)
  bits.push(`湿度 ${data.humidity}%`)
  bits.push(`更新于 ${formatClock(data.updatedAt)}`)
  return `${data.city || '未知城市'} ${data.description} ${data.temperature}°C（${bits.join('，')}）`
}

/**
 * 读**已有缓存**，不新增数据源（工具描述里就是这么向后端承诺的）。
 * 指定城市时只认那个城市；没指定就回落到"上次定位的城市"。
 */
function runGetWeather(call: ClientToolCall): ClientToolResult {
  const args = call.arguments ?? {}
  const city = typeof args.city === 'string' ? args.city.trim() : ''

  const candidates: string[] = []
  if (city) {
    const adcode = localAdcode(city)
    if (!adcode) {
      return fail(call, `本地没有「${city}」的天气缓存，先去仪表板刷新天气`)
    }
    candidates.push(adcode)
  }
  const remembered = readRememberedPlace()
  if (remembered) candidates.push(remembered.adcode)

  for (const adcode of candidates) {
    const data = weatherCache.getWeather(adcode)
    if (data) return ok(call, formatWeather(data), data)
  }

  const scope = city ? `「${city}」的` : ''
  return fail(call, `本地还没有${scope}天气缓存，先去仪表板刷新天气`)
}
