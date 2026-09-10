import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { addDays, addMonths, todayKey } from '@/utils/dateFormatter'
import { useTagStore } from '@/stores/tagStore'
import TodoForm from './TodoForm.vue'

async function submitForm(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('form').trigger('submit')
}

/**
 * 组件会读标签 store，必须带上 pinia。
 * 注意要 `setActivePinia` 同一个实例：否则测试里 `useTagStore()`（走 active pinia）
 * 与组件里的（走注入的 pinia）会是两个互不相干的 store。
 */
function mountForm() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(TodoForm, { global: { plugins: [pinia] } })
}

describe('TodoForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('日期初始为真实当天，提交发射 create 并清空标题', async () => {
    const wrapper = mountForm()
    const vm = wrapper.vm as unknown as { dueDate: string }
    expect(vm.dueDate).toBe(todayKey())

    await wrapper.find('input[placeholder*="添加新任务"]').setValue('写周报')
    await submitForm(wrapper)

    const created = wrapper.emitted('create')?.[0]?.[0] as Record<string, unknown>
    expect(created.title).toBe('写周报')
    expect(created.priority).toBe('medium')
    expect(created.dueDate).toBe(todayKey())
    // 未选标签时提交空数组（任务无标签）
    expect(created.tags).toEqual([])

    // 标题清空，日期重置为今天
    expect(
      (wrapper.find('input[placeholder*="添加新任务"]').element as HTMLInputElement).value,
    ).toBe('')
    expect(vm.dueDate).toBe(todayKey())
  })

  it('1天/1周/1月 快捷按钮按当前日期递增', async () => {
    const wrapper = mountForm()
    const vm = wrapper.vm as unknown as {
      dueDate: string
      shiftDue: (d: number, m?: number) => void
    }
    const today = todayKey()

    vm.shiftDue(1)
    expect(vm.dueDate).toBe(addDays(today, 1))

    vm.shiftDue(7)
    expect(vm.dueDate).toBe(addDays(today, 8))

    // 重置回今天，再测 1 月
    vm.dueDate = today
    vm.shiftDue(0, 1)
    expect(vm.dueDate).toBe(addMonths(today, 1))
  })

  it('真实按钮点击也在已选值上叠加（非同今天）', async () => {
    const wrapper = mountForm()
    const vm = wrapper.vm as unknown as { dueDate: string }
    // 预置一个非今天的已选值
    const selected = '2026-09-10'
    vm.dueDate = selected

    const dayBtn = wrapper.findAll('button').find((b) => b.text() === '1天')
    const weekBtn = wrapper.findAll('button').find((b) => b.text() === '1周')
    expect(dayBtn).toBeTruthy()
    expect(weekBtn).toBeTruthy()

    await dayBtn!.trigger('click')
    expect(vm.dueDate).toBe(addDays(selected, 1))

    await weekBtn!.trigger('click')
    expect(vm.dueDate).toBe(addDays(selected, 8))
  })

  it('回车提交同样生效', async () => {
    const wrapper = mountForm()
    await wrapper.find('input[placeholder*="添加新任务"]').setValue('回车任务')
    await wrapper.find('input[placeholder*="添加新任务"]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('空白标题不发射 create 且提示错误', async () => {
    const wrapper = mountForm()
    await submitForm(wrapper)
    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.text()).toContain('任务标题不能为空')
  })

  it('选择优先级与截止日期后发射对应字段', async () => {
    const wrapper = mountForm()
    await wrapper.find('input[placeholder*="添加新任务"]').setValue('重要任务')

    const highBtn = wrapper.findAll('button').find((b) => b.text() === '高')
    expect(highBtn).toBeTruthy()
    await highBtn!.trigger('click')

    // 通过暴露的 state 驱动截止日期（el-date-picker 在 happy-dom 中交互复杂，直接测逻辑）
    ;(wrapper.vm as unknown as { dueDate: string }).dueDate = '2026-10-01'
    await submitForm(wrapper)

    const created = wrapper.emitted('create')?.[0]?.[0] as Record<string, unknown>
    expect(created.priority).toBe('high')
    expect(created.dueDate).toBe('2026-10-01')
  })

  it('超长年份（如 232233）的日期不发射 create 且提示错误', async () => {
    const wrapper = mountForm()
    await wrapper.find('input[placeholder*="添加新任务"]').setValue('异常日期任务')
    ;(wrapper.vm as unknown as { dueDate: string }).dueDate = '232233-10-01'
    await submitForm(wrapper)

    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.text()).toContain('截止日期格式不正确')
  })

  it('不存在的日期（如 2026-02-30）同样不发射 create', async () => {
    const wrapper = mountForm()
    await wrapper.find('input[placeholder*="添加新任务"]').setValue('不存在的日期')
    ;(wrapper.vm as unknown as { dueDate: string }).dueDate = '2026-02-30'
    await submitForm(wrapper)

    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.text()).toContain('截止日期格式不正确')
  })

  // ---- 标签（第六阶段 6.1） ----

  it('就地新建标签：选色创建后自动选中，并随任务一起提交', async () => {
    const wrapper = mountForm()
    const tagStore = useTagStore()

    await wrapper.find('[data-testid="todo-form-new-tag"]').trigger('click')
    await wrapper.find('input[aria-label="新标签名"]').setValue('工作')
    // 选一个非默认色
    await wrapper.find('button[aria-label="选择红色"]').trigger('click')
    await wrapper.find('[data-testid="todo-form-create-tag"]').trigger('click')

    expect(tagStore.tags).toHaveLength(1)
    expect(tagStore.tags[0].name).toBe('工作')
    expect(tagStore.tags[0].color).toBe('rose')

    await wrapper.find('input[placeholder*="添加新任务"]').setValue('带标签的任务')
    await submitForm(wrapper)

    const created = wrapper.emitted('create')?.[0]?.[0] as Record<string, unknown>
    expect(created.tags).toEqual([tagStore.tags[0].id])
  })

  it('重名标签被拒绝并提示', async () => {
    const wrapper = mountForm()
    const tagStore = useTagStore()
    tagStore.addTag({ name: '工作', color: 'sky' })

    await wrapper.find('[data-testid="todo-form-new-tag"]').trigger('click')
    await wrapper.find('input[aria-label="新标签名"]').setValue('工作')
    await wrapper.find('[data-testid="todo-form-create-tag"]').trigger('click')

    expect(tagStore.tags).toHaveLength(1)
    expect(wrapper.text()).toContain('不能重名')
  })

  it('已存在的标签可点选与取消，提交后清空选择', async () => {
    const wrapper = mountForm()
    const tagStore = useTagStore()
    const tag = tagStore.addTag({ name: '生活', color: 'emerald' })!
    await nextTick()

    const tagButton = wrapper.findAll('button').find((b) => b.text().includes('生活'))
    expect(tagButton).toBeTruthy()
    expect(tagButton!.attributes('aria-pressed')).toBe('false')

    await tagButton!.trigger('click')
    expect(tagButton!.attributes('aria-pressed')).toBe('true')

    await wrapper.find('input[placeholder*="添加新任务"]').setValue('买菜')
    await submitForm(wrapper)

    expect((wrapper.emitted('create')?.[0]?.[0] as { tags: string[] }).tags).toEqual([tag.id])

    // 提交后选择被清空：再提交一次应是无标签
    await wrapper.find('input[placeholder*="添加新任务"]').setValue('第二件')
    await submitForm(wrapper)
    expect((wrapper.emitted('create')?.[1]?.[0] as { tags: string[] }).tags).toEqual([])
  })
})
