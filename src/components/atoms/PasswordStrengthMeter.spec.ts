import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import PasswordStrengthMeter from './PasswordStrengthMeter.vue'

function mountMeter(password: string, showHints = true) {
  return mount(PasswordStrengthMeter, { props: { password, showHints } })
}

describe('PasswordStrengthMeter（密码强度条）', () => {
  it('空密码：整块不渲染（0% 的进度条轨道看起来像一条分割线，夹在密码与确认密码之间很难看）', () => {
    const wrapper = mountMeter('')
    expect(wrapper.find('[data-testid="password-strength"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="password-strength-bar"]').exists()).toBe(false)
    expect(wrapper.find('.el-progress').exists()).toBe(false)
    expect(wrapper.find('[data-testid="password-strength-level"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="password-strength-hints"]').exists()).toBe(false)
  })

  it('一旦有输入就出现（进度条才是有意义的反馈）', () => {
    const wrapper = mountMeter('a')
    expect(wrapper.find('[data-testid="password-strength"]').exists()).toBe(true)
    expect(wrapper.find('.el-progress').exists()).toBe(true)
  })

  it('弱密码：档位「弱」+ 逐条列出缺什么', () => {
    const wrapper = mountMeter('12345678')
    expect(wrapper.find('[data-testid="password-strength-level"]').text()).toBe('弱')
    const hints = wrapper.find('[data-testid="password-strength-hints"]')
    expect(hints.text()).toContain('需要包含小写字母')
    expect(hints.text()).toContain('需要包含大写字母')
  })

  it('差一条规则：档位「中」，只列缺的那一条', () => {
    const wrapper = mountMeter('abcd1234')
    expect(wrapper.find('[data-testid="password-strength-level"]').text()).toBe('中')
    expect(wrapper.find('[data-testid="password-strength-hints"]').text()).toContain(
      '需要包含大写字母',
    )
  })

  it('达标：档位「强」且不再列提示', () => {
    const wrapper = mountMeter('Abcd1234')
    expect(wrapper.find('[data-testid="password-strength-level"]').text()).toBe('强')
    expect(wrapper.find('[data-testid="password-strength-hints"]').exists()).toBe(false)
  })

  it('黑名单密码即使大小写数字齐备也不放行（提示换一个）', () => {
    const wrapper = mountMeter('Passw0rd')
    expect(wrapper.find('[data-testid="password-strength-level"]').text()).toBe('弱')
    expect(wrapper.find('[data-testid="password-strength-hints"]').text()).toContain('常见弱密码')
  })

  it('进度条本体渲染出来了（el-progress 由按需导入接管）', () => {
    const wrapper = mountMeter('Abcd1234')
    expect(wrapper.find('[data-testid="password-strength-bar"] .el-progress').exists()).toBe(true)
  })

  it('showHints=false 时只给强度、不列清单（登录页那种"只提示不挡"的场景）', () => {
    const wrapper = mountMeter('12345678', false)
    expect(wrapper.find('[data-testid="password-strength-level"]').text()).toBe('弱')
    expect(wrapper.find('[data-testid="password-strength-hints"]').exists()).toBe(false)
  })
})
