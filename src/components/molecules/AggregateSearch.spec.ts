/**
 * 聚合搜索组件：任务结果通道 + 网页跳转通道 + 引擎轮换 + Ctrl+K / `/` 快捷键。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import type { Todo } from '@/types/todo'
import AggregateSearch from './AggregateSearch.vue'

function makeTodo(partial: Partial<Todo> & { id: string; title: string }): Todo {
  return {
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    tags: [],
    ...partial,
  }
}

const RESULTS: Todo[] = [
  makeTodo({ id: '1', title: '写周报', priority: 'high' }),
  makeTodo({ id: '2', title: '周报复盘', status: 'completed' }),
]

function mountSearch(props: Record<string, unknown> = {}, attach = false) {
  return mount(AggregateSearch, {
    props: { modelValue: '', engine: 'baidu', results: RESULTS, ...props },
    // 焦点相关用例需要真实挂到 document 上，否则 document.activeElement 永远是 body
    ...(attach ? { attachTo: document.body } : {}),
  })
}

/** 弹层只在有关键字时出现，多数用例需要先输入 */
async function mountOpen(props: Record<string, unknown> = {}) {
  const wrapper = mountSearch({ modelValue: '周报', ...props })
  await nextTick()
  return wrapper
}

let openSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  openSpy = vi.fn()
  vi.stubGlobal('open', openSpy)
})

describe('AggregateSearch', () => {
  it('空关键字时不展开弹层', () => {
    const wrapper = mountSearch()
    expect(wrapper.find('[data-testid="aggregate-search-panel"]').exists()).toBe(false)
  })

  it('有关键字时展开弹层，任务结果与网页入口都在', async () => {
    const wrapper = await mountOpen()

    const panel = wrapper.find('[data-testid="aggregate-search-panel"]')
    expect(panel.exists()).toBe(true)
    expect(wrapper.find('[data-testid="aggregate-result-1"]').text()).toContain('写周报')
    expect(wrapper.find('[data-testid="aggregate-result-2"]').text()).toContain('已完成')
    expect(wrapper.find('[data-testid="aggregate-search-web"]').text()).toContain('百度')
  })

  it('点某条任务 emit select-todo 并收起弹层', async () => {
    const wrapper = await mountOpen()

    await wrapper.find('[data-testid="aggregate-result-1"]').trigger('click')

    expect(wrapper.emitted('select-todo')?.[0]).toEqual(['1'])
    expect(wrapper.find('[data-testid="aggregate-search-panel"]').exists()).toBe(false)
  })

  it('没有命中任务时给出提示（而不是空白面板）', async () => {
    const wrapper = await mountOpen({ results: [] })
    expect(wrapper.text()).toContain('没有匹配的任务')
  })

  it('点网页入口用当前引擎新标签页打开，并 emit submit', async () => {
    const wrapper = await mountOpen({ modelValue: '前端 面试' })

    await wrapper.find('[data-testid="aggregate-search-web"]').trigger('click')

    expect(openSpy).toHaveBeenCalledWith(
      'https://www.baidu.com/s?wd=%E5%89%8D%E7%AB%AF%20%E9%9D%A2%E8%AF%95',
      '_blank',
      'noopener,noreferrer',
    )
    expect(wrapper.emitted('submit')?.[0]).toEqual(['前端 面试'])
  })

  it('回车等同于点网页入口', async () => {
    const wrapper = await mountOpen()

    await wrapper.find('[data-testid="aggregate-search-input"]').trigger('keydown.enter')

    expect(openSpy).toHaveBeenCalled()
  })

  it('引擎按钮轮换并 emit update:engine', async () => {
    const wrapper = await mountOpen({ engine: 'baidu' })

    await wrapper.find('[data-testid="aggregate-search-engine"]').trigger('click')
    expect(wrapper.emitted('update:engine')?.[0]).toEqual(['google'])

    await wrapper.setProps({ engine: 'ging' as never }).catch(() => {})
    await wrapper.setProps({ engine: 'bing' })
    expect(wrapper.find('[data-testid="aggregate-search-engine"]').text()).toBe('必应')
  })

  it('输入写回 v-model', async () => {
    const wrapper = await mountOpen()

    await wrapper.find('[data-testid="aggregate-search-input"]').setValue('新关键字')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['新关键字'])
  })

  it('Esc 收起弹层', async () => {
    const wrapper = await mountOpen()

    await wrapper.find('[data-testid="aggregate-search-input"]').trigger('keydown.esc')
    expect(wrapper.find('[data-testid="aggregate-search-panel"]').exists()).toBe(false)
  })

  it('Ctrl+K 把焦点打到输入框（命令面板的通行约定）', async () => {
    const wrapper = mountSearch({}, true)
    const input = wrapper.find('[data-testid="aggregate-search-input"]').element as HTMLInputElement

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await nextTick()

    expect(document.activeElement).toBe(input)
    wrapper.unmount()
  })

  it('“/” 在非输入场景聚焦，但在输入框里不抢（应该是真的打出一个斜杠）', async () => {
    const wrapper = mountSearch({}, true)
    const input = wrapper.find('[data-testid="aggregate-search-input"]').element as HTMLInputElement

    // 焦点在 body 上时生效
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }))
    await nextTick()
    expect(document.activeElement).toBe(input)

    // 焦点已经在该输入框里时不再拦截
    const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('空关键字时点网页入口不跳转（不发无效搜索）', async () => {
    const wrapper = mountSearch({ modelValue: '   ' })
    // 弹层没开，直接调用内部逻辑的入口不存在；用回车模拟
    await wrapper.find('[data-testid="aggregate-search-input"]').trigger('keydown.enter')

    expect(openSpy).not.toHaveBeenCalled()
  })
})
