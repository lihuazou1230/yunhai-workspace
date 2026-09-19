import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import type { Todo } from '@/types/todo'
import { addDays, todayKey } from '@/utils/dateFormatter'
import todoItemSource from './TodoItem.vue?raw'
import uiIconSource from '@/components/atoms/UiIcon.vue?raw'
import TodoItem from './TodoItem.vue'

/**
 * 结构守卫：图标按钮的内边距与不可压缩性。
 *
 * 为什么要用源码断言而不是行为断言：这两个都是**纯 CSS 层**的坑，
 * happy-dom 不做布局、量不出宽高，行为断言根本发现不了。
 *
 * 1. `p-0` 在 `BaseButton` 上**静默无效** —— Tailwind 把 `padding` 的规则排在
 *    `padding-left/right` 之后，同一个元素上 `p-0` 打不过组件自带的 `px-2.5 py-1`。
 *    后果是按钮里残留 10px 内边距、可用宽度只剩 16px，把 24px 的图标**压扁成 16×24**
 *    （形变比尺寸偏小更难看）。必须写 `!p-0`。
 * 2. `svg` 必须 `shrink-0`：flex 子项默认 `flex-shrink: 1`，
 *    一旦容器空间不足就会把图标压扁，加 `shrink-0` 才能保证它始终是正方形。
 */
