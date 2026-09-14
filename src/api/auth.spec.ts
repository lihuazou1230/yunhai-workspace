import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SupabaseUnavailableError } from './supabase'

/**
 * 认证 API 单测：把 supabase 客户端整块换成桩，
 * 这样能在不联网、不建真项目的前提下覆盖「成功 / 失败 / 未配置」三条路径。
 */
const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('./supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./supabase')>()
  return {
    ...actual,
    isSupabaseConfigured: () => holder.client !== null,
    getSupabaseClient: () => holder.client,
    requireSupabaseClient: () => {
      if (!holder.client) throw new actual.SupabaseUnavailableError()
      return holder.client
    },
  }
})

import {
  consumeAuthRedirect,
  describeAuthError,
  emailPrefix,
  getCurrentSessionUser,
  resendConfirmEmail,
  sendPasswordReset,
  signInWithGitHub,
  signInWithPassword,
  signOutUser,
  signUpWithPassword,
  subscribeAuthChanges,
  toAuthUser,
  updateAvatarMetadata,
  updateUserPassword,
} from './auth'

/** 造一个 auth 桩：默认全部成功，用例按需覆盖具体方法 */
function fakeClient(overrides: Record<string, unknown> = {}) {
  const auth = {
    signUp: vi.fn(async () => ({ data: { session: null }, error: null as unknown })),
    signInWithPassword: vi.fn(async () => ({ data: { session: {} }, error: null as unknown })),
    signInWithOAuth: vi.fn(async () => ({
      data: { url: 'https://github.com/login' },
      error: null as unknown,
    })),
    signOut: vi.fn(async () => ({ data: {}, error: null as unknown })),
    resend: vi.fn(async () => ({ data: {}, error: null as unknown })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null as unknown })),
    exchangeCodeForSession: vi.fn(async () => ({
      data: { session: { access_token: 't' } },
      error: null as unknown,
    })),
    verifyOtp: vi.fn(async () => ({
      data: { session: { access_token: 't' } },
      error: null as unknown,
    })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null as unknown })),
    updateUser: vi.fn(async () => ({ data: { user: {} }, error: null as unknown })),
    onAuthStateChange: vi.fn<
      (cb: (event: string, session: unknown) => void) => {
        data: { subscription: { unsubscribe: () => void } }
      }
    >(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  }
  Object.assign(auth, overrides)
  return { auth }
}

describe('toAuthUser（Supabase user → 应用用户模型）', () => {
  it('优先用 display_name，并保留头像与登录方式', () => {
    expect(
      toAuthUser({
        id: 'u1',
        email: 'zhang@example.com',
        user_metadata: { display_name: '张三', avatar_url: 'https://x/a.webp?v=1' },
        app_metadata: { provider: 'github' },
      }),
    ).toEqual({
      id: 'u1',
      email: 'zhang@example.com',
      displayName: '张三',
      avatarUrl: 'https://x/a.webp?v=1',
      provider: 'github',
    })
  })

  it('没有 display_name 时依次回退 full_name / name / user_name', () => {
    const base = { id: 'u1', email: 'a@b.com' }
    expect(toAuthUser({ ...base, user_metadata: { full_name: 'Alice Zhang' } })?.displayName).toBe(
      'Alice Zhang',
    )
    expect(toAuthUser({ ...base, user_metadata: { name: 'Bob' } })?.displayName).toBe('Bob')
    expect(toAuthUser({ ...base, user_metadata: { user_name: 'carol' } })?.displayName).toBe(
      'carol',
    )
  })

  it('元数据全空时回退邮箱前缀，最后回退「未命名用户」', () => {
    expect(toAuthUser({ id: 'u1', email: 'zhang@example.com' })?.displayName).toBe('zhang')
    expect(toAuthUser({ id: 'u1', email: '' })?.displayName).toBe('未命名用户')
  })

  it('头像与登录方式缺失时有默认值', () => {
    const user = toAuthUser({ id: 'u1', email: 'a@b.com' })
    expect(user?.avatarUrl).toBe('')
    expect(user?.provider).toBe('email')
  })

  it('空 user 返回 null', () => {
    expect(toAuthUser(null)).toBeNull()
    expect(toAuthUser(undefined)).toBeNull()
    expect(toAuthUser({ id: '' })).toBeNull()
  })

  it('email 不是字符串（Supabase 会给 null）时归一为空串，不把 null 塞进用户模型', () => {
    const user = toAuthUser({ id: 'u1', email: null })

    expect(user?.email).toBe('')
    // 邮箱前缀这条回退也因此拿不到东西，最终落到「未命名用户」
    expect(user?.displayName).toBe('未命名用户')
  })

  it('emailPrefix 处理异常邮箱', () => {
    expect(emailPrefix('zhang@example.com')).toBe('zhang')
    expect(emailPrefix('no-at-sign')).toBe('no-at-sign')
  })
})

