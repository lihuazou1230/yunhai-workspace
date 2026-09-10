/**
 * WxPusher 微信推送的客户端纯函数（第六阶段 6.5）
 *
 * 只放「不依赖网络、不依赖浏览器状态」的东西，方便单测：
 * - UID 校验（用户级凭证，BYOK 存 localStorage；appToken 在服务端 Secrets，前端永远看不到）
 * - 推送文案拼装（**含 HTML 转义**，见下）
 * - 深链生成（通知点回来要落在那条任务上）
 *
 * ⚠️ 转义不是可选项：WxPusher 的 HTML 消息（contentType=2）由微信直接渲染，
 * 而任务标题是**用户自己输入的、完全不可信的字符串**。不转义的话，
 * 标题里写个 `<script>` 或 `<img onerror=...>` 就变成了注入面。
 * 同理，标题里的 `&`/`<`/`>` 不转义还会让消息排版错乱（`<` 后面的内容被当成标签吞掉）。
 */

import { appUrl } from './appUrl'

/** UID 存 localStorage 的键（BYOK：用户级凭证存本地，不落服务端） */
export const WXPUSHER_UID_KEY = 'smart-workspace:wxpusher-uid'

/** WxPusher 官网（设置页「去哪儿拿 UID」的引导链接） */
export const WXPUSHER_APP_URL = 'https://wxpusher.zjiecode.com/'

/**
 * 设置页的绑定引导文案。
 *
 * 为什么集中在这里而不是写在模板里：绑定分三步（扫码 → 复制 UID → 填回来验证），
 * 文案分散在组件里最容易改一处漏一处；设置页只负责排版。
 */
export const wxpusherBindHint = {
  title: '微信推送',
  intro: '绑定后在任务到期时把提醒发到微信，页面关着也能收到（需登录 + 免费 WxPusher 账号）。',
  step1: '1. 用微信扫描下方应用二维码并关注',
  step2: '2. 在 WxPusher 的会话消息里复制你的 UID（形如 UID_xxxxxxxx）',
  step3: '3. 把 UID 粘贴到下面保存，再点「发送测试消息」确认能收到',
  uidLabel: 'WxPusher UID',
  uidPlaceholder: 'UID_xxxxxxxxxxxxxxxxxxxxxxxx',
  invalid: 'UID 看起来不对：应是一串以 UID_ 开头的字符（从 WxPusher 消息里复制，别手打）',
  missing: '还没有填 UID：请先扫码关注并从消息里复制 UID',
  emptyWarning: '微信推送发送失败',
} as const

/**
 * UID 是否合法。
 *
 * 为什么不按 `^UID_[0-9a-f]{24}$` 这种精确格式卡死：UID 的具体长度与字符集属于
 * WxPusher 的内部实现，官方只承诺「UID_ 开头的用户标识」；写死格式一旦对方调整，
 * 就会把真实用户挡在门外——而这是用户手动粘贴的凭证，误判代价很高
 * （「我明明复制对了，它说格式错」）。所以只做**宽松但能挡住明显垃圾输入**的校验：
 * 去空白后长度 8~64、且只含字母数字下划线（真 UID 约 28 位，落在区间内）。
 */
export function isValidUid(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /^[A-Za-z0-9_]{8,64}$/.test(value.trim())
}

/** 需要嵌进 HTML 的文本转义（顺序很重要：`&` 必须先换，否则会把后面生成的实体二次转义） */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 拼给 `buildReminderMessage` 的任务子集（Todo 结构兼容，便于直接传整个 todo） */
export interface ReminderTodoLike {
  id?: string
  title: string
  dueDate?: string
}

/** 一条微信推送（与 `src/api/notify.ts` 的 NotifyPayload 除 uid 外一一对应） */
export interface WxPusherMessage {
  /** 通知栏摘要（服务端会按 100 字符截断） */
  title: string
  /** HTML 正文（已转义） */
  content: string
  /** 深链回应用对应任务 */
  url: string
}

/** 空标题的兜底文案：宁可显示「未命名任务」，也不要推一条没有主语的空消息 */
export const EMPTY_TODO_TITLE = '未命名任务'

/**
 * 深链：`<应用地址>#/todos?focus=<id>`。
 *
 * 应用可能挂在子路径下（GitHub Pages 的 `/<repo>/`），所以基地址由调用方给
 * ——默认取 `appUrl()`（见 `src/utils/appUrl.ts`，它已经算好了部署前缀）。
 * 有 id 时先把尾斜杠统一去掉再补一个，避免拼出 `.../repo//#/todos` 这种两种写法都不认的地址。
 *
 * 空 id 或空基地址时**原样返回基地址**：没有任务可聚焦时给应用首页，
 * 总好过给出一个 `#/todos?focus=` 的坏链接。
 */
export function deepLink(todoId: string, baseUrl: string = appUrl()): string {
  const base = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  if (!base) return ''
  const id = typeof todoId === 'string' ? todoId.trim() : ''
  // 没有 id 就原样返回（保留调用方给的尾斜杠，那才是应用首页的规范地址）
  if (!id) return base
  return `${base.replace(/\/+$/, '')}/#/todos?focus=${encodeURIComponent(id)}`
}

/**
 * 任务 → 微信推送内容（标题 + 截止信息 + 回跳链接）。
 *
 * 正文是 HTML 片段，配合服务端的 `contentType: 2`（HTML）发送；
 * 所有插值都经过 `escapeHtml`，任务标题里的标签只会原样显示，不会被渲染。
 */
export function buildReminderMessage(
  todo: ReminderTodoLike,
  baseUrl: string = appUrl(),
): WxPusherMessage {
  const rawTitle = typeof todo?.title === 'string' ? todo.title.trim() : ''
  const title = rawTitle || EMPTY_TODO_TITLE
  const dueDate = typeof todo?.dueDate === 'string' ? todo.dueDate.trim() : ''
  const url = deepLink(todo?.id ?? '', baseUrl)

  const lines = [
    '<div>',
    `<p><strong>${escapeHtml(title)}</strong></p>`,
    `<p>截止：${dueDate ? escapeHtml(dueDate) : '未设置'}</p>`,
    // 正文里的链接行：有些微信客户端会屏蔽 <a> 的跳转，所以同一个 url 还会作为
    // 消息的 `url` 字段交给 WxPusher（通知栏点开即落地），两条路径互为兜底
    url ? `<p><a href="${escapeHtml(url)}">点击查看任务</a></p>` : '',
    '</div>',
  ]

  return { title, content: lines.filter(Boolean).join(''), url }
}
