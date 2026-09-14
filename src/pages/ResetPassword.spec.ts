import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('@/api/auth', async () => (await import('@/test/authApiStub')).authApiStub)

import { AUTH_TEST_USER, authApiStub, resetAuthApiStub } from '@/test/authApiStub'
import ResetPassword from './ResetPassword.vue'

const TEST_ROUTES = [
  { path: '/reset-password', name: 'resetPassword', component: ResetPassword },
  { path: '/login', name: 'login', component: { template: '<div>登录页</div>' } },
  { path: '/', name: 'dashboard', component: { template: '<div>仪表板</div>' } },
]

function configureSupabase(configured = true) {
  vi.stubEnv('VITE_SUPABASE_URL', configured ? 'https://demo.supabase.co' : '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', configured ? 'anon-key' : '')
}

async function mountPage(options: { withSession?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  if (options.withSession) authApiStub.getCurrentSessionUser.mockResolvedValue(AUTH_TEST_USER)

  const router = createRouter({ history: createMemoryHistory(), routes: TEST_ROUTES })
  await router.push('/reset-password')
  await router.isReady()

  const wrapper = mount(ResetPassword, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('重置密码页', () => {
  beforeEach(() => {
    resetAuthApiStub()
    configureSupabase(true)
    localStorage.clear()
  })

  it('链接无效/过期（没有 recovery 会话）：给出重新申请的引导，而不是一个必然失败的表单', async () => {
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-testid="reset-invalid"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('重新申请')
    expect(wrapper.find('[data-testid="reset-submit"]').exists()).toBe(false)
  })

  it('有会话（正常流程）：显示新密码表单与当前账号', async () => {
    const { wrapper } = await mountPage({ withSession: true })

    expect(wrapper.find('[data-testid="reset-invalid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="reset-password"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reset-confirm-password"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(AUTH_TEST_USER.email)
  })

  it('两次密码不一致：本地校验拦住，不发请求', async () => {
    const { wrapper } = await mountPage({ withSession: true })

    await wrapper.find('[data-testid="reset-password"] input').setValue('Newpw123456')
    await wrapper.find('[data-testid="reset-confirm-password"] input').setValue('Newpw654321')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.find('[data-testid="reset-error-confirm-password"]').text()).toBe(
      '两次输入的密码不一致',
    )
    expect(authApiStub.updateUserPassword).not.toHaveBeenCalled()
  })

  it('新密码太短/不合规：强度条列出缺什么，保存按钮置灰', async () => {
    const { wrapper } = await mountPage({ withSession: true })

    await wrapper.find('[data-testid="reset-password"] input').setValue('123')
    await wrapper.find('[data-testid="reset-confirm-password"] input').setValue('123')
    await wrapper.find('form').trigger('submit')

    const hints = wrapper.find('[data-testid="password-strength-hints"]')
    expect(hints.text()).toContain('至少 8 个字符')
    expect(wrapper.find('[data-testid="reset-submit"]').attributes('disabled')).toBeDefined()
    expect(authApiStub.updateUserPassword).not.toHaveBeenCalled()
  })

  it('提交成功：调用改密接口、清空表单、稍后跳回仪表板', async () => {
    vi.useFakeTimers()
    try {
      const { wrapper, router } = await mountPage({ withSession: true })

      await wrapper.find('[data-testid="reset-password"] input').setValue('Newpw123456')
      await wrapper.find('[data-testid="reset-confirm-password"] input').setValue('Newpw123456')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(authApiStub.updateUserPassword).toHaveBeenCalledWith('Newpw123456')
      expect(wrapper.find('[data-testid="reset-feedback"]').text()).toContain('密码已更新')
      expect(
        (wrapper.find('[data-testid="reset-password"] input').element as HTMLInputElement).value,
      ).toBe('')

      await vi.advanceTimersByTimeAsync(1500)
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('dashboard')
    } finally {
      vi.useRealTimers()
    }
  })

  it('提交失败：展示服务端文案，不跳转', async () => {
    authApiStub.updateUserPassword.mockResolvedValue({
      ok: false,
      message: '新密码不能与当前密码相同',
    })
    const { wrapper, router } = await mountPage({ withSession: true })

    await wrapper.find('[data-testid="reset-password"] input').setValue('Newpw123456')
    await wrapper.find('[data-testid="reset-confirm-password"] input').setValue('Newpw123456')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="reset-feedback"]').text()).toContain('不能与当前密码相同')
    expect(router.currentRoute.value.name).toBe('resetPassword')
  })

  it('可以返回登录页', async () => {
    const { wrapper, router } = await mountPage({ withSession: true })

    await wrapper.find('[data-testid="reset-to-login"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('本地模式：提示没有云端账号可重置', async () => {
    configureSupabase(false)
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-testid="reset-local-mode"]').exists()).toBe(true)
  })

  it('会话带邮箱时用于展示（recovery 会话来自邮箱链接）', async () => {
    const { wrapper } = await mountPage({ withSession: true })
    expect(wrapper.text()).toContain('zhang@example.com')
  })
})
