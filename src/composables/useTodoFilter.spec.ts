import { describe, expect, it } from 'vitest'

import type { Todo } from '@/types/todo'
import {
  countActive,
  countCompleted,
  filterByPriority,
  filterByStatus,
  filterByTags,
  filterTodos,
  isTodoStatus,
  matchesKeyword,
  sortTodos,
} from './useTodoFilter'

function makeTodo(partial: Partial<Todo> & { id: string; title: string }): Todo {
  return {
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

const list: Todo[] = [
  makeTodo({ id: '1', title: '写周报', priority: 'high' }),
  makeTodo({ id: '2', title: '健身', status: 'completed', dueDate: '2026-09-15' }),
  makeTodo({ id: '3', title: '阅读 Vue 文档', dueDate: '2026-09-20' }),
]

describe('useTodoFilter', () => {
  it('filterByStatus: all 返回全部', () => {
    expect(filterByStatus(list, 'all', '2026-09-15')).toHaveLength(3)
  })

  it('filterByStatus: active / completed', () => {
    expect(filterByStatus(list, 'active', '2026-09-15').map((t) => t.id)).toEqual(['1', '3'])
    expect(filterByStatus(list, 'completed', '2026-09-15').map((t) => t.id)).toEqual(['2'])
  })

  it('filterByStatus: today 匹配 dueDate === today', () => {
    expect(filterByStatus(list, 'today', '2026-09-15').map((t) => t.id)).toEqual(['2'])
    expect(filterByStatus(list, 'today', '2026-09-16')).toHaveLength(0)
  })

  it('filterByStatus: week 匹配本周内（周一~周日）的截止日期', () => {
    // 2026-09-15 所在周为 09-14 ~ 09-20；list 中 2(09-15)、3(09-20) 在本周
    expect(filterByStatus(list, 'week', '2026-09-15').map((t) => t.id)).toEqual(['2', '3'])
    // 边界：周一/周日计入，上周日/下周一不计入
    const around: Todo[] = [
      makeTodo({ id: 'w1', title: '周一', dueDate: '2026-09-14' }),
      makeTodo({ id: 'w2', title: '周日', dueDate: '2026-09-20' }),
      makeTodo({ id: 'w3', title: '上周日', dueDate: '2026-09-13' }),
      makeTodo({ id: 'w4', title: '无日期' }),
    ]
    expect(filterByStatus(around, 'week', '2026-09-15').map((t) => t.id)).toEqual(['w1', 'w2'])
  })

  it('matchesKeyword 大小写不敏感且忽略空白', () => {
    expect(matchesKeyword(list[0], ' 周报 ')).toBe(true)
    expect(matchesKeyword(list[0], 'ZHOUBAO')).toBe(false)
    expect(matchesKeyword(list[2], 'vue')).toBe(true)
    expect(matchesKeyword(list[0], '')).toBe(true)
  })

  it('filterTodos 组合状态与关键字', () => {
    const result = filterTodos(list, { filter: 'all', keyword: 'vue' })
    expect(result.map((t) => t.id)).toEqual(['3'])
  })

  it('filterByPriority 按优先级多选过滤，空数组不过滤', () => {
    expect(filterByPriority(list, ['high']).map((t) => t.id)).toEqual(['1'])
    // 多选：命中任一即保留
    expect(filterByPriority(list, ['medium', 'low']).map((t) => t.id)).toEqual(['2', '3'])
    expect(filterByPriority(list, ['high', 'low']).map((t) => t.id)).toEqual(['1'])
    expect(filterByPriority(list, [])).toHaveLength(3)
    expect(filterByPriority(list, undefined)).toHaveLength(3)
  })

  it('filterTodos 组合状态 + 多选优先级 + 关键字', () => {
    const result = filterTodos(list, { filter: 'all', keyword: '', priority: ['medium', 'high'] })
    expect(result.map((t) => t.id)).toEqual(['1', '2', '3'])
    const activeHighLow = filterTodos(list, {
      filter: 'active',
      keyword: '',
      priority: ['high', 'low'],
    })
    expect(activeHighLow.map((t) => t.id)).toEqual(['1'])
  })

  it('countActive / countCompleted', () => {
    expect(countActive(list)).toBe(2)
    expect(countCompleted(list)).toBe(1)
  })

  it('sortTodos 优先级高→低，同优先级截止早→晚，无日期在最后', () => {
    const mixed: Todo[] = [
      makeTodo({ id: 'low-nodue', title: '低-无日期', priority: 'low' }),
      makeTodo({ id: 'med-late', title: '中-晚', priority: 'medium', dueDate: '2026-09-30' }),
      makeTodo({ id: 'high-nodue', title: '高-无日期', priority: 'high' }),
      makeTodo({ id: 'med-early', title: '中-早', priority: 'medium', dueDate: '2026-09-10' }),
      makeTodo({ id: 'high-early', title: '高-早', priority: 'high', dueDate: '2026-09-05' }),
    ]
    const result = sortTodos(mixed).map((t) => t.id)
    expect(result).toEqual(['high-early', 'high-nodue', 'med-early', 'med-late', 'low-nodue'])
  })

  it('sortTodos 已完成任务排在未完成任务下方', () => {
    const mixed: Todo[] = [
      makeTodo({ id: 'done-high', title: '已完成-高', priority: 'high', status: 'completed' }),
      makeTodo({ id: 'active-low', title: '未完成-低', priority: 'low' }),
      makeTodo({ id: 'active-high', title: '未完成-高', priority: 'high' }),
      makeTodo({ id: 'done-low', title: '已完成-低', priority: 'low', status: 'completed' }),
    ]
    const ids = sortTodos(mixed).map((t) => t.id)
    // 未完成（active）整体在前，已完成（completed）整体在后；各组内再按优先级高→低
    expect(ids).toEqual(['active-high', 'active-low', 'done-high', 'done-low'])
  })

  /**
   * 回归：置顶必须**立刻看得见**。
   *
   * 此前 sortTodos 完全不看 `pinned`，于是用户在任务页点「置顶到今日聚焦」后
   * 那一行原地不动 —— 加上"该任务本来就已逾期、已在今日聚焦里"，
   * 整个动作在任何界面都没有可见变化，用户只能判断为"没生效"。
   */
  it('sortTodos 置顶项排在最前（跨优先级与截止日期）', () => {
    const mixed: Todo[] = [
      makeTodo({ id: 'a-high-early', title: '高-早', priority: 'high', dueDate: '2026-09-05' }),
      makeTodo({ id: 'b-low-nodue', title: '低-无日期', priority: 'low' }),
      makeTodo({ id: 'c-med', title: '中', priority: 'medium', dueDate: '2026-09-20' }),
    ]
    // 默认顺序：高-早 → 中 → 低-无日期
    expect(sortTodos(mixed).map((t) => t.id)).toEqual(['a-high-early', 'c-med', 'b-low-nodue'])

    // 把最不起眼的那条置顶 → 它必须直接到最前
    const pinned = mixed.map((t) => (t.id === 'b-low-nodue' ? { ...t, pinned: true } : t))
    expect(sortTodos(pinned).map((t) => t.id)).toEqual(['b-low-nodue', 'a-high-early', 'c-med'])
  })

  it('sortTodos 置顶压过"未完成在上"：已完成的置顶项也在最前', () => {
    const mixed: Todo[] = [
      makeTodo({ id: 'active-high', title: '未完成-高', priority: 'high' }),
      makeTodo({
        id: 'done-pinned',
        title: '已完成-置顶',
        priority: 'low',
        status: 'completed',
        pinned: true,
      }),
    ]
    // 置顶是用户的显式意图（"我要盯着它"），应当压过完成状态这一层
    expect(sortTodos(mixed).map((t) => t.id)).toEqual(['done-pinned', 'active-high'])
  })

  it('sortTodos 置顶状态相同时保持原有排序（不破坏稳定性）', () => {
    const same = [
      makeTodo({ id: 'x', title: 'x', priority: 'medium', dueDate: '2026-09-12' }),
      makeTodo({ id: 'y', title: 'y', priority: 'medium', dueDate: '2026-09-12' }),
    ]
    expect(sortTodos(same).map((t) => t.id)).toEqual(['x', 'y'])
  })

  it('sortTodos 不修改原数组', () => {
    const input = [
      makeTodo({ id: 'a', title: 'a', priority: 'low' }),
      makeTodo({ id: 'b', title: 'b', priority: 'high' }),
    ]
    const before = input.map((t) => t.id)
    sortTodos(input)
    expect(input.map((t) => t.id)).toEqual(before)
  })

  it("filterByStatus: 'date' 按目标日期筛；未指定目标日期时退回今天", () => {
    // 迷你月历点了 09-20：只看那一天的截止任务
    expect(filterByStatus(list, 'date', '2026-09-15', '2026-09-20').map((t) => t.id)).toEqual(['3'])
    // 没点过任何日期时退回「今天」，避免出现「筛出来是空但没人知道为什么」
    expect(filterByStatus(list, 'date', '2026-09-15').map((t) => t.id)).toEqual(['2'])
  })

  it('filterByTags 按标签多选过滤；空数组/未传表示不过滤', () => {
    const tagged: Todo[] = [
      makeTodo({ id: 't1', title: '写周报', tags: ['work'] }),
      makeTodo({ id: 't2', title: '买菜', tags: ['life', 'work'] }),
      makeTodo({ id: 't3', title: '健身', tags: [] }),
    ]

    expect(filterByTags(tagged, ['work']).map((t) => t.id)).toEqual(['t1', 't2'])
    expect(filterByTags(tagged, ['life']).map((t) => t.id)).toEqual(['t2'])
    // 多选是「命中任一」：并集而不是交集
    expect(filterByTags(tagged, ['life', 'work']).map((t) => t.id)).toEqual(['t1', 't2'])
    expect(filterByTags(tagged, ['nope']).map((t) => t.id)).toEqual([])
    expect(filterByTags(tagged, []).map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(filterByTags(tagged, undefined).map((t) => t.id)).toEqual(['t1', 't2', 't3'])
  })

  it('filterTodos 组合标签 + 优先级 + 关键字（三层过滤顺序不能颠，标签过滤必须在关键字之前）', () => {
    const tagged: Todo[] = [
      makeTodo({ id: 't1', title: '写周报', priority: 'high', tags: ['work'] }),
      makeTodo({ id: 't2', title: '写方案', priority: 'medium', tags: ['work'] }),
      makeTodo({ id: 't3', title: '买菜', priority: 'medium', tags: ['life'] }),
      makeTodo({ id: 't4', title: '健身', priority: 'high', tags: [] }),
    ]

    // 只留 work 标签里关键字命中的那条
    expect(
      filterTodos(tagged, { filter: 'all', keyword: '写', tags: ['work'] }).map((t) => t.id),
    ).toEqual(['t1', 't2'])
    // 标签 + 优先级都不命中时为空（不是退回全部）
    expect(
      filterTodos(tagged, { filter: 'all', keyword: '', tags: ['life'], priority: ['high'] }).map(
        (t) => t.id,
      ),
    ).toEqual([])
    expect(
      filterTodos(tagged, {
        filter: 'all',
        keyword: '买',
        tags: ['life'],
        priority: ['medium'],
      }).map((t) => t.id),
    ).toEqual(['t3'])
  })

  it('sortTodos：同状态同优先级时，有截止日期的排在无日期之前', () => {
    const due = () => makeTodo({ id: 'due', title: '有日期', dueDate: '2026-09-30' })
    const nodue = () => makeTodo({ id: 'nodue', title: '无日期' })

    // 两种输入顺序都要给出同一结果（比较器被调用的方向与输入顺序有关）
    expect(sortTodos([nodue(), due()]).map((t) => t.id)).toEqual(['due', 'nodue'])
    expect(sortTodos([due(), nodue()]).map((t) => t.id)).toEqual(['due', 'nodue'])

    // 两个都有日期且相同：视为相等，保持原有相对顺序（列表不会自己抖动）
    const sameDate: Todo[] = [
      makeTodo({ id: 'a', title: 'a', dueDate: '2026-09-10' }),
      makeTodo({ id: 'b', title: 'b', dueDate: '2026-09-10' }),
    ]
    expect(sortTodos(sameDate).map((t) => t.id)).toEqual(['a', 'b'])

    // 截止日期早→晚：输入顺序反过来也要排成一样
    const early = makeTodo({ id: 'early', title: '早', dueDate: '2026-09-10' })
    const late = makeTodo({ id: 'late', title: '晚', dueDate: '2026-09-30' })
    expect(sortTodos([early, late]).map((t) => t.id)).toEqual(['early', 'late'])
    expect(sortTodos([late, early]).map((t) => t.id)).toEqual(['early', 'late'])

    // 都无日期且其它字段一样：判定相等，同样保持原顺序
    const bothNoDate: Todo[] = [
      makeTodo({ id: 'n1', title: 'n1' }),
      makeTodo({ id: 'n2', title: 'n2' }),
    ]
    expect(sortTodos(bothNoDate).map((t) => t.id)).toEqual(['n1', 'n2'])
  })

  it('isTodoStatus 只认 active/completed（存储里读到别的值要能判脏）', () => {
    expect(isTodoStatus('active')).toBe(true)
    expect(isTodoStatus('completed')).toBe(true)
    expect(isTodoStatus('archived')).toBe(false)
    expect(isTodoStatus('')).toBe(false)
    expect(isTodoStatus(null)).toBe(false)
    expect(isTodoStatus(1)).toBe(false)
  })
})
