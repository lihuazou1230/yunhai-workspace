/**
 * 部署子路径感知的「站内绝对地址」。
 *
 * 为什么需要它：应用不一定挂在域名根目录下。
 * - 本地 / Vercel / Netlify / Cloudflare Pages：`/`
 * - **GitHub Pages 项目站点**：`/yunhai-workspace/`
 *
 * 之前认证相关代码直接拼 `location.origin`，在子路径部署下会得到
 * `https://<user>.github.io/reset-password`——既丢掉了仓库前缀（不是本应用的真实地址），
 * 也匹配不上 Supabase 的 Redirect URLs 白名单（会被直接拒掉）。
 *
 * `import.meta.env.BASE_URL` 会跟着 vite 的 `base` 一起变（见 vite.config.ts 的 BASE_PATH），
 * 所以统一用它拼即可，一套代码适配所有部署方式。
 */

/** 纯函数：把 origin + base + path 拼成绝对地址（base 缺尾斜杠会自动补，path 允许带前导斜杠） */
export function buildAppUrl(origin: string, base: string, path = ''): string {
  const normalizedBase = base === '' ? '/' : base.endsWith('/') ? base : `${base}/`
  const relative = path.replace(/^\/+/, '')
  return `${origin.replace(/\/+$/, '')}${normalizedBase}${relative}`
}

/**
 * 运行时封装：以当前页面 origin 与构建期 base 拼站内地址。
 *
 * - 根目录部署：`appUrl('reset-password')` → `https://app.example.com/reset-password`
 * - GitHub Pages：`appUrl('reset-password')` → `https://<user>.github.io/<repo>/reset-password`
 */
export function appUrl(path = ''): string {
  const origin = typeof location !== 'undefined' ? location.origin : ''
  const base = import.meta.env.BASE_URL ?? '/'
  return buildAppUrl(origin, base, path)
}
