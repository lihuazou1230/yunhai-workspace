import { describe, expect, it } from 'vitest'

import type { LinkItem } from '@/types/link'
import { DEFAULT_LINK_GROUP, MAX_LINK_TITLE } from '@/types/link'
import { faviconUrl, groupLinks, hostOf, isValidLinkTitle, normalizeUrl } from '@/utils/linkHelper'

function link(partial: Partial<LinkItem> & { id: string }): LinkItem {
  return { title: '站点', url: 'https://example.com', group: '', ...partial }
}

describe('normalizeUrl', () => {
  it.each<[string, string | null]>([
    // 缺协议时补 https://
    ['example.com', 'https://example.com'],
    ['  example.com  ', 'https://example.com'],
    ['example.com/path?a=1', 'https://example.com/path?a=1'],
    // 带协议的原样保留
    ['https://example.com', 'https://example.com'],
    ['http://x/y', 'http://x/y'],
    ['https://example.com:8443/path?q=1#h', 'https://example.com:8443/path?q=1#h'],
    // 域名:端口 不是协议（协议名不含点），按裸地址补 https://
    ['example.com:8080/x', 'https://example.com:8080/x'],
    // 空 / 垃圾输入
    ['', null],
    ['   ', null],
    ['exa mple.com', null],
    ['example.com\nfoo', null],
    ['hello', null],
    ['中文域名', null],
    ['.com', null],
    ['example.', null],
    // 没有主机名的地址根本打不开
    ['https://', null],
    ['https:///path', null],
    ['https://?q=1', null],
  ])('%j → %j', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected)
  })

  it('拒绝非 http(s) 协议（安全相关：这些地址进了 href 就是 XSS 口子）', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('JavaScript:alert(1)')).toBeNull()
    expect(normalizeUrl('jAvAsCrIpT:void(0)')).toBeNull()
    expect(normalizeUrl('javascript://example.com/%0aalert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,<h1>hi</h1>')).toBeNull()
    expect(normalizeUrl('vbscript:msgbox(1)')).toBeNull()
    expect(normalizeUrl('file:///C:/Windows/System32')).toBeNull()
    expect(normalizeUrl('ftp://example.com')).toBeNull()
    expect(normalizeUrl('mailto:someone@example.com')).toBeNull()
    // 不带 // 的 http(s) 属于畸形写法，同样拒绝
    expect(normalizeUrl('https:example.com')).toBeNull()
  })

  it('协议大小写不敏感，白名单内的照常放行', () => {
    expect(normalizeUrl('HTTPS://Example.com/a')).toBe('HTTPS://Example.com/a')
    expect(normalizeUrl('HTTP://example.com')).toBe('HTTP://example.com')
  })
})

describe('hostOf', () => {
  it('取主机名并去掉开头的 www.', () => {
    expect(hostOf('https://www.example.com/a/b')).toBe('example.com')
    expect(hostOf('https://example.com')).toBe('example.com')
  })

  it('保留子域名、丢掉端口、统一小写', () => {
    expect(hostOf('https://sub.example.com:8080/a')).toBe('sub.example.com')
    expect(hostOf('http://WWW.Example.COM:80')).toBe('example.com')
  })

  it('解析不了时返回空串', () => {
    expect(hostOf('example.com')).toBe('')
    expect(hostOf('not a url')).toBe('')
    expect(hostOf('')).toBe('')
  })
})

describe('faviconUrl', () => {
  it('拼 Google s2 图标服务地址（域名已去 www.）', () => {
    expect(faviconUrl('https://www.example.com/x')).toBe(
      'https://www.google.com/s2/favicons?domain=example.com&sz=64',
    )
    expect(faviconUrl('https://github.com')).toBe(
      'https://www.google.com/s2/favicons?domain=github.com&sz=64',
    )
  })

  it('尺寸可指定', () => {
    expect(faviconUrl('https://github.com', 32)).toBe(
      'https://www.google.com/s2/favicons?domain=github.com&sz=32',
    )
  })

  it('主机名解析不出来时返回空串（交给上层走首字母兜底）', () => {
    expect(faviconUrl('garbage')).toBe('')
    expect(faviconUrl('')).toBe('')
  })
})

describe('groupLinks', () => {
  it('按首次出现顺序分组', () => {
    const result = groupLinks([
      link({ id: '1', group: '工具' }),
      link({ id: '2', group: '学习' }),
      link({ id: '3', group: '工具' }),
    ])

    expect(result.map((b) => b.group)).toEqual(['工具', '学习'])
    expect(result[0].links.map((l) => l.id)).toEqual(['1', '3'])
    expect(result[1].links.map((l) => l.id)).toEqual(['2'])
  })

  it('未分组（空串 / 只有空白）归入默认分组，且与显式写「常用」的合并', () => {
    const result = groupLinks([
      link({ id: '1', group: '' }),
      link({ id: '2', group: '   ' }),
      link({ id: '3', group: DEFAULT_LINK_GROUP }),
      link({ id: '4', group: '工具' }),
    ])

    expect(result.map((b) => b.group)).toEqual([DEFAULT_LINK_GROUP, '工具'])
    expect(result[0].links.map((l) => l.id)).toEqual(['1', '2', '3'])
  })

  it('空输入返回空数组', () => {
    expect(groupLinks([])).toEqual([])
  })
})

describe('isValidLinkTitle', () => {
  it('去空白后非空即合法', () => {
    expect(isValidLinkTitle('GitHub')).toBe(true)
    expect(isValidLinkTitle('  知乎  ')).toBe(true)
    expect(isValidLinkTitle('')).toBe(false)
    expect(isValidLinkTitle('    ')).toBe(false)
  })

  it('长度边界：正好 24 字可以，25 字不行（首尾空白不计入）', () => {
    expect(isValidLinkTitle('一'.repeat(MAX_LINK_TITLE))).toBe(true)
    expect(isValidLinkTitle('一'.repeat(MAX_LINK_TITLE + 1))).toBe(false)
    expect(isValidLinkTitle(`  ${'一'.repeat(MAX_LINK_TITLE)}  `)).toBe(true)
  })
})
