/**
 * 快捷导航状态（Pinia）：链接 CRUD + 分组 + localStorage 持久化。
 *
 * 职责边界：**所有校验与分组规则都在 linkHelper 的纯函数里**，这里只做
 * 「读改写本地数组 + 落盘」，方便单测与复用。
 */

import { computed } from 'vue'

import { defineStore } from 'pinia'

import { useLocalStorage } from '@/composables/useLocalStorage'
import { LINK_STORAGE_KEY } from '@/types/link'
import type { LinkItem } from '@/types/link'
import { groupLinks, isValidLinkTitle, normalizeGroupName, normalizeUrl } from '@/utils/linkHelper'

/** 新建链接的入参（group 省略或为空 = 落进默认分组） */
export interface LinkDraft {
  title: string
  url: string
  group?: string
}

/** 生成链接 id（crypto 不可用时退化为时间戳 + 随机串） */
function createId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `link-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const useLinkStore = defineStore('link', () => {
  const links = useLocalStorage<LinkItem[]>(LINK_STORAGE_KEY, [])

  /** 链接总数 */
  const linkCount = computed(() => links.value.length)

  /** 分组后的链接（分组顺序 = 首次出现顺序；未分组归入默认分组） */
  const groups = computed(() => groupLinks(links.value))

  /** 分组下拉用的组名清单：直接取分组结果，天然去重且顺序稳定 */
  const allGroups = computed<string[]>(() => groups.value.map((bucket) => bucket.group))

  /** 按 id 取链接 */
  function getLink(id: string): LinkItem | undefined {
    return links.value.find((l) => l.id === id)
  }

  /**
   * 新建链接。
   * @returns 新建的链接；标题非法或网址归一化失败时返回 null（由 UI 给提示）
   */
  function addLink(input: LinkDraft): LinkItem | null {
    const title = input.title.trim()
    if (!isValidLinkTitle(title)) return null

    const url = normalizeUrl(input.url)
    if (!url) return null

    const link: LinkItem = {
      id: createId(),
      title,
      url,
      // 空分组直接落成「常用」而不是留空串：展示上二者等价（groupLinks 会把空串也归到常用），
      // 但存下真名字能让分组下拉里有据可依，不会出现一个没有名字的选项
      group: normalizeGroupName(input.group ?? ''),
    }
    links.value = [...links.value, link]
    return link
  }

  /**
   * 改标题 / 网址 / 分组 / 自定义图标。
   * @returns 是否成功（标题非法、网址归一化失败或 id 不存在时返回 false，且不改动原数据）
   */
  function updateLink(
    id: string,
    patch: Partial<Pick<LinkItem, 'title' | 'url' | 'group' | 'iconUrl'>>,
  ): boolean {
    const current = getLink(id)
    if (!current) return false

    let title = current.title
    if (patch.title !== undefined) {
      if (!isValidLinkTitle(patch.title)) return false
      title = patch.title.trim()
    }

    let url = current.url
    if (patch.url !== undefined) {
      const normalized = normalizeUrl(patch.url)
      if (!normalized) return false
      url = normalized
    }

    const group = patch.group !== undefined ? normalizeGroupName(patch.group) : current.group
    const iconUrl = patch.iconUrl !== undefined ? patch.iconUrl : current.iconUrl

    links.value = links.value.map((l) => (l.id === id ? { ...l, title, url, group, iconUrl } : l))
    return true
  }

  /** 删除链接 */
  function removeLink(id: string) {
    links.value = links.value.filter((l) => l.id !== id)
  }

  /** 换分组（空分组 = 回到默认分组） */
  function moveLink(id: string, group: string) {
    const target = normalizeGroupName(group)
    links.value = links.value.map((l) => (l.id === id ? { ...l, group: target } : l))
  }

  /**
   * 同组内排序：把 movedId 插到 targetId **之前**（沿用 todoStore.moveTodo 的语义）。
   *
   * 只动链接自身的相对顺序，不碰分组字段；跨组调用直接忽略——
   * 「换个组」是 `moveLink` 的活，混在一起会出现「拖一下就悄悄换了分组」的怪现象。
   */
  function reorderWithinGroup(group: string, movedId: string, targetId: string) {
    if (movedId === targetId) return

    const key = normalizeGroupName(group)
    const list = [...links.value]
    const movedIdx = list.findIndex((l) => l.id === movedId)
    const targetIdx = list.findIndex((l) => l.id === targetId)
    if (movedIdx < 0 || targetIdx < 0) return
    if (
      normalizeGroupName(list[movedIdx].group) !== key ||
      normalizeGroupName(list[targetIdx].group) !== key
    ) {
      return
    }

    const [moved] = list.splice(movedIdx, 1)
    list.splice(targetIdx, 0, moved)
    links.value = list
  }

  /** 重置（测试与「清空数据」用） */
  function reset() {
    links.value = []
  }

  return {
    links,
    linkCount,
    groups,
    allGroups,
    getLink,
    addLink,
    updateLink,
    removeLink,
    moveLink,
    reorderWithinGroup,
    reset,
  }
})
