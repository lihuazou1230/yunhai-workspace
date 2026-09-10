import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import type { Todo } from '@/types/todo'
import { migrationKey } from '@/utils/todoSync'

/** 云端读写整块换成桩：只验证「该推什么、什么时候推、失败了怎么办」 */
const remote = vi.hoisted(() => ({
  fetchRemoteTodos: vi.fn<(userId: string) => Promise<Todo[]>>(async () => []),
  pushRemoteTodos: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  deleteRemoteTodos: vi.fn<(ids: readonly string[]) => Promise<void>>(async () => {}),
  clearRemoteTodos: vi.fn<(userId: string) => Promise<void>>(async () => {}),
}))

vi.mock('@/api/todoRemote', () => remote)

import { SYNC_OWNER_KEY, SYNC_QUEUE_KEY, useTodoStore } from './todoStore'

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'r1',
    title: '云端任务',
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-09T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...overrides,
  }
}

/** 等 watcher 与异步补发跑完 */
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

describe('todoStore · 云同步', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setOnline(true)
    remote.fetchRemoteTodos.mockResolvedValue([])
    remote.pushRemoteTodos.mockResolvedValue(undefined)
    remote.deleteRemoteTodos.mockResolvedValue(undefined)
    setActivePinia(createPinia())
  })

  describe('未登录（本地模式）', () => {
    it('没有任何云请求，行为与以前一致', async () => {
      const store = useTodoStore()
      store.addTodo({ title: '本地任务', priority: 'high' })
      await settle()

      expect(store.syncState).toBe('local')
      expect(remote.fetchRemoteTodos).not.toHaveBeenCalled()
      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()
      expect(store.totalCount).toBe(1)
    })
  })

  describe('激活云同步', () => {
    it('首次登录：本地旧数据一次性迁移到云端（并保留远端独有任务）', async () => {
      const store = useTodoStore()
      store.addTodo({ title: '本地 A', priority: 'high' })
      store.addTodo({ title: '本地 B', priority: 'low' })
      remote.fetchRemoteTodos.mockResolvedValue([todo({ id: 'remote-1', title: '别的设备加的' })])

      const ok = await store.activateCloud('u1')

      expect(ok).toBe(true)
      expect(remote.fetchRemoteTodos).toHaveBeenCalledWith('u1')
      // 迁移 = 合并后的全量写入（本地 2 条 + 远端独有 1 条）
      const [userId, entries] = remote.pushRemoteTodos.mock.calls[0] as unknown as [
        string,
        Array<{ todo: Todo; position: number }>,
      ]
      expect(userId).toBe('u1')
      expect(entries.map((e) => e.todo.title)).toEqual(['本地 A', '本地 B', '别的设备加的'])
      expect(entries.map((e) => e.position)).toEqual([0, 1, 2])
      // 本地列表 = 合并结果，两边都不丢
      expect(store.todos.map((t) => t.title)).toEqual(['本地 A', '本地 B', '别的设备加的'])
      expect(store.syncState).toBe('synced')
      expect(store.syncMessage).toContain('已把本地 2 条任务迁移到云端')
      expect(localStorage.getItem(migrationKey('u1'))).toBe('done')
      expect(localStorage.getItem(SYNC_OWNER_KEY)).toBe(JSON.stringify('u1'))
    })

    it('迁移只做一次：第二次登录直接以云端为准，本地缓存不再回推', async () => {
      const store = useTodoStore()
      store.addTodo({ title: '本地任务', priority: 'medium' })
      await store.activateCloud('u1')
      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)

      // 模拟「同账号在新设备登录」：本地缓存已有主人标记，云端是权威
      localStorage.setItem(SYNC_OWNER_KEY, JSON.stringify('u1'))
      setActivePinia(createPinia())
      remote.pushRemoteTodos.mockClear()
      remote.fetchRemoteTodos.mockResolvedValue([todo({ id: 'cloud-1' })])

      const fresh = useTodoStore()
      await fresh.activateCloud('u1')

      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()
      expect(fresh.todos.map((t) => t.id)).toEqual(['cloud-1'])
    })

    it('本地缓存属于另一个账号：先清空，绝不把上个账号的任务推到新账号', async () => {
      localStorage.setItem(SYNC_OWNER_KEY, JSON.stringify('u2'))
      localStorage.setItem('smart-workspace:todos', JSON.stringify([todo({ id: 'belongs-to-u2' })]))
      remote.fetchRemoteTodos.mockResolvedValue([todo({ id: 'u1-cloud' })])

      const store = useTodoStore()
      await store.activateCloud('u1')

      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()
      expect(store.todos.map((t) => t.id)).toEqual(['u1-cloud'])
    })

    it('云端拉取失败：降级为离线，本地数据照常可用', async () => {
      const store = useTodoStore()
      store.addTodo({ title: '本地任务', priority: 'medium' })
      remote.fetchRemoteTodos.mockRejectedValue(new Error('Failed to fetch'))

      const ok = await store.activateCloud('u1')

      expect(ok).toBe(false)
      expect(store.syncState).toBe('offline')
      expect(store.syncMessage).toContain('网络不可用')
      expect(store.totalCount).toBe(1)
    })

    it('重复激活同一账号只是再补发一次队列', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      remote.fetchRemoteTodos.mockClear()

      await store.activateCloud('u1')
      expect(remote.fetchRemoteTodos).not.toHaveBeenCalled()
    })
  })

  describe('写穿透（改动自动推送）', () => {
    beforeEach(async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      remote.pushRemoteTodos.mockClear()
      remote.deleteRemoteTodos.mockClear()
    })

    it('新增任务 → 推送 upsert（带顺序位）', async () => {
      const store = useTodoStore()
      const created = store.addTodo({ title: '新任务', priority: 'high' })
      await settle()

      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)
      const [userId, entries] = remote.pushRemoteTodos.mock.calls[0] as unknown as [
        string,
        Array<{ todo: Todo; position: number }>,
      ]
      expect(userId).toBe('u1')
      expect(entries[0].todo.id).toBe(created.id)
      expect(entries[0].position).toBe(0)
      expect(store.syncQueue).toEqual([])
    })

    it('完成 / 编辑 / 子任务 / 置顶都会推送（不必逐个动作手写同步代码）', async () => {
      const store = useTodoStore()
      const created = store.addTodo({ title: '待办', priority: 'low' })
      await settle()
      remote.pushRemoteTodos.mockClear()

      store.toggleComplete(created.id)
      await settle()
      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)

      remote.pushRemoteTodos.mockClear()
      store.addSubtask(created.id, '拆一步')
      await settle()
      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)

      remote.pushRemoteTodos.mockClear()
      store.togglePinned(created.id)
      await settle()
      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)
    })

    it('真正删除任务 → 推送 delete（软删除期间不动云端，撤销后也不会误删）', async () => {
      const store = useTodoStore()
      const created = store.addTodo({ title: '待删除', priority: 'low' })
      await settle()
      remote.deleteRemoteTodos.mockClear()

      // 软删除：不进云端
      store.removeTodo(created.id)
      await settle()
      expect(remote.deleteRemoteTodos).not.toHaveBeenCalled()

      // 撤销：本地恢复，云端本来就没事
      store.undoDelete(created.id)
      await settle()
      expect(remote.deleteRemoteTodos).not.toHaveBeenCalled()

      // 真正删除
      store.removeTodo(created.id)
      store.commitDelete(created.id)
      await settle()
      expect(remote.deleteRemoteTodos).toHaveBeenCalledWith([created.id])
    })

    it('拖拽排序 → 位置变化的那几条都会重新推送', async () => {
      const store = useTodoStore()
      const a = store.addTodo({ title: 'A', priority: 'low' })
      const b = store.addTodo({ title: 'B', priority: 'low' })
      await settle()
      remote.pushRemoteTodos.mockClear()

      store.moveTodo(b.id, a.id)
      await settle()

      const entries = remote.pushRemoteTodos.mock.calls.flatMap(
        (call) => (call as unknown as [string, Array<{ todo: Todo; position: number }>])[1],
      )
      expect(entries.map((e) => [e.todo.id, e.position])).toEqual([
        [b.id, 0],
        [a.id, 1],
      ])
    })

    it('无实际变化时不产生任何云端请求', async () => {
      const store = useTodoStore()
      store.addTodo({ title: '任务', priority: 'low' })
      await settle()
      remote.pushRemoteTodos.mockClear()

      store.setFilter('all')
      store.setKeyword('任务')
      store.toggleSelectionMode()
      await settle()

      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()
    })
  })

  describe('离线降级与补发', () => {
    it('断网时改动进队列并持久化，恢复网络后补发成功并清空队列', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')

      setOnline(false)
      const created = store.addTodo({ title: '断网期间新增', priority: 'high' })
      await settle()

      expect(store.syncState).toBe('offline')
      expect(store.syncMessage).toContain('离线模式')
      expect(store.syncQueue).toHaveLength(1)
      // 队列已持久化到 localStorage，刷新页面也不会丢
      expect(JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) ?? '[]')).toHaveLength(1)
      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()

      // 网络恢复 → 手动同步（浏览器 online 事件在 bindConnectivity 里）
      setOnline(true)
      const ok = await store.syncNow()

      expect(ok).toBe(true)
      expect(store.syncState).toBe('synced')
      expect(store.syncQueue).toEqual([])
      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)
      const [, entries] = remote.pushRemoteTodos.mock.calls[0] as unknown as [
        string,
        Array<{ todo: Todo }>,
      ]
      expect(entries[0].todo.id).toBe(created.id)
      expect(store.lastSyncedAt).toBeTruthy()
    })

    it('补发失败时保留队列，不清空（避免静默丢数据）', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      remote.pushRemoteTodos.mockRejectedValue(new Error('boom'))

      store.addTodo({ title: '推送失败的任务', priority: 'low' })
      await settle()

      expect(store.syncState).toBe('offline')
      expect(store.syncQueue).toHaveLength(1)
    })

    it('同一任务离线期间多次改动只留最后一次（队列不膨胀）', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      setOnline(false)

      const created = store.addTodo({ title: '草稿', priority: 'low' })
      store.updateTodo(created.id, { title: '草稿 v2' })
      store.togglePinned(created.id)
      await settle()

      expect(store.syncQueue).toEqual([{ todoId: created.id, type: 'upsert' }])

      setOnline(true)
      await store.syncNow()
      const [, entries] = remote.pushRemoteTodos.mock.calls[0] as unknown as [
        string,
        Array<{ todo: Todo }>,
      ]
      expect(entries[0].todo.title).toBe('草稿 v2')
      expect(entries[0].todo.pinned).toBe(true)
    })

    it('bindConnectivity：online 事件触发补发，解绑后不再触发', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')

      const unbind = store.bindConnectivity()

      // 断网期间的改动进队列，恢复联网的 online 事件负责补发
      setOnline(false)
      store.addTodo({ title: '离线任务', priority: 'low' })
      await settle()
      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()

      setOnline(true)
      window.dispatchEvent(new Event('online'))
      await settle()
      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)

      // 解绑后：断网改动只进队列，online 事件不再触发补发，手动同步仍可用
      unbind()
      remote.pushRemoteTodos.mockClear()
      setOnline(false)
      store.addTodo({ title: '解绑后的任务', priority: 'low' })
      await settle()
      setOnline(true)
      window.dispatchEvent(new Event('online'))
      await settle()
      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()

      await store.syncNow()
      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)
    })

    it('断网事件会把状态标记为离线（侧边栏/设置页据此提示）', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      const unbind = store.bindConnectivity()

      setOnline(false)
      window.dispatchEvent(new Event('offline'))

      expect(store.syncState).toBe('offline')
      expect(store.syncMessage).toContain('离线模式')
      unbind()
    })
  })

  describe('退出登录', () => {
    it('清空本地缓存与队列，避免下一个登录者看到别人的任务', async () => {
      const store = useTodoStore()
      store.addTodo({ title: '账号里的任务', priority: 'medium' })
      await store.activateCloud('u1')
      await settle()

      await store.deactivateCloud()

      expect(store.syncState).toBe('local')
      expect(store.syncUserId).toBeNull()
      expect(store.todos).toEqual([])
      expect(store.syncQueue).toEqual([])
      expect(localStorage.getItem(SYNC_OWNER_KEY)).toBe('null')
      expect(JSON.parse(localStorage.getItem('smart-workspace:todos') ?? '[]')).toEqual([])
    })

    it('退出前会把待补发的改动尽量送出去', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      setOnline(false)
      store.addTodo({ title: '还没来得及同步', priority: 'low' })
      await settle()
      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()

      setOnline(true)
      await store.deactivateCloud()

      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)
    })
  })
})
