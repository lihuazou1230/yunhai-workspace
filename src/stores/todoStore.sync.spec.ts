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

    /**
     * 回归：离线改动曾被「云端为准」的赋值吞掉。
     *
     * 场景就是真实的「断网改一下 → 关掉应用 → 联网再打开」。
     * 队列里只存 `{todoId, type}`，而补发是拿 id 去**当前的** todos 里现取内容；
     * 若不在覆盖前把队列翻译成本地差异，赋值会把本地版本换成云端版本，
     * 于是补发推的是云端那一份 —— 改动静默蒸发，且用户毫无提示。
     */
    it('离线编辑后重开应用：本地改动不被云端结果覆盖（回归）', async () => {
      // 1) 首次登录：本地已有数据 → 走一次性迁移并标记「已迁移」
      const first = useTodoStore()
      const created = first.addTodo({ title: 'v1', priority: 'medium' })
      remote.fetchRemoteTodos.mockResolvedValue([])
      await first.activateCloud('u1')
      await settle()
      expect(first.syncQueue).toEqual([])

      // 2) 断网后编辑：改动只能进队列
      setOnline(false)
      first.updateTodo(created.id, { title: 'v2-离线编辑' })
      await settle()
      expect(first.syncQueue).toEqual([{ todoId: created.id, type: 'upsert' }])

      // 3) 「重开应用」= 新的 pinia（syncUserId 从 null 开始），此时云端仍是 v1
      setActivePinia(createPinia())
      setOnline(true)
      remote.fetchRemoteTodos.mockResolvedValue([todo({ id: created.id, title: 'v1' })])

      const second = useTodoStore()
      await second.activateCloud('u1')
      await settle()

      // 本地必须保住离线期间的版本
      expect(second.todos.map((t) => t.title)).toEqual(['v2-离线编辑'])
      // 且补发上去的也必须是它（不是被覆盖后的云端版本）
      const pushed = remote.pushRemoteTodos.mock.calls.flatMap((call) => {
        const [, entries] = call as unknown as [string, Array<{ todo: Todo }>]
        return entries.map((entry) => entry.todo.title)
      })
      expect(pushed).toContain('v2-离线编辑')
      expect(second.syncQueue).toEqual([])
    })

    /**
     * 同一根因的第二个症状：本地已删、云端还没删的那条，会在本地「复活」
     * （云端结果里还带着它，而删除操作推不上去 / 推之前界面先被覆盖）。
     */
    it('离线删除后重开应用：任务不会在本地复活（回归）', async () => {
      const first = useTodoStore()
      const created = first.addTodo({ title: '要删的', priority: 'low' })
      remote.fetchRemoteTodos.mockResolvedValue([])
      await first.activateCloud('u1')
      await settle()

      // 模拟「删除已入队但还没推成功」
      setOnline(false)
      first.syncQueue = [{ todoId: created.id, type: 'delete' }]
      await settle()

      // 重开应用：云端仍然留着这条
      setActivePinia(createPinia())
      setOnline(true)
      remote.fetchRemoteTodos.mockResolvedValue([todo({ id: created.id, title: '要删的' })])

      const second = useTodoStore()
      await second.activateCloud('u1')
      await settle()

      expect(second.todos).toEqual([])
      expect(remote.deleteRemoteTodos).toHaveBeenCalledWith([created.id])
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

  describe('激活云同步的边界情况', () => {
    it('迁移标记读不出来（隐私模式 SecurityError）时按「没迁移过」处理：重跑一次幂等迁移而不是直接失败', async () => {
      const store = useTodoStore()
      store.addTodo({ title: '本地任务', priority: 'medium' })

      // 隐私模式 / 禁用 Cookie 时，连 localStorage.getItem 都会抛 SecurityError
      const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: localStorage is disabled')
      })
      try {
        // 先确认桩真的生效了（否则下面的 isMigrated false 只是「读不到标记」的假绿）
        expect(() => localStorage.getItem(migrationKey('u1'))).toThrow('SecurityError')

        expect(store.isMigrated('u1')).toBe(false)
        // 读不到标记 ⇒ 视为未迁移 ⇒ 走一次性迁移（merge + 全量 upsert，本身幂等，重跑无害）
        const ok = await store.activateCloud('u1')
        expect(ok).toBe(true)
        expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)
        expect(store.syncState).toBe('synced')
      } finally {
        spy.mockRestore()
      }
    })

    it('激活期间的新增不会被云端结果吞掉，且会补发到云端', async () => {
      // 本地缓存已经属于 u1（adopt-remote）：云端为准，激活时会用远端列表覆盖本地
      localStorage.setItem(SYNC_OWNER_KEY, JSON.stringify('u1'))
      const store = useTodoStore()

      let release!: (todos: Todo[]) => void
      remote.fetchRemoteTodos.mockImplementation(
        () =>
          new Promise<Todo[]>((resolve) => {
            release = resolve
          }),
      )

      const activating = store.activateCloud('u1')
      // 真实场景：登录成功后用户立刻记一笔，此时云端还在拉取
      const late = store.addTodo({ title: '拉取期间新增', priority: 'high' })
      await settle()
      release([todo({ id: 'cloud-1', title: '云端任务' })])
      await activating
      await settle()

      // 这条曾经锁定的是一个数据丢失缺陷：拉取前的基准快照缺失，「补差」比的是同一份数据、
      // 差异恒为空，于是拉取期间的改动既没进队列、又被 next 覆盖。
      // 现在：云端任务照常拉下来，用户期间新增的也在，并且会被推回云端。
      expect(store.todos.map((t) => t.id)).toEqual(['cloud-1', late.id])
      expect(store.syncQueue).toEqual([])
      expect(remote.pushRemoteTodos).toHaveBeenCalled()

      const pushed: string[] = []
      for (const call of remote.pushRemoteTodos.mock.calls) {
        for (const entry of call[1] as Array<{ todo: Todo }>) pushed.push(entry.todo.id)
      }
      expect(pushed).toContain(late.id)
    })

    it('未登录时手动「立即同步」是空操作：不发任何请求，也不谎报成功', async () => {
      const store = useTodoStore()
      store.addTodo({ title: '本地任务', priority: 'low' })
      await settle()

      expect(await store.syncNow()).toBe(false)

      expect(remote.fetchRemoteTodos).not.toHaveBeenCalled()
      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()
      expect(store.syncState).toBe('local')
    })

    it('activateCloud 收到空 userId 时直接返回 false（不给云端发一个 user_id 为空的查询）', async () => {
      const store = useTodoStore()

      expect(await store.activateCloud('')).toBe(false)

      expect(remote.fetchRemoteTodos).not.toHaveBeenCalled()
      expect(store.syncUserId).toBeNull()
    })

    it('队列为空 + 之前是离线 → 联网后同步把状态扳回 synced（角标不能一直显示离线）', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      const unbind = store.bindConnectivity()
      // 断网事件把状态置为 offline，但此时并没有攒下任何待补发操作
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
      expect(store.syncState).toBe('offline')
      expect(store.syncQueue).toEqual([])

      setOnline(true)
      expect(await store.syncNow()).toBe(true)

      expect(store.syncState).toBe('synced')
      unbind()
    })

    it('没有 window（SSR / 非浏览器宿主）时 bindConnectivity 返回空解绑函数，不抛错', () => {
      const store = useTodoStore()
      vi.stubGlobal('window', undefined)

      const unbind = store.bindConnectivity()

      expect(typeof unbind).toBe('function')
      expect(() => unbind()).not.toThrow()
      vi.unstubAllGlobals()
    })

    it('只改标签 / 归档 / 到期日 时也能推送（差异指纹里带这些字段）', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      const created = store.addTodo({ title: '要归档的任务', priority: 'medium' })
      await settle()
      remote.pushRemoteTodos.mockClear()

      store.archive(created.id)
      await settle()

      // 归档必须自己就能触发推送——它不改 title/status 等老字段，
      // 所以 todoSignature 里必须有 archived，否则「只归档」永远同步不到其它设备。
      expect(remote.pushRemoteTodos).toHaveBeenCalledTimes(1)

      // 对照：这条推送确实带上了归档状态
      const [, entries] = remote.pushRemoteTodos.mock.calls[0] as [
        string,
        Array<{ todo: { archived?: boolean } }>,
      ]
      expect(entries[0].todo.archived).toBe(true)
    })

    it('队列里指向「本地已经没有的任务」时跳过该条推送（刷新的旧队列可能指向已删任务）', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      // 模拟刷新页面后从 localStorage 读回来的陈旧队列：任务已经不在了
      store.syncQueue = [{ todoId: 'ghost-todo', type: 'upsert' }]

      expect(await store.syncNow()).toBe(true)

      // 不为幽灵任务发请求，但队列要照常排空（否则它会永远堵在队头，后面的改动全推不出去）
      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()
      expect(store.syncQueue).toEqual([])
      expect(store.syncState).toBe('synced')
    })

    it('未登录时网络状态变化不发任何同步请求，本地模式也不会被标成「离线」', async () => {
      const store = useTodoStore()
      await store.activateCloud('u1')
      await store.deactivateCloud()
      const unbind = store.bindConnectivity()
      // 激活/退出过程中本来就有请求，这里只关心「事件之后」有没有新请求
      remote.fetchRemoteTodos.mockClear()
      remote.pushRemoteTodos.mockClear()

      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('offline'))
      await settle()

      expect(remote.fetchRemoteTodos).not.toHaveBeenCalled()
      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()
      // 没登录就没有「离线待补发」这回事，侧边栏不该弹离线提示
      expect(store.syncState).toBe('local')
      unbind()
    })

    it('未登录时调 deactivateCloud 是空操作（退出登录流程可以无脑调用）', async () => {
      const store = useTodoStore()
      store.addTodo({ title: '本地任务', priority: 'low' })

      await expect(store.deactivateCloud()).resolves.toBeUndefined()

      expect(remote.pushRemoteTodos).not.toHaveBeenCalled()
      expect(store.syncState).toBe('local')
      expect(store.syncUserId).toBeNull()
    })
  })
})
