/**
 * 账号级设置同步的**唯一清单**（第九阶段）。
 *
 * 为什么要有这份清单：一共有几十个 localStorage 键，其中「哪些跟账号走、哪些留在本机」
 * 是个产品决定而不是实现细节。散在各 store 里各写各的，迟早出现
 * 「主题同步了、壁纸没同步」「天气缓存被同步到另一座城市」这类说不清的行为。
 * 这里集中声明，设置页也直接读它来告诉用户**到底同步了什么**。
 */

/** 同步冲突策略 */
export type SettingMergeStrategy =
  /** 整值覆盖（默认）：以「谁最后改」为准，适合人工逐项编辑的设置 */
  | 'last-write-wins'
  /** 按日期键逐项取大：投入日志是单调递增的每日秒数，两台设备各记各的天，合并时不能丢 */
  | 'max-per-key'

/** 一个被同步的设置项 */
export interface SyncedKeyMeta {
  /** localStorage 键（同时也是云端的 key） */
  key: string
  /** 展示名（设置页列出「已同步 N 项」时用） */
  label: string
  /** 冲突策略（缺省 last-write-wins） */
  strategy?: SettingMergeStrategy
}

/**
 * 跟账号走的设置项。
 * 顺序即设置页的展示顺序（先外观、再内容、最后数据）。
 */
export const SYNCED_KEYS: readonly SyncedKeyMeta[] = [
  { key: 'smart-workspace:theme', label: '主题与外观' },
  { key: 'smart-workspace:wallpaper', label: '壁纸' },
  { key: 'smart-workspace:dashboard-order', label: '仪表板卡片顺序' },
  { key: 'smart-workspace:dashboard-customized', label: '仪表板自定义标记' },
  { key: 'smart-workspace:dashboard-hidden', label: '仪表板隐藏卡片' },
  { key: 'smart-workspace:dashboard-sizes', label: '仪表板卡片大小' },
  { key: 'smart-workspace:dashboard-week-goal', label: '周目标' },
  { key: 'smart-workspace:tags', label: '标签' },
  { key: 'smart-workspace:links', label: '快捷导航' },
  { key: 'smart-workspace:countdown-items', label: '纪念日倒计时' },
  { key: 'smart-workspace:countdown-payday', label: '发薪日' },
  { key: 'smart-workspace:earnings', label: '赚钱秒表配置' },
  { key: 'smart-workspace:earnings-compact', label: '秒表迷你模式' },
  { key: 'smart-workspace:worklog', label: '投入时长日志', strategy: 'max-per-key' },
  { key: 'smart-workspace:reminder-settings', label: '提醒设置' },
  { key: 'smart-workspace:search-engine', label: '默认搜索引擎' },
]

/** 同步项的键集合（判定用，O(1)） */
export const SYNCED_KEY_SET: ReadonlySet<string> = new Set(SYNCED_KEYS.map((item) => item.key))

/** 键 -> 展示名 */
export const SYNCED_KEY_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SYNCED_KEYS.map((item) => [item.key, item.label]),
)

/**
 * 刻意**留在本机**的键（写在这里是为了让「没同步」这个决定有出处、可解释）。
 * 设置页会把下面这份清单直接讲给用户听。
 */
export const LOCAL_ONLY_KEYS: readonly { key: string; label: string; reason: string }[] = [
  {
    key: 'smart-workspace:wxpusher-uid',
    label: '微信推送 UID',
    reason: '同上（应用 token 本就在 Supabase Edge Function 的 Secrets 里）',
  },
  {
    key: 'smart-workspace:reminder-notified',
    label: '已通知标记',
    reason: '同步会让另一台设备该提醒时被标成「已提醒」而静默不响',
  },
  {
    key: 'smart-workspace:last-place',
    label: '上次定位的城市',
    reason: '设备相关：手机与桌面本来就可能不在同一座城市',
  },
  {
    key: 'smart-workspace:geo-denied',
    label: '定位被拒标记',
    reason: '设备相关：一台拒了不代表另一台也拒了',
  },
  {
    key: 'smart-workspace:weather-cache',
    label: '天气缓存',
    reason: '设备相关同理，同步过去只会显示另一个城市的天气',
  },
  {
    key: 'smart-workspace:weather-forecast',
    label: '未来 3 日预报缓存',
    reason: '设备相关同理',
  },
  {
    key: 'smart-workspace:sidebar-collapsed',
    label: '侧边栏折叠状态',
    reason: '跟着屏幕尺寸走的界面细节，与账号无关',
  },
]

// ---- 同步层自己的键（都不上云） ----

/** 待推送的键列表（离线队列：只记「哪个键脏了」，推送时取当前值即可） */
export const SETTINGS_PENDING_KEY = 'smart-workspace:settings-pending'

/** 每个键「上次成功推送后云端返回的 updated_at」，用于判断云端是否被别的设备改过 */
export const SETTINGS_META_KEY = 'smart-workspace:settings-meta'

/** 本地数据的主人（userId / 'guest' / 'signed-out'），防止换账号时串数据 */
export const SETTINGS_OWNER_KEY = 'smart-workspace:settings-owner'

/** 上一个登录过的 userId：登出后再登同一个账号不算「换账号」，不该重置本地 */
export const SETTINGS_LAST_USER_KEY = 'smart-workspace:settings-last-user'
