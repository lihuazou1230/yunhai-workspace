/**
 * 快捷导航（Link Dock）领域类型。
 *
 * 设计要点：**分组只存名字，不建分组实体**——空分组（空串）在展示时归入
 * `DEFAULT_LINK_GROUP`，所以用户删到只剩一个链接也不会留下空壳分组，
 * 组名改了也不需要迁移任何 id（见 utils/linkHelper.ts 的 groupLinks）。
 */

/** 单条快捷链接 */
export interface LinkItem {
  id: string
  title: string
  url: string
  /** 分组名，空串表示未分组 */
  group: string
  /** 用户手动指定图标时用；否则自动抓 favicon */
  iconUrl?: string
}

/** localStorage 键 */
export const LINK_STORAGE_KEY = 'smart-workspace:links'

/** 新链接默认落进的分组名 */
export const DEFAULT_LINK_GROUP = '常用'

/** 标题长度上限（过长会挤坏图标卡的标题行） */
export const MAX_LINK_TITLE = 24
