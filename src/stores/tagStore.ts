/**
 * 标签状态（Pinia）：标签 CRUD + localStorage 持久化。
 *
 * 关键约束：
 * - 标签只存**名字与颜色**，任务侧只引用 id（改名不影响任务数据）
 * - 删除标签时由调用方（组件/store）配合 `stripTagFromTodos` 摘掉任务上的引用，
 *   这里只负责「标签自己」的生命周期——职责清晰，也避免两个 store 互相写
 */

import { computed } from 'vue'

import { defineStore } from 'pinia'

import { useLocalStorage } from '@/composables/useLocalStorage'
import { TAG_STORAGE_KEY } from '@/types/tag'
import type { Tag, TagInput } from '@/types/tag'
import { createTag, findTag, isTagNameTaken, isValidTagName } from '@/utils/tagHelper'

export const useTagStore = defineStore('tag', () => {
  const tags = useLocalStorage<Tag[]>(TAG_STORAGE_KEY, [])

  /** 标签总数 */
  const tagCount = computed(() => tags.value.length)

  /** 按 id 取标签 */
  function getTag(id: string): Tag | undefined {
    return findTag(tags.value, id)
  }

  /** 批量取标签（保持传入顺序，找不到的忽略） */
  function getTags(ids: readonly string[]): Tag[] {
    return ids.map((id) => findTag(tags.value, id)).filter((t): t is Tag => t !== undefined)
  }

  /**
   * 新建标签。
   * @returns 新建的标签；名字非法或重名时返回 null（由 UI 给出提示）
   */
  function addTag(input: TagInput): Tag | null {
    if (!isValidTagName(input.name)) return null
    if (isTagNameTaken(tags.value, input.name)) return null
    const tag = createTag(input)
    tags.value = [...tags.value, tag]
    return tag
  }

  /**
   * 改名 / 改色。
   * @returns 是否成功（名字非法或与其他标签重名时失败）
   */
  function updateTag(id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>): boolean {
    const current = findTag(tags.value, id)
    if (!current) return false

    if (patch.name !== undefined) {
      if (!isValidTagName(patch.name)) return false
      if (isTagNameTaken(tags.value, patch.name, id)) return false
    }

    tags.value = tags.value.map((t) =>
      t.id === id
        ? {
            ...t,
            name: patch.name !== undefined ? patch.name.trim() : t.name,
            color: patch.color ?? t.color,
          }
        : t,
    )
    return true
  }

  /** 删除标签（任务上的引用由调用方用 stripTagFromTodos 摘掉；任务本身不删） */
  function removeTag(id: string) {
    tags.value = tags.value.filter((t) => t.id !== id)
  }

  /** 清空全部标签 */
  function clearTags() {
    tags.value = []
  }

  /** 重置为初始状态（测试与「恢复默认」用） */
  function reset() {
    tags.value = []
  }

  return {
    tags,
    tagCount,
    getTag,
    getTags,
    addTag,
    updateTag,
    removeTag,
    clearTags,
    reset,
  }
})
