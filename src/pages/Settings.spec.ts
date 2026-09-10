/**
 * 设置页 · 标签管理（第六阶段 6.1）
 *
 * 重点钉「删除标签的影响范围」这条验收：标签没了，**任务必须还在**。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'

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
    markImageFailed: vi.fn(),
    loadLocalAvatar: vi.fn(async () => {}),
    hasAvatar: ref(false),
    error: ref(''),
    dispose: vi.fn(),
  }),
}))

import { useTagStore } from '@/stores/tagStore'
import { useTodoStore } from '@/stores/todoStore'
import Settings from './Settings.vue'

const ROUTES = [
  { path: '/settings', name: 'settings', component: { template: '<div />' } },
  { path: '/login', name: 'login', component: { template: '<div />' } },
]

/**
 * 先建 pinia 并设为 active，再取 store、再挂载组件 —— 三者必须是同一个实例，
 * 否则测试里改的 store 和组件读的 store 会是两套互不相干的状态。
 */
async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: ROUTES })
  await router.push('/settings')
  await router.isReady()

  const tagStore = useTagStore()
  const todoStore = useTodoStore()
  const wrapper = mount(Settings, { global: { plugins: [pinia, router] } })
  await nextTick()
  return { wrapper, tagStore, todoStore }
}

describe('设置页 · 标签管理', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    avatarStub.displayUrl = ref('')
    avatarStub.fallbackInitial = ref('访客')
  })

  it('标签列表展示名字、颜色与引用任务数', async () => {
    const { wrapper, tagStore, todoStore } = await setup()
    const tag = tagStore.addTag({ name: '工作', color: 'sky' })!
    todoStore.addTodo({ title: '写周报', priority: 'high', tags: [tag.id] })
    await nextTick()

    const manager = wrapper.find('[data-testid="tag-manager"]')
    expect(manager.exists()).toBe(true)
    // 名字是可编辑输入框，取 value 而不是文本
    expect(
      (manager.find(`[data-testid="tag-name-${tag.id}"]`).element as HTMLInputElement).value,
    ).toBe('工作')
    expect(manager.text()).toContain('1 个任务')
  })

  it('改名立刻生效', async () => {
    const { wrapper, tagStore } = await setup()
    const tag = tagStore.addTag({ name: '工作', color: 'sky' })!
    await nextTick()

    const input = wrapper.find(`[data-testid="tag-name-${tag.id}"]`)
    await input.setValue('职场')
    await input.trigger('change')

    expect(tagStore.getTag(tag.id)?.name).toBe('职场')
  })

  it('重名改名被拒绝并提示', async () => {
    const { wrapper, tagStore } = await setup()
    const a = tagStore.addTag({ name: '工作', color: 'sky' })!
    tagStore.addTag({ name: '生活', color: 'rose' })
    await nextTick()

    const input = wrapper.find(`[data-testid="tag-name-${a.id}"]`)
    await input.setValue('生活')
    await input.trigger('change')
    await nextTick()

    expect(tagStore.getTag(a.id)?.name).toBe('工作')
    expect(wrapper.text()).toContain('改名失败')
  })

  it('改色立刻生效', async () => {
    const { wrapper, tagStore } = await setup()
    const tag = tagStore.addTag({ name: '工作', color: 'sky' })!
    await nextTick()

    await wrapper.find(`[data-testid="tag-color-${tag.id}-violet"]`).trigger('click')
    expect(tagStore.getTag(tag.id)?.color).toBe('violet')
  })

  it('删除标签走确认弹窗，确认后任务仍在（只摘引用）', async () => {
    const { wrapper, tagStore, todoStore } = await setup()
    const tag = tagStore.addTag({ name: '工作', color: 'sky' })!
    const todo = todoStore.addTodo({ title: '写周报', priority: 'high', tags: [tag.id] })
    await nextTick()

    await wrapper.find(`[data-testid="tag-delete-${tag.id}"]`).trigger('click')
    for (let i = 0; i < 3; i += 1) await nextTick()

    // 弹窗里讲清影响范围
    expect(wrapper.text()).toContain('删除标签')
    expect(wrapper.text()).toContain('1 个任务')

    await wrapper.find('[data-testid="tag-delete-confirm"]').trigger('click')
    for (let i = 0; i < 3; i += 1) await nextTick()

    expect(tagStore.getTag(tag.id)).toBeUndefined()
    // 关键：任务没被删，只是标签引用被摘掉
    expect(todoStore.todos).toHaveLength(1)
    expect(todoStore.todos[0].id).toBe(todo.id)
    expect(todoStore.todos[0].tags).toEqual([])
  })

  it('取消删除时标签与引用都保持不变', async () => {
    const { wrapper, tagStore, todoStore } = await setup()
    const tag = tagStore.addTag({ name: '工作', color: 'sky' })!
    todoStore.addTodo({ title: '写周报', priority: 'high', tags: [tag.id] })
    await nextTick()

    await wrapper.find(`[data-testid="tag-delete-${tag.id}"]`).trigger('click')
    for (let i = 0; i < 3; i += 1) await nextTick()

    const cancel = wrapper.findAll('.el-dialog button').find((b) => b.text() === '取消')
    expect(cancel).toBeTruthy()
    await cancel!.trigger('click')
    for (let i = 0; i < 3; i += 1) await nextTick()

    expect(tagStore.getTag(tag.id)).toBeDefined()
    expect(todoStore.todos[0].tags).toEqual([tag.id])
  })

  it('没有标签时给出引导文案', async () => {
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('还没有标签')
  })
})
