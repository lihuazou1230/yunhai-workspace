import { describe, expect, it } from 'vitest'

import { resolveSortMove } from './sortableMove'

const LIST = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('拖拽索引换算（SortableJS → store.moveTodo）', () => {
  it('向后拖：从第 0 位拖到第 2 位，目标是被拖到该位置的那条', () => {
    expect(resolveSortMove(LIST, 0, 2)).toEqual({ movedId: 'a', targetId: 'c' })
  })

  it('向前拖：从第 2 位拖到第 0 位', () => {
    expect(resolveSortMove(LIST, 2, 0)).toEqual({ movedId: 'c', targetId: 'a' })
  })

  it('相邻交换', () => {
    expect(resolveSortMove(LIST, 1, 0)).toEqual({ movedId: 'b', targetId: 'a' })
  })

  it('原地不动（oldIndex === newIndex）不产生移动', () => {
    expect(resolveSortMove(LIST, 1, 1)).toBeNull()
  })

  it('索引缺失 / 非整数 / 越界 / 负数都安全返回 null', () => {
    expect(resolveSortMove(LIST, null, 1)).toBeNull()
    expect(resolveSortMove(LIST, 1, null)).toBeNull()
    expect(resolveSortMove(LIST, undefined, undefined)).toBeNull()
    expect(resolveSortMove(LIST, 1.5, 0)).toBeNull()
    expect(resolveSortMove(LIST, 0, 9)).toBeNull()
    expect(resolveSortMove(LIST, -1, 0)).toBeNull()
    expect(resolveSortMove(LIST, 5, 0)).toBeNull()
  })

  it('空列表不崩', () => {
    expect(resolveSortMove([], 0, 1)).toBeNull()
  })
})
