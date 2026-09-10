import { describe, expect, it } from 'vitest'

import type { Todo } from '@/types/todo'
import { activityDateKeys, activityDatesOfMonth } from './dashboardStats'

function todo(partial: Partial<Todo> & { id: string }): Todo {
  return {
    title: '任务',
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

describe('activityDateKeys（迷你月历的圆点来源）', () => {
  it('截止日期与完成时间取并集', () => {
    const list = [
      todo({ id: '1', dueDate: '2026-09-10' }),
      todo({
        id: '2',
        status: 'completed',
        completedAt: new Date(2026, 8, 11, 9, 30).toISOString(),
      }),
    ]
    expect(activityDateKeys(list)).toEqual(['2026-09-10', '2026-09-11'])
  })

  it('同一天既排了任务又完成了任务时只算一次（去重）', () => {
    const list = [
      todo({ id: '1', dueDate: '2026-09-10' }),
      todo({
        id: '2',
        status: 'completed',
        completedAt: new Date(2026, 8, 10, 20, 0).toISOString(),
      }),
    ]
    expect(activityDateKeys(list)).toEqual(['2026-09-10'])
  })

  it('未完成的任务不看 completedAt（完成时间只在已完成时有意义）', () => {
    const list = [
      todo({
        id: '1',
        status: 'active',
        completedAt: new Date(2026, 8, 11, 9, 0).toISOString(),
      }),
    ]
    expect(activityDateKeys(list)).toEqual([])
  })

  it('结果按日期升序（月历渲染依赖这个顺序）', () => {
    const list = [
      todo({ id: '1', dueDate: '2026-09-20' }),
      todo({ id: '2', dueDate: '2026-09-05' }),
      todo({ id: '3', dueDate: '2026-10-01' }),
    ]
    expect(activityDateKeys(list)).toEqual(['2026-09-05', '2026-09-20', '2026-10-01'])
  })

  it('脏日期被过滤：畸形截止日期与无法解析的完成时间都不算活动', () => {
    const list = [
      todo({ id: '1', dueDate: '232233-10-01' }),
      todo({ id: '2', dueDate: '2026-02-30' }),
      todo({ id: '3', status: 'completed', completedAt: '不是时间' }),
    ]
    expect(activityDateKeys(list)).toEqual([])
  })

  it('没有任务时返回空数组', () => {
    expect(activityDateKeys([])).toEqual([])
  })
})

describe('activityDatesOfMonth', () => {
  const list = [
    todo({ id: '1', dueDate: '2026-09-10' }),
    todo({ id: '2', dueDate: '2026-09-28' }),
    todo({ id: '3', dueDate: '2026-10-02' }),
    todo({ id: '4', dueDate: '2025-09-10' }),
  ]

  it('只返回指定月份的活动日期（个位月也要正确补零）', () => {
    expect(activityDatesOfMonth(list, 2026, 9)).toEqual(['2026-09-10', '2026-09-28'])
    expect(activityDatesOfMonth(list, 2026, 10)).toEqual(['2026-10-02'])
    expect(activityDatesOfMonth(list, 2025, 9)).toEqual(['2025-09-10'])
  })

  it('月份不匹配时返回空数组', () => {
    expect(activityDatesOfMonth(list, 2026, 11)).toEqual([])
  })
})
