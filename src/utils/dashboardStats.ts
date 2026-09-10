/**
 * 仪表板用的聚合纯函数（第六阶段 6.4）。
 *
 * 迷你月历要标「有任务的日期」，而"有任务"这件事有两个来源：
 * 任务本身的截止日期（那天要做的事）与完成时间（那天做完的事）。
 * 两者取并集才符合直觉——只看截止日会漏掉"提前干完"的日子，
 * 只看完成时间又会漏掉"排了但还没干"的日子。
 */

import type { Todo } from '@/types/todo'
import { toDateKey } from '@/utils/dateFormatter'
import { isValidDateKey } from '@/utils/validation'

/**
 * 有任务活动的日期键集合（已去重、升序）。
 * 非法日期（如 6 位年份的脏数据）会被过滤掉，不让它污染月历。
 */
export function activityDateKeys(todos: readonly Todo[]): string[] {
  const keys = new Set<string>()

  for (const todo of todos) {
    if (todo.dueDate && isValidDateKey(todo.dueDate)) keys.add(todo.dueDate)
    if (todo.status === 'completed' && todo.completedAt) {
      const parsed = new Date(todo.completedAt)
      if (!Number.isNaN(parsed.getTime())) keys.add(toDateKey(parsed))
    }
  }

  return [...keys].sort()
}

/** 某个月份里有活动日期的集合（月历按当前展示的月份取用） */
export function activityDatesOfMonth(
  todos: readonly Todo[],
  year: number,
  month1to12: number,
): string[] {
  const prefix = `${year}-${String(month1to12).padStart(2, '0')}-`
  return activityDateKeys(todos).filter((key) => key.startsWith(prefix))
}