describe('TodoItem · 图标按钮的 CSS 结构守卫', () => {
  it('删除按钮用 !p-0（普通 p-0 打不过 BaseButton 的 px-2.5 py-1）', () => {
    // 只取删除按钮自己的开标签，避免误抓到紧随其后的菜单容器（它有 class="relative"）
    const tag =
      todoItemSource.match(/<BaseButton[\s\S]*?data-testid="todo-remove"[\s\S]*?>/)?.[0] ?? ''
    expect(tag).toContain('data-testid="todo-remove"')
    expect(tag).toContain('!p-0')
    // 只要出现孤立（未被 ! 修饰）的 p-0，就说明又踩回去了
    expect(/(^|\s)p-0(\s|$)/.test(tag)).toBe(false)
  })

  it('UiIcon 的 svg 带 shrink-0（否则会被 flex 压扁成非正方形）', () => {
    expect(uiIconSource).toMatch(/:class="\['shrink-0', size\]"/)
  })

  it('删除图标比另外两个大一号（24px vs 20px）', () => {
    // 垃圾桶是纯轮廓线条，视觉重量比实心图钉轻，等大时看起来偏小
    expect(todoItemSource).toMatch(/name="trash" size="h-6 w-6"/)
    expect(todoItemSource).toMatch(/name="pin"[\s\S]{0,60}size="h-5 w-5"/)
    expect(todoItemSource).toMatch(/name="more" size="h-5 w-5"/)
  })

  it('置顶样式走标记类，不在模板里拼 Tailwind 状态类', () => {
    /*
      实测踩过两次，都是"拼 Tailwind 类"这条路本身不可靠：
      1. `border-slate-200` 在产物里排在 `border-amber-300/70` 之后，
         基础类的灰边会把状态色盖掉（胜负由产物顺序决定，与类在元素上的先后无关）；
      2. `shadow-[var(--app-pinned-shadow)]` 没被生成出来，computed 是 none（静默失效）。
      所以状态样式必须在 custom.css 的 `.item-surface--pinned` 里定义。
    */
    expect(todoItemSource).toContain("todo.pinned ? 'item-surface--pinned'")
    expect(todoItemSource).not.toMatch(/todo\.pinned\s*\?[\s\S]{0,80}border-amber/)
  })

  it('置顶时不再叠加逾期红边（一张卡片只有一个描边结论）', () => {
    // 三元表达式里 pinned 分支优先，overdue 只在未置顶时生效
    expect(todoItemSource).toMatch(/todo\.pinned[\s\S]{0,80}: overdue/)
  })

  it('标题左侧不再渲染置顶图钉（置顶由整卡样式表达）', () => {
    expect(todoItemSource).not.toContain('>📌<')
    expect(todoItemSource).not.toMatch(/v-if="todo\.pinned"[\s\S]{0,60}📌/)
  })
})

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

  it('completeSlide=true 时（进行中视图）先放礼花再左滑，滑完才发射 toggle', async () => {
    const todo = makeTodo({ id: '1', title: '写周报', priority: 'high' })
    const wrapper = mount(TodoItem, { props: { todo, completeSlide: true } })

    await wrapper.find('button[aria-label="标记为已完成"]').trigger('click')
    // 礼花与滑出同时挂上，但滑出被 keyframes 推迟到 62% 之后（见 .anim-slide-left）
    expect(wrapper.find('li').classes()).toContain('anim-slide-left')
    expect(wrapper.find('.particle').exists()).toBe(true)
    expect(wrapper.emitted('toggle')).toBeUndefined()

    vi.advanceTimersByTime(1200)
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

  it('减少动效（prefers-reduced-motion）：改用淡出替代左滑、不放礼花，且不留白等', async () => {
    const original = window.matchMedia
    // @vueuse 的 usePreferredReducedMotion 走 matchMedia，直接把它钉成 reduce
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))

    try {
      const todo = makeTodo({ id: '1', title: '写周报' })
      const wrapper = mount(TodoItem, { props: { todo, completeSlide: true } })
      await nextTick()

      await wrapper.find('button[aria-label="标记为已完成"]').trigger('click')

      // 只淡出，不位移
      expect(wrapper.find('li').classes()).toContain('anim-fade-out')
      expect(wrapper.find('li').classes()).not.toContain('anim-slide-left')
      // 粒子飞散本身就是要避免的"大幅位移"，所以不发礼花
      expect(wrapper.find('.particle').exists()).toBe(false)
      expect(wrapper.emitted('toggle')).toBeUndefined()

      // 等的是淡出时长（260ms），而不是完整礼花+滑动那 1.1s
      vi.advanceTimersByTime(300)
      expect(wrapper.emitted('toggle')?.[0]).toEqual(['1'])
    } finally {
      vi.unstubAllGlobals()
      window.matchMedia = original
    }
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

  // ---- 标签（第六阶段 6.1） ----

  it('元信息行展示标签：彩色小点 + 文字', () => {
    const todo = makeTodo({ id: '1', title: '写周报' })
    const wrapper = mount(TodoItem, {
      props: {
        todo,
        todoTags: [
          { id: 't1', name: '工作', color: 'sky' },
          { id: 't2', name: '紧急', color: 'rose' },
        ],
      },
    })

    expect(wrapper.text()).toContain('工作')
    expect(wrapper.text()).toContain('紧急')
    const chip = wrapper.find('[data-testid="todo-tag-t1"]')
    expect(chip.exists()).toBe(true)
    expect(chip.find('span.bg-sky-500').exists()).toBe(true)
    expect(chip.classes()).toContain('text-sky-600')
  })

  it('没有标签时不渲染标签 chip', () => {
    const wrapper = mount(TodoItem, { props: { todo: makeTodo({ id: '1', title: '看文档' }) } })
    expect(wrapper.find('[data-testid^="todo-tag-"]').exists()).toBe(false)
  })

  // ---- 归档 / 推后 操作菜单（第六阶段 6.1） ----

  it('主列表菜单：归档发出 archive，推后发出 postpone（带天数，不是日期）', async () => {
    const todo = makeTodo({ id: '1', title: '写周报' })
    const wrapper = mount(TodoItem, { props: { todo } })

    // 菜单默认收起
    expect(wrapper.find('[data-testid="todo-archive"]').exists()).toBe(false)

    await wrapper.find('[data-testid="todo-more"]').trigger('click')
    await wrapper.find('[data-testid="todo-archive"]').trigger('click')
    expect(wrapper.emitted('archive')?.[0]).toEqual(['1'])

    // 再开一次菜单走推后子菜单
    await wrapper.find('[data-testid="todo-more"]').trigger('click')
    await wrapper.find('[data-testid="todo-postpone"]').trigger('click')
    await wrapper.find('[data-testid="todo-postpone-day"]').trigger('click')

    /*
      事件只带「推几天」，不带日期：日期规则（基准取当前 dueDate、逾期兜到今天、
      max(dueDate+N, today+N)）统一在 store 的 postponeTodo 里，组件不重复实现一份。
    */
    expect(wrapper.emitted('postpone')?.[0]).toEqual(['1', 1])
  })

  it('推后子菜单提供 1 天 / 1 周 / 1 月 三档，与新建表单的快捷键一致', async () => {
    const wrapper = mount(TodoItem, { props: { todo: makeTodo({ id: '1', title: '写周报' }) } })

    await wrapper.find('[data-testid="todo-more"]').trigger('click')
    await wrapper.find('[data-testid="todo-postpone"]').trigger('click')

    const items = wrapper.findAll('[data-testid^="todo-postpone-"]')
    // 触发按钮自己也算一个（data-testid="todo-postpone"），排除它
    const optionItems = items.filter((n) => n.attributes('data-testid') !== 'todo-postpone')
    expect(optionItems.map((n) => n.text())).toEqual(['推后 1 天', '推后 1 周', '推后 1 月'])

    await wrapper.find('[data-testid="todo-postpone-week"]').trigger('click')
    expect(wrapper.emitted('postpone')?.[0]).toEqual(['1', 7])

    await wrapper.find('[data-testid="todo-more"]').trigger('click')
    await wrapper.find('[data-testid="todo-postpone"]').trigger('click')
    await wrapper.find('[data-testid="todo-postpone-month"]').trigger('click')
    expect(wrapper.emitted('postpone')?.[1]).toEqual(['1', 30])
  })

  it('选完推后项后菜单整体收起（不用再点一下才关）', async () => {
    const wrapper = mount(TodoItem, { props: { todo: makeTodo({ id: '1', title: '写周报' }) } })

    await wrapper.find('[data-testid="todo-more"]').trigger('click')
    await wrapper.find('[data-testid="todo-postpone"]').trigger('click')
    await wrapper.find('[data-testid="todo-postpone-day"]').trigger('click')

    expect(wrapper.find('[data-testid="todo-postpone-day"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="todo-archive"]').exists()).toBe(false)
  })

  it('归档视图菜单只提供恢复与彻底删除', async () => {
    const wrapper = mount(TodoItem, {
      props: { todo: makeTodo({ id: '1', title: '旧任务', archived: true }), view: 'archived' },
    })

    expect(wrapper.text()).toContain('已归档')

    await wrapper.find('[data-testid="todo-more"]').trigger('click')
    expect(wrapper.find('[data-testid="todo-archive"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="todo-postpone"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="todo-unarchive"]').exists()).toBe(true)

    await wrapper.find('[data-testid="todo-unarchive"]').trigger('click')
    expect(wrapper.emitted('unarchive')?.[0]).toEqual(['1'])

    await wrapper.find('[data-testid="todo-more"]').trigger('click')
    await wrapper.find('[data-testid="todo-purge"]').trigger('click')
    expect(wrapper.emitted('purge')?.[0]).toEqual(['1'])
  })
})
