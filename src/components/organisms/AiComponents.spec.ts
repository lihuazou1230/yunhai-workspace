/**
 * AI 智能添加 / AI 拆解 的组件行为测试。
 *
 * 两条硬约束：
 * 1. **AI 只建议不落库**：解析结果必须先出预览卡片，点「确认添加」才 emit create
 * 2. **失败不阻塞**：解析失败要给出原因并引导回手动表单
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'

import { AI_STORAGE_KEY } from '@/types/ai'
import type { Todo } from '@/types/todo'

const aiApi = vi.hoisted(() => ({
  parseTodoWithAi: vi.fn(),
  breakdownWithAi: vi.fn(),
}))

vi.mock('@/api/ai', async () => {
  const actual = await vi.importActual<typeof import('@/api/ai')>('@/api/ai')
  return {
    ...actual,
    parseTodoWithAi: aiApi.parseTodoWithAi,
    breakdownWithAi: aiApi.breakdownWithAi,
  }
})

import AiTodoInput from './AiTodoInput.vue'
import AiBreakdownDialog from './AiBreakdownDialog.vue'
import { AiError } from '@/api/ai'

function seedConfigured() {
  localStorage.setItem(
    AI_STORAGE_KEY,
    JSON.stringify({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-test',
    }),
  )
}

/**
 * 统一挂载：组件里有 `<router-link>`（去设置的引导），没有 router 会告警且渲染不出链接。
 * pinia 用同一个实例 setActivePinia，保证测试里读到的 store 与组件里的是同一个。
 */
async function mountWithPinia(component: unknown, props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'todos', component: { template: '<div />' } },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()

  const wrapper = mount(component as never, {
    // 泛型组件类型在这里无法推断，挂载参数统一按 never 传入（仅测试内部使用）
    props: props as never,
    global: { plugins: [pinia, router] },
  })
  await nextTick()
  return wrapper
}

