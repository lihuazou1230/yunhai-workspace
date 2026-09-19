/**
 * FLIP 位移动画（First → Last → Invert → Play）。
 *
 * 场景：列表按状态重排时（典型是「置顶」把一条任务从中间提到最前），
 * Vue 只是把它**重新插到新位置**，浏览器直接重绘 —— 视觉上就是"突然出现在上方"。
 * CSS transition 对此无能为力（元素的布局位置变了，没有一个可过渡的属性），
 * 所以要手动用 FLIP 补出这段位移：
 *
 *   1. First  ：调用前记录元素的初始视口位置
 *   2. Last   ：等 DOM 更新完，记录它的最终位置
 *   3. Invert ：给元素加一个「反向位移」的 transform，让它**看起来还在原地**
 *   4. Play   ：把 transform 过渡回 0，于是它"从原位置滑到新位置"
 *
 * 为什么不用 Vue 的 `<TransitionGroup>`：本列表由 SortableJS 接管拖拽，
 * 两者都会直接操作同一批 DOM 节点与 transform，叠在一起容易出现拖拽期间
 * 位置抖动。这里只在**我们自己的动作**（置顶）里做一次定点补间，风险面最小。
 */

/** 动画时长（ms）：与列表本身的 150ms 拖拽动画保持同一量级，不显拖沓 */
const FLIP_DURATION = 380

/** 缓动：指数收尾（先快后慢），位移类动画用它最稳 */
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

interface Rect {
  left: number
  top: number
}

function rectOf(el: Element | null | undefined): Rect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top }
}

/**
 * 让 `selector` 命中的元素从「动作前的位置」平滑移动到「动作后的位置」。
 *
 * @param selector 目标元素选择器（用 data-testid 最稳，避免依赖 DOM 结构）
 * @param action   触发重排的同步动作（改 store 即可，DOM 更新由本函数等待）
 * @param waitDom  等待 DOM 更新完成的函数（传 `nextTick`；注入是为了可测）
 */
export async function flipMove(
  selector: string,
  action: () => void,
  waitDom: () => Promise<unknown>,
): Promise<void> {
  const target = document.querySelector(selector)
  const first = rectOf(target)

  action()
  await waitDom()

  // 元素可能在重排中被替换（keyed diff 下常见），所以**重新查询**而不是复用旧引用
  const after = document.querySelector(selector)
  const last = rectOf(after)
  // 拿不到元素 / 位置没变（本来就在最前）→ 无需补间
  if (!after || !first || !last || !after.animate) return

  const dx = first.left - last.left
  const dy = first.top - last.top
  if (dx === 0 && dy === 0) return

  /*
    「减少动效」下直接跳过：这段动画是大幅位移，正是要避免的那一类。
    注意不能只依赖全局 CSS 的降级 —— WAAPI 动画不受 `animation-duration` 影响，
    必须在这里显式判断，否则会出现"CSS 全降级了、只有这条还在飞"的漏网。
  */
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return
  }

  after.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      // 终态用 `none` 而不是 `translate(0, 0)`：避免动画结束后留下一个恒等的
      // transform，那会为元素创建新的层叠上下文与包含块（影响内部绝对定位）
      { transform: 'none' },
    ],
    { duration: FLIP_DURATION, easing: FLIP_EASING },
  )
}
