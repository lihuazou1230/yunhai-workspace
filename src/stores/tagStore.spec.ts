import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import { TAG_STORAGE_KEY } from '@/types/tag'
import { useTagStore } from './tagStore'

describe('tagStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('新建标签：去空白、生成 id、可持久化', async () => {
    const store = useTagStore()
    const tag = store.addTag({ name: '  工作  ', color: 'sky' })

    expect(tag).not.toBeNull()
    expect(tag!.name).toBe('工作')
    expect(tag!.color).toBe('sky')
    expect(store.tagCount).toBe(1)

    // 持久化（useLocalStorage 走 watch 落盘，要等一个 tick）
    await nextTick()
    const raw = localStorage.getItem(TAG_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)[0].name).toBe('工作')
  })

  it('非法名与重名都被拒绝并返回 null', () => {
    const store = useTagStore()
    store.addTag({ name: '工作', color: 'sky' })

    expect(store.addTag({ name: '', color: 'sky' })).toBeNull()
    expect(store.addTag({ name: '   ', color: 'sky' })).toBeNull()
    expect(store.addTag({ name: '一'.repeat(13), color: 'sky' })).toBeNull()
    expect(store.addTag({ name: '工作', color: 'rose' })).toBeNull()
    // 忽略大小写
    expect(store.addTag({ name: 'WORK', color: 'rose' })).not.toBeNull()
    expect(store.addTag({ name: 'work', color: 'rose' })).toBeNull()

    expect(store.tagCount).toBe(2)
  })

  it('改名与改色：成功后所有引用处自动生效（任务只存 id）', () => {
    const store = useTagStore()
    const tag = store.addTag({ name: '工作', color: 'sky' })!

    expect(store.updateTag(tag.id, { name: '职场' })).toBe(true)
    expect(store.getTag(tag.id)?.name).toBe('职场')

    expect(store.updateTag(tag.id, { color: 'violet' })).toBe(true)
    expect(store.getTag(tag.id)?.color).toBe('violet')
  })

  it('改名遇到重名或非法名时失败且不改动原数据', () => {
    const store = useTagStore()
    const a = store.addTag({ name: '工作', color: 'sky' })!
    store.addTag({ name: '生活', color: 'rose' })

    expect(store.updateTag(a.id, { name: '生活' })).toBe(false)
    expect(store.updateTag(a.id, { name: '   ' })).toBe(false)
    expect(store.getTag(a.id)?.name).toBe('工作')
  })

  it('只改名字或只改颜色时，另一个字段必须原样保留', () => {
    const store = useTagStore()
    const tag = store.addTag({ name: '工作', color: 'sky' })!

    // 只改名（设置页的改名输入框）：颜色不能被顺手重置
    expect(store.updateTag(tag.id, { name: '职场' })).toBe(true)
    expect(store.getTag(tag.id)).toMatchObject({ name: '职场', color: 'sky' })

    // 只改色（调色板）：名字不能被清掉
    expect(store.updateTag(tag.id, { color: 'violet' })).toBe(true)
    expect(store.getTag(tag.id)).toMatchObject({ name: '职场', color: 'violet' })

    // 名字前后空白会被去掉（否则重名判定会出现「工作」与「工作 」两个标签）
    expect(store.updateTag(tag.id, { name: '  工作  ' })).toBe(true)
    expect(store.getTag(tag.id)?.name).toBe('工作')
  })

  it('改不存在的标签返回 false', () => {
    const store = useTagStore()
    expect(store.updateTag('nope', { name: 'x' })).toBe(false)
  })

  it('删除标签：只删标签自己', () => {
    const store = useTagStore()
    const a = store.addTag({ name: '工作', color: 'sky' })!
    store.addTag({ name: '生活', color: 'rose' })

    store.removeTag(a.id)
    expect(store.tagCount).toBe(1)
    expect(store.getTag(a.id)).toBeUndefined()
  })

  it('getTags 保持传入顺序并忽略找不到的 id', () => {
    const store = useTagStore()
    const a = store.addTag({ name: 'A', color: 'sky' })!
    const b = store.addTag({ name: 'B', color: 'rose' })!

    expect(store.getTags([b.id, 'missing', a.id]).map((t) => t.name)).toEqual(['B', 'A'])
    expect(store.getTags([])).toEqual([])
  })

  it('修改一个标签不会碰到其它标签（map 里没命中的原样返回）', () => {
    const store = useTagStore()
    const a = store.addTag({ name: '工作', color: 'sky' })!
    const b = store.addTag({ name: '生活', color: 'rose' })!
    const beforeB = { ...b }

    expect(store.updateTag(a.id, { name: '职场' })).toBe(true)

    // 改一个标签的名字/颜色，其它标签（以及它们的 id）必须一模一样
    expect(store.getTag(b.id)).toEqual(beforeB)
    expect(store.getTag(a.id)?.name).toBe('职场')
    expect(store.tagCount).toBe(2)
  })

  it('clearTags 清空标签表并落盘（标签没了≠任务没了，任务上的引用由调用方摘）', async () => {
    const store = useTagStore()
    store.addTag({ name: '工作', color: 'sky' })
    store.addTag({ name: '生活', color: 'rose' })

    store.clearTags()

    expect(store.tags).toEqual([])
    expect(store.tagCount).toBe(0)
    // 清空后重建同名标签不会被「重名」挡住（重名只看当前标签表）
    expect(store.addTag({ name: '工作', color: 'sky' })).not.toBeNull()

    await nextTick()
    expect(JSON.parse(localStorage.getItem(TAG_STORAGE_KEY)!)).toHaveLength(1)
  })

  it('reset 与 clearTags 同口径：标签没有「默认项」，恢复默认只能是清空', async () => {
    const store = useTagStore()
    store.addTag({ name: '工作', color: 'sky' })
    store.addTag({ name: '生活', color: 'rose' })

    store.reset()

    expect(store.tags).toEqual([])
    expect(store.tagCount).toBe(0)
    await nextTick()
    expect(JSON.parse(localStorage.getItem(TAG_STORAGE_KEY)!)).toEqual([])
  })
})
