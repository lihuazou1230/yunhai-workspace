// Vitest 全局测试环境配置（happy-dom）
import { beforeEach, vi } from 'vitest'
import { config } from '@vue/test-utils'

config.global.stubs = {
  // 过渡动画在测试里没有意义，关掉避免断言中间态
  transition: false,
}

// 注意：这里**不要** stub `router-link`。
// 第五阶段启用真实路由后，导航项的 href 与激活态都是断言对象，
// stub 掉只会得到一个没有 href、没有插槽内容的空壳（踩过一次）。

/**
 * 测试必须与「开发机有没有配 .env.local」无关。
 * Vite 会把 `.env.local` 读进 `import.meta.env`，于是本机一旦填了 Supabase 凭据，
 * 整个应用在测试里就变成「云端模式」，与「本地模式」相关的断言就会莫名其妙失败
 * （而且 CI 上没有 .env.local 又是另一种结果）。
 *
 * 所以统一先清空 Supabase 变量（= 本地模式）；需要云端模式的用例自己 stub 非空值。
 * Turnstile 的 siteKey 同理：默认清空（= 不启用验证码），
 * 需要验证「注册必须过验证码」的用例自己 stub 一个非空 siteKey。
 */
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
})
