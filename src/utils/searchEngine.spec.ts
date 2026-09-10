import { describe, expect, it } from 'vitest'

import { SEARCH_ENGINES } from '@/types/search'
import {
  buildSearchUrl,
  isEditableTarget,
  isSearchEngineId,
  nextEngine,
  safeSearchEngine,
  shouldFocusSearch,
} from './searchEngine'

function keyEvent(partial: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  target?: unknown
}) {
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    altKey: partial.altKey ?? false,
    target: (partial.target ?? null) as EventTarget | null,
  }
}

describe('buildSearchUrl', () => {
  it('按引擎模板拼 URL', () => {
    expect(buildSearchUrl('baidu', 'vue3')).toBe('https://www.baidu.com/s?wd=vue3')
    expect(buildSearchUrl('google', 'vue3')).toBe('https://www.google.com/search?q=vue3')
    expect(buildSearchUrl('bing', 'vue3')).toBe('https://www.bing.com/search?q=vue3')
  })

  it('中文与特殊字符被正确编码（否则会把查询串截断）', () => {
    expect(buildSearchUrl('baidu', '前端 面试')).toBe(
      'https://www.baidu.com/s?wd=%E5%89%8D%E7%AB%AF%20%E9%9D%A2%E8%AF%95',
    )
    expect(buildSearchUrl('bing', 'a&b=c')).toContain('a%26b%3Dc')
    expect(buildSearchUrl('bing', 'c#d')).toContain('c%23d')
  })

  it('关键字去首尾空白；空关键字返回空串', () => {
    expect(buildSearchUrl('baidu', '  vue  ')).toBe('https://www.baidu.com/s?wd=vue')
    expect(buildSearchUrl('baidu', '')).toBe('')
    expect(buildSearchUrl('baidu', '   ')).toBe('')
  })

  it('未知引擎回落到百度', () => {
    expect(buildSearchUrl('unknown' as never, 'x')).toBe(
      SEARCH_ENGINES.baidu.template.replace('{q}', 'x'),
    )
  })
})

describe('引擎校验与轮换', () => {
  it('isSearchEngineId / safeSearchEngine', () => {
    expect(isSearchEngineId('baidu')).toBe(true)
    expect(isSearchEngineId('google')).toBe(true)
    expect(isSearchEngineId('sogou')).toBe(false)
    expect(isSearchEngineId(null)).toBe(false)
    expect(isSearchEngineId(42)).toBe(false)

    expect(safeSearchEngine('sogou')).toBe('baidu')
    expect(safeSearchEngine(null)).toBe('baidu')
    expect(safeSearchEngine('bing')).toBe('bing')
  })

  it('nextEngine 按 百度 → 谷歌 → 必应 → 百度 轮换', () => {
    expect(nextEngine('baidu')).toBe('google')
    expect(nextEngine('google')).toBe('bing')
    expect(nextEngine('bing')).toBe('baidu')
  })
})

describe('isEditableTarget', () => {
  it('输入类元素算「正在输入」', () => {
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
    expect(
      isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true)
  })

  it('普通元素与 null 不算', () => {
    expect(isEditableTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(undefined as unknown as EventTarget)).toBe(false)
  })
})

describe('shouldFocusSearch（Ctrl+K 与 / 快捷键）', () => {
  it('Ctrl+K / Cmd+K 在任何位置都生效（包括正在输入框里）', () => {
    const inInput = { tagName: 'INPUT' } as unknown as EventTarget
    expect(shouldFocusSearch(keyEvent({ key: 'k', ctrlKey: true }))).toBe(true)
    expect(shouldFocusSearch(keyEvent({ key: 'K', metaKey: true }))).toBe(true)
    expect(shouldFocusSearch(keyEvent({ key: 'k', ctrlKey: true, target: inInput }))).toBe(true)
  })

  it('Ctrl+Alt+K 不生效（避免和系统/浏览器快捷键打架）', () => {
    expect(shouldFocusSearch(keyEvent({ key: 'k', ctrlKey: true, altKey: true }))).toBe(false)
  })

  it('单独的 k 不生效', () => {
    expect(shouldFocusSearch(keyEvent({ key: 'k' }))).toBe(false)
  })

  it('“/” 只在非输入元素上生效', () => {
    expect(shouldFocusSearch(keyEvent({ key: '/' }))).toBe(true)
    expect(
      shouldFocusSearch(
        keyEvent({ key: '/', target: { tagName: 'INPUT' } as unknown as EventTarget }),
      ),
    ).toBe(false)
  })

  it('“/” 带修饰键时不生效', () => {
    expect(shouldFocusSearch(keyEvent({ key: '/', ctrlKey: true }))).toBe(false)
    expect(shouldFocusSearch(keyEvent({ key: '/', metaKey: true }))).toBe(false)
  })

  it('其它按键不生效', () => {
    expect(shouldFocusSearch(keyEvent({ key: 'Enter' }))).toBe(false)
    expect(shouldFocusSearch(keyEvent({ key: 'Escape' }))).toBe(false)
  })
})
