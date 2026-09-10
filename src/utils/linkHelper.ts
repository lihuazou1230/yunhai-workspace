/**
 * 快捷导航相关的纯函数（URL 归一化 / 主机名 / favicon / 分组）。
 *
 * 抽成纯函数的两个原因：
 * 1. **安全**：URL 归一化是唯一拦得住 `javascript:` / `data:` 这类危险地址的地方，
 *    「用户输入 → 直接塞进 `<a href>`」等于把 XSS 的口子交给浏览器，所以规则必须钉死并单测。
 * 2. 分组、图标兜底这类展示规则最容易出现「列表一套、计数另一套」，用纯函数统一口径。
 */

import { DEFAULT_LINK_GROUP, MAX_LINK_TITLE } from '@/types/link'
import type { LinkItem } from '@/types/link'

/** 放行的协议白名单：只有 http(s) 允许写进 href */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/** 形如 `scheme://`：分层协议，能明确判断是不是白名单里的 */
const HIERARCHICAL_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i

/** 形如 `scheme:` 但不带 `//`：`javascript:` / `data:` / `mailto:` 走这条 */
const OPAQUE_SCHEME = /^([a-z][a-z0-9+.-]*):/i

/** 是否像主机名：必须有至少一个点，且不在首尾（`hello`、`.com`、`example.` 都不算） */
function looksLikeHost(hostname: string): boolean {
  return hostname.includes('.') && !hostname.startsWith('.') && !hostname.endsWith('.')
}

/**
 * 取 `scheme://` 之后的 authority 段（到第一个 `/`、`?`、`#` 为止）。
 * 用文本切分而不是 `parsed.hostname`：各家 URL 实现对 `https:///path` 这种空主机的
 * 处理并不一致（浏览器与 happy-dom 的结果就不同），判定必须不依赖实现细节。
 */
function authorityOf(candidate: string): string {
  const start = candidate.indexOf('://') + 3
  return start <= 2 ? '' : (candidate.slice(start).split(/[/?#]/, 1)[0] ?? '')
}

/**
 * 用户输入 → 可安全放进 `<a href>` 的绝对地址；不合法返回 null。
 *
 * - 缺协议时补 `https://`（`example.com` → `https://example.com`）
 * - **拒绝一切非 http(s) 协议**：`javascript:`、`data:`、`vbscript:`、`mailto:`、`ftp:` 全部返回 null
 * - 含空白（"exa mple.com"、粘贴带换行的地址）一律判非法
 * - 补协议前要求主机带点：`hello` 这种明显不是域名的输入被挡掉；
 *   但**用户自己写了 `http://` 就照单全收**（`http://x/y`、`http://localhost:5173` 都是有效地址，
 *   再要求带点反而会把内网地址误杀）
 */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (/\s/.test(raw)) return null

  const hierarchical = HIERARCHICAL_SCHEME.exec(raw)
  if (hierarchical) {
    if (!ALLOWED_PROTOCOLS.has(`${hierarchical[1].toLowerCase()}:`)) return null
  } else {
    const opaque = OPAQUE_SCHEME.exec(raw)
    // 点号不可能是协议名的一部分——`example.com:8080` 是「域名:端口」而不是协议，
    // 所以只有名副其实的协议名（不含点）才按协议处理，其余当裸地址补 https://
    if (opaque && !opaque[1].includes('.')) return null
  }

  const candidate = hierarchical ? raw : `https://${raw}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }

  // 双保险：即使 new URL 认了某种冷门写法，也必须在白名单里
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null
  // 没有主机名的地址（`https:///path`、`https://?q=1`）根本打不开，一律当非法
  if (!authorityOf(candidate)) return null
  if (!hierarchical && !looksLikeHost(parsed.hostname)) return null

  // 刻意不用 url.toString()：它会给裸域名补尾斜杠（example.com → https://example.com/），
  // 而展示与持久化都希望保留用户输入的原样形式
  return candidate
}

/** 取主机名（去掉开头的 `www.`，统一小写）；解析失败返回空串 */
export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return ''
  }
}

/**
 * 抓站点图标的地址（Google s2 服务）：`<host>` 已去掉 www.，同一站点只缓存一份。
 *
 * 兜底策略（由组件负责接线，见 LinkDock.vue）：
 * 1. 用户指定了 `iconUrl` 就优先用它，否则用这里的 s2 地址；
 * 2. s2 抓不到（`@error`）→ 退到站点自己的 `/favicon.ico`；
 * 3. 还是失败 → 用标题首字母色块兜底，永远不会留下一个空缺的图标位。
 */
export function faviconUrl(url: string, size = 64): string {
  const host = hostOf(url)
  if (!host) return ''
  return `https://www.google.com/s2/favicons?domain=${host}&sz=${size}`
}

/** 分组名归一化：空串（未分组）与只有空白的都归入默认分组 */
export function normalizeGroupName(group: string): string {
  return group.trim() || DEFAULT_LINK_GROUP
}

/**
 * 按分组归拢链接：分组顺序 = **首次出现顺序**（不打乱用户录入的先后），
 * 未分组的链接统一落到 `DEFAULT_LINK_GROUP` 桶里。空输入返回空数组（调用方据此渲染空状态）。
 */
export function groupLinks(
  links: readonly LinkItem[],
): Array<{ group: string; links: LinkItem[] }> {
  const buckets = new Map<string, LinkItem[]>()
  for (const link of links) {
    const group = normalizeGroupName(link.group)
    const bucket = buckets.get(group)
    if (bucket) {
      bucket.push(link)
    } else {
      buckets.set(group, [link])
    }
  }
  // Map 的插入顺序天然就是「首次出现顺序」，直接映射即可
  return [...buckets.entries()].map(([group, items]) => ({ group, links: items }))
}

/** 校验标题：去空白后非空且不超长 */
export function isValidLinkTitle(title: string): boolean {
  const trimmed = title.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_LINK_TITLE
}
