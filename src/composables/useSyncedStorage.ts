/**
 * 账号级设置同步（第九阶段）：把主题、标签、快捷导航、倒计时、仪表板布局、秒表配置、
 * 投入日志、提醒设置、壁纸这类**偏好数据**跟着账号走，做到「同账号在任何设备上都是同一套」。
 *
 * 设计取舍（每一条都对应一类真实故障）：
 *
 * 1. **本地优先**：读写先落 localStorage（同步、瞬时、离线可用），云端只是"另一个副本"。
 *    绝不做成"先等网络回来再渲染"——那样断网就等于应用坏了。
 * 2. **一行一个 key，逐键合并**：整坨 JSON 上传的话，手机上改主题会把桌面上刚调的卡片顺序一起覆盖。
 *    拆键之后冲突范围收敛到"同一个设置项"，而同一个设置项几乎总是同一个人改的。
 * 3. **localStorage 是本地唯一真相，ref 只是视图**：同一个键可能被多处持有
 *    （`useEarnings` 在 App.vue 与秒表卡各一次、`useWorkLog` 更是四个页面都有），
 *    所以同步层不去"挑一个 ref 当代表"，而是读存储、并把云端值写回**所有**订阅者。
 * 4. **冲突判定不看本机时钟**：只比较「本地是否有未推送的改动」+「云端 updated_at 是否变过我上次推上去的值」。
 *    两端时钟不一致（笔记本时区/时间被改）也不会算错。
 * 5. **离线队列只记"哪个键脏了"**：推送时取当前值。设置项是**整值快照**语义，
 *    重放旧操作反而会把中间态推上去。
 * 6. **跨账号隔离**：`settings-owner` 记住本地这份数据属于谁。换账号登录时先把本地重置为默认再拉新账号的，
 *    否则会把 A 的偏好推进 B 的账号（同一台电脑换人用很常见）。
 *    登出后再登**同一个**账号不算换账号（靠 `settings-last-user`），不会白重置一次。
 * 7. **凭证与设备相关项一律不上云**：清单见 `types/settings.ts`
 *    （AI Key / 微信 UID / 天气缓存 / 已通知标记 / 定位记忆…）。
 */

