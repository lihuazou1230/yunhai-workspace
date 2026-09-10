import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { useLinkStore } from '@/stores/linkStore'
import LinkDock from './LinkDock.vue'

/**
 * 组件读的是 Pinia store，所以必须让「测试里改的 store」和「组件读的 store」是同一个实例：
 * 先 setActivePinia(pinia)，再用同一个 pinia 挂载。
 */
function mountDock() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLinkStore()
  const wrapper = mount(LinkDock, { global: { plugins: [pinia] } })
  return { wrapper, store }
}

/** 表单字段（BaseInput 的 testid 落在包裹层，输入框在它里面） */
function fieldElement(wrapper: VueWrapper, name: string): HTMLInputElement {
  return wrapper.find(`[data-testid="${name}"] input`).element as HTMLInputElement
}

/**
 * 提交添加表单。
 * 走 `<form>` 的 submit 事件而不是点按钮：happy-dom 不实现「点 submit 按钮 → 触发表单提交」
 * 这条浏览器的默认行为（与 TodoForm.spec.ts 同一套写法）。
 */
async function submitLinkForm(wrapper: VueWrapper) {
  await wrapper.find('[data-testid="link-add-form"]').trigger('submit')
}

async function enterEditMode(wrapper: VueWrapper) {
  await wrapper.find('[data-testid="linkdock-edit-toggle"]').trigger('click')
}

