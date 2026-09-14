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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
