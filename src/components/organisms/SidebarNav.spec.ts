import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'

/** 头像 composable 的桩（组件里只用到展示地址与首字母兜底） */
const avatarStub = vi.hoisted(() => ({
  displayUrl: null as unknown,
  fallbackInitial: null as unknown,
  markImageFailed: vi.fn(),
}))

vi.mock('@/api/auth', async () => (await import('@/test/authApiStub')).authApiStub)
vi.mock('@/api/todoRemote', () => ({
  fetchRemoteTodos: vi.fn(async () => []),
  pushRemoteTodos: vi.fn(async () => {}),
  deleteRemoteTodos: vi.fn(async () => {}),
  clearRemoteTodos: vi.fn(async () => {}),
}))
vi.mock('@/composables/useAvatar', () => ({
  useAvatar: () => ({
    displayUrl: avatarStub.displayUrl,
    saving: ref(false),
    fallbackInitial: avatarStub.fallbackInitial,
    saveAvatar: vi.fn(),
    removeAvatar: vi.fn(),
    markImageFailed: avatarStub.markImageFailed,
    loadLocalAvatar: vi.fn(async () => {}),
    hasAvatar: ref(false),
    error: ref(''),
    dispose: vi.fn(),
  }),
}))

import { authApiStub, resetAuthApiStub, AUTH_TEST_USER } from '@/test/authApiStub'
import { useAuthStore } from '@/stores/authStore'
import { useTodoStore } from '@/stores/todoStore'
import SidebarNav from './SidebarNav.vue'

const TEST_ROUTES = [
  { path: '/', name: 'dashboard', component: { template: '<div />' } },
  { path: '/todos', name: 'todos', component: { template: '<div />' } },
  { path: '/stats', name: 'stats', component: { template: '<div />' } },
  { path: '/knowledge', name: 'knowledge', component: { template: '<div />' } },
  { path: '/settings', name: 'settings', component: { template: '<div />' } },
  { path: '/login', name: 'login', component: { template: '<div />' } },
]

async function mountSidebar(options: { path?: string; collapsed?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: TEST_ROUTES })
  await router.push(options.path ?? '/todos')
  await router.isReady()

  const wrapper = mount(SidebarNav, {
    props: { collapsed: options.collapsed ?? false },
    global: { plugins: [pinia, router] },
  })
  await nextTick()
  return { wrapper, router }
}

