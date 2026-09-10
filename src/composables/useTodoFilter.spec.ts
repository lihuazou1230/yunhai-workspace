import { describe, expect, it } from 'vitest'

import type { Todo } from '@/types/todo'
import {
  countActive,
  countCompleted,
  filterByPriority,
  filterByStatus,
  filterTodos,
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

  it('sortTodos 不修改原数组', () => {
    const input = [
      makeTodo({ id: 'a', title: 'a', priority: 'low' }),
      makeTodo({ id: 'b', title: 'b', priority: 'high' }),
    ]
    const before = input.map((t) => t.id)
    sortTodos(input)
    expect(input.map((t) => t.id)).toEqual(before)
  })
})