import { computed, reactive, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { isSupabaseConfigured } from '@/api/supabase'
import {
  fetchRemoteSetting,
  fetchRemoteSettings,
  upsertRemoteSetting,
} from '@/api/userSettingsRemote'
import { useLocalStorage } from '@/composables/useLocalStorage'
import {
  LOCAL_ONLY_KEYS,
  SETTINGS_LAST_USER_KEY,
  SETTINGS_META_KEY,
  SETTINGS_OWNER_KEY,
  SETTINGS_PENDING_KEY,
  SYNCED_KEYS,
  SYNCED_KEY_SET,
} from '@/types/settings'

/**
 * 本地改完多久后推云端。
 * 主题色是拖取色器改的（一秒几十次变化），不防抖就是几十个请求；
 * 800ms 足够把"连续调整"合成一次，又不至于让用户切设备时等太久。
 */
export const SETTINGS_PUSH_DEBOUNCE_MS = 800

/** 新注册的键延迟拉取（合并成一次全量请求，避免每个 store 各打一次） */
const SETTINGS_PULL_DEBOUNCE_MS = 300

/** 同步状态（单例，设置页直接读） */
export interface SettingsSyncStatus {
  /** 正在同步（拉取/推送中） */
  syncing: boolean
  /** 最近一次成功同步的时间（ISO；空串表示本次会话还没成功过） */
  lastSyncedAt: string
  /** 最近一次失败原因（空串表示没有问题） */
  lastError: string
  /** 云端已有的设置项数量（最近一次拉取时看到的） */
  cloudKeys: number
}

/** 一个持有某个键的 ref（生产里同一个键可能有多个实例） */
interface SyncedSubscriber {
  ref: Ref<unknown>
  /** 该实例用的存储（测试会注入假存储；undefined = window.localStorage） */
  storage: Storage | null | undefined
}

interface SyncedEntry {
  key: string
  /** 默认值的稳定序列化（判断"本地是不是还是空的"，用于首次登录迁移） */
  defaultJson: string
  subscribers: SyncedSubscriber[]
  /** 合并策略（缺省：云端整值覆盖本地） */
  merge?: (local: unknown, cloud: unknown) => unknown
}

export interface SyncedStorageOptions<T> {
  /** 归一化（同 useLocalStorage 的第 4 个参数）：存储里的值是脏数据 */
  normalize?: (value: unknown) => T
  /** 合并策略（默认 LWW） */
  merge?: (local: T, cloud: T) => T
  /** 可注入存储（测试用） */
  storage?: Storage | null
}

// ---- 单例状态 ----

/** 已注册的同步项（key -> 订阅者集合）。store 是懒创建的，所以注册也是懒的 */
const entries = new Map<string, SyncedEntry>()

/** 施加云端值时抑制"本地被改了"的判定 */
let applying = false

/**
 * 待推送项的**最新本地值**（内存态，不持久化）。
 *
 * 为什么不直接读 localStorage 推送：`useLocalStorage` 落盘是异步的（watch flush 'pre'），
 * 而"改完立刻手动点同步"或防抖窗口刚到时，存储里可能还是上一版——
 * 推上去的就是旧值（甚至默认值），用户会看到"同步成功但云端没变"。
 * 刷新页面后这张表是空的，退回读存储（那时存储一定是最新的）。
 */
const dirtyValues = new Map<string, unknown>()

/** 当前激活的账号（null = 未登录 / 本地模式） */
let currentUserId: string | null = null

let pushTimer: ReturnType<typeof setTimeout> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null

const pending = useLocalStorage<string[]>(SETTINGS_PENDING_KEY, [])
const meta = useLocalStorage<Record<string, string>>(SETTINGS_META_KEY, {})
const owner = useLocalStorage<string | null>(SETTINGS_OWNER_KEY, null)
const lastUser = useLocalStorage<string | null>(SETTINGS_LAST_USER_KEY, null)

const status = reactive<SettingsSyncStatus>({
  syncing: false,
  lastSyncedAt: '',
  lastError: '',
  cloudKeys: 0,
})

// ---- 小工具 ----

/** 稳定序列化（对象键排序），避免"同一份数据、键序不同"被判成有差异 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/** 面板文案用的失败原因（拿不到 message 时退化成字符串，绝不抛） */
export function describeSettingsSyncError(error: unknown): string {
  if (!error) return '同步失败'
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return String(error)
}

function isPending(key: string): boolean {
  return pending.value.includes(key)
}

function addPending(key: string) {
  if (isPending(key)) return
  pending.value = [...pending.value, key]
}

function removePending(key: string) {
  dirtyValues.delete(key)
  if (!isPending(key)) return
  pending.value = pending.value.filter((item) => item !== key)
}

function rememberPushedAt(key: string, updatedAt: string) {
  if (!updatedAt) return
  meta.value = { ...meta.value, [key]: updatedAt }
}

function defaultStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null
}

/** 该键的本地存储（取第一个订阅者注入的那个，生产里都是 window.localStorage） */
function storageOf(entry: SyncedEntry): Storage | null {
  const injected = entry.subscribers.find((item) => item.storage !== undefined)?.storage
  return injected === undefined ? defaultStorage() : injected
}

/**
 * 读本地当前值：**以存储为准**（同一键的多个 ref 里，谁是最新的只有存储知道）。
 *
 * 存储里没有这一项时返回**默认值的副本**（而不是退回内存里那个 ref）：
 * 后者在"刚改完还没落盘"的瞬间已经是新值了，会让"本地改了没有"的判断得出相反结论——
 * 这也是本文件最容易写错的一处（第一版就踩了：本地改动永远进不了推送队列）。
 * 返回副本而不是默认值本身：默认对象可能正被某个 store 原地改写（如 `prefs.value.mode = x`）。
 */
function readLocal(entry: SyncedEntry): unknown {
  const storage = storageOf(entry)
  if (storage) {
    try {
      const raw = storage.getItem(entry.key)
      return raw === null
        ? (JSON.parse(entry.defaultJson) as unknown)
        : (JSON.parse(raw) as unknown)
    } catch {
      // 存储坏了/被禁用：退回内存态（功能降级，但不抛）
    }
  }
  return entry.subscribers[0]?.ref.value
}