describe('SidebarNav', () => {
  beforeEach(() => {
    resetAuthApiStub()
    // 显式清空而不是 unstubAllEnvs：后者会把开发机 .env.local 的真实配置读回来
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    localStorage.clear()
    avatarStub.displayUrl = ref('')
    avatarStub.fallbackInitial = ref('张三')
  })

  /** 模拟「已配置 Supabase」，否则 store 会直接判定为本地模式（不会去读会话） */
  function configureSupabase() {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  }

  it('渲染品牌、4 个导航项与姓名首字母兜底', async () => {
    const { wrapper } = await mountSidebar()

    expect(wrapper.text()).toContain('云海工作台')
    expect(wrapper.text()).toContain('仪表板')
    expect(wrapper.text()).toContain('任务')
    expect(wrapper.text()).toContain('统计')
    expect(wrapper.text()).toContain('设置')
    expect(wrapper.find('[data-testid="sidebar-avatar"]').text()).toBe('张三')
  })

  it('头像加载失败时上报（用于回落到首字母，避免显示碎图）', async () => {
    avatarStub.displayUrl = ref('https://avatars.githubusercontent.com/u/1')
    const { wrapper } = await mountSidebar()
    await nextTick()

    const img = wrapper.find('[data-testid="sidebar-avatar"] img')
    expect(img.exists()).toBe(true)
    await img.trigger('error')

    expect(avatarStub.markImageFailed).toHaveBeenCalled()
  })

  it('点头像弹窗渲染在侧边栏之外（aside 的 backdrop-filter 会把 fixed 弹窗困在 240px 里）', async () => {
    const { wrapper } = await mountSidebar()

    await wrapper.find('[data-testid="sidebar-avatar"]').trigger('click')
    for (let i = 0; i < 3; i += 1) await nextTick()

    // 弹窗确实出现了
    expect(wrapper.find('.el-overlay').exists()).toBe(true)
    // 但它不是侧边栏的后代（否则会被限制在侧边栏内定位）
    const sidebar = wrapper.find('[data-testid="sidebar"]')
    expect(sidebar.find('.el-overlay').exists()).toBe(false)
    expect(sidebar.find('[data-testid="avatar-file-input"]').exists()).toBe(false)
  })

  it('上组主导航是 5 项（含知识库与设置），下组是帮助与账号区', async () => {
    const { wrapper } = await mountSidebar()

    // 第五阶段 4 项 + 第十阶段的知识库
    const nav = wrapper.find('nav[aria-label="主导航"]')
    for (const name of ['dashboard', 'todos', 'stats', 'knowledge', 'settings']) {
      expect(nav.find(`[data-testid="sidebar-nav-${name}"]`).exists()).toBe(true)
    }
    const settings = nav.find('[data-testid="sidebar-nav-settings"]')
    expect(settings.attributes('href')).toBe('/settings')
    expect(settings.text()).toContain('设置')
    expect(nav.find('[data-testid="sidebar-nav-knowledge"]').text()).toContain('知识库')

    // 下组：帮助 / 退出登录（未登录时为登录入口）
    const footer = wrapper.find('[data-testid="sidebar-footer"]')
    expect(footer.find('[data-testid="sidebar-help"]').exists()).toBe(true)
    expect(footer.find('[data-testid="sidebar-sign-in"]').exists()).toBe(true)
    // 设置不再重复出现在下组
    expect(footer.find('[data-testid="sidebar-nav-settings"]').exists()).toBe(false)
  })

  it('导航项指向对应路由，当前路由用「主题色浅底 pill」高亮（不是黑底反白）', async () => {
    const { wrapper, router } = await mountSidebar({ path: '/stats' })

    const statsLink = wrapper.find('[data-testid="sidebar-nav-stats"]')
    expect(statsLink.attributes('href')).toBe('/stats')
    const statsClasses = statsLink.classes().join(' ')
    // 浅色 pill：主题色极浅底 + 深色文字
    expect(statsClasses).toContain('bg-[var(--el-color-primary-light-9)]')
    expect(statsClasses).toContain('text-[var(--el-color-primary-dark-2)]')
    // 不再是实底白字
    expect(statsClasses).not.toContain('text-white')

    // 非当前页不抢高亮
    const todosLink = wrapper.find('[data-testid="sidebar-nav-todos"]')
    const todosClasses = todosLink.classes().join(' ')
    expect(todosClasses).not.toContain('bg-[var(--el-color-primary-light-9)]')
    expect(todosClasses).toContain('text-slate-500')
    expect(router.currentRoute.value.name).toBe('stats')
  })

  it('头像区用圆形头像（展开 56px，折叠收成 36px）', async () => {
    const { wrapper } = await mountSidebar()
    expect(wrapper.find('[data-testid="sidebar-avatar"]').classes()).toContain('h-14')
    expect(wrapper.find('[data-testid="sidebar-avatar"]').classes()).toContain('rounded-full')
  })

  it('点帮助打开使用说明弹窗', async () => {
    const { wrapper } = await mountSidebar()

    // el-dialog 关闭时只有一层空遮罩节点，弹窗本体不在 DOM 里
    expect(wrapper.find('.el-dialog').exists()).toBe(false)

    await wrapper.find('[data-testid="sidebar-help"]').trigger('click')
    for (let i = 0; i < 3; i += 1) await nextTick()

    expect(wrapper.find('.el-dialog').exists()).toBe(true)
    expect(wrapper.text()).toContain('使用帮助')
  })

  it('折叠成 icon rail：只留图标与折叠按钮，品牌文案隐藏', async () => {
    const { wrapper } = await mountSidebar({ collapsed: true })

    expect(wrapper.find('[data-testid="sidebar"]').classes()).toContain('w-16')
    expect(wrapper.text()).not.toContain('仪表板')
    expect(wrapper.text()).not.toContain('云海工作台')
    expect(wrapper.find('[data-testid="sidebar-nav-dashboard"]').exists()).toBe(true)
  })

  it('展开时宽度是 240px，点折叠按钮向上抛事件', async () => {
    const { wrapper } = await mountSidebar({ collapsed: false })

    expect(wrapper.find('[data-testid="sidebar"]').classes()).toContain('w-60')
    await wrapper.find('[data-testid="sidebar-collapse"]').trigger('click')

    expect(wrapper.emitted('toggle-collapse')).toHaveLength(1)
  })

  it('未登录：显示「登录 / 注册」入口与本地模式提示', async () => {
    const { wrapper } = await mountSidebar()
    await useAuthStore().init()
    await nextTick()

    expect(wrapper.find('[data-testid="sidebar-sign-in"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-sign-out"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('本地访客')
  })

  it('已登录：显示昵称/邮箱与退出按钮，但**不再**显示同步状态角标', async () => {
    configureSupabase()
    const pinia = createPinia()
    setActivePinia(pinia)
    const authStore = useAuthStore()
    authApiStub.getCurrentSessionUser.mockResolvedValue(AUTH_TEST_USER)
    await authStore.init()
    // 即使云同步已激活，侧边栏也不该再出现同步角标（同步态归「设置」页）
    await useTodoStore().activateCloud(AUTH_TEST_USER.id)

    const router = createRouter({ history: createMemoryHistory(), routes: TEST_ROUTES })
    await router.push('/todos')
    const wrapper = mount(SidebarNav, {
      props: { collapsed: false },
      global: { plugins: [pinia, router] },
    })
    await nextTick()

    expect(wrapper.text()).toContain('张三')
    expect(wrapper.text()).toContain('zhang@example.com')
    expect(wrapper.find('[data-testid="sidebar-sign-out"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('云同步')
    expect(wrapper.text()).not.toContain('已同步')
  })

  it('点退出登录：调用 signOut 并跳回登录页', async () => {
    configureSupabase()
    const pinia = createPinia()
    setActivePinia(pinia)
    const authStore = useAuthStore()
    authApiStub.getCurrentSessionUser.mockResolvedValue(AUTH_TEST_USER)
    await authStore.init()

    const router = createRouter({ history: createMemoryHistory(), routes: TEST_ROUTES })
    await router.push('/todos')
    const wrapper = mount(SidebarNav, {
      props: { collapsed: false },
      global: { plugins: [pinia, router] },
    })
    await nextTick()

    await wrapper.find('[data-testid="sidebar-sign-out"]').trigger('click')
    await flushPromises()

    expect(authApiStub.signOutUser).toHaveBeenCalled()
    expect(authStore.isAuthed).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
  })
})