describe('describeAuthError（英文报错 → 中文文案）', () => {
  it('映射常见错误', () => {
    expect(describeAuthError(new Error('Invalid login credentials'))).toBe('邮箱或密码不正确')
    expect(describeAuthError(new Error('Email not confirmed'))).toBe(
      '邮箱尚未验证，请先查收验证邮件',
    )
    expect(describeAuthError(new Error('User already registered'))).toBe('该邮箱已注册，请直接登录')
    expect(describeAuthError(new Error('Password should be at least 6 characters'))).toBe(
      '密码至少 6 位',
    )
    expect(describeAuthError(new Error('email rate limit exceeded'))).toBe(
      '操作过于频繁，请稍后再试',
    )
    expect(describeAuthError(new Error('Failed to fetch'))).toBe('网络不可用，请检查网络后重试')
  })

  it('发信失败翻译成可操作的中文（真凶往往是收件邮箱不存在）', () => {
    // GoTrue 对「SMTP 拒收」统一报这个英文错误，用户看不出问题在哪
    expect(describeAuthError(new Error('Error sending confirmation email'))).toContain(
      '邮箱真实存在',
    )
    expect(describeAuthError(new Error('Error sending recovery email'))).toContain('邮箱真实存在')
    expect(describeAuthError(new Error('Error sending magic link email'))).toContain('邮件发送失败')
  })

  it('未配置 Supabase 时给出配置引导', () => {
    expect(describeAuthError(new SupabaseUnavailableError())).toContain('.env.local')
  })

  it('邮箱格式与「关闭注册」两句提示都要能翻译（注册失败时用户最容易懵的两种）', () => {
    // 同一句话 GoTrue 有多套措辞，两个关键词都得认
    expect(describeAuthError(new Error('Unable to validate email address: invalid format'))).toBe(
      '邮箱格式不正确',
    )
    expect(describeAuthError(new Error('Invalid email'))).toBe('邮箱格式不正确')

    expect(describeAuthError(new Error('Signups not allowed for this instance'))).toBe(
      '当前项目已关闭注册，请使用已有账号登录',
    )
    expect(describeAuthError(new Error('Signup is disabled'))).toBe(
      '当前项目已关闭注册，请使用已有账号登录',
    )
  })

  it('未知错误原样返回，空错误给兜底文案', () => {
    expect(describeAuthError(new Error('boom'))).toBe('boom')
    expect(describeAuthError(null)).toBe('认证失败，请稍后重试')
  })

  it('密码强度不足：把 weak_password 翻译成可执行动作（调高最小长度后老账号登录会撞上）', () => {
    // supabase-js 只带错误码的情形
    expect(describeAuthError({ code: 'weak_password', message: '' })).toContain('忘记密码')
    // 只有英文 message 的情形（GoTrue 两套措辞都认）
    expect(describeAuthError(new Error('Password is too weak'))).toContain('强度要求')
    expect(describeAuthError(new Error('Weak password detected'))).toContain('强度要求')
  })

  it('人机验证失败：把 Cloudflare 的错误码翻译成「重新验证」的可执行动作', () => {
    // token 一次性：用第二次就是这个错，提示必须指向"再验一次"而不是"再点一次注册"
    expect(
      describeAuthError(new Error('captcha protection: request disallowed (timeout-or-duplicate)')),
    ).toContain('重新完成验证')
    expect(describeAuthError(new Error('captcha verification process failed'))).toBe(
      '人机验证未通过，请重新完成验证后再试',
    )
    expect(describeAuthError(new Error('invalid-input-response'))).toBe(
      '人机验证未通过，请重新完成验证后再试',
    )
  })

  it('最小密码长度从服务端报错里读（长度可配，写死会骗人）', () => {
    expect(describeAuthError(new Error('Password should be at least 6 characters'))).toBe(
      '密码至少 6 位',
    )
    expect(describeAuthError(new Error('Password should be at least 8 characters'))).toBe(
      '密码至少 8 位',
    )
  })

  it('原始错误是字符串或没有 message 的对象时不能二次抛错', () => {
    // SDK / fetch polyfill 有时直接把错误当字符串抛；读 .message 会得到 undefined
    expect(describeAuthError('Invalid login credentials')).toBe('邮箱或密码不正确')
    expect(describeAuthError({})).toBe('认证失败，请稍后重试')
    expect(describeAuthError(new Error(''))).toBe('认证失败，请稍后重试')
  })
})

