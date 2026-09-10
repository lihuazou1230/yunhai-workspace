import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount, flushPromises } from '@vue/test-utils'

const avatarStub = vi.hoisted(() => ({
  displayUrl: null as unknown,
  fallbackInitial: null as unknown,
}))

vi.mock('@/composables/useAvatar', () => ({
  useAvatar: () => ({
    displayUrl: avatarStub.displayUrl,
    saving: ref(false),
    fallbackInitial: avatarStub.fallbackInitial,
    saveAvatar: vi.fn(),
    removeAvatar: vi.fn(),
    loadLocalAvatar: vi.fn(async () => {}),
    hasAvatar: ref(false),
    error: ref(''),
    dispose: vi.fn(),
  }),
}))

import { useTodoStore } from '@/stores/todoStore'
import DefaultLayout from './DefaultLayout.vue'

const Child = { template: '<div data-testid="page-child">子页面</div>' }

const TEST_ROUTES = [
  {
    path: '/',
    component: DefaultLayout,
    children: [
      { path: '', name: 'dashboard', component: Child, meta: { title: '仪表板' } },
      { path: 'todos', name: 'todos', component: Child, meta: { title: '任务' } },
      { path: 'stats', name: 'stats', component: Child, meta: { title: '统计' } },
      { path: 'settings', name: 'settings', component: Child, meta: { title: '设置' } },
    ],
  },
  { path: '/login', name: 'login', component: { template: '<div />' } },
]

async function mountLayout(path = '/') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: TEST_ROUTES })
  await router.push(path)
  await router.isReady()

  const wrapper = mount(DefaultLayout, { global: { plugins: [pinia, router] } })
  await nextTick()
  return { wrapper, router }
}

describe('DefaultLayout', () => {
  beforeEach(() => {
    localStorage.clear()
    avatarStub.displayUrl = ref('')
    avatarStub.fallbackInitial = ref('访客')
  })

  it('装配侧边栏、顶栏聚合搜索、页面标题、内容区与移动端底部导航', async () => {
    const { wrapper } = await mountLayout('/todos')

    expect(wrapper.find('[data-testid="sidebar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="aggregate-search-input"]').exists()).toBe(true)
    expect(wrapper.find('h1').text()).toBe('任务')
    expect(wrapper.find('[data-testid="page-child"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="bottom-nav-dashboard"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="bottom-nav-todos"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="bottom-nav-stats"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="bottom-nav-settings"]').exists()).toBe(true)
  })

  it('顶栏搜索写进 todoStore，但**不**在打字时把人搬走（结果就地出弹层）', async () => {
    const { wrapper, router } = await mountLayout('/')
    const store = useTodoStore()
    expect(router.currentRoute.value.name).toBe('dashboard')

    await wrapper.find('[data-testid="aggregate-search-input"]').setValue('周报')
    await flushPromises()

    expect(store.keyword).toBe('周报')
    // 6.4 起改用结果弹层：输入过程不再触发跳转
    expect(router.currentRoute.value.name).toBe('dashboard')
    expect(wrapper.find('[data-testid="aggregate-search-panel"]').exists()).toBe(true)
  })

  it('弹层里列出命中的任务，点一条跳到任务页', async () => {
    const { wrapper, router } = await mountLayout('/')
    const store = useTodoStore()
    store.addTodo({ title: '写周报', priority: 'high' })

    await wrapper.find('[data-testid="aggregate-search-input"]').setValue('周报')
    await flushPromises()

    const result = wrapper.find(`[data-testid="aggregate-result-${store.todos[0].id}"]`)
    expect(result.exists()).toBe(true)
    expect(result.text()).toContain('写周报')

    await result.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('todos')
  })

  it('弹层提供「用某引擎搜索网页」的入口，点引擎按钮轮换', async () => {
    const { wrapper } = await mountLayout('/')
    const store = useTodoStore()
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    await wrapper.find('[data-testid="aggregate-search-input"]').setValue('vue3')
    await flushPromises()

    // 默认百度 → 点一次切到谷歌
    const engineButton = wrapper.find('[data-testid="aggregate-search-engine"]')
    expect(engineButton.text()).toBe('百度')
    await engineButton.trigger('click')
    expect(engineButton.text()).toBe('谷歌')

    await wrapper.find('[data-testid="aggregate-search-web"]').trigger('click')
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.google.com/search?q=vue3',
      '_blank',
      'noopener,noreferrer',
    )
    // 跳站外搜索不应改变当前路由
    expect(store.keyword).toBe('vue3')
    vi.unstubAllGlobals()
  })

  it('已配置过的搜索引擎选择会被记住', async () => {
    // useLocalStorage 存的是 JSON，所以要带引号（裸字符串解析会失败并回落默认值）
    localStorage.setItem('smart-workspace:search-engine', JSON.stringify('bing'))
    const { wrapper } = await mountLayout('/')
    expect(wrapper.find('[data-testid="aggregate-search-engine"]').text()).toBe('必应')
  })

  it('持久化的引擎值被写脏时回落百度（不崩、不显示空白）', async () => {
    localStorage.setItem('smart-workspace:search-engine', JSON.stringify('sogou'))
    const { wrapper } = await mountLayout('/')
    expect(wrapper.find('[data-testid="aggregate-search-engine"]').text()).toBe('百度')
  })

  it('排序与折叠状态不受搜索影响（清空关键字留在当前页）', async () => {
    const { wrapper, router } = await mountLayout('/settings')

    await wrapper.find('[data-testid="aggregate-search-input"]').setValue('周报')
    await flushPromises()
    expect(useTodoStore().keyword).toBe('周报')
    expect(router.currentRoute.value.name).toBe('settings')

    await wrapper.find('[data-testid="aggregate-search-input"]').setValue('')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('settings')
    expect(useTodoStore().keyword).toBe('')
  })

  it('顶栏右侧有主题切换与设置入口（视觉规范：搜索居左，右侧 ThemeToggle + 设置）', async () => {
    const { wrapper } = await mountLayout('/')

    const header = wrapper.find('header')
    const settingsEntry = header.find('[data-testid="header-settings"]')
    expect(settingsEntry.exists()).toBe(true)
    expect(settingsEntry.attributes('href')).toBe('/settings')
    // 主题切换按钮仍在顶栏
    expect(header.find('button[aria-label^="切换到"]').exists()).toBe(true)
  })

  it('折叠按钮切换侧边栏宽度并记住状态', async () => {
    const { wrapper } = await mountLayout('/')
    expect(wrapper.find('[data-testid="sidebar"]').classes()).toContain('w-60')

    await wrapper.find('[data-testid="sidebar-collapse"]').trigger('click')
    await nextTick()

    expect(wrapper.find('[data-testid="sidebar"]').classes()).toContain('w-16')
    expect(localStorage.getItem('smart-workspace:sidebar-collapsed')).toBe('true')
  })

  it('折叠状态从本地记忆恢复', async () => {
    localStorage.setItem('smart-workspace:sidebar-collapsed', 'true')
    const { wrapper } = await mountLayout('/')
    expect(wrapper.find('[data-testid="sidebar"]').classes()).toContain('w-16')
  })
})