/** 把值写进存储 + **所有**订阅者 ref */
function writeLocal(entry: SyncedEntry, value: unknown) {
  const storage = storageOf(entry)
  if (storage) {
    try {
      storage.setItem(entry.key, JSON.stringify(value))
    } catch {
      // 容量满/隐私模式：内存态照常更新，别让同步把界面带崩
    }
  }
  applying = true
  try {
    for (const subscriber of entry.subscribers) subscriber.ref.value = value
  } finally {
    applying = false
  }
}

/** 本地当前值就是默认值吗（是的话就没必要为它往云端写一行） */
function isDefaultValue(entry: SyncedEntry): boolean {
  return stableStringify(readLocal(entry)) === entry.defaultJson
}

// ---- 注册 ----

/**
 * 声明一个「跟账号走」的 localStorage 键。
 *
 * 用法与 `useLocalStorage` 一致，只是多了云同步：
 * ```ts
 * const prefs = useSyncedStorage<ThemePrefs>(THEME_STORAGE_KEY, { ...DEFAULT_THEME })
 * ```
 */
export function useSyncedStorage<T>(
  key: string,
  defaultValue: T,
  options: SyncedStorageOptions<T> = {},
): Ref<T> {
  const data = useLocalStorage<T>(key, defaultValue, options.storage, options.normalize) as Ref<T>

  // 只同步清单里的键：写错 key 时会明说，而不是"默默不同步"（那才是最难查的 bug）
  if (!SYNCED_KEY_SET.has(key)) {
    if (import.meta.env?.DEV) {
      console.warn(`[settings-sync] "${key}" 不在 SYNCED_KEYS 清单里，不会被同步`)
    }
    return data
  }

  // 泛型合并函数在注册表里按 unknown 存取（表内不关心具体类型，调用处已由 options.merge 保证）
  const merge = options.merge as unknown as
    ((local: unknown, cloud: unknown) => unknown) | undefined

  const existing = entries.get(key)
  const entry: SyncedEntry = existing ?? {
    key,
    defaultJson: stableStringify(defaultValue),
    subscribers: [],
    merge,
  }
  if (existing && merge && !existing.merge) existing.merge = merge
  if (!existing) entries.set(key, entry)

  const subscriber: SyncedSubscriber = { ref: data as Ref<unknown>, storage: options.storage }
  entry.subscribers.push(subscriber)

  /**
   * 本地一改就标脏。
   * 必须 `flush: 'sync'`：默认的异步回调会在"施加云端值"之后才跑，
   * 那时 `applying` 已经复位，于是自己拉下来的值又被自己标成待推送（来回打请求）。
   *
   * 只在**已登录**时标脏：本地模式下的改动不该进队列，否则"很久以前在本地随手改过一次"
   * 会在登录时覆盖掉账号里更新的那份设置（笔电上改主题 → 手机上登录 → 主题被顶回旧的）。
   */
  watch(
    data,
    () => {
      if (applying || !currentUserId) return
      // 内容与存储里的一致就跳过：某些键会被"回灌"（如 useEarnings 的 config ↔ stored 双向同步），
      // 那只是对象身份变了、内容没变，不该让它变成一次云端写入
      if (stableStringify(data.value) === stableStringify(readLocal(entry))) return
      // 记下最新值：推送时优先用它（存储落盘是异步的，可能还差一拍）
      dirtyValues.set(key, data.value)
      addPending(key)
      schedulePush()
    },
    { deep: true, flush: 'sync' },
  )

  // store 是懒创建的：已在同步状态下的键要补拉一次（合并成一次全量请求）
  if (currentUserId) schedulePull()

  return data
}

// ---- 推送 ----

function schedulePush() {
  if (!currentUserId || !isSupabaseConfigured()) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    void flushSettingsPending()
  }, SETTINGS_PUSH_DEBOUNCE_MS)
}

/**
 * 待推送的值。
 *
 * 合并型键（投入日志）**必须先读云端再合并**，不能直接推本地快照：
 * 直接用本地覆盖，会把云端另一台设备记的那些天抹掉——而这份数据是不可再生的
 * （用户不会记得三天前在另一台电脑上工作了几小时）。
 * 代价是每次推送多一个单键查询，而它一分钟最多一次。
 */
