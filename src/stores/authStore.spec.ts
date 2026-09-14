import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import type { AuthResult, AuthUser, SignUpPayload } from '@/types/auth'

/** 认证 API 全部换成桩：这一层只验证 store 的状态流转（按真实签名声明，便于断言调用参数） */
const api = vi.hoisted(() => ({
  consumeAuthRedirect: vi.fn<(url?: string) => Promise<AuthResult | null>>(),
  describeAuthError: vi.fn<(error: unknown) => string>(),
  getCurrentSessionUser: vi.fn<() => Promise<AuthUser | null>>(),
  resendConfirmEmail:
    vi.fn<(email: string, redirectTo?: string, captchaToken?: string) => Promise<AuthResult>>(),
  sendPasswordReset:
    vi.fn<(email: string, redirectTo?: string, captchaToken?: string) => Promise<AuthResult>>(),
  signInWithGitHub: vi.fn<(redirectTo?: string) => Promise<AuthResult>>(),
  signInWithPassword:
    vi.fn<(email: string, password: string, captchaToken?: string) => Promise<AuthResult>>(),
  signOutUser: vi.fn<() => Promise<AuthResult>>(),
  signUpWithPassword: vi.fn<(payload: SignUpPayload) => Promise<AuthResult>>(),
  subscribeAuthChanges: vi.fn<(cb: (user: AuthUser | null) => void) => () => void>(),
  updateAvatarMetadata: vi.fn<(avatarUrl: string) => Promise<AuthResult>>(),
  updateUserPassword: vi.fn<(password: string) => Promise<AuthResult>>(),
}))

const supabase = vi.hoisted(() => ({ isSupabaseConfigured: vi.fn(() => true) }))

vi.mock('@/api/auth', () => api)
vi.mock('@/api/supabase', () => supabase)

import { useAuthStore } from './authStore'

const SESSION_USER: AuthUser = {
  id: 'u1',
  email: 'zhang@example.com',
  displayName: '张三',
  avatarUrl: 'https://x/a.webp?v=1',
  provider: 'github',
}