const TODO: Todo = {
  id: 't1',
  title: '准备前端面试',
  status: 'active',
  priority: 'medium',
  createdAt: '2026-09-01T00:00:00.000Z',
  pinned: false,
  subtasks: [],
  tags: [],
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AiTodoInput（智能添加任务）', () => {
  it('未配置 Key：入口隐藏，只留一行去设置的引导', async () => {
    const wrapper = await mountWithPinia(AiTodoInput)

    expect(wrapper.find('[data-testid="ai-todo-input"]').exists()).toBe(false)
    const hint = wrapper.find('[data-testid="ai-todo-hint"]')
    expect(hint.text()).toContain('未启用')
    // 引导里的链接指向设置页
    expect(hint.find('a').attributes('href')).toBe('/settings')
  })

  it('已配置：渲染输入框与例句，未解析时不显示预览', async () => {
    seedConfigured()
    const wrapper = await mountWithPinia(AiTodoInput)

    expect(wrapper.find('[data-testid="ai-todo-input"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('试试')
    expect(wrapper.find('[data-testid="ai-todo-preview"]').exists()).toBe(false)
  })

  it('解析成功后出预览卡片，但**不立刻入库**', async () => {
    seedConfigured()
    aiApi.parseTodoWithAi.mockResolvedValue({
      title: '交周报',
      dueDate: '2026-09-11',
      priority: 'high',
      note: '听到「明天」',
    })
    const wrapper = await mountWithPinia(AiTodoInput)

    await wrapper.find('[data-testid="ai-todo-input"]').setValue('明天交周报，高优先级')
    await wrapper.find('[data-testid="ai-todo-parse"]').trigger('click')
    await nextTick()

    const preview = wrapper.find('[data-testid="ai-todo-preview"]')
    expect(preview.text()).toContain('交周报')
    expect(preview.text()).toContain('高优先级')
    expect(preview.text()).toContain('9月11日')
    // 关键：还没 emit，用户没确认就不落库
    expect(wrapper.emitted('create')).toBeUndefined()
  })

  it('点「确认添加」才 emit create（带标题/日期/优先级）', async () => {
    seedConfigured()
    aiApi.parseTodoWithAi.mockResolvedValue({
      title: '交周报',
      dueDate: '2026-09-11',
      priority: 'high',
    })
    const wrapper = await mountWithPinia(AiTodoInput)
    await parseInput(wrapper, '明天交周报')

    await wrapper.find('[data-testid="ai-preview-confirm"]').trigger('click')

    expect(wrapper.emitted('create')?.[0]?.[0]).toEqual({
      title: '交周报',
      priority: 'high',
      dueDate: '2026-09-11',
    })
    // 确认后预览与输入都被清空
    expect(wrapper.find('[data-testid="ai-todo-preview"]').exists()).toBe(false)
    expect((wrapper.find('[data-testid="ai-todo-input"]').element as HTMLInputElement).value).toBe(
      '',
    )
  })

  it('点「放弃」不产生任何写入', async () => {
    seedConfigured()
    aiApi.parseTodoWithAi.mockResolvedValue({ title: 'x', priority: 'low' })
    const wrapper = await mountWithPinia(AiTodoInput)
    await parseInput(wrapper, '随便什么')

    await wrapper.find('[data-testid="ai-preview-discard"]').trigger('click')

    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.find('[data-testid="ai-todo-preview"]').exists()).toBe(false)
  })

  it('解析失败：展示原因 + 引导手动表单，不 emit', async () => {
    seedConfigured()
    aiApi.parseTodoWithAi.mockRejectedValue(new AiError('AI 请求超时，请稍后重试'))
    const wrapper = await mountWithPinia(AiTodoInput)
    await parseInput(wrapper, '写点什么')

    const error = wrapper.find('[data-testid="ai-todo-error"]')
    expect(error.text()).toContain('AI 请求超时')
    expect(error.text()).toContain('手动表单')
    expect(wrapper.emitted('create')).toBeUndefined()
  })

  it('不写日期时预览显示「未指定日期」', async () => {
    seedConfigured()
    aiApi.parseTodoWithAi.mockResolvedValue({ title: '整理书桌', priority: 'low' })
    const wrapper = await mountWithPinia(AiTodoInput)
    await parseInput(wrapper, '整理书桌')

    expect(wrapper.find('[data-testid="ai-todo-preview"]').text()).toContain('未指定日期')
  })

  it('点例句直接发起解析', async () => {
    seedConfigured()
    aiApi.parseTodoWithAi.mockResolvedValue({ title: '交周报', priority: 'high' })
    const wrapper = await mountWithPinia(AiTodoInput)

    const example = wrapper.findAll('button').find((b) => b.text().includes('明天下午3点'))
    expect(example).toBeTruthy()
    await example!.trigger('click')
    await nextTick()

    expect(aiApi.parseTodoWithAi).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="ai-todo-preview"]').exists()).toBe(true)
  })
})

/** 输入文本并触发一次解析 */
async function parseInput(wrapper: Awaited<ReturnType<typeof mountWithPinia>>, text: string) {
  await wrapper.find('[data-testid="ai-todo-input"]').setValue(text)
  await wrapper.find('[data-testid="ai-todo-parse"]').trigger('click')
  await nextTick()
}

/** 读预览清单里第 index 条的标题（标题在可编辑输入框里） */
function titleValue(wrapper: Awaited<ReturnType<typeof mountWithPinia>>, index: number): string {
  const el = wrapper.find(`[data-testid="ai-breakdown-title-${index}"]`).element as HTMLInputElement
  return el.value
}