async function valueForPush(userId: string, entry: SyncedEntry): Promise<unknown> {
  const local = dirtyValues.has(entry.key) ? dirtyValues.get(entry.key) : readLocal(entry)
  if (!entry.merge) return local

  try {
    const remote = await fetchRemoteSetting(userId, entry.key)
    if (!remote) return local
    const merged = entry.merge(local, remote.value)
    // 合并结果也写回本机：两台设备各记一半时，本机同样该看到全量
    if (stableStringify(merged) !== stableStringify(local)) writeLocal(entry, merged)
    return merged
  } catch {
    // 读不到云端就退回本地值（推上去至少不丢本机这份）
    return local
  }
}

/**
 * 把待推送的项逐个推上去。
 * @returns 成功推送的项数（断网时从失败那一项开始保留在队列里，等下次联网/手动同步）
 */
export async function flushSettingsPending(): Promise<number> {
  const userId = currentUserId
  if (!userId || pending.value.length === 0) return 0

  let pushed = 0
  for (const key of [...pending.value]) {
    const entry = entries.get(key)
    if (!entry) {
      removePending(key)
      continue
    }
    try {
      rememberPushedAt(
        key,
        await upsertRemoteSetting(userId, key, await valueForPush(userId, entry)),
      )
      removePending(key)
      pushed++
    } catch (error) {
      status.lastError = describeSettingsSyncError(error)
      // 网络断了就别继续打剩下的键（后面的多半也会失败，只是白白等超时）
      break
    }
  }

  if (pushed > 0) {
    status.lastSyncedAt = new Date().toISOString()
    status.lastError = ''
  }
  return pushed
}

// ---- 拉取 ----

function applyCloudValue(entry: SyncedEntry, cloudValue: unknown, updatedAt: string) {
  const local = readLocal(entry)
  const merged = entry.merge ? entry.merge(local, cloudValue) : cloudValue
  writeLocal(entry, merged)
  rememberPushedAt(entry.key, updatedAt)

  // 合并结果比云端多出东西（例如两台设备各记了不同的投入日志）→ 回推一次，让云端也齐
  if (entry.merge && stableStringify(merged) !== stableStringify(cloudValue)) {
    addPending(entry.key)
    schedulePush()
  }
}

/**
 * 拉全量并逐键合并。
 * @returns 是否成功（失败时 `status.lastError` 有原因）
 */
export async function pullSettings(): Promise<boolean> {
  const userId = currentUserId
  if (!userId || !isSupabaseConfigured()) return false

  status.syncing = true
  try {
    const cloud = await fetchRemoteSettings(userId)
    status.cloudKeys = Object.keys(cloud).length

    for (const [key, entry] of entries) {
      const remote = cloud[key]
      if (!remote) {
        // 云端还没有这一项：本地不是默认值就推上去（= 第一次登录时把本机设置迁到账号里）
        if (!isPending(key) && !isDefaultValue(entry)) addPending(key)
        continue
      }
      // 本地有没推上去的改动 → 以本地为准，交给 flush 去覆盖云端
      if (isPending(key)) continue

      const pushedAt = meta.value[key] ?? ''
      if (pushedAt && Date.parse(remote.updatedAt) <= Date.parse(pushedAt)) continue
      applyCloudValue(entry, remote.value, remote.updatedAt)
    }

    status.lastSyncedAt = new Date().toISOString()
    status.lastError = ''
    return true
  } catch (error) {
    status.lastError = describeSettingsSyncError(error)
    return false
  } finally {
    status.syncing = false
  }
}

function schedulePull() {
  if (!currentUserId || !isSupabaseConfigured()) return
  if (pullTimer) clearTimeout(pullTimer)
  pullTimer = setTimeout(() => {
    pullTimer = null
    void pullSettings()
  }, SETTINGS_PULL_DEBOUNCE_MS)
}

// ---- 生命周期 ----

/** 把本地所有同步项重置为默认值（换账号时用，避免把上一个账号的偏好写进新账号） */
function resetLocalToDefaults() {
  for (const entry of entries.values()) writeLocal(entry, JSON.parse(entry.defaultJson))
  pending.value = []
  meta.value = {}
}

