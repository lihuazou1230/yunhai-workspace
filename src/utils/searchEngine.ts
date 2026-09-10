/**
 * 聚合搜索工具（纯函数，便于单测）。
 */

import { SEARCH_ENGINES, SEARCH_ENGINE_ORDER } from '@/types/search'
import type { SearchEngineId } from '@/types/search'

/** 校验是否为已知引擎（存 localStorage 的值可能来自旧版本或被人手改过） */
export function isSearchEngineId(value: unknown): value is SearchEngineId {
  // 必须用 Object.hasOwn 而不是 `in`：`'toString' in SEARCH_ENGINES` 会走原型链返回 true，
  // 于是 SEARCH_ENGINES['toString'].template 取到 undefined，拼 URL 时直接炸。
  // 这里的值来自可被用户手改的 localStorage，不是纯理论问题。
  return typeof value === 'string' && Object.hasOwn(SEARCH_ENGINES, value)
}

/** 收敛未知引擎为默认的百度 */
export function safeSearchEngine(value: unknown): SearchEngineId {
  return isSearchEngineId(value) ? value : 'baidu'
}

/** 按切换顺序轮换到下一个引擎 */
export function nextEngine(current: SearchEngineId): SearchEngineId {
  const index = SEARCH_ENGINE_ORDER.indexOf(current)
  return SEARCH_ENGINE_ORDER[(index + 1) % SEARCH_ENGINE_ORDER.length]
}

/**
 * 拼出搜索 URL。
 * 关键字一定走 `encodeURIComponent`：中文、`&`、`#` 这些字符不编码会把查询串截断。
 * 空关键字返回空串（调用方据此禁用按钮）。
 */
export function buildSearchUrl(engine: SearchEngineId, query: string): string {
  const keyword = query.trim()
  if (!keyword) return ''
  const target = SEARCH_ENGINES[safeSearchEngine(engine)]
  return target.template.replace('{q}', encodeURIComponent(keyword))
}

/**
 * 事件目标是否是可输入元素。
 * 用于判断快捷键该不该抢：光标已经在输入框里时，`/` 应该老老实实打出斜杠。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: string; isContentEditable?: boolean }
  const tag = (el.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

/**
 * 是否应触发「聚焦搜索框」：
 * - `Ctrl/Cmd + K`：任何位置都生效（包括正在输入时，这是命令面板的通行约定）
 * - `/`：只在非输入元素上生效，且不带任何修饰键
 */
export function shouldFocusSearch(ev: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: EventTarget | null
}): boolean {
  const key = ev.key

  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && key.toLowerCase() === 'k') return true

  if (key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    return !isEditableTarget(ev.target)
  }

  return false
}
