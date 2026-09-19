/**
 * 前端工具执行器（第十一阶段 11.1 的 client 半边）。
 *
 * 三个必须守住的性质：
 * 1. **永不抛**——工具失败是一条观察结果，不是流程终止；
 * 2. **不猜**——匹配到多条任务时返回候选让模型去问用户，绝不改错数据；
 * 3. **不越权**——归档任务不出现，天气只读缓存（这里把 fetch 换成会炸的桩，
 *    任何一次"顺手请求一下"都会让用例红掉）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { runClientTool } from './clientTools'
import { WEATHER_CACHE_KEY } from '@/api/weatherCache'
import { useTodoStore } from '@/stores/todoStore'
import { todayKey } from '@/utils/dateFormatter'
import type { Todo, TodoPriority } from '@/types/todo'
import type { WeatherData } from '@/types/weather'

const LAST_PLACE_KEY = 'smart-workspace:last-place'

let seq = 0

/** 造一条任务：只写用例关心的字段，其余给合理默认 */
function todo(patch: Partial<Todo> = {}): Todo {
  seq += 1
  return {
    id: patch.id ?? `t${seq}`,
    title: patch.title ?? `任务 ${seq}`,
    status: 'active',
    priority: (patch.priority ?? 'medium') as TodoPriority,
    createdAt: '2026-01-01T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...patch,
  }
}

function store() {
  return useTodoStore()
}

function call(name: string, args: Record<string, unknown> = {}, id = `c${(seq += 1)}`) {
  return { id, name, arguments: args }
}

/** 直接塞进 store 的 todos（绕开表单与云同步，用例只关心执行器逻辑） */
function seed(todos: Todo[]) {
  store().todos = todos
}

