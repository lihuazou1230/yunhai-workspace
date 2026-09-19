import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('@/api/auth', async () => (await import('@/test/authApiStub')).authApiStub)

import { AUTH_TEST_USER, authApiStub, resetAuthApiStub } from '@/test/authApiStub'
import { TURNSTILE_LOADER_KEY } from '@/composables/useTurnstile'
import type { TurnstileApi, TurnstileRenderOptions } from '@/composables/useTurnstile'
import Login from './Login.vue'

const TEST_ROUTES = [
  { path: '/login', name: 'login', component: Login },
  { path: '/', name: 'dashboard', component: { template: '<div>仪表板</div>' } },
  { path: '/todos', name: 'todos', component: { template: '<div>任务</div>' } },
]

/** 一个达标的注册密码（8 位 + 大小写 + 数字；强度条判「强」） */
const STRONG_PASSWORD = 'Pw123456'

/** 配置 Supabase 环境（默认按「已配置」测，未配置的场景单测时再清掉） */
function configureSupabase(configured = true) {
  vi.stubEnv('VITE_SUPABASE_URL', configured ? 'https://demo.supabase.co' : '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', configured ? 'anon-key' : '')
}

/** 造一个假 Turnstile widget：渲染参数（回调）留给我们自己触发 */
function fakeTurnstile() {
  const renders: TurnstileRenderOptions[] = []
  const api: TurnstileApi = {
    render: vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      renders.push(options)
      return 'w1'
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  return { api, renders }
}

async function mountLogin(
  query: Record<string, string> = {},
  options: { provide?: Record<string | symbol, unknown> } = {},
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: TEST_ROUTES })
  await router.push({ name: 'login', query })
  await router.isReady()

  const wrapper = mount(Login, {
    global: { plugins: [pinia, router], provide: options.provide ?? {} },
  })
  await nextTick()
  return { wrapper, router }
}

/** 填表单（邮箱/密码通过 BaseInput 内部的 input） */
async function fill(
  wrapper: Awaited<ReturnType<typeof mountLogin>>['wrapper'],
  values: { email?: string; password?: string; confirm?: string; name?: string },
) {
  if (values.email !== undefined)
    await wrapper.find('[data-testid="login-email"] input').setValue(values.email)
  if (values.password !== undefined)
    await wrapper.find('[data-testid="login-password"] input').setValue(values.password)
  if (values.confirm !== undefined)
    await wrapper.find('[data-testid="login-confirm-password"] input').setValue(values.confirm)
  if (values.name !== undefined)
    await wrapper.find('[data-testid="login-display-name"] input').setValue(values.name)
}