describe('LinkDock', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('按分组渲染图标卡与分组标题', async () => {
    const { wrapper, store } = mountDock()
    const github = store.addLink({ title: 'GitHub', url: 'github.com', group: '开发' })!
    store.addLink({ title: '知乎', url: 'zhihu.com', group: '资讯' })
    store.addLink({ title: 'MDN', url: 'developer.mozilla.org', group: '开发' })
    await nextTick()

    expect(wrapper.find('[data-testid="linkdock-group-开发"]').text()).toBe('开发')
    expect(wrapper.find('[data-testid="linkdock-group-资讯"]').text()).toBe('资讯')
    // 组内保持录入顺序
    const devTitles = wrapper.findAll('[data-testid="linkdock-grid-开发"] a').map((a) => a.text())
    expect(devTitles).toEqual(['GitHub', 'MDN'])
    expect(wrapper.find(`[data-testid="linkdock-link-${github.id}"]`).exists()).toBe(true)
  })

  it('未分组链接落在默认分组标题下', async () => {
    const { wrapper, store } = mountDock()
    store.addLink({ title: '百度', url: 'baidu.com' })
    await nextTick()

    expect(wrapper.find('[data-testid="linkdock-group-常用"]').exists()).toBe(true)
  })

  it('没有链接时显示空状态与添加入口，不显示表单', () => {
    const { wrapper } = mountDock()

    expect(wrapper.find('[data-testid="linkdock-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="linkdock-empty"]').text()).toContain('还没有快捷入口')
    expect(wrapper.find('[data-testid="linkdock-add"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="linkdock-add"]').text()).toContain('添加链接')
    expect(wrapper.find('[data-testid="link-add-form"]').exists()).toBe(false)
  })

  it('空状态的添加入口直接进入编辑态并摊开表单', async () => {
    const { wrapper } = mountDock()

    await wrapper.find('[data-testid="linkdock-add"]').trigger('click')

    expect(wrapper.find('[data-testid="link-add-form"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="linkdock-edit-toggle"]').text()).toBe('完成')
  })

  it('查看态不显示「＋ 添加链接」与删除按钮，编辑态才显示', async () => {
    const { wrapper, store } = mountDock()
    const link = store.addLink({ title: 'GitHub', url: 'github.com' })!
    await nextTick()

    expect(wrapper.find('[data-testid="linkdock-add"]').exists()).toBe(false)
    expect(wrapper.find(`[data-testid="link-delete-${link.id}"]`).exists()).toBe(false)

    await enterEditMode(wrapper)

    expect(wrapper.find('[data-testid="linkdock-edit-toggle"]').text()).toBe('完成')
    expect(wrapper.find('[data-testid="linkdock-add"]').exists()).toBe(true)
    expect(wrapper.find(`[data-testid="link-delete-${link.id}"]`).exists()).toBe(true)
    expect(wrapper.find('[data-testid="link-add-form"]').exists()).toBe(true)
  })

  it('添加链接：写进 store（网址归一化），表单清空且保留分组', async () => {
    const { wrapper, store } = mountDock()
    await enterEditMode(wrapper)

    await wrapper.find('[data-testid="link-add-title"] input').setValue('示例站')
    await wrapper.find('[data-testid="link-add-url"] input').setValue('example.com')
    await wrapper.find('[data-testid="link-add-group"] input').setValue('工具')
    // 提交按钮本身是表单的 submit 触发器（语义正确，浏览器里点它就能提交）
    expect(wrapper.find('[data-testid="link-add-submit"]').attributes('type')).toBe('submit')
    await submitLinkForm(wrapper)
    await nextTick()

    expect(store.linkCount).toBe(1)
    expect(store.links[0]).toMatchObject({
      title: '示例站',
      url: 'https://example.com',
      group: '工具',
    })
    // 新链接立刻出现在自己的分组里
    expect(wrapper.find('[data-testid="linkdock-group-工具"]').exists()).toBe(true)
    expect(fieldElement(wrapper, 'link-add-title').value).toBe('')
    expect(fieldElement(wrapper, 'link-add-url').value).toBe('')
    expect(fieldElement(wrapper, 'link-add-group').value).toBe('工具')
    expect(wrapper.find('[data-testid="link-add-error"]').exists()).toBe(false)
  })

  it('添加链接：分组留空归入默认分组', async () => {
    const { wrapper, store } = mountDock()
    await wrapper.find('[data-testid="linkdock-add"]').trigger('click')

    await wrapper.find('[data-testid="link-add-title"] input').setValue('百度')
    await wrapper.find('[data-testid="link-add-url"] input').setValue('baidu.com')
    await wrapper.find('[data-testid="link-add-group"] input').setValue('')
    await submitLinkForm(wrapper)
    await nextTick()

    expect(store.links[0].group).toBe('常用')
  })

  it('标题非法时给出内联错误且不写入', async () => {
    const { wrapper, store } = mountDock()
    await enterEditMode(wrapper)

    await wrapper.find('[data-testid="link-add-url"] input').setValue('example.com')
    await submitLinkForm(wrapper)
    await nextTick()

    expect(wrapper.find('[data-testid="link-add-error"]').text()).toContain('名称不能为空')
    expect(store.linkCount).toBe(0)
  })

  it('网址非法（含危险协议）时给出内联错误且不写入', async () => {
    const { wrapper, store } = mountDock()
    await enterEditMode(wrapper)

    await wrapper.find('[data-testid="link-add-title"] input').setValue('坏链接')
    await wrapper.find('[data-testid="link-add-url"] input').setValue('javascript:alert(1)')
    await submitLinkForm(wrapper)
    await nextTick()

    expect(wrapper.find('[data-testid="link-add-error"]').text()).toContain('网址格式不正确')
    expect(store.linkCount).toBe(0)
  })

  it('编辑态删除按钮移除该条链接', async () => {
    const { wrapper, store } = mountDock()
    const link = store.addLink({ title: 'GitHub', url: 'github.com' })!
    await nextTick()
    await enterEditMode(wrapper)

    await wrapper.find(`[data-testid="link-delete-${link.id}"]`).trigger('click')
    await nextTick()

    expect(store.linkCount).toBe(0)
    expect(wrapper.find(`[data-testid="linkdock-link-${link.id}"]`).exists()).toBe(false)
    expect(wrapper.find('[data-testid="linkdock-empty"]').exists()).toBe(true)
  })

  it('链接卡片的 href / target / rel 正确（新标签页 + 防反向控制）', async () => {
    const { wrapper, store } = mountDock()
    const link = store.addLink({ title: 'GitHub', url: 'github.com' })!
    await nextTick()

    const anchor = wrapper.find(`[data-testid="linkdock-link-${link.id}"]`)
    expect(anchor.element.tagName).toBe('A')
    expect(anchor.attributes('href')).toBe('https://github.com')
    expect(anchor.attributes('target')).toBe('_blank')
    expect(anchor.attributes('rel')).toBe('noopener noreferrer')
  })

  it('图标先走抓取服务，失败后退到站点 /favicon.ico，再失败上首字母色块', async () => {
    const { wrapper, store } = mountDock()
    const link = store.addLink({ title: 'github', url: 'github.com' })!
    await nextTick()

    expect(wrapper.find(`[data-testid="link-icon-${link.id}"]`).attributes('src')).toBe(
      'https://www.google.com/s2/favicons?domain=github.com&sz=64',
    )

    // 第一级失败 → 站点自己的 favicon
    await wrapper.find(`[data-testid="link-icon-${link.id}"]`).trigger('error')
    expect(wrapper.find(`[data-testid="link-icon-${link.id}"]`).attributes('src')).toBe(
      'https://github.com/favicon.ico',
    )

    // 第二级也失败 → 首字母色块（同一个链接只兜两次，不会来回弹）
    await wrapper.find(`[data-testid="link-icon-${link.id}"]`).trigger('error')
    expect(wrapper.find(`[data-testid="link-icon-${link.id}"]`).exists()).toBe(false)
    expect(wrapper.find(`[data-testid="link-icon-fallback-${link.id}"]`).text()).toBe('G')
  })

  it('自定义 iconUrl 优先于抓取图标', async () => {
    const { wrapper, store } = mountDock()
    const link = store.addLink({ title: '自定图标', url: 'example.com' })!
    store.updateLink(link.id, { iconUrl: 'https://cdn.example.com/i.png' })
    await nextTick()

    expect(wrapper.find(`[data-testid="link-icon-${link.id}"]`).attributes('src')).toBe(
      'https://cdn.example.com/i.png',
    )
  })

  it('一个图标坏掉不影响其它链接的图标', async () => {
    const { wrapper, store } = mountDock()
    const broken = store.addLink({ title: 'A 站', url: 'a.com' })!
    const fine = store.addLink({ title: 'B 站', url: 'b.com' })!
    await nextTick()

    await wrapper.find(`[data-testid="link-icon-${broken.id}"]`).trigger('error')
    await wrapper.find(`[data-testid="link-icon-${broken.id}"]`).trigger('error')

    expect(wrapper.find(`[data-testid="link-icon-fallback-${broken.id}"]`).exists()).toBe(true)
    expect(wrapper.find(`[data-testid="link-icon-${fine.id}"]`).attributes('src')).toBe(
      'https://www.google.com/s2/favicons?domain=b.com&sz=64',
    )
  })

  it('分组输入框提供已有分组作为候选项', async () => {
    const { wrapper, store } = mountDock()
    store.addLink({ title: 'GitHub', url: 'github.com', group: '开发' })
    store.addLink({ title: '知乎', url: 'zhihu.com', group: '资讯' })
    await nextTick()
    await enterEditMode(wrapper)

    const options = wrapper
      .findAll('#linkdock-group-options option')
      .map((o) => o.attributes('value'))
    expect(options).toEqual(['开发', '资讯'])
  })
})
