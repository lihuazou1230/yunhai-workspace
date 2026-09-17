import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'

import { NAV_ITEMS } from './navItems'
import MobileBottomNav from './MobileBottomNav.vue'

const TEST_ROUTES = [
  { path: '/', name: 'dashboard', component: { template: '<div />' } },
  { path: '/todos', name: 'todos', component: { template: '<div />' } },
  { path: '/stats', name: 'stats', component: { template: '<div />' } },
  { path: '/knowledge', name: 'knowledge', component: { template: '<div />' } },
  { path: '/settings', name: 'settings', component: { template: '<div />' } },
]

async function mountNav(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: TEST_ROUTES })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(MobileBottomNav, { global: { plugins: [router] } })
  await nextTick()
  return wrapper
}

describe('MobileBottomNav', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('渲染全部路由 Tab（第五阶段 4 项，第十阶段加知识库成 5 项），与侧边栏共用同一份定义', async () => {
    const wrapper = await mountNav()

    expect(wrapper.findAll('a')).toHaveLength(NAV_ITEMS.length)
    for (const item of NAV_ITEMS) {
      const link = wrapper.find(`[data-testid="bottom-nav-${item.name}"]`)
      expect(link.exists()).toBe(true)
      expect(link.text()).toContain(item.label)
    }
    expect(wrapper.find('[data-testid="bottom-nav-todos"]').attributes('href')).toBe('/todos')
  })

  it('当前路由的 Tab 带激活样式', async () => {
    const wrapper = await mountNav('/stats')

    const active = wrapper.find('[data-testid="bottom-nav-stats"]')
    const inactive = wrapper.find('[data-testid="bottom-nav-todos"]')
    expect(active.classes().join(' ')).toContain('text-[var(--el-color-primary)]')
    expect(inactive.classes().join(' ')).not.toContain('text-[var(--el-color-primary)]')
  })

  it('仪表板 Tab 只在根路径高亮（不做前缀匹配）', async () => {
    const wrapper = await mountNav('/todos')

    const dashboard = wrapper.find('[data-testid="bottom-nav-dashboard"]')
    // '/todos' 时仪表板不应被点亮（否则每个页面都会同时亮两个 Tab）
    expect(dashboard.classes().join(' ')).not.toContain('text-[var(--el-color-primary)]')
  })
})
