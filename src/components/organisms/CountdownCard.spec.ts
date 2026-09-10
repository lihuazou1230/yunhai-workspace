import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { useCountdownStore } from '@/stores/countdownStore'
import CountdownCard from './CountdownCard.vue'

/** 2026-09-15（周二） */
const NOW = new Date(2026, 8, 15, 10, 0, 0)

/** 挂载并注入时钟：时钟走 store，所以先 refresh 再 mount；prepare 用于预置条目/配置 */
function mountCard(
  now: Date = NOW,
  prepare?: (store: ReturnType<typeof useCountdownStore>) => void,
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useCountdownStore()
  store.refresh(now)
  prepare?.(store)
  const wrapper = mount(CountdownCard, { global: { plugins: [pinia] } })
  return { wrapper, store }
}

/** 空白无关的文本断言（模板换行会被压成空格，直接比对容易假失败） */
const flat = (text: string) => text.replace(/\s+/g, '')

async function openEdit(wrapper: ReturnType<typeof mountCard>['wrapper']) {
  await wrapper.find('[data-testid="countdown-edit-toggle"]').trigger('click')
}

async function addItem(
  wrapper: ReturnType<typeof mountCard>['wrapper'],
  fields: { title: string; date: string; yearly?: boolean },
) {
  await wrapper.find('[data-testid="countdown-add-title"]').setValue(fields.title)
  await wrapper.find('[data-testid="countdown-add-date"]').setValue(fields.date)
  if (fields.yearly) await wrapper.find('[data-testid="countdown-add-yearly"]').setValue(true)
  await wrapper.find('[data-testid="countdown-add-form"]').trigger('submit')
}

