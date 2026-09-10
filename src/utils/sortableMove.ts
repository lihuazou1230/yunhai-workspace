/**
 * 拖拽排序的索引换算（纯函数，便于单测）
 *
 * 为什么要单独抽出来：SortableJS 只告诉我们「从第 oldIndex 拖到了第 newIndex」，
 * 而 store 的 `moveTodo(movedId, targetId)` 认的是**任务 id**。中间的换算一旦写错，
 * 表现是「拖了但顺序不对」这种很难查的问题，所以抽成纯函数钉住行为。
 *
 * 注意：索引是在**当前可见列表**（`filteredTodos`，已过滤+排序）里的下标，
 * 不是底层 `todos` 数组的下标。二者不同没关系——`moveTodo` 是把 moved 插到 target 之前，
 * 相对位置一致即可。
 */

export interface SortMove {
  /** 被拖动的任务 id */
  movedId: string
  /** 目标位置的任务 id（moved 会插到它之前） */
  targetId: string
}

/**
 * 把 SortableJS 的索引换算成一次移动意图；无效或原地不动时返回 null。
 */
export function resolveSortMove<T extends { id: string }>(
  list: readonly T[],
  oldIndex: number | null | undefined,
  newIndex: number | null | undefined,
): SortMove | null {
  if (oldIndex === null || oldIndex === undefined) return null
  if (newIndex === null || newIndex === undefined) return null
  if (!Number.isInteger(oldIndex) || !Number.isInteger(newIndex)) return null
  if (oldIndex === newIndex) return null
  if (oldIndex < 0 || newIndex < 0) return null
  if (oldIndex >= list.length || newIndex >= list.length) return null

  const moved = list[oldIndex]
  const target = list[newIndex]
  if (!moved || !target) return null
  if (moved.id === target.id) return null

  return { movedId: moved.id, targetId: target.id }
}