describe('Login 页', () => {
  beforeEach(() => {
    resetAuthApiStub()
    // 本文件默认按「已配置 Supabase」测；下面的用例再按需切回未配置
    configureSupabase(true)
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('表单校验（纯函数驱动，不消耗一次网络请求）', () => {
    it('邮箱为空：提示且不调用登录接口', async () => {
      const { wrapper } = await mountLogin()
      await fill(wrapper, { password: '123456' })

      await wrapper.find('form').trigger('submit')

      expect(wrapper.find('[data-testid="login-error-email"]').text()).toBe('请输入邮箱')
      expect(authApiStub.signInWithPassword).not.toHaveBeenCalled()
    })

    it('邮箱格式不对：提示格式错误', async () => {
      const { wrapper } = await mountLogin()
      await fill(wrapper, { email: 'zhang.example.com', password: '123456' })

      await wrapper.find('form').trigger('submit')

      expect(wrapper.find('[data-testid="login-error-email"]').text()).toBe('邮箱格式不正确')
      expect(authApiStub.signInWithPassword).not.toHaveBeenCalled()
    })

    it('密码为空：提示请输入，且不发请求', async () => {
      const { wrapper } = await mountLogin()
      await fill(wrapper, { email: 'zhang@example.com' })

      await wrapper.find('form').trigger('submit')

      expect(wrapper.find('[data-testid="login-error-password"]').text()).toBe('请输入密码')
      expect(authApiStub.signInWithPassword).not.toHaveBeenCalled()
    })

    it('登录不校验复杂度：老账号的弱密码也照样提交（服务端才是权威，前端别把登录锁死）', async () => {
      const { wrapper } = await mountLogin()
      await fill(wrapper, { email: 'zhang@example.com', password: '123456' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.signInWithPassword).toHaveBeenCalledWith(
        'zhang@example.com',
        '123456',
        undefined,
      )
    })
  })

  describe('登录', () => {
    it('成功：调用 signInWithPassword 并跳到仪表板', async () => {
      const { wrapper, router } = await mountLogin()
      await fill(wrapper, { email: ' zhang@example.com ', password: 'pw123456' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.signInWithPassword).toHaveBeenCalledWith(
        'zhang@example.com',
        'pw123456',
        undefined,
      )
      expect(router.currentRoute.value.name).toBe('dashboard')
    })

    it('成功且带 redirect：回到原目标页', async () => {
      const { wrapper, router } = await mountLogin({ redirect: '/todos' })
      await fill(wrapper, { email: 'zhang@example.com', password: 'pw123456' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('todos')
    })

    it('redirect 是外站：忽略它，回仪表板（防开放重定向）', async () => {
      const { wrapper, router } = await mountLogin({ redirect: '//evil.com' })
      await fill(wrapper, { email: 'zhang@example.com', password: 'pw123456' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('dashboard')
    })

    it('失败：显示服务端返回的中文文案，且留在登录页', async () => {
      authApiStub.signInWithPassword.mockResolvedValue({ ok: false, message: '邮箱或密码不正确' })
      const { wrapper, router } = await mountLogin()
      await fill(wrapper, { email: 'zhang@example.com', password: 'wrong123' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid="login-feedback"]').text()).toBe('邮箱或密码不正确')
      expect(router.currentRoute.value.name).toBe('login')
    })
  })

  describe('注册', () => {
    it('切到注册 Tab 才出现昵称与确认密码字段', async () => {
      const { wrapper } = await mountLogin()
      expect(wrapper.find('[data-testid="login-display-name"]').exists()).toBe(false)

      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')

      expect(wrapper.find('[data-testid="login-display-name"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="login-confirm-password"]').exists()).toBe(true)
    })

    it('两次密码不一致：提示且不发请求', async () => {
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: STRONG_PASSWORD,
        confirm: 'Pw654321',
        name: '张三',
      })

      await wrapper.find('form').trigger('submit')

      expect(wrapper.find('[data-testid="login-error-confirm-password"]').text()).toBe(
        '两次输入的密码不一致',
      )
      expect(authApiStub.signUpWithPassword).not.toHaveBeenCalled()
    })

    it('注册成功（拿到会话）：传递昵称并跳转', async () => {
      const { wrapper, router } = await mountLogin()
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: STRONG_PASSWORD,
        confirm: STRONG_PASSWORD,
        name: '张三',
      })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.signUpWithPassword).toHaveBeenCalledWith({
        email: 'zhang@example.com',
        password: STRONG_PASSWORD,
        displayName: '张三',
        // 未配置 VITE_TURNSTILE_SITE_KEY 时不带 token（服务端也没开 Captcha 校验）
        captchaToken: undefined,
      })
      expect(router.currentRoute.value.name).toBe('dashboard')
    })

    it('注册成功但需要邮箱验证：留在登录页并给出提示', async () => {
      authApiStub.signUpWithPassword.mockResolvedValue({
        ok: true,
        message: '注册成功，请到邮箱完成验证后再登录',
        needsEmailConfirm: true,
      })
      const { wrapper, router } = await mountLogin()
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: STRONG_PASSWORD,
        confirm: STRONG_PASSWORD,
        name: '',
      })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid="login-feedback"]').text()).toContain('验证')
      expect(router.currentRoute.value.name).toBe('login')
    })

    it('需要邮箱验证时给出「重新发送」入口，并说明慢/进垃圾箱是常态', async () => {
      authApiStub.signUpWithPassword.mockResolvedValue({
        ok: true,
        message: '注册成功，请到邮箱完成验证后再登录',
        needsEmailConfirm: true,
      })
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: STRONG_PASSWORD,
        confirm: STRONG_PASSWORD,
        name: '',
      })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      const panel = wrapper.find('[data-testid="login-pending-confirm"]')
      expect(panel.exists()).toBe(true)
      expect(panel.text()).toContain('zhang@example.com')
      expect(panel.text()).toContain('垃圾箱')
      // 刚发过一次，进入 60 秒冷却
      const resend = wrapper.find('[data-testid="login-resend-confirm"]')
      expect(resend.attributes('disabled')).toBeDefined()
      expect(resend.text()).toContain('60s')
    })

    it('冷却结束后可重发，成功后重新进入冷却', async () => {
      vi.useFakeTimers()
      try {
        authApiStub.signUpWithPassword.mockResolvedValue({
          ok: true,
          message: '注册成功，请到邮箱完成验证后再登录',
          needsEmailConfirm: true,
        })
        const { wrapper } = await mountLogin()
        await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
        await fill(wrapper, {
          email: 'zhang@example.com',
          password: STRONG_PASSWORD,
          confirm: STRONG_PASSWORD,
          name: '',
        })
        await wrapper.find('form').trigger('submit')
        await flushPromises()

        // 等冷却走完
        await vi.advanceTimersByTimeAsync(60_000)
        await nextTick()
        expect(
          wrapper.find('[data-testid="login-resend-confirm"]').attributes('disabled'),
        ).toBeUndefined()

        await wrapper.find('[data-testid="login-resend-confirm"]').trigger('click')
        await flushPromises()

        expect(authApiStub.resendConfirmEmail).toHaveBeenCalledWith(
          'zhang@example.com',
          undefined,
          undefined,
        )
        expect(wrapper.find('[data-testid="login-feedback"]').text()).toContain('重新发送')
        expect(
          wrapper.find('[data-testid="login-resend-confirm"]').attributes('disabled'),
        ).toBeDefined()
      } finally {
        vi.useRealTimers()
      }
    })

    it('重发被限流时展示服务端文案，且不进入冷却（可以稍后再点）', async () => {
      authApiStub.signUpWithPassword.mockResolvedValue({
        ok: true,
        message: '注册成功，请到邮箱完成验证后再登录',
        needsEmailConfirm: true,
      })
      authApiStub.resendConfirmEmail.mockResolvedValue({
        ok: false,
        message: '操作过于频繁，请稍后再试',
      })
      vi.useFakeTimers()
      try {
        const { wrapper } = await mountLogin()
        await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
        await fill(wrapper, {
          email: 'zhang@example.com',
          password: STRONG_PASSWORD,
          confirm: STRONG_PASSWORD,
          name: '',
        })
        await wrapper.find('form').trigger('submit')
        await flushPromises()

        await vi.advanceTimersByTimeAsync(60_000)
        await nextTick()
        await wrapper.find('[data-testid="login-resend-confirm"]').trigger('click')
        await flushPromises()

        expect(wrapper.find('[data-testid="login-feedback"]').text()).toContain('过于频繁')
        // 失败不进冷却，用户等一会儿就能再试
        expect(
          wrapper.find('[data-testid="login-resend-confirm"]').attributes('disabled'),
        ).toBeUndefined()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('忘记密码', () => {
    it('登录页有「忘记密码？」入口，点了切到重置模式（只剩邮箱字段）', async () => {
      const { wrapper } = await mountLogin()

      const link = wrapper.find('[data-testid="login-forgot-password"]')
      expect(link.exists()).toBe(true)
      await link.trigger('click')

      expect(wrapper.text()).toContain('忘记密码')
      expect(wrapper.find('[data-testid="login-email"]').exists()).toBe(true)
      // 重置模式不需要密码/确认密码入口
      expect(wrapper.find('[data-testid="login-password"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="login-tab-signup"]').exists()).toBe(false)
      // 也不需要输入密码就能提交
      expect(wrapper.find('[data-testid="login-submit"]').text()).toContain('发送重置邮件')
    })

    it('邮箱不合法：本地校验拦住，不发请求', async () => {
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-forgot-password"]').trigger('click')
      await fill(wrapper, { email: 'not-an-email' })

      await wrapper.find('form').trigger('submit')

      expect(wrapper.find('[data-testid="login-error-email"]').text()).toBe('邮箱格式不正确')
      expect(authApiStub.sendPasswordReset).not.toHaveBeenCalled()
    })

    it('提交成功：调用发信接口、显示已发送说明并进入 60 秒冷却', async () => {
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-forgot-password"]').trigger('click')
      await fill(wrapper, { email: 'zhang@example.com' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.sendPasswordReset).toHaveBeenCalledWith(
        'zhang@example.com',
        undefined,
        undefined,
      )
      expect(wrapper.find('[data-testid="login-reset-sent"]').text()).toContain('zhang@example.com')
      const submit = wrapper.find('[data-testid="login-submit"]')
      expect(submit.attributes('disabled')).toBeDefined()
      expect(submit.text()).toContain('60s')
    })

    it('发信失败：展示服务端文案（例如收件邮箱不存在）', async () => {
      authApiStub.sendPasswordReset.mockResolvedValue({
        ok: false,
        message: '重置密码邮件发送失败：请确认这个邮箱真实存在且能收信',
      })
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-forgot-password"]').trigger('click')
      await fill(wrapper, { email: 'nobody@example.com' })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid="login-feedback"]').text()).toContain('邮箱真实存在')
      expect(wrapper.find('[data-testid="login-reset-sent"]').exists()).toBe(false)
    })

    it('可以返回登录模式', async () => {
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-forgot-password"]').trigger('click')
      await wrapper.find('[data-testid="login-back-to-signin"]').trigger('click')

      expect(wrapper.find('[data-testid="login-tab-signin"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="login-password"]').exists()).toBe(true)
    })

    it('本地模式不显示入口（没配 Supabase 时发不出重置邮件，避免死路）', async () => {
      configureSupabase(false)
      const { wrapper } = await mountLogin()

      expect(wrapper.find('[data-testid="login-forgot-password"]').exists()).toBe(false)
    })
  })

  describe('未配置 Supabase（本地模式）', () => {
    it('显示配置引导，并提供「以本地模式进入」', async () => {
      configureSupabase(false)
      const { wrapper, router } = await mountLogin()

      const hint = wrapper.find('[data-testid="login-setup-hint"]')
      expect(hint.exists()).toBe(true)
      expect(hint.text()).toContain('.env.local')

      await wrapper.find('[data-testid="login-enter-local"]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('dashboard')
    })

    it('本地模式才给「先随便逛逛」出口', async () => {
      configureSupabase(false)
      const local = await mountLogin()
      expect(local.wrapper.find('[data-testid="login-browse-local"]').exists()).toBe(true)
    })
  })

  describe('已配置 Supabase', () => {
    it('不显示「先随便逛逛」：点了会被守卫弹回登录页，等于死链', async () => {
      const { wrapper } = await mountLogin()
      expect(wrapper.find('[data-testid="login-browse-local"]').exists()).toBe(false)
    })
  })

  describe('已登录用户', () => {
    it('store 有会话时进入登录页不报错，并被自动送进应用', async () => {
      authApiStub.getCurrentSessionUser.mockResolvedValue(AUTH_TEST_USER)
      const { router } = await mountLogin()
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('dashboard')
    })
  })

  describe('登录页保持干净（自检入口与"未开启"提示已撤）', () => {
    it('页面上不再有连接自检入口与结果面板', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 401 })),
      )
      const { wrapper } = await mountLogin()
      await flushPromises()

      expect(wrapper.find('[data-testid="login-connection-test"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="login-connection-result"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('测试与 Supabase 的连接')
    })

    it('本地模式同样不出现自检入口', async () => {
      configureSupabase(false)
      const { wrapper } = await mountLogin()
      expect(wrapper.find('[data-testid="login-connection-test"]').exists()).toBe(false)
    })
  })

  describe('邮件链接落地（验证完不该还要手动登录一次）', () => {
    it('已登录（会话在本页挂载后才建立）→ 自动送进应用，不再停在登录页', async () => {
      authApiStub.getCurrentSessionUser.mockResolvedValue(AUTH_TEST_USER)
      const { router } = await mountLogin()
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('dashboard')
    })

    it('落地时已带 redirect：回到原目标页', async () => {
      authApiStub.getCurrentSessionUser.mockResolvedValue(AUTH_TEST_USER)
      const { router } = await mountLogin({ redirect: '/todos' })
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('todos')
    })

    it('验证成功的结果展示一次（"邮箱验证成功，已自动登录"）', async () => {
      authApiStub.consumeAuthRedirect.mockResolvedValue({
        ok: true,
        message: '邮箱验证成功，已自动登录',
      })
      const { wrapper } = await mountLogin()
      await flushPromises()

      expect(wrapper.find('[data-testid="login-feedback"]').text()).toContain('已自动登录')
    })

    it('链接过期/被邮件扫描器先点过：给出"重新发送"的可执行提示', async () => {
      authApiStub.consumeAuthRedirect.mockResolvedValue({
        ok: false,
        message:
          '邮件链接已失效（多半是超过有效期，或被邮箱安全扫描先点掉了一次）：请回登录页重新发送一封',
      })
      const { wrapper } = await mountLogin()
      await flushPromises()

      const feedback = wrapper.find('[data-testid="login-feedback"]')
      expect(feedback.text()).toContain('重新发送')
      // 仍是未登录状态，登录表单可用
      expect(wrapper.find('[data-testid="login-submit"]').exists()).toBe(true)
    })

    it('未登录落地：不会误跳（只处理邮件凭据，不做别的）', async () => {
      const { router } = await mountLogin()
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('login')
    })
  })

  describe('注册安全①：密码复杂度（实时强度条）', () => {
    it('弱密码：强度条给出档位与「缺什么」，注册按钮同时置灰', async () => {
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: 'abcd1234',
        confirm: 'abcd1234',
      })

      const strength = wrapper.find('[data-testid="password-strength"]')
      expect(strength.exists()).toBe(true)
      expect(strength.find('[data-testid="password-strength-level"]').text()).toBe('中')
      expect(wrapper.find('[data-testid="password-strength-hints"]').text()).toContain(
        '需要包含大写字母',
      )
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeDefined()
    })

    it('按钮置灰挡不住回车：弱密码走 form submit 也发不出请求', async () => {
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: 'abcd1234',
        confirm: 'abcd1234',
      })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.signUpWithPassword).not.toHaveBeenCalled()
    })

    it('补齐后按钮恢复可用（强度条实时跟随输入）', async () => {
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: 'abcd1234',
        confirm: 'abcd1234',
      })
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeDefined()

      await fill(wrapper, { password: STRONG_PASSWORD, confirm: STRONG_PASSWORD })

      expect(wrapper.find('[data-testid="password-strength-level"]').text()).toBe('强')
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeUndefined()
    })

    it('黑名单密码（Passw0rd）：大小写数字齐备也不放行，理由说清', async () => {
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: 'Passw0rd',
        confirm: 'Passw0rd',
      })

      expect(wrapper.find('[data-testid="password-strength-level"]').text()).toBe('弱')
      expect(wrapper.find('[data-testid="password-strength-hints"]').text()).toContain('常见弱密码')
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeDefined()
    })

    it('登录 Tab 不出现强度条（复杂度是注册/改密的要求，不该把登录锁死）', async () => {
      const { wrapper } = await mountLogin()
      expect(wrapper.find('[data-testid="password-strength"]').exists()).toBe(false)
    })
  })

  describe('注册安全②：Cloudflare Turnstile 人机验证', () => {
    beforeEach(() => {
      // siteKey 在组件 setup 时读一次，必须在 mount 之前 stub
      vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA')
    })

    /** 切到注册并填一份"除验证码外都合格"的表单 */
    async function setupSignUp(loader?: () => Promise<TurnstileApi>) {
      const fake = fakeTurnstile()
      const { wrapper, router } = await mountLogin(
        {},
        { provide: { [TURNSTILE_LOADER_KEY]: loader ?? (async () => fake.api) } },
      )
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: STRONG_PASSWORD,
        confirm: STRONG_PASSWORD,
      })
      await nextTick()
      return { wrapper, router, ...fake }
    }

    it('未通过验证前注册按钮置灰，通过后恢复可用', async () => {
      const { wrapper, renders } = await setupSignUp()
      await flushPromises()

      expect(renders).toHaveLength(1)
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeDefined()

      renders[0].callback('tok')
      await nextTick()

      expect(wrapper.find('[data-testid="turnstile-passed"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeUndefined()
    })

    it('提交注册时把一次性 token 一起带上（服务端才能真正核验）', async () => {
      const { wrapper, renders } = await setupSignUp()
      await flushPromises()
      renders[0].callback('tok')
      await nextTick()

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.signUpWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'zhang@example.com', captchaToken: 'tok' }),
      )
    })

    it('注册失败后重置 token 并重新置灰（token 一次性，复用必被服务端拒）', async () => {
      const { wrapper, renders, api } = await setupSignUp()
      await flushPromises()
      renders[0].callback('tok')
      await nextTick()

      authApiStub.signUpWithPassword.mockResolvedValue({
        ok: false,
        message: '该邮箱已注册，请直接登录',
      })
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(api.reset).toHaveBeenCalledWith('w1')
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeDefined()
    })

    it('脚本加载失败：说明原因 + 置灰，且回车提交也发不出请求', async () => {
      const loader = vi.fn(async () => {
        throw new Error('offline')
      })
      const { wrapper } = await setupSignUp(loader)
      await flushPromises()

      expect(wrapper.find('[data-testid="turnstile-error"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeDefined()

      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="login-error-captcha"]').text()).toBe('请先完成人机验证')
      expect(authApiStub.signUpWithPassword).not.toHaveBeenCalled()
    })

    it('三个 Tab 共用同一个 widget：切 Tab 不丢弃已拿到的 token', async () => {
      const { wrapper, renders } = await setupSignUp()
      await flushPromises()
      renders[0].callback('tok')
      await nextTick()
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeUndefined()

      await wrapper.find('[data-testid="login-tab-signin"]').trigger('click')

      // 登录 Tab 也要求验证码（服务端 Captcha 是全局开关），token 仍然有效 → 按钮可用
      expect(wrapper.find('[data-testid="login-captcha"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeUndefined()
      expect(renders).toHaveLength(1) // 没有重新渲染 widget
    })

    it('登录也带 token：Captcha 一开，登录同样会被服务端要求核验', async () => {
      const { wrapper, renders } = await setupSignUp()
      await flushPromises()
      renders[0].callback('tok')
      await nextTick()

      // 切到登录 Tab，用同一个 token 提交
      await wrapper.find('[data-testid="login-tab-signin"]').trigger('click')
      await fill(wrapper, { email: 'zhang@example.com', password: 'pw123456' })
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.signInWithPassword).toHaveBeenCalledWith(
        'zhang@example.com',
        'pw123456',
        'tok',
      )
      // 提交后 token 已被花掉：重新验证前不能再提交
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeDefined()
    })

    it('忘记密码也带 token（/recover 同样被 Captcha 保护）', async () => {
      const { wrapper, renders } = await setupSignUp()
      await flushPromises()
      renders[0].callback('tok')
      await nextTick()

      // 「忘记密码」入口只在登录 Tab 上，先切回去
      await wrapper.find('[data-testid="login-tab-signin"]').trigger('click')
      await wrapper.find('[data-testid="login-forgot-password"]').trigger('click')
      await fill(wrapper, { email: 'zhang@example.com' })
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.sendPasswordReset).toHaveBeenCalledWith(
        'zhang@example.com',
        undefined,
        'tok',
      )
    })

    it('登录未过验证时同样置灰 + 回车也发不出请求', async () => {
      const { wrapper } = await setupSignUp()
      await flushPromises()

      await wrapper.find('[data-testid="login-tab-signin"]').trigger('click')
      await fill(wrapper, { email: 'zhang@example.com', password: 'pw123456' })
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeDefined()

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.signInWithPassword).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="login-error-captcha"]').exists()).toBe(true)
    })

    it('未配置 siteKey：不渲染 widget、不拦注册（降级而不是锁死）', async () => {
      vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
      const { wrapper } = await mountLogin()
      await wrapper.find('[data-testid="login-tab-signup"]').trigger('click')
      await fill(wrapper, {
        email: 'zhang@example.com',
        password: STRONG_PASSWORD,
        confirm: STRONG_PASSWORD,
      })

      expect(wrapper.find('[data-testid="turnstile-disabled"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="login-submit"]').attributes('disabled')).toBeUndefined()
    })
  })
})
