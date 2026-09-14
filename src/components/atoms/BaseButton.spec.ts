import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseButton from './BaseButton.vue'

describe('BaseButton', () => {
  it('默认渲染 primary 按钮（跟随主题色 CSS 变量）并发射 click', async () => {
    const wrapper = mount(BaseButton, { slots: { default: '保存' } })
    expect(wrapper.text()).toContain('保存')
    // primary 用主题色变量，换主题色即时生效（不再硬编码颜色）
    expect(wrapper.classes()).toContain('bg-[var(--el-color-primary)]')

    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('支持 variant/size/nativeType/block', () => {
    const wrapper = mount(BaseButton, {
      props: { variant: 'danger', size: 'sm', nativeType: 'submit', block: true },
    })
    expect(wrapper.classes()).toContain('bg-rose-600')
    expect(wrapper.attributes('type')).toBe('submit')
    expect(wrapper.classes()).toContain('w-full')
  })

  it('disabled 时不发射 click', async () => {
    const wrapper = mount(BaseButton, { props: { disabled: true } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('loading：显示转圈动画、自动禁用并拦住 click（防重复提交）', async () => {
    const wrapper = mount(BaseButton, { props: { loading: true }, slots: { default: '注册中…' } })

    expect(wrapper.text()).toContain('注册中…')
    expect(wrapper.find('.animate-spin').exists()).toBe(true)
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.attributes('aria-busy')).toBe('true')

    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('未加载时不渲染转圈', () => {
    const wrapper = mount(BaseButton, { slots: { default: '保存' } })
    expect(wrapper.find('.animate-spin').exists()).toBe(false)
  })
})
