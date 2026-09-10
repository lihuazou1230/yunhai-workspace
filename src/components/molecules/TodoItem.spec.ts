import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import type { Todo } from '@/types/todo'
import { addDays, todayKey } from '@/utils/dateFormatter'
import TodoItem from './TodoItem.vue'

function makeTodo(partial: Partial<Todo> & { id: string; title: string }): Todo {
  return {
    status: 'active',
    priority: 'medium',
    createdAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    subtasks: [],
    ...partial,
  }
}

describe('TodoItem', () => {
  const today = todayKey()

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('渲染标题与优先级，完成按钮（未完成→完成）立即发射 toggle 且不左滑（全部视图）', async () => {
    const todo = makeTodo({ id: '1', title: '写周报', priority: 'high' })
    const wrapper = mount(TodoItem, { props: { todo, showDue: true } })
    expect(wrapper.text()).toContain('写周报')
    expect(wrapper.text()).toContain('高优先级')
    // 左侧不再有复选框
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)

    await wrapper.find('button[aria-label="标记为已完成"]').trigger('click')
    // 全部视图语义：仅礼花、立即 emit、无左滑
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['1'])
    expect(wrapper.find('li').classes()).not.toContain('anim-slide-left')
    expect(wrapper.find('.particle').exists()).toBe(true)
  })

  it('completeSlide=true 时（进行中视图）完成按钮左滑后发射 toggle', async () => {
    const todo = makeTodo({ id: '1', title: '写周报', priority: 'high' })
    const wrapper = mount(TodoItem, { props: { todo, completeSlide: true } })

    await wrapper.find('button[aria-label="标记为已完成"]').trigger('click')
    expect(wrapper.find('li').classes()).toContain('anim-slide-left')
    expect(wrapper.emitted('toggle')).toBeUndefined()

    vi.advanceTimersByTime(800)
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['1'])
  })

  it('已完成任务点击圆钮取消完成，直接通知 toggle（无左滑动画）', async () => {
    const todo = makeTodo({ id: '1', title: '健身', status: 'completed' })
    const wrapper = mount(TodoItem, { props: { todo } })
    await wrapper.find('button[aria-label="标记为未完成"]').trigger('click')
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['1'])
  })

  it('完成态显示删除线文案', () => {
    const todo = makeTodo({ id: '1', title: '健身', status: 'completed' })
    const wrapper = mount(TodoItem, { props: { todo } })
    expect(wrapper.find('p').classes()).toContain('line-through')
  })

  it('逾期任务标红并显示已逾期徽章', () => {
    const yesterday = addDays(today, -1)
    const todo = makeTodo({ id: '1', title: '补卡', dueDate: yesterday })
    const wrapper = mount(TodoItem, { props: { todo, showDue: true } })
    const li = wrapper.find('li')
    expect(li.classes()).toContain('border-rose-300')
    expect(wrapper.text()).toContain('已逾期')
  })

  it('今日到期显示今日徽章', () => {
    const todo = makeTodo({ id: '1', title: '开会', dueDate: today })
    const wrapper = mount(TodoItem, { props: { todo, showDue: true } })
    expect(wrapper.text()).toContain('今日到期')
  })

  it('未展示截止日期时（showDue=false）不渲染日期', () => {
    const todo = makeTodo({ id: '1', title: '看文档', dueDate: today })
    const wrapper = mount(TodoItem, { props: { todo } })
    expect(wrapper.text()).not.toContain('今日到期')
  })

  it('畸形截止日期（6 位年份）不渲染日期徽章、不标红', () => {
    const todo = makeTodo({ id: '1', title: '异常日期', dueDate: '232233-10-01' })
    const wrapper = mount(TodoItem, { props: { todo, showDue: true } })
    expect(wrapper.text()).not.toContain('今日到期')
    expect(wrapper.text()).not.toContain('已逾期')
    expect(wrapper.text()).not.toContain('232233')
  })

  it('点击删除按钮先右滑后发射 remove', async () => {
    const todo = makeTodo({ id: '1', title: '写周报' })
    const wrapper = mount(TodoItem, { props: { todo } })
    await wrapper.find('button[aria-label="删除任务"]').trigger('click')
    expect(wrapper.find('li').classes()).toContain('anim-slide-right')
    expect(wrapper.emitted('remove')).toBeUndefined()

    vi.advanceTimersByTime(700)
    expect(wrapper.emitted('remove')?.[0]).toEqual(['1'])
  })

  it('撤销恢复（revealFromRight）播放从右滑入动画', async () => {
    const todo = makeTodo({ id: '1', title: '恢复的任务' })
    const wrapper = mount(TodoItem, { props: { todo, revealFromRight: true } })
    await nextTick()
    expect(wrapper.find('li').classes()).toContain('anim-reveal-right')
  })

  it('新建任务（enterFromLeft）播放从左滑入动画', async () => {
    const todo = makeTodo({ id: '1', title: '新建的任务' })
    const wrapper = mount(TodoItem, { props: { todo, enterFromLeft: true } })
    await nextTick()
    expect(wrapper.find('li').classes()).toContain('anim-enter-left')
  })

  // ---- 视觉规范「方案 A · 行式极简」结构约束 ----

  it('主操作居左：完成圆圈排在标题之前，置顶/删除操作区排在标题之后', () => {
    const todo = makeTodo({ id: '1', title: '写周报' })
    const html = mount(TodoItem, { props: { todo } }).html()
    const toggleIdx = html.indexOf('标记为已完成')
    const titleIdx = html.indexOf('写周报')
    const pinIdx = html.indexOf('置顶到今日聚焦')
    const removeIdx = html.indexOf('删除任务')

    expect(toggleIdx).toBeGreaterThanOrEqual(0)
    expect(toggleIdx).toBeLessThan(titleIdx)
    expect(pinIdx).toBeGreaterThan(titleIdx)
    expect(removeIdx).toBeGreaterThan(titleIdx)
  })

  it('元信息行用小图标 + 灰字，不再使用徽章 chip', () => {
    const todo = makeTodo({ id: '1', title: '开会', dueDate: today, priority: 'high' })
    const wrapper = mount(TodoItem, { props: { todo, showDue: true } })

    // 今日到期 = 琥珀字（异常状态才发声），普通日期为灰字
    const due = wrapper.find('[title*="今日到期"]')
    expect(due.exists()).toBe(true)
    expect(due.classes()).toContain('text-amber-600')

    // 优先级为彩色小旗（svg + aria-label），不是文字徽章
    const flag = wrapper.find('[aria-label="高优先级"]')
    expect(flag.exists()).toBe(true)
    expect(flag.find('svg').exists()).toBe(true)
    expect(flag.classes()).toContain('text-rose-500')
  })

  it('普通日期用灰字（不滥用颜色）', () => {
    const todo = makeTodo({ id: '1', title: '看文档', dueDate: addDays(today, 5) })
    const wrapper = mount(TodoItem, { props: { todo, showDue: true } })
    const due = wrapper.find('[title]')
    expect(due.classes()).toContain('text-slate-400')
  })

  it('完成态：标题划线 + 整卡 65% 透明度', () => {
    const todo = makeTodo({ id: '1', title: '健身', status: 'completed' })
    const wrapper = mount(TodoItem, { props: { todo } })
    expect(wrapper.find('p').classes()).toContain('line-through')
    expect(wrapper.find('li').classes()).toContain('opacity-[0.65]')
  })

  it('子任务默认折叠为「+ 添加子任务」小字，点击后才出现输入框', async () => {
    const todo = makeTodo({ id: '1', title: '写周报' })
    const wrapper = mount(TodoItem, { props: { todo } })

    expect(wrapper.text()).toContain('添加子任务')
    expect(wrapper.find('input[placeholder*="添加子任务"]').exists()).toBe(false)

    const addButton = wrapper.findAll('button').find((b) => b.text().includes('添加子任务'))
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')

    expect(wrapper.find('input[placeholder*="添加子任务"]').exists()).toBe(true)
  })

  it('已有子任务时展示灰字进度，点击进度展开清单', async () => {
    const todo = makeTodo({
      id: '1',
      title: '写周报',
      subtasks: [
        { id: 's1', title: '收集数据', completed: true },
        { id: 's2', title: '写正文', completed: false },
      ],
    })
    const wrapper = mount(TodoItem, { props: { todo } })

    expect(wrapper.text()).toContain('1/2')
    expect(wrapper.text()).not.toContain('收集数据')

    await wrapper.find('button[aria-label="展开子任务"]').trigger('click')
    expect(wrapper.text()).toContain('收集数据')
  })
})
