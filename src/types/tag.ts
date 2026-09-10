/**
 * 任务标签（Tag）领域类型。
 *
 * 设计要点：**任务只存标签 id，不存名字**——改名时所有引用处自动生效（单一数据源），
 * 删标签时把 id 从任务上摘掉但**任务本身不删**（见 utils/tagHelper.ts）。
 */

/** 标签色（预置 8 色色板，创建标签时选一个） */
export type TagColor = 'slate' | 'rose' | 'amber' | 'emerald' | 'sky' | 'violet' | 'pink' | 'teal'

/** 单个标签 */
export interface Tag {
  id: string
  name: string
  color: TagColor
}

/** 新建标签入参 */
export type TagInput = Pick<Tag, 'name' | 'color'>

/** 预置色板（对齐 Finexy 风格：色点克制、不做高饱和填充） */
export const TAG_COLOR_PALETTE: readonly TagColor[] = [
  'slate',
  'rose',
  'amber',
  'emerald',
  'sky',
  'violet',
  'pink',
  'teal',
]

/**
 * 色名 -> 展示类名。
 * 写死完整类名而不是拼字符串：Tailwind 是静态扫描，`bg-${color}-500` 这类
 * 动态拼接在构建时扫不到，样式会整块丢失。
 */
export const TAG_COLOR_DOT: Record<TagColor, string> = {
  slate: 'bg-slate-400',
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500',
}

export const TAG_COLOR_TEXT: Record<TagColor, string> = {
  slate: 'text-slate-500 dark:text-slate-400',
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  sky: 'text-sky-600 dark:text-sky-400',
  violet: 'text-violet-600 dark:text-violet-400',
  pink: 'text-pink-600 dark:text-pink-400',
  teal: 'text-teal-600 dark:text-teal-400',
}

/** 色名 -> 中文名（设置页与创建表单无障碍描述用） */
export const TAG_COLOR_LABEL: Record<TagColor, string> = {
  slate: '灰',
  rose: '红',
  amber: '琥珀',
  emerald: '绿',
  sky: '天蓝',
  violet: '紫',
  pink: '粉',
  teal: '青',
}

/** 标签名长度上限（过长会挤坏列表行） */
export const MAX_TAG_NAME_LENGTH = 12

/** localStorage 键 */
export const TAG_STORAGE_KEY = 'smart-workspace:tags'

/** 是否合法色名 */
export function isTagColor(value: unknown): value is TagColor {
  return typeof value === 'string' && (TAG_COLOR_PALETTE as readonly string[]).includes(value)
}
