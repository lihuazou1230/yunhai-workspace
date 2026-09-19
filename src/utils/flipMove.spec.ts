import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { flipMove } from './flipMove'

/**
 * `flipMove` 的单元测试。
 *
 * 它做的是「测量 → 改状态 → 再测量 → 补一段反向位移动画」，全程只依赖 DOM 的两个能力：
 * `getBoundingClientRect()` 与 `Element.animate()`。这里用桩件驱动这两点，
 * 不依赖真实布局（happy-dom 不做布局，量出来永远是 0，测不出东西）。
 */

/** 造一个可控的桩元素：位置由 `pos` 决定，并记录 animate 的调用 */
function stubElement(pos: { left: number; top: number }) {
  const calls: Array<{ keyframes: unknown; options: unknown }> = []
  const el = {
    getBoundingClientRect: () => ({ ...pos, width: 100, height: 40, right: 0, bottom: 0 }),
    animate: (keyframes: unknown, options: unknown) => {
      calls.push({ keyframes, options })
      return { finished: Promise.resolve() }
    },
  }
  return { el: el as unknown as Element, calls }
}

describe('flipMove', () => {
  let queryResult: Element | null
  let queryAll: Element[] = []

  beforeEach(() => {
    queryResult = null
    queryAll = []
    vi.stubGlobal('document', {
      querySelector: () => queryResult,
      querySelectorAll: () => queryAll,
    })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('元素位置变了：用「原位置 - 新位置」的反向位移做补间，终态回到 none', async () => {
    // 元素从 y=500 移到 y=100（被置顶到最前）
    const before = stubElement({ left: 10, top: 500 })
    const after = stubElement({ left: 10, top: 100 })

    let actionRan = false
    queryResult = before.el
    await flipMove(
      '[data-testid="todo-item-1"]',
      () => {
        actionRan = true
        // 动作执行后（DOM 更新完）查询会返回移到新位置的同一个元素
        queryResult = after.el
      },
      async () => {},
    )

    expect(actionRan).toBe(true)
    expect(after.calls).toHaveLength(1)
    expect(after.calls[0].keyframes).toEqual([
      { transform: 'translate(0px, 400px)' },
      { transform: 'none' },
    ])
  })

  it('位置没变（本来就在最前）：不做任何动画', async () => {
    const same = stubElement({ left: 10, top: 100 })
    queryResult = same.el
    await flipMove(
      '[data-testid="todo-item-1"]',
      () => {},
      async () => {},
    )

    expect(same.calls).toHaveLength(0)
  })

  it('拿不到元素（比如被筛掉）：静默跳过，不抛错', async () => {
    queryResult = null
    await expect(
      flipMove(
        '[data-testid="missing"]',
        () => {},
        async () => {},
      ),
    ).resolves.toBeUndefined()
  })

  it('减少动效（prefers-reduced-motion）：跳过位移补间', async () => {
    const before = stubElement({ left: 10, top: 500 })
    const after = stubElement({ left: 10, top: 100 })
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    queryResult = before.el
    await flipMove(
      '[data-testid="todo-item-1"]',
      () => {
        queryResult = after.el
      },
      async () => {},
    )

    /*
      必须在这里判断：WAAPI 的动画**不受**全局 CSS 的 `animation-duration` 降级影响，
      只靠样式表的话会出现"其它动效都降级了、只有这条还在飞"的漏网。
    */
    expect(after.calls).toHaveLength(0)
  })

  it('等 DOM 更新后才测量（顺序：先量 → 动作 → 等 → 再量）', async () => {
    const order: string[] = []
    const before = stubElement({ left: 0, top: 300 })
    const after = stubElement({ left: 0, top: 0 })

    queryResult = before.el
    await flipMove(
      '[data-testid="x"]',
      () => {
        order.push('action')
        queryResult = after.el
      },
      async () => {
        order.push('waitDom')
      },
    )

    expect(order).toEqual(['action', 'waitDom'])
  })
})
