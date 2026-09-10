import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import { DEFAULT_LINK_GROUP, LINK_STORAGE_KEY, MAX_LINK_TITLE } from '@/types/link'
import { useLinkStore } from '@/stores/linkStore'

describe('linkStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('新增链接：网址补 https://、标题去空白、空分组落进默认分组', async () => {
    const store = useLinkStore()
    const link = store.addLink({ title: '  示例站  ', url: 'example.com' })

    expect(link).not.toBeNull()
    expect(link!.title).toBe('示例站')
    expect(link!.url).toBe('https://example.com')
    expect(link!.group).toBe(DEFAULT_LINK_GROUP)
    expect(store.linkCount).toBe(1)
    expect(store.groups).toEqual([{ group: DEFAULT_LINK_GROUP, links: [link] }])

    // 持久化（useLocalStorage 走 watch 落盘，要等一个 tick）
    await nextTick()
    const raw = localStorage.getItem(LINK_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)[0].url).toBe('https://example.com')
  })

  it('新增链接：指定分组时按首次出现顺序分组', () => {
    const store = useLinkStore()
    store.addLink({ title: 'A', url: 'a.com', group: '工具' })
    store.addLink({ title: 'B', url: 'b.com', group: '学习' })
    store.addLink({ title: 'C', url: 'c.com', group: '工具' })

    expect(store.groups.map((b) => b.group)).toEqual(['工具', '学习'])
    expect(store.groups[0].links.map((l) => l.title)).toEqual(['A', 'C'])
    expect(store.allGroups).toEqual(['工具', '学习'])
  })

  it('标题非法时拒绝新增并返回 null', () => {
    const store = useLinkStore()

    expect(store.addLink({ title: '', url: 'example.com' })).toBeNull()
    expect(store.addLink({ title: '   ', url: 'example.com' })).toBeNull()
    expect(store.addLink({ title: '一'.repeat(MAX_LINK_TITLE + 1), url: 'example.com' })).toBeNull()
    expect(store.linkCount).toBe(0)
  })

  it('网址非法（含危险协议）时拒绝新增并返回 null', () => {
    const store = useLinkStore()

    expect(store.addLink({ title: '空网址', url: '' })).toBeNull()
    expect(store.addLink({ title: '带空格', url: 'exa mple.com' })).toBeNull()
    expect(store.addLink({ title: '没点', url: 'hello' })).toBeNull()
    expect(store.addLink({ title: '脚本', url: 'javascript:alert(1)' })).toBeNull()
    expect(store.addLink({ title: '内联页', url: 'data:text/html,<h1>x</h1>' })).toBeNull()
    expect(store.linkCount).toBe(0)
  })

  it('改标题与网址：网址依旧会被归一化', () => {
    const store = useLinkStore()
    const link = store.addLink({ title: '旧名', url: 'old.com' })!

    expect(store.updateLink(link.id, { title: '新名', url: 'new.com' })).toBe(true)
    expect(store.getLink(link.id)?.title).toBe('新名')
    expect(store.getLink(link.id)?.url).toBe('https://new.com')
  })

  it('改标题/网址非法时失败且原数据不变', () => {
    const store = useLinkStore()
    const link = store.addLink({ title: '原名', url: 'old.com' })!

    expect(store.updateLink(link.id, { title: '   ' })).toBe(false)
    expect(store.updateLink(link.id, { url: 'javascript:alert(1)' })).toBe(false)
    expect(store.updateLink('missing', { title: 'x' })).toBe(false)

    expect(store.getLink(link.id)?.title).toBe('原名')
    expect(store.getLink(link.id)?.url).toBe('https://old.com')
  })

  it('只改分组或图标时，其余字段（标题/网址/另一个字段）原样保留，其它链接不受影响', () => {
    const store = useLinkStore()
    const a = store.addLink({ title: 'A', url: 'a.com', group: '工具' })!
    const b = store.addLink({ title: 'B', url: 'b.com', group: '工具' })!

    // 只改分组：标题与网址必须原样（设置页的分组下拉就是这条路径）
    expect(store.updateLink(a.id, { group: '学习' })).toBe(true)
    expect(store.getLink(a.id)).toMatchObject({
      title: 'A',
      url: 'https://a.com',
      group: '学习',
      iconUrl: undefined,
    })
    // 同组另一条链接完全没被碰到
    expect(store.getLink(b.id)).toEqual(b)

    // 只改自定义图标：分组与其它字段不受影响
    expect(store.updateLink(a.id, { iconUrl: 'https://cdn.example.com/a.png' })).toBe(true)
    expect(store.getLink(a.id)).toMatchObject({
      title: 'A',
      url: 'https://a.com',
      group: '学习',
      iconUrl: 'https://cdn.example.com/a.png',
    })
    expect(store.getLink(b.id)).toEqual(b)
  })

  it('删除链接', () => {
    const store = useLinkStore()
    const a = store.addLink({ title: 'A', url: 'a.com' })!
    store.addLink({ title: 'B', url: 'b.com' })

    store.removeLink(a.id)
    expect(store.linkCount).toBe(1)
    expect(store.getLink(a.id)).toBeUndefined()
  })

  it('换分组：空串回到默认分组', () => {
    const store = useLinkStore()
    const link = store.addLink({ title: 'A', url: 'a.com', group: '工具' })!

    store.moveLink(link.id, '学习')
    expect(store.getLink(link.id)?.group).toBe('学习')
    expect(store.groups.map((b) => b.group)).toEqual(['学习'])

    store.moveLink(link.id, '')
    expect(store.getLink(link.id)?.group).toBe(DEFAULT_LINK_GROUP)
  })

  it('换分组只动那一条：同组其它链接留在原分组', () => {
    const store = useLinkStore()
    const a = store.addLink({ title: 'A', url: 'a.com', group: '工具' })!
    const b = store.addLink({ title: 'B', url: 'b.com', group: '工具' })!

    store.moveLink(a.id, '学习')

    expect(store.groups.map((bucket) => bucket.group)).toEqual(['学习', '工具'])
    // 拖一条链接去别的组，不该把同组的兄弟也带走
    expect(store.getLink(b.id)?.group).toBe('工具')
  })

  it('同组内排序：把 moved 插到 target 之前', () => {
    const store = useLinkStore()
    const a1 = store.addLink({ title: 'A1', url: 'a1.com', group: '工具' })!
    const a2 = store.addLink({ title: 'A2', url: 'a2.com', group: '工具' })!
    const a3 = store.addLink({ title: 'A3', url: 'a3.com', group: '工具' })!
    const b1 = store.addLink({ title: 'B1', url: 'b1.com', group: '学习' })!

    // A3 拖到 A1 之前
    store.reorderWithinGroup('工具', a3.id, a1.id)
    expect(store.groups[0].links.map((l) => l.id)).toEqual([a3.id, a1.id, a2.id])
    // 另一组不受影响
    expect(store.groups[1].links.map((l) => l.id)).toEqual([b1.id])

    // 再把 A2 插到 A1 之前（A3 A1 A2 → A3 A2 A1）
    store.reorderWithinGroup('工具', a2.id, a1.id)
    expect(store.groups[0].links.map((l) => l.id)).toEqual([a3.id, a2.id, a1.id])
  })

  it('同组内排序：跨组 / 找不到 / 原地不动时都不改动', () => {
    const store = useLinkStore()
    const a1 = store.addLink({ title: 'A1', url: 'a1.com', group: '工具' })!
    const b1 = store.addLink({ title: 'B1', url: 'b1.com', group: '学习' })!
    const before = store.links.map((l) => l.id)

    // 拿学习组的链接来排工具组：忽略
    store.reorderWithinGroup('工具', b1.id, a1.id)
    store.reorderWithinGroup('工具', a1.id, b1.id)
    // id 不存在 / 自己排自己
    store.reorderWithinGroup('工具', 'missing', a1.id)
    store.reorderWithinGroup('工具', a1.id, a1.id)

    expect(store.links.map((l) => l.id)).toEqual(before)
  })

  it('reset 清空全部链接', () => {
    const store = useLinkStore()
    store.addLink({ title: 'A', url: 'a.com' })
    store.addLink({ title: 'B', url: 'b.com' })

    store.reset()
    expect(store.linkCount).toBe(0)
    expect(store.groups).toEqual([])
  })

  it('crypto.randomUUID 不可用（非安全上下文 / 老浏览器）时退化为本地 id，功能照旧', () => {
    vi.stubGlobal('crypto', {})
    const store = useLinkStore()

    const a = store.addLink({ title: 'A', url: 'a.com' })!
    expect(a.id).toMatch(/^link-\d+-[a-z0-9]+$/)
    expect(store.getLink(a.id)?.url).toBe('https://a.com')
    // 降级 id 同样要唯一：同毫秒内连加两条不能撞（否则拖动排序/删除会误伤）
    const b = store.addLink({ title: 'B', url: 'b.com' })!
    expect(b.id).not.toBe(a.id)

    store.removeLink(a.id)
    expect(store.links.map((l) => l.id)).toEqual([b.id])
  })
})