describe('认证动作（未配置 Supabase 时不抛错，只返回失败结果）', () => {
  beforeEach(() => {
    holder.client = null
  })

  it('未配置时登录/注册/登出/改头像都返回引导文案', async () => {
    const results = await Promise.all([
      signInWithPassword('a@b.com', '123456'),
      signUpWithPassword({ email: 'a@b.com', password: '123456', displayName: '张三' }),
      signInWithGitHub(),
      signOutUser(),
      updateAvatarMetadata('https://x/a.webp'),
    ])
    for (const result of results) {
      expect(result.ok).toBe(false)
      expect(result.message).toContain('.env.local')
    }
  })

  it('未配置时读会话返回 null，订阅返回空函数', async () => {
    expect(await getCurrentSessionUser()).toBeNull()
    expect(() => subscribeAuthChanges(() => {})()).not.toThrow()
  })
})

describe('认证动作（已配置）', () => {
  beforeEach(() => {
    holder.client = fakeClient()
  })

  it('注册：开启邮箱验证时提示去邮箱确认', async () => {
    const result = await signUpWithPassword({
      email: 'a@b.com',
      password: '123456',
      displayName: '张三',
    })
    expect(result).toMatchObject({ ok: true, needsEmailConfirm: true })
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.com',
        password: '123456',
        options: expect.objectContaining({ data: { display_name: '张三' } }),
      }),
    )
  })

  it('注册：把 Turnstile 的一次性 token 透传给服务端（前端伪造无效，核验在服务端）', async () => {
    await signUpWithPassword({
      email: 'a@b.com',
      password: 'Abcd1234',
      displayName: '张三',
      captchaToken: 'turnstile-one-shot',
    })
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ captchaToken: 'turnstile-one-shot' }),
      }),
    )
  })

  it('注册：未启用验证码时 captchaToken 为 undefined（不给服务端送空 token）', async () => {
    await signUpWithPassword({ email: 'a@b.com', password: 'Abcd1234', displayName: '' })
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ captchaToken: undefined }) }),
    )
  })

  it('注册：直接拿到会话时提示已自动登录', async () => {
    holder.client = fakeClient({
      signUp: vi.fn(async () => ({ data: { session: { access_token: 't' } }, error: null })),
    })
    const result = await signUpWithPassword({
      email: 'a@b.com',
      password: '123456',
      displayName: '',
    })
    expect(result).toEqual({ ok: true, message: '注册成功，已自动登录' })
  })

  it('注册失败返回中文文案', async () => {
    holder.client = fakeClient({
      signUp: vi.fn(async () => ({
        data: { session: null },
        error: { message: 'User already registered' },
      })),
    })
    expect(
      await signUpWithPassword({ email: 'a@b.com', password: '123456', displayName: '' }),
    ).toEqual({ ok: false, message: '该邮箱已注册，请直接登录' })
  })

  it('登录成功与失败', async () => {
    expect(await signInWithPassword('a@b.com', 'pw')).toEqual({ ok: true, message: '登录成功' })

    holder.client = fakeClient({
      signInWithPassword: vi.fn(async () => ({
        data: {},
        error: { message: 'Invalid login credentials' },
      })),
    })
    expect(await signInWithPassword('a@b.com', 'bad')).toEqual({
      ok: false,
      message: '邮箱或密码不正确',
    })
  })

  it('GitHub OAuth：带 redirectTo 时透传给 supabase', async () => {
    const result = await signInWithGitHub('https://app.example.com/login')
    expect(result.ok).toBe(true)
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'https://app.example.com/login' },
    })
  })

  it('不传 redirectTo 时默认回跳当前页面（location.href）', async () => {
    const result = await signInWithGitHub()

    expect(result.ok).toBe(true)
    const client = holder.client as ReturnType<typeof fakeClient>
    // 用 location.href 而不是 origin：GitHub Pages 部署在 /<repo>/ 子路径下也能回到原页面
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: location.href },
    })
  })

  it('GitHub OAuth 返回错误（provider 没开后端、或网络不通）时返回失败结果而不是抛错', async () => {
    holder.client = fakeClient({
      signInWithOAuth: vi.fn(async () => ({ data: {}, error: { message: 'Failed to fetch' } })),
    })

    expect(await signInWithGitHub()).toEqual({
      ok: false,
      message: '网络不可用，请检查网络后重试',
    })
  })

  it('退出登录接口报错时也返回失败结果（本地退不退由 store 决定）', async () => {
    holder.client = fakeClient({
      signOut: vi.fn(async () => ({ data: {}, error: { message: 'Failed to fetch' } })),
    })

    expect(await signOutUser()).toEqual({
      ok: false,
      message: '网络不可用，请检查网络后重试',
    })
  })

  it('退出登录调用 signOut', async () => {
    expect(await signOutUser()).toEqual({ ok: true, message: '已退出登录' })
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.signOut).toHaveBeenCalled()
  })

  it('读取会话：把 session.user 归一化', async () => {
    holder.client = fakeClient({
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: 'u1', email: 'a@b.com', user_metadata: { name: 'A' } } } },
        error: null,
      })),
    })
    expect(await getCurrentSessionUser()).toMatchObject({ id: 'u1', displayName: 'A' })
  })

  it('读取会话失败时抛错（由 store 兜住）', async () => {
    holder.client = fakeClient({
      getSession: vi.fn(async () => ({
        data: { session: null },
        error: { message: 'network down' },
      })),
    })
    await expect(getCurrentSessionUser()).rejects.toMatchObject({ message: 'network down' })
  })

  it('订阅登录态变化：事件回调带归一化用户，取消订阅可用', () => {
    const unsubscribe = vi.fn()
    // 桩在订阅瞬间同步回调一次（模拟 SIGNED_IN），再换一个桩模拟 SIGNED_OUT
    holder.client = fakeClient({
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        cb('SIGNED_IN', { user: { id: 'u1', email: 'a@b.com', user_metadata: {} } })
        return { data: { subscription: { unsubscribe } } }
      }),
    })

    const onChange = vi.fn()
    const stop = subscribeAuthChanges(onChange)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'u1' }))

    const onSignOut = vi.fn()
    holder.client = fakeClient({
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        cb('SIGNED_OUT', null)
        return { data: { subscription: { unsubscribe } } }
      }),
    })
    subscribeAuthChanges(onSignOut)
    expect(onSignOut).toHaveBeenLastCalledWith(null)

    stop()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('重新发送验证邮件：调用 resend(type=signup) 并带上回跳地址', async () => {
    const result = await resendConfirmEmail('zhang@example.com', 'https://app.example.com')

    expect(result).toMatchObject({ ok: true })
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.resend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'signup',
        email: 'zhang@example.com',
        options: expect.objectContaining({ emailRedirectTo: 'https://app.example.com' }),
      }),
    )
  })

  it('登录也支持 captchaToken（Captcha 是全局开关，不开就给 undefined）', async () => {
    await signInWithPassword('a@b.com', 'pw', 'turnstile-token')
    let client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw',
      options: { captchaToken: 'turnstile-token' },
    })

    holder.client = fakeClient()
    await signInWithPassword('a@b.com', 'pw')
    client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw',
      options: undefined,
    })
  })

  it('重发验证邮件也支持 captchaToken', async () => {
    await resendConfirmEmail('a@b.com', undefined, 'turnstile-token')
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.resend).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ captchaToken: 'turnstile-token' }),
      }),
    )
  })

  describe('consumeAuthRedirect（邮件链接落地）', () => {
    it('没有邮件凭据：返回 null，不打扰服务端', async () => {
      expect(await consumeAuthRedirect('http://localhost:5173/todos?filter=all')).toBeNull()
      const client = holder.client as ReturnType<typeof fakeClient>
      expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled()
      expect(client.auth.verifyOtp).not.toHaveBeenCalled()
    })

    it('implicit（#access_token=…）交给 supabase-js 自己换，这里不动手', async () => {
      expect(
        await consumeAuthRedirect('http://localhost:5173/#access_token=a&refresh_token=b'),
      ).toBeNull()
      const client = holder.client as ReturnType<typeof fakeClient>
      expect(client.auth.verifyOtp).not.toHaveBeenCalled()
    })

    it('PKCE：用 ?code= 换会话，并把一次性 code 从地址栏抹掉', async () => {
      window.history.replaceState({}, '', '/?code=abc-123&redirect=%2Ftodos')

      const result = await consumeAuthRedirect()

      expect(result).toMatchObject({ ok: true })
      expect(result?.message).toContain('已自动登录')
      const client = holder.client as ReturnType<typeof fakeClient>
      expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc-123')
      // 关键：用完即清，刷新页面不会拿同一个 code 再换一次
      expect(window.location.search).toBe('?redirect=%2Ftodos')
    })

    it('新版模板：用 ?token_hash= 调 verifyOtp（supabase-js 不会自动处理这一种）', async () => {
      window.history.replaceState({}, '', '/auth/confirm?token_hash=hash-1&type=signup')

      const result = await consumeAuthRedirect()

      expect(result).toMatchObject({ ok: true })
      const client = holder.client as ReturnType<typeof fakeClient>
      expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-1', type: 'signup' })
      expect(window.location.search).toBe('')
    })

    it('链接过期/已被用过：翻成中文可执行提示，且不去换会话', async () => {
      window.history.replaceState({}, '', '/#error=access_denied&error_code=otp_expired')

      const result = await consumeAuthRedirect()

      expect(result?.ok).toBe(false)
      expect(result?.message).toContain('重新发送')
      const client = holder.client as ReturnType<typeof fakeClient>
      expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled()
      expect(window.location.hash).toBe('')
    })

    it('换会话失败（如凭据已被用过）时返回可展示的失败结果', async () => {
      holder.client = fakeClient({
        exchangeCodeForSession: vi.fn(async () => ({
          data: {},
          error: {
            message: 'invalid request: both auth code and code verifier should be non-empty',
          },
        })),
      })
      const result = await consumeAuthRedirect('http://localhost:5173/?code=used')
      expect(result?.ok).toBe(false)
    })
  })

  /**
   * 回归保护：部署在子路径（GitHub Pages 的 /<repo>/）时，默认回跳地址必须带上前缀。
   * 以前这里拼的是 location.origin，线上会得到不是本应用的地址、且匹配不上白名单。
   */
  describe('默认回跳地址带部署子路径', () => {
    async function withBase<T>(base: string, run: () => Promise<T>): Promise<T> {
      const original = import.meta.env.BASE_URL
      try {
        ;(import.meta.env as Record<string, unknown>).BASE_URL = base
        return await run()
      } finally {
        ;(import.meta.env as Record<string, unknown>).BASE_URL = original
      }
    }

    it('注册验证邮件的回跳地址 = origin + base', async () => {
      await withBase('/yunhai-workspace/', async () => {
        await signUpWithPassword({ email: 'a@b.com', password: 'secret1', displayName: '张三' })
      })

      const client = holder.client as ReturnType<typeof fakeClient>
      expect(client.auth.signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            emailRedirectTo: `${location.origin}/yunhai-workspace/`,
          }),
        }),
      )
    })

    it('重置密码邮件的回跳地址 = origin + base + reset-password', async () => {
      await withBase('/yunhai-workspace/', async () => {
        await sendPasswordReset('zhang@example.com')
      })

      const client = holder.client as ReturnType<typeof fakeClient>
      expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('zhang@example.com', {
        redirectTo: `${location.origin}/yunhai-workspace/reset-password`,
      })
    })

    it('显式传入 redirectTo 时优先使用调用方的值（不被 base 覆盖）', async () => {
      await withBase('/yunhai-workspace/', async () => {
        await sendPasswordReset('zhang@example.com', 'https://custom.example.com/reset')
      })

      const client = holder.client as ReturnType<typeof fakeClient>
      expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('zhang@example.com', {
        redirectTo: 'https://custom.example.com/reset',
      })
    })
  })

  it('重发遇到频率限制：翻译成中文提示（连续点会被限流）', async () => {
    holder.client = fakeClient({
      resend: vi.fn(async () => ({ data: {}, error: { message: 'email rate limit exceeded' } })),
    })

    expect(await resendConfirmEmail('zhang@example.com')).toEqual({
      ok: false,
      message: '操作过于频繁，请稍后再试',
    })
  })

  it('未配置 Supabase 时重发返回配置引导', async () => {
    holder.client = null
    const result = await resendConfirmEmail('zhang@example.com')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('.env.local')
  })

  it('忘记密码：调用 resetPasswordForEmail 并带上回跳地址', async () => {
    const result = await sendPasswordReset(
      'zhang@example.com',
      'https://app.example.com/reset-password',
    )

    expect(result).toMatchObject({ ok: true })
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('zhang@example.com', {
      redirectTo: 'https://app.example.com/reset-password',
    })
    expect(result.message).toContain('邮箱')
  })

  it('忘记密码也支持 captchaToken（/recover 同样被 Captcha 保护）', async () => {
    await sendPasswordReset('zhang@example.com', 'https://app.example.com/reset', 'turnstile-token')
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('zhang@example.com', {
      redirectTo: 'https://app.example.com/reset',
      captchaToken: 'turnstile-token',
    })
  })

  it('忘记密码：失败时给出中文文案（如发信失败）', async () => {
    holder.client = fakeClient({
      resetPasswordForEmail: vi.fn(async () => ({
        data: {},
        error: { message: 'Error sending recovery email' },
      })),
    })

    const result = await sendPasswordReset('zhang@example.com')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('邮箱真实存在')
  })

  it('修改密码：调用 updateUser({ password })', async () => {
    const result = await updateUserPassword('newpw123456')

    expect(result).toMatchObject({ ok: true })
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'newpw123456' })
  })

  it('修改密码失败：弱密码/与旧密码相同都翻译成中文', async () => {
    holder.client = fakeClient({
      updateUser: vi.fn(async () => ({
        data: {},
        error: { message: 'New password should be different from the old password' },
      })),
    })
    expect((await updateUserPassword('old')).message).toBe('新密码不能与当前密码相同')

    holder.client = fakeClient({
      updateUser: vi.fn(async () => ({
        data: {},
        error: { message: 'Password should be at least 6 characters' },
      })),
    })
    expect((await updateUserPassword('123')).message).toBe('密码至少 6 位')
  })

  it('更新头像元数据成功后透传调用', async () => {
    expect(await updateAvatarMetadata('https://x/a.webp?v=2')).toEqual({
      ok: true,
      message: '头像已更新',
    })
    const client = holder.client as ReturnType<typeof fakeClient>
    expect(client.auth.updateUser).toHaveBeenCalledWith({
      data: { avatar_url: 'https://x/a.webp?v=2' },
    })
  })

  it('写头像元数据失败时返回失败结果，让组件回滚本地展示', async () => {
    holder.client = fakeClient({
      updateUser: vi.fn(async () => ({
        data: {},
        error: { message: 'email rate limit exceeded' },
      })),
    })

    expect(await updateAvatarMetadata('https://x/a.webp?v=2')).toEqual({
      ok: false,
      message: '操作过于频繁，请稍后再试',
    })
  })

  it('重置密码接口自身抛错（断网 / SDK 异常）也返回失败结果，不把异常抛给组件', async () => {
    // 组件层没有 try/catch，「不抛异常」是这个模块的契约：抛出去就是一屏白
    holder.client = fakeClient({
      resetPasswordForEmail: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })

    const result = await sendPasswordReset('zhang@example.com')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('网络不可用，请检查网络后重试')
  })

  it('改密接口自身抛错时同样兜住，并给出可展示的中文', async () => {
    holder.client = fakeClient({
      updateUser: vi.fn(async () => {
        throw new TypeError('NetworkError when attempting to fetch resource')
      }),
    })

    const result = await updateUserPassword('newpw123456')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('网络不可用，请检查网络后重试')
  })
})