describe('CountdownCard', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('发薪日行按注入的时钟给出天数与日期', () => {
    const { wrapper } = mountCard(NOW, (store) => store.setPaydayDay(25))
    const payday = wrapper.find('[data-testid="countdown-payday"]')

    expect(flat(payday.text())).toBe('距离发薪日还有10天')
    expect(wrapper.text()).toContain('9月25日')
  })

  it('今天就是发薪日时天数为 0 并高亮（主题色）', () => {
    const { wrapper } = mountCard()
    const payday = wrapper.find('[data-testid="countdown-payday"]')

    expect(flat(payday.text())).toBe('距离发薪日还有0天')
    expect(payday.classes().join(' ')).toContain('var(--el-color-primary)')
  })

  it('发薪日在短月顺延到月末（31 号 + 4 月）', () => {
    const { wrapper } = mountCard(new Date(2026, 3, 10, 9, 0), (store) => store.setPaydayDay(31))

    expect(wrapper.text()).toContain('4月30日')
    expect(flat(wrapper.find('[data-testid="countdown-payday"]').text())).toBe('距离发薪日还有20天')
  })

  it('编辑态才出现发薪日输入框与新增表单，输入即写回 store', async () => {
    const { wrapper, store } = mountCard()
    expect(wrapper.find('[data-testid="countdown-payday-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="countdown-add-form"]').exists()).toBe(false)

    await openEdit(wrapper)
    const input = wrapper.find('[data-testid="countdown-payday-input"]')
    expect(input.exists()).toBe(true)

    await input.setValue('5')
    expect(store.paydayDay).toBe(5)

    // 清空输入不写脏值（保留原值，不跳到 1 号）
    await input.setValue('')
    expect(store.paydayDay).toBe(5)

    // 收起编辑态时输入框与表单一起消失
    await openEdit(wrapper)
    expect(wrapper.find('[data-testid="countdown-payday-input"]').exists()).toBe(false)
  })

  it('法定节假日区块列出接下来的假期（同一假期合并成一条）', () => {
    const { wrapper } = mountCard()

    const mid = wrapper.find('[data-testid="countdown-holiday-2026-09-25"]')
    const national = wrapper.find('[data-testid="countdown-holiday-2026-10-01"]')
    const newYear = wrapper.find('[data-testid="countdown-holiday-2027-01-01"]')

    expect(mid.exists()).toBe(true)
    expect(flat(mid.text())).toContain('中秋节')
    expect(flat(mid.text())).toContain('还有10天')
    expect(flat(national.text())).toContain('还有16天')
    // 跨年的元旦带年份，不再只显示月日
    expect(flat(newYear.text())).toContain('2027年1月1日')
    expect(flat(newYear.text())).toContain('还有108天')

    // 中秋放了 3 天，但只占一行（否则国庆会被挤出 3 个名额）
    expect(wrapper.find('[data-testid="countdown-holiday-2026-09-26"]').exists()).toBe(false)
  })

  it('当年没有内置数据时直说缺数据，不假装', () => {
    const { wrapper } = mountCard(new Date(2030, 0, 5, 9, 0))

    const note = wrapper.find('[data-testid="countdown-holiday-note"]')
    expect(note.exists()).toBe(true)
    expect(flat(note.text())).toContain('暂未内置2030年放假安排')
  })

  it('空状态：没有纪念日时给引导文案', () => {
    const { wrapper } = mountCard()

    expect(wrapper.find('[data-testid="countdown-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('还没有纪念日/自定义倒计时')
  })

  it('新增一次性倒计时：出现在列表里，带解析后的日期与倒计时', async () => {
    const { wrapper, store } = mountCard()
    await openEdit(wrapper)
    await addItem(wrapper, { title: '项目上线', date: '2026-10-01' })

    expect(store.items).toHaveLength(1)
    const row = wrapper.find(`[data-testid="countdown-item-${store.items[0].id}"]`)
    expect(flat(row.text())).toContain('项目上线')
    expect(flat(row.text())).toContain('10月1日')
    expect(flat(row.text())).toContain('还有16天')
    // 成功后表单被清空，方便连着录
    expect(
      (wrapper.find('[data-testid="countdown-add-title"]').element as HTMLInputElement).value,
    ).toBe('')
    expect(wrapper.find('[data-testid="countdown-add-error"]').exists()).toBe(false)
  })

  it('勾选「每年重复」后解析日期顺延到下一次（今年 3/5 已过 -> 明年）', async () => {
    const { wrapper, store } = mountCard()
    await openEdit(wrapper)
    await addItem(wrapper, { title: '生日', date: '2000-03-05', yearly: true })

    const row = wrapper.find(`[data-testid="countdown-item-${store.items[0].id}"]`)
    expect(store.items[0].yearly).toBe(true)
    expect(flat(row.text())).toContain('2027年3月5日')
    expect(flat(row.text())).toContain('还有171天')
  })

  it('标题为空或日期无效时给出内联报错且不入库', async () => {
    const { wrapper, store } = mountCard()
    await openEdit(wrapper)

    // 标题为空
    await addItem(wrapper, { title: '   ', date: '2026-10-01' })
    expect(wrapper.find('[data-testid="countdown-add-error"]').text()).toBe('请填写倒计时名称')
    expect(store.items).toHaveLength(0)

    // 日期没填 / 填了不存在的日子（2026 平年没有 2/30）
    await addItem(wrapper, { title: '假的', date: '' })
    expect(wrapper.find('[data-testid="countdown-add-error"]').text()).toBe('请选择有效日期')
    await addItem(wrapper, { title: '假的', date: '2026-02-30' })
    expect(wrapper.find('[data-testid="countdown-add-error"]').exists()).toBe(true)
    expect(store.items).toHaveLength(0)

    // 改成合法值后报错消失、正常入库
    await addItem(wrapper, { title: '真的', date: '2026-12-24' })
    expect(store.items).toHaveLength(1)
    expect(wrapper.find('[data-testid="countdown-add-error"]').exists()).toBe(false)
  })

  it('删除按钮只在编辑态出现，点击后条目消失并回到空状态', async () => {
    const { wrapper, store } = mountCard(NOW, (s) => {
      s.addItem({ title: '待删', date: '2026-10-01', kind: 'custom', yearly: false })
    })

    const id = store.items[0].id
    expect(wrapper.find(`[data-testid="countdown-remove-${id}"]`).exists()).toBe(false)

    await openEdit(wrapper)
    await wrapper.find(`[data-testid="countdown-remove-${id}"]`).trigger('click')

    expect(store.items).toHaveLength(0)
    expect(wrapper.find(`[data-testid="countdown-item-${id}"]`).exists()).toBe(false)
    expect(wrapper.find('[data-testid="countdown-empty"]').exists()).toBe(true)
  })

  it('今天的条目高亮主题色，过期的一次性条目变暗并标「已过去」', () => {
    const { wrapper, store } = mountCard(NOW, (s) => {
      s.addItem({ title: '今天的事', date: '2026-09-15', kind: 'custom', yearly: false })
      s.addItem({ title: '过期的事', date: '2026-09-01', kind: 'custom', yearly: false })
    })

    const todayRow = wrapper.find(`[data-testid="countdown-item-${store.items[0].id}"]`)
    const pastRow = wrapper.find(`[data-testid="countdown-item-${store.items[1].id}"]`)

    expect(todayRow.classes().join(' ')).toContain('var(--el-color-primary)')
    expect(flat(todayRow.text())).toContain('今天')
    expect(pastRow.classes()).toContain('opacity-50')
    expect(flat(pastRow.text())).toContain('已过去14天')
  })
})
