/** 环境变量类型声明（`.env.local` 中的值由 Vite 注入 `import.meta.env`） */

interface ImportMetaEnv {
  /** 高德地图「Web服务」Key（天气功能） */
  readonly VITE_AMAP_KEY?: string
  /** 同上，规划文档里的变量名；两个写哪个都认（getWeatherKey 会依次读取） */
  readonly VITE_WEATHER_KEY?: string
  /** Supabase 项目地址，如 https://xxxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon（公开）Key —— 权限由数据库 RLS 兜底，泄露也无法越权读写 */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * Cloudflare Turnstile 的**公开** siteKey（注册页人机验证）
   * 公开无妨：secretKey 只填在 Supabase Dashboard（Auth → Attacks Protection），不进前端。
   * 留空 = 不启用验证码（注册照常，不拦）。
   */
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /**
   * AI 助手页的**默认**后端基地址（不填 = http://127.0.0.1:8000，本地开发用）。
   *
   * 只有构建部署包时才需要设：自有服务器上的页面连不到访问者本机的回环地址
   * （浏览器对"公网页面 → 127.0.0.1"有 Local Network Access 限制），
   * 所以服务器形态把它指到服务器上的同源地址，如 `http://124.220.159.58/yhai`。
   * 用户仍可在 AI 助手页侧栏改，值存在各自浏览器本地。
   */
  readonly VITE_AGENT_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