function configured(value: boolean) {
  supabase.isSupabaseConfigured.mockReturnValue(value)
}

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configured(true)
    api.consumeAuthRedirect.mockResolvedValue(null)
    api.describeAuthError.mockImplementation((error) => `err:${String(error)}`)
    api.getCurrentSessionUser.mockResolvedValue(null)
    api.resendConfirmEmail.mockResolvedValue({
      ok: true,
      message: '验证邮件已重新发送，请稍候查收',
    })
    api.sendPasswordReset.mockResolvedValue({
      ok: true,
      message: '重置链接已发送，请到邮箱查收（没收到先看垃圾箱）',
    })
    api.updateUserPassword.mockResolvedValue({
      ok: true,
      message: '密码已更新，可以用新密码登录了',
    })
    api.subscribeAuthChanges.mockReturnValue(vi.fn())
    api.signInWithPassword.mockResolvedValue({ ok: true, message: '登录成功' })
    api.signInWithGitHub.mockResolvedValue({ ok: true, message: '正在跳转 GitHub 授权…' })
    api.signOutUser.mockResolvedValue({ ok: true, message: '已退出登录' })
    api.signUpWithPassword.mockResolvedValue({ ok: true, message: '注册成功，已自动登录' })
    api.updateAvatarMetadata.mockResolvedValue({ ok: true, message: '头像已更新' })
    setActivePinia(createPinia())
  })

  it('初始状态是 loading（守卫必须能区分「还没恢复完」与「未登录」）', () => {
    const store = useAuthStore()
    expect(store.status).toBe('loading')
    expect(store.isReady).toBe(false)
    expect(store.isAuthed).toBe(false)
  })

  it('未登录时 email / avatarUrl 给空串而不是 undefined（模板直接插值会渲染成 "undefined"）', () => {
    const store = useAuthStore()
    expect(store.user).toBeNull()
    expect(store.email).toBe('')
    expect(store.avatarUrl).toBe('')
    expect(store.displayName).toBe('本地访客')
  })

  it('未配置 Supabase：直接进入本地模式，不报错、不阻塞', async () => {
    configured(false)
    const store = useAuthStore()
    await store.init()

    expect(store.mode).toBe('local')
    expect(store.isLocalMode).toBe(true)
    expect(store.status).toBe('guest')
    expect(store.displayName).toBe('本地访客')
    expect(api.getCurrentSessionUser).not.toHaveBeenCalled()
  })

  it('已配置但无会话：恢复为未登录，并订阅登录态变化', async () => {
    const store = useAuthStore()
    await store.init()

    expect(store.mode).toBe('cloud')
    expect(store.status).toBe('guest')
    expect(api.getCurrentSessionUser).toHaveBeenCalledTimes(1)
    expect(api.subscribeAuthChanges).toHaveBeenCalledTimes(1)
  })

  it('刷新页面：用 getSession 恢复已登录状态', async () => {
    api.getCurrentSessionUser.mockResolvedValue(SESSION_USER)
    const store = useAuthStore()
    await store.init()

    expect(store.isAuthed).toBe(true)
    expect(store.displayName).toBe('张三')
    expect(store.email).toBe('zhang@example.com')
    expect(store.avatarUrl).toBe('https://x/a.webp?v=1')
    expect(store.initial).toBe('张三')
  })

  it('邮件链接落地：先认领凭据再恢复会话（顺序反了会判成未登录，用户得手动登一次）', async () => {
    api.consumeAuthRedirect.mockResolvedValue({ ok: true, message: '邮箱验证成功，已自动登录' })
    api.getCurrentSessionUser.mockResolvedValue(SESSION_USER)

    const store = useAuthStore()
    await store.init()

    expect(api.consumeAuthRedirect).toHaveBeenCalledTimes(1)
    expect(store.isAuthed).toBe(true)
    expect(store.redirectNotice?.message).toContain('已自动登录')
    // 顺序：consumeAuthRedirect 的调用时刻必须早于 getSession
    const redirectOrder = api.consumeAuthRedirect.mock.invocationCallOrder[0]
    const sessionOrder = api.getCurrentSessionUser.mock.invocationCallOrder[0]
    expect(redirectOrder).toBeLessThan(sessionOrder)
  })

  it('邮件链接失效：把原因记成可展示的提示，取一次就清掉', async () => {
    api.consumeAuthRedirect.mockResolvedValue({ ok: false, message: '邮件链接已失效' })

    const store = useAuthStore()
    await store.init()

    expect(store.takeRedirectNotice()?.message).toBe('邮件链接已失效')
    expect(store.takeRedirectNotice()).toBeNull()
    expect(store.lastError).toBe('邮件链接已失效')
  })

  it('本地模式不处理邮件链接（没有云配置就没有这回事）', async () => {
    configured(false)
    const store = useAuthStore()
    await store.init()

    expect(api.consumeAuthRedirect).not.toHaveBeenCalled()
  })

  it('会话恢复失败时降级为未登录并记录原因，不抛错', async () => {
    api.getCurrentSessionUser.mockRejectedValue(new Error('network down'))
    const store = useAuthStore()
    await store.init()

    expect(store.status).toBe('guest')
    expect(store.lastError).toBe('err:Error: network down')
  })

  it('init 幂等：并发调用只恢复一次（守卫可放心 await）', async () => {
    const store = useAuthStore()
    await Promise.all([store.init(), store.init(), store.ensureReady()])
    expect(api.getCurrentSessionUser).toHaveBeenCalledTimes(1)
  })

  it('ensureReady 已完成时不再重复恢复', async () => {
    const store = useAuthStore()
    await store.init()
    await store.ensureReady()
    expect(api.getCurrentSessionUser).toHaveBeenCalledTimes(1)
  })

  it('订阅回调更新登录/登出状态', async () => {
    const emitters: Array<(user: AuthUser | null) => void> = []
    api.subscribeAuthChanges.mockImplementation((cb: (user: AuthUser | null) => void) => {
      emitters.push(cb)
      return vi.fn()
    })

    const store = useAuthStore()
    await store.init()
    expect(emitters).toHaveLength(1)
    expect(store.isAuthed).toBe(false)

    emitters.forEach((emit) => emit(SESSION_USER))
    expect(store.isAuthed).toBe(true)
    expect(store.displayName).toBe('张三')

    emitters.forEach((emit) => emit(null))
    expect(store.status).toBe('guest')
  })

  it('登录成功后立即刷新用户（不等 onAuthStateChange）', async () => {
    const store = useAuthStore()
    await store.init()

    api.getCurrentSessionUser.mockResolvedValue(SESSION_USER)
    const result = await store.signIn(' zhang@example.com ', 'pw123456', 'turnstile-token')

    expect(result.ok).toBe(true)
    expect(api.signInWithPassword).toHaveBeenCalledWith(
      'zhang@example.com',
      'pw123456',
      'turnstile-token',
    )
    expect(store.isAuthed).toBe(true)
  })

  it('登录失败：记录错误文案，状态保持未登录', async () => {
    api.signInWithPassword.mockResolvedValue({ ok: false, message: '邮箱或密码不正确' })
    const store = useAuthStore()
    await store.init()

    const result = await store.signIn('a@b.com', 'bad')

    expect(result).toEqual({ ok: false, message: '邮箱或密码不正确' })
    expect(store.lastError).toBe('邮箱或密码不正确')
    expect(store.isAuthed).toBe(false)
  })

  it('注册：需要邮箱验证时不算登录', async () => {
    api.signUpWithPassword.mockResolvedValue({
      ok: true,
      message: '注册成功，请到邮箱完成验证后再登录',
      needsEmailConfirm: true,
    })
    const store = useAuthStore()
    await store.init()

    const result = await store.signUp({
      email: 'a@b.com',
      password: 'pw123456',
      displayName: ' 李四 ',
    })

    expect(result.needsEmailConfirm).toBe(true)
    expect(api.signUpWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw123456',
      displayName: '李四',
    })
    expect(store.isAuthed).toBe(false)
  })

  it('GitHub 登录透传 redirectTo', async () => {
    const store = useAuthStore()
    await store.init()

    await store.signInWithGithub('https://app.example.com/login?redirect=/todos')
    expect(api.signInWithGitHub).toHaveBeenCalledWith(
      'https://app.example.com/login?redirect=/todos',
    )
  })

  it('GitHub 登录失败（provider 未开启 / 网络不通）：记录文案，状态保持未登录', async () => {
    api.signInWithGitHub.mockResolvedValue({ ok: false, message: 'Provider is not enabled' })
    const store = useAuthStore()
    await store.init()

    const result = await store.signInWithGithub()

    expect(result.ok).toBe(false)
    expect(store.lastError).toBe('Provider is not enabled')
    expect(store.isAuthed).toBe(false)
  })

  it('注册失败：记录文案并保持未登录（不能因为「调用没抛错」就当成功）', async () => {
    api.signUpWithPassword.mockResolvedValue({ ok: false, message: '该邮箱已注册，请直接登录' })
    const store = useAuthStore()
    await store.init()

    const result = await store.signUp({
      email: 'a@b.com',
      password: 'pw123456',
      displayName: '张三',
    })

    expect(result.ok).toBe(false)
    expect(store.lastError).toBe('该邮箱已注册，请直接登录')
    expect(store.isAuthed).toBe(false)
    // 失败时不该去刷新用户（那会多打一次会话接口）
    expect(api.getCurrentSessionUser).toHaveBeenCalledTimes(1)
  })

  it('注册成功且直接拿到会话：立刻刷新用户，不用等 onAuthStateChange', async () => {
    api.signUpWithPassword.mockResolvedValue({ ok: true, message: '注册成功，已自动登录' })
    const store = useAuthStore()
    await store.init()

    api.getCurrentSessionUser.mockResolvedValue(SESSION_USER)
    await store.signUp({ email: 'a@b.com', password: 'pw123456', displayName: '张三' })

    expect(store.isAuthed).toBe(true)
    expect(api.getCurrentSessionUser).toHaveBeenCalledTimes(2)
  })

  it('重新发送验证邮件：去空格后调用，失败时记录文案', async () => {
    const store = useAuthStore()
    await store.init()

    await store.resendConfirm('  zhang@example.com  ', 'turnstile-token')
    expect(api.resendConfirmEmail).toHaveBeenCalledWith(
      'zhang@example.com',
      undefined,
      'turnstile-token',
    )

    api.resendConfirmEmail.mockResolvedValue({ ok: false, message: '操作过于频繁，请稍后再试' })
    const result = await store.resendConfirm('zhang@example.com')
    expect(result.ok).toBe(false)
    expect(store.lastError).toBe('操作过于频繁，请稍后再试')
  })

  it('忘记密码：发送重置邮件（去空格）并透传失败文案', async () => {
    const store = useAuthStore()
    await store.init()

    const result = await store.sendResetEmail('  zhang@example.com ', 'turnstile-token')
    expect(result.ok).toBe(true)
    expect(api.sendPasswordReset).toHaveBeenCalledWith(
      'zhang@example.com',
      undefined,
      'turnstile-token',
    )

    api.sendPasswordReset.mockResolvedValue({ ok: false, message: '重置密码邮件发送失败' })
    const failed = await store.sendResetEmail('zhang@example.com')
    expect(failed.ok).toBe(false)
    expect(store.lastError).toBe('重置密码邮件发送失败')
  })

  it('修改密码：调用 updateUser 并返回结果', async () => {
    const store = useAuthStore()
    await store.init()

    const result = await store.changePassword('newpw123456')
    expect(result.ok).toBe(true)
    expect(api.updateUserPassword).toHaveBeenCalledWith('newpw123456')

    api.updateUserPassword.mockResolvedValue({ ok: false, message: '新密码不能与当前密码相同' })
    expect((await store.changePassword('same')).ok).toBe(false)
    expect(store.lastError).toBe('新密码不能与当前密码相同')
  })

  it('退出登录：无论云端结果如何本地都清空（避免卡在疑似登录态）', async () => {
    api.getCurrentSessionUser.mockResolvedValue(SESSION_USER)
    const store = useAuthStore()
    await store.init()
    expect(store.isAuthed).toBe(true)

    api.signOutUser.mockResolvedValue({ ok: false, message: '网络不可用' })
    await store.signOut()

    expect(store.isAuthed).toBe(false)
    expect(store.user).toBeNull()
    expect(store.lastError).toBe('网络不可用')
  })

  it('退出登录成功时把上一次的错误文案也清掉（否则登录页会残留旧报错）', async () => {
    api.getCurrentSessionUser.mockRejectedValue(new Error('network down'))
    const store = useAuthStore()
    await store.init()
    expect(store.lastError).toBe('err:Error: network down')

    api.signOutUser.mockResolvedValue({ ok: true, message: '已退出登录' })
    await store.signOut()

    expect(store.lastError).toBe('')
    expect(store.status).toBe('guest')
  })

  it('本地模式（未配置 Supabase）下 refreshUser 直接返回 null，不打会话接口', async () => {
    configured(false)
    const store = useAuthStore()

    expect(await store.refreshUser()).toBeNull()
    expect(api.getCurrentSessionUser).not.toHaveBeenCalled()
  })

  it('更新头像地址后本地用户立刻反映新头像', async () => {
    api.getCurrentSessionUser.mockResolvedValue(SESSION_USER)
    const store = useAuthStore()
    await store.init()

    await store.setAvatarUrl('https://x/a.webp?v=2')
    expect(store.avatarUrl).toBe('https://x/a.webp?v=2')

    store.clearLocalAvatar()
    expect(store.avatarUrl).toBe('')
  })

  it('写头像元数据失败时记下文案，且不把本地头像改成没存上的那个地址', async () => {
    api.getCurrentSessionUser.mockResolvedValue(SESSION_USER)
    api.updateAvatarMetadata.mockResolvedValue({
      ok: false,
      message: '网络不可用，请检查网络后重试',
    })
    const store = useAuthStore()
    await store.init()

    const result = await store.setAvatarUrl('https://x/a.webp?v=9')

    expect(result.ok).toBe(false)
    expect(store.lastError).toBe('网络不可用，请检查网络后重试')
    // 云端没存上却把界面上换成新地址，刷新后头像会「变回去」，用户会以为丢了
    expect(store.avatarUrl).toBe(SESSION_USER.avatarUrl)
  })

  it('dispose 取消失订阅并允许重新初始化', async () => {
    const unsubscribe = vi.fn()
    api.subscribeAuthChanges.mockReturnValue(unsubscribe)

    const store = useAuthStore()
    await store.init()
    store.dispose()

    expect(unsubscribe).toHaveBeenCalled()
    expect(store.status).toBe('loading')

    await store.init()
    expect(api.getCurrentSessionUser).toHaveBeenCalledTimes(2)
  })

  it('refreshUser 失败（会话接口挂了）：记下原因并返回 null，且不把已有的登录态清掉', async () => {
    api.getCurrentSessionUser.mockResolvedValue(SESSION_USER)
    const store = useAuthStore()
    await store.init()
    expect(store.isAuthed).toBe(true)

    api.getCurrentSessionUser.mockRejectedValue(new Error('session endpoint down'))
    const result = await store.refreshUser()

    expect(result).toBeNull()
    expect(store.lastError).toBe('err:Error: session endpoint down')
    // 一次「刷新资料」失败 ≠ 登出：把用户踢回登录页才是更糟的体验
    expect(store.isAuthed).toBe(true)
    expect(store.displayName).toBe('张三')
  })

  it('refreshUser 拿不到会话（token 已失效）时返回 null，但不主动把用户踢下线', async () => {
    api.getCurrentSessionUser.mockResolvedValue(SESSION_USER)
    const store = useAuthStore()
    await store.init()
    expect(store.isAuthed).toBe(true)

    // 会话过期：这里只回报「没拿到用户」，登出由 onAuthStateChange 的 SIGNED_OUT 负责，
    // 否则一次接口抖动就会把用户甩到登录页
    api.getCurrentSessionUser.mockResolvedValue(null)

    expect(await store.refreshUser()).toBeNull()
    expect(store.isAuthed).toBe(true)
  })

  it('未登录时 clearLocalAvatar 是空操作，不抛错', () => {
    const store = useAuthStore()
    expect(store.user).toBeNull()

    expect(() => store.clearLocalAvatar()).not.toThrow()
    expect(store.user).toBeNull()
  })
})
