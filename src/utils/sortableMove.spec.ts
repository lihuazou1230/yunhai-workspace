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

  it('列表里出现重复 id 时不产生移动（插到自己前面等于原地不动）', () => {
    // 导入 / 从云端恢复的数据可能带着重复 id，此时 moved 与 target 是同一条任务
    expect(resolveSortMove([{ id: 'dup' }, { id: 'dup' }], 0, 1)).toBeNull()
    expect(resolveSortMove([{ id: 'dup' }, { id: 'dup' }], 1, 0)).toBeNull()
  })

  it('长度失真 / 带空洞的数组（下标取不到元素）安全返回 null 而不是崩', () => {
    // 过滤后与 SortableJS 的索引不同步时会读到空洞，这里必须挡住而不是抛 undefined.id
    const sparse = new Array<{ id: string }>(3)
    expect(resolveSortMove(sparse, 0, 2)).toBeNull()
  })
})