function weatherData(patch: Partial<WeatherData> = {}): WeatherData {
  return {
    city: '上海市',
    province: '上海',
    temperature: 24,
    description: '晴',
    icon: '☀️',
    humidity: 60,
    updatedAt: new Date('2026-01-01T10:20:00').getTime(),
    ...patch,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  window.localStorage.clear()
  seq = 0
  // 缓存模块读写的是 window.localStorage 里的固定键，清掉就是"没有缓存"
  window.localStorage.removeItem(WEATHER_CACHE_KEY)
  // 任何网络请求都算失败：这些工具不该联网
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('前端工具不该发网络请求')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runClientTool 分派', () => {
  it('未知工具名返回 ok:false 而不是抛异常', async () => {
    const result = await runClientTool(call('draw_chart'))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('前端还没有实现工具 draw_chart')
    expect(result.name).toBe('draw_chart')
  })

  it('执行器内部炸了也降级成 ok:false（绝不打断整轮对话）', async () => {
    // 没有激活的 Pinia：useTodoStore() 会抛，runClientTool 必须兜住
    setActivePinia(undefined as never)
    const result = await runClientTool(call('task_crud', { action: 'list' }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('执行失败')
  })
})

describe('task_crud / create', () => {
  it('落到 store 里，摘要带上 id 与截止/优先级', async () => {
    const result = await runClientTool(
      call('task_crud', {
        action: 'create',
        title: '交周报',
        due_date: '2026-03-01',
        priority: 'high',
      }),
    )

    expect(result.ok).toBe(true)
    const created = store().todos[0]
    expect(created.title).toBe('交周报')
    expect(created.dueDate).toBe('2026-03-01')
    expect(created.priority).toBe('high')
    expect(result.summary).toContain('已创建任务「交周报」')
    expect(result.summary).toContain(created.id)
    expect(result.summary).toContain('截止 2026-03-01')
    expect(result.summary).toContain('优先级 高')
    expect(result.result).toMatchObject({ id: created.id })
  })

  it('缺少 title → ok:false（不静默建一条空任务）', async () => {
    const result = await runClientTool(call('task_crud', { action: 'create', title: '   ' }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('缺少 title')
    expect(store().todos).toHaveLength(0)
  })

  it('非法日期 → ok:false，让模型自己改对再试', async () => {
    const result = await runClientTool(
      call('task_crud', { action: 'create', title: '交周报', due_date: '2026-13-45' }),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('YYYY-MM-DD')
    expect(store().todos).toHaveLength(0)
  })

  it('urgent 收敛成工作台最高档「高」，并在摘要里说清', async () => {
    const result = await runClientTool(
      call('task_crud', { action: 'create', title: '修线上', priority: 'urgent' }),
    )
    expect(result.ok).toBe(true)
    expect(store().todos[0].priority).toBe('high')
    expect(result.summary).toContain('urgent 按最高档「高」记录')
  })
})

describe('task_crud / list', () => {
  it('filter=today 只给"今天到期或已逾期且未完成"的任务', async () => {
    const today = todayKey()
    seed([
      todo({ id: 'a', title: '今天到期', dueDate: today }),
      todo({ id: 'b', title: '已逾期', dueDate: '2020-01-01' }),
      todo({ id: 'c', title: '今天到期但已完成', dueDate: today, status: 'completed' }),
      todo({ id: 'd', title: '明天到期', dueDate: '2999-01-01' }),
      todo({ id: 'e', title: '没有截止日期' }),
    ])

    const result = await runClientTool(call('task_crud', { action: 'list', filter: 'today' }))
    expect(result.ok).toBe(true)
    expect(result.result).toEqual({ count: 2, ids: ['a', 'b'] })
    expect(result.summary).toContain('共 2 条（今天）')
    expect(result.summary).toContain('- [a] 今天到期（截止')
    expect(result.summary).not.toContain('明天到期')
  })

  it('query 按标题模糊匹配（大小写不敏感），摘要给出 id 与状态', async () => {
    seed([
      todo({ id: 'a', title: 'Review 周报', priority: 'high', dueDate: '2026-03-01' }),
      todo({ id: 'b', title: '买菜' }),
      todo({ id: 'c', title: '读 review 笔记', status: 'completed' }),
    ])

    const result = await runClientTool(call('task_crud', { action: 'list', query: 'review' }))
    expect(result.ok).toBe(true)
    expect(result.result).toEqual({ count: 2, ids: ['a', 'c'] })
    expect(result.summary).toContain('- [a] Review 周报（截止 2026-03-01，高，未完成）')
    expect(result.summary).toContain('- [c] 读 review 笔记（中，已完成）')
  })

  it('其余筛选项：active / completed / overdue / all', async () => {
    seed([
      todo({ id: 'a', title: '未完成', dueDate: '2020-01-01' }),
      todo({ id: 'b', title: '已完成', status: 'completed' }),
      todo({ id: 'c', title: '未来的活', dueDate: '2999-01-01' }),
    ])

    const active = await runClientTool(call('task_crud', { action: 'list', filter: 'active' }))
    expect(active.result).toEqual({ count: 2, ids: ['a', 'c'] })

    const completed = await runClientTool(
      call('task_crud', { action: 'list', filter: 'completed' }),
    )
    expect(completed.result).toEqual({ count: 1, ids: ['b'] })

    const overdue = await runClientTool(call('task_crud', { action: 'list', filter: 'overdue' }))
    expect(overdue.result).toEqual({ count: 1, ids: ['a'] })

    const all = await runClientTool(call('task_crud', { action: 'list', filter: 'all' }))
    expect(all.result).toEqual({ count: 3, ids: ['a', 'b', 'c'] })
  })

  it('归档任务不出现在任何列表里（对 agent 而言等于不存在）', async () => {
    seed([todo({ id: 'a', title: '在用的' }), todo({ id: 'b', title: '归档的', archived: true })])
    const result = await runClientTool(call('task_crud', { action: 'list' }))
    expect(result.result).toEqual({ count: 1, ids: ['a'] })
  })

  it('空结果也是 ok:true（"没有任务"本身就是答案）', async () => {
    seed([])
    const result = await runClientTool(call('task_crud', { action: 'list', filter: 'today' }))
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('没有符合条件的任务（今天）')
    expect(result.result).toEqual({ count: 0, ids: [] })
  })

  it('超过 20 条时截断并说明还有多少（别把上下文撑爆）', async () => {
    seed(Array.from({ length: 23 }, (_unused, index) => todo({ title: `任务${index}` })))
    const result = await runClientTool(call('task_crud', { action: 'list' }))
    expect(result.summary).toContain('共 23 条')
    expect(result.summary).toContain('…还有 3 条')
    expect((result.result as { ids: string[] }).ids).toHaveLength(23)
  })
})

describe('task_crud / 定位目标', () => {
  it('query 命中多条 → ok:false 并列出候选（让 agent 去问用户是哪一条）', async () => {
    seed([todo({ id: 'a', title: '写周报' }), todo({ id: 'b', title: '写周报（补充）' })])

    const result = await runClientTool(call('task_crud', { action: 'complete', query: '写周报' }))
    expect(result.ok).toBe(false)
    expect(result.summary).toContain('「写周报」(id=a)')
    expect(result.summary).toContain('「写周报（补充）」(id=b)')
    expect(result.error).toContain('请先问用户指的是哪一条')
    // 一条都没动
    expect(store().todos.every((item) => item.status === 'active')).toBe(true)
  })

  it('query 没命中 → ok:false，且说清是哪个关键字', async () => {
    seed([todo({ title: '买菜' })])
    const result = await runClientTool(call('task_crud', { action: 'delete', query: '写周报' }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('没有找到标题包含「写周报」的任务')
  })

  it('完全没有 ids / query → ok:false（不允许"改点什么"这种调用）', async () => {
    seed([todo({ title: '买菜' })])
    const result = await runClientTool(call('task_crud', { action: 'complete' }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('需要 ids 或 query')
  })

  it('ids 更准：给对 id 就能一次命中，别名不会误伤', async () => {
    seed([todo({ id: 'a', title: '写周报' }), todo({ id: 'b', title: '写周报（补充）' })])
    const result = await runClientTool(call('task_crud', { action: 'complete', ids: ['b'] }))
    expect(result.ok).toBe(true)
    expect(store().todos.find((item) => item.id === 'b')?.status).toBe('completed')
    expect(store().todos.find((item) => item.id === 'a')?.status).toBe('active')
  })

  it('ids 一个都对不上 → ok:false', async () => {
    seed([todo({ id: 'a', title: '写周报' })])
    const result = await runClientTool(call('task_crud', { action: 'complete', ids: ['zzz'] }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('没有找到 id 为 zzz 的任务')
  })
})

describe('task_crud / update · complete · uncomplete · delete · archive', () => {
  it('update 逐项说明改了什么，只改给了的字段', async () => {
    seed([todo({ id: 'a', title: '交周报', priority: 'low', dueDate: '2026-01-01' })])

    const result = await runClientTool(
      call('task_crud', { action: 'update', ids: ['a'], title: '交月报', priority: 'high' }),
    )
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('已更新任务「交月报」')
    expect(result.summary).toContain('标题改为「交月报」')
    expect(result.summary).toContain('优先级改为 高')

    const updated = store().todos[0]
    expect(updated.title).toBe('交月报')
    expect(updated.priority).toBe('high')
    // 没提到的字段保持原样
    expect(updated.dueDate).toBe('2026-01-01')
  })

  it('update 什么字段都没给 → ok:false', async () => {
    seed([todo({ id: 'a', title: '交周报' })])
    const result = await runClientTool(call('task_crud', { action: 'update', ids: ['a'] }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('title / due_date / priority')
  })

  it('complete / uncomplete 按需切换并说明新状态', async () => {
    seed([todo({ id: 'a', title: '交周报' })])

    const done = await runClientTool(call('task_crud', { action: 'complete', ids: ['a'] }))
    expect(done.ok).toBe(true)
    expect(done.summary).toContain('已把任务「交周报」（id=a）标记为已完成')
    expect(store().todos[0].status).toBe('completed')

    const again = await runClientTool(call('task_crud', { action: 'complete', ids: ['a'] }))
    expect(again.summary).toContain('本来就是已完成，没有改动')
    expect(store().todos[0].status).toBe('completed')

    const undo = await runClientTool(call('task_crud', { action: 'uncomplete', ids: ['a'] }))
    expect(undo.summary).toContain('标记为未完成')
    expect(store().todos[0].status).toBe('active')
  })

  it('delete 走软删除并提示可以撤销', async () => {
    seed([todo({ id: 'a', title: '交周报' })])
    const result = await runClientTool(call('task_crud', { action: 'delete', ids: ['a'] }))
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('已删除任务「交周报」')
    expect(result.summary).toContain('撤销')
    // 软删除：还在撤销队列里，随时可以救回来
    expect(store().pendingDeletes.map((item) => item.todo.id)).toEqual(['a'])
    expect(store().visibleTodos).toHaveLength(0)
  })

  it('archive 后从可见列表消失，但数据还在', async () => {
    seed([todo({ id: 'a', title: '交周报' })])
    const result = await runClientTool(call('task_crud', { action: 'archive', ids: ['a'] }))
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('已归档任务「交周报」')
    expect(store().visibleTodos).toHaveLength(0)
    expect(store().archivedTodos).toHaveLength(1)
  })

  it('不认识的 action → ok:false', async () => {
    const result = await runClientTool(call('task_crud', { action: 'explode' }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不认识的 action')
  })
})

describe('task_crud 的拆解（subtasks）', () => {
  it('create 带 subtasks：目标建成任务、步骤作为子任务真的落进工作台', async () => {
    seed([])
    const result = await runClientTool(
      call('task_crud', {
        action: 'create',
        title: '准备前端面试',
        subtasks: ['整理项目经历', '刷算法题', '复习浏览器原理'],
      }),
    )

    expect(result.ok).toBe(true)
    const created = store().todos[0]
    expect(created.title).toBe('准备前端面试')
    expect(created.subtasks.map((item) => item.title)).toEqual([
      '整理项目经历',
      '刷算法题',
      '复习浏览器原理',
    ])
    // 摘要要给模型和用户同一份说法
    expect(result.summary).toContain('拆成 3 个步骤')
    expect(result.summary).toContain('1. 整理项目经历')
  })

  it('子任务为空的字符串会被丢掉，不会建出空步骤', async () => {
    seed([])
    await runClientTool(
      call('task_crud', { action: 'create', title: '目标', subtasks: ['第一步', '   ', ''] }),
    )
    expect(store().todos[0].subtasks.map((item) => item.title)).toEqual(['第一步'])
  })

  it('建太多步骤会被截断到 12 条（防模型灌一屏），且摘要里说清条数', async () => {
    seed([])
    const many = Array.from({ length: 20 }, (_, i) => `步骤 ${i + 1}`)
    const result = await runClientTool(
      call('task_crud', { action: 'create', title: '大目标', subtasks: many }),
    )
    expect(store().todos[0].subtasks).toHaveLength(12)
    expect(result.summary).toContain('拆成 12 个步骤')
  })

  it('update 默认追加步骤；subtasks_mode=replace 则整体替换', async () => {
    seed([
      todo({
        id: 'a',
        title: '准备面试',
        subtasks: [{ id: 's1', title: '旧步骤', completed: false }],
      }),
    ])

    const appended = await runClientTool(
      call('task_crud', { action: 'update', ids: ['a'], subtasks: ['新步骤'] }),
    )
    expect(appended.ok).toBe(true)
    expect(store().todos[0].subtasks.map((item) => item.title)).toEqual(['旧步骤', '新步骤'])

    const replaced = await runClientTool(
      call('task_crud', {
        action: 'update',
        ids: ['a'],
        subtasks: ['换掉的第一步', '换掉的第二步'],
        subtasks_mode: 'replace',
      }),
    )
    expect(replaced.ok).toBe(true)
    expect(store().todos[0].subtasks.map((item) => item.title)).toEqual([
      '换掉的第一步',
      '换掉的第二步',
    ])
  })

  it('update 什么字段都没给时给出可操作的错误', async () => {
    seed([todo({ id: 'a', title: '准备面试' })])
    const result = await runClientTool(call('task_crud', { action: 'update', ids: ['a'] }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('subtasks')
  })
})

describe('get_weather', () => {
  it('没有缓存 → ok:false 并指路「先去仪表板刷新天气」', async () => {
    const result = await runClientTool(call('get_weather'))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('本地还没有天气缓存，先去仪表板刷新天气')
  })

  it('指定城市但没有那个城市的缓存 → ok:false，带上城市名', async () => {
    const result = await runClientTool(call('get_weather', { city: '杭州' }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('本地还没有「杭州」的天气缓存')
  })

  it('命中「上次定位的城市」缓存：按摘要格式给出实况', async () => {
    // 缓存键是 adcode（杭州 330100），上次位置记的是同一个 adcode
    window.localStorage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify({
        adcode: { 杭州: '330100' },
        weather: {
          '330100': {
            data: weatherData({
              city: '杭州市',
              description: '晴',
              temperature: 24,
              feelsLike: 26,
              humidity: 60,
            }),
            cachedAt: Date.now(),
          },
        },
      }),
    )
    window.localStorage.setItem(
      LAST_PLACE_KEY,
      JSON.stringify({ adcode: '330100', label: '杭州市 · 浙江省' }),
    )

    const result = await runClientTool(call('get_weather'))
    expect(result.ok).toBe(true)
    expect(result.summary).toBe('杭州市 晴 24°C（体感 26°C，湿度 60%，更新于 10:20）')
    expect((result.result as WeatherData).temperature).toBe(24)
  })

  it('指定城市时只认这个城市（不拿别的城市的缓存糊弄）', async () => {
    window.localStorage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify({
        adcode: { 北京: '110000' },
        weather: {
          '110000': { data: weatherData({ city: '北京市' }), cachedAt: Date.now() },
        },
      }),
    )

    const shanghai = await runClientTool(call('get_weather', { city: '上海' }))
    expect(shanghai.ok).toBe(false)
    expect(shanghai.error).toContain('「上海」')

    const beijing = await runClientTool(call('get_weather', { city: '北京' }))
    expect(beijing.ok).toBe(true)
    expect(beijing.summary).toContain('北京市')
  })

  it('过期缓存不算数（30 分钟 TTL）', async () => {
    window.localStorage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify({
        adcode: {},
        weather: {
          '330100': {
            data: weatherData({ city: '杭州市' }),
            cachedAt: Date.now() - 60 * 60 * 1000,
          },
        },
      }),
    )
    window.localStorage.setItem(
      LAST_PLACE_KEY,
      JSON.stringify({ adcode: '330100', label: '杭州市' }),
    )

    const result = await runClientTool(call('get_weather'))
    expect(result.ok).toBe(false)
  })
})