describe('AiBreakdownDialog（AI 拆解）', () => {
  it('未配置 Key 时给出引导，不显示拆解表单', async () => {
    const wrapper = await mountWithPinia(AiBreakdownDialog, { modelValue: true, todo: TODO })
    expect(wrapper.text()).toContain('还没配置 AI API Key')
  })

  it('打开时用任务标题预填目标', async () => {
    seedConfigured()
    const wrapper = await mountWithPinia(AiBreakdownDialog, { modelValue: false, todo: TODO })
    await wrapper.setProps({ modelValue: true } as never)
    await nextTick()

    expect(
      (wrapper.find('[data-testid="ai-breakdown-goal"]').element as HTMLInputElement).value,
    ).toBe('准备前端面试')
  })

  it('拆解结果进预览清单（默认全选），不立刻写入', async () => {
    seedConfigured()
    aiApi.breakdownWithAi.mockResolvedValue([
      { title: '梳理岗位要求', priority: 'high' },
      { title: '复习手写题', priority: 'medium' },
      { title: '做两个项目', priority: 'high' },
    ])
    const wrapper = await runBreakdown()

    expect(wrapper.find('[data-testid="ai-breakdown-preview"]').exists()).toBe(true)
    // 标题在可编辑输入框里，取 value
    expect(titleValue(wrapper, 0)).toBe('梳理岗位要求')
    expect(titleValue(wrapper, 2)).toBe('做两个项目')
    // 默认全选
    expect(wrapper.text()).toContain('已选 3 / 3 条')
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('取消勾选 / 删除条目后只写入保留项', async () => {
    seedConfigured()
    aiApi.breakdownWithAi.mockResolvedValue([
      { title: '步骤一', priority: 'high' },
      { title: '步骤二', priority: 'medium' },
      { title: '步骤三', priority: 'low' },
    ])
    const wrapper = await runBreakdown()

    await wrapper.find('[data-testid="ai-breakdown-check-1"]').setValue(false)
    await wrapper.find('[data-testid="ai-breakdown-remove-2"]').trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('已选 1 / 2 条')

    await wrapper.find('[data-testid="ai-breakdown-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[0]).toEqual(['t1', ['步骤一']])
  })

  it('可编辑标题后再写入', async () => {
    seedConfigured()
    aiApi.breakdownWithAi.mockResolvedValue([
      { title: 'a', priority: 'high' },
      { title: 'b', priority: 'high' },
      { title: 'c', priority: 'high' },
    ])
    const wrapper = await runBreakdown()

    await wrapper.find('[data-testid="ai-breakdown-title-0"]').setValue('改成这个')
    await wrapper.find('[data-testid="ai-breakdown-confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')?.[0]?.[1]).toEqual(['改成这个', 'b', 'c'])
  })

  it('点优先级在 高→中→低 之间循环', async () => {
    seedConfigured()
    aiApi.breakdownWithAi.mockResolvedValue([
      { title: 'a', priority: 'high' },
      { title: 'b', priority: 'high' },
      { title: 'c', priority: 'high' },
    ])
    const wrapper = await runBreakdown()

    const button = wrapper.find('[data-testid="ai-breakdown-priority-0"]')
    expect(button.text()).toBe('高')
    await button.trigger('click')
    expect(button.text()).toBe('中')
    await button.trigger('click')
    expect(button.text()).toBe('低')
    await button.trigger('click')
    expect(button.text()).toBe('高')
  })

  it('「放弃」不产生写入', async () => {
    seedConfigured()
    aiApi.breakdownWithAi.mockResolvedValue([
      { title: 'a', priority: 'high' },
      { title: 'b', priority: 'high' },
      { title: 'c', priority: 'high' },
    ])
    const wrapper = await runBreakdown()

    await wrapper.find('[data-testid="ai-breakdown-discard"]').trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('拆解失败：展示原因 + 引导手动添加', async () => {
    seedConfigured()
    aiApi.breakdownWithAi.mockRejectedValue(new AiError('账户余额不足'))
    const wrapper = await runBreakdown()

    const error = wrapper.find('[data-testid="ai-breakdown-error"]')
    expect(error.text()).toContain('账户余额不足')
    expect(error.text()).toContain('手动添加子任务')
    expect(wrapper.find('[data-testid="ai-breakdown-preview"]').exists()).toBe(false)
  })

  async function runBreakdown() {
    const wrapper = await mountWithPinia(AiBreakdownDialog, { modelValue: true, todo: TODO })
    await wrapper.find('[data-testid="ai-breakdown-run"]').trigger('click')
    await nextTick()
    return wrapper
  }
})