/**
 * 登录后激活设置同步。
 * - 首次在**本机**登录（此前是本地模式）：把本机已有设置推上账号（一次性迁移）
 * - 换了一个账号登录：先把本地重置为默认，再拉新账号的（绝不把 A 的偏好写进 B）
 */
export async function activateSettingsSync(userId: string): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return
  if (currentUserId === userId) return

  const previous = owner.value
  const sameAccount = previous === userId || lastUser.value === userId
  // previous 为 null/'guest' = 本机数据从来只属于本地访客 → 迁到账号里，不算换账号
  const switchingAccount = previous !== null && previous !== 'guest' && !sameAccount
  if (switchingAccount) resetLocalToDefaults()

  owner.value = userId
  lastUser.value = userId
  currentUserId = userId

  await pullSettings()
  await flushSettingsPending()
}

/** 登出：停掉推送，并记住"本机这份数据属于某个已登出的账号"（下次换账号要重置） */
export function deactivateSettingsSync(): void {
  currentUserId = null
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  if (pullTimer) {
    clearTimeout(pullTimer)
    pullTimer = null
  }
  if (owner.value !== null && owner.value !== 'guest') owner.value = 'signed-out'
}

/** 手动「立即同步」：先推本地待办，再拉云端（顺序不能反：反了会被云端旧值盖掉本地新改动） */
export async function syncSettingsNow(): Promise<boolean> {
  if (!currentUserId) return false
  await flushSettingsPending()
  const ok = await pullSettings()
  await flushSettingsPending()
  return ok
}

/** 联网后重试（App.vue 挂在 window online 上） */
export function retrySettingsSync(): void {
  if (!currentUserId) return
  void flushSettingsPending().then(() => pullSettings())
}

// ---- 对外状态（设置页用） ----

export interface UseSettingsSyncReturn {
  status: SettingsSyncStatus
  /** 待推送的键（含展示名） */
  pendingItems: ComputedRef<{ key: string; label: string }[]>
  /** 待推送数量 */
  pendingCount: ComputedRef<number>
  /** 已推到云端的键数量 */
  syncedCount: ComputedRef<number>
  /** 正在同步 */
  syncing: ComputedRef<boolean>
  /** 全部同步项（展示「同步了哪些」） */
  syncedKeys: typeof SYNCED_KEYS
  /** 刻意不同步的项（附原因，给用户一个交代） */
  localOnlyKeys: typeof LOCAL_ONLY_KEYS
  syncNow: () => Promise<boolean>
}

/**
 * **仅供测试**：把同步层的内存状态清干净。
 *
 * 生产代码不要调用。存在的理由：这是个模块级单例（`pending` / `meta` / `owner` /
 * 已注册的订阅者都活在模块作用域里），而单测只清 localStorage 是清不掉内存态的——
 * 上一条用例留下的 pending 会让下一条用例莫名其妙地"多推了一次"。
 */
export function __resetSettingsSyncForTests(): void {
  entries.clear()
  dirtyValues.clear()
  pending.value = []
  meta.value = {}
  owner.value = null
  lastUser.value = null
  currentUserId = null
  applying = false
  if (pushTimer) clearTimeout(pushTimer)
  if (pullTimer) clearTimeout(pullTimer)
  pushTimer = null
  pullTimer = null
  status.syncing = false
  status.lastSyncedAt = ''
  status.lastError = ''
  status.cloudKeys = 0
}

export function useSettingsSync(): UseSettingsSyncReturn {
  const pendingItems = computed(() =>
    pending.value.map((key) => ({
      key,
      label: SYNCED_KEYS.find((item) => item.key === key)?.label ?? key,
    })),
  )
  const syncedCount = computed(() => Object.keys(meta.value).length)
  const syncing = computed(() => status.syncing)
  const pendingCount = computed(() => pending.value.length)

  return {
    status,
    pendingItems,
    pendingCount,
    syncedCount,
    syncing,
    syncedKeys: SYNCED_KEYS,
    localOnlyKeys: LOCAL_ONLY_KEYS,
    syncNow: syncSettingsNow,
  }
}
