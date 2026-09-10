/**
 * useECharts 生命周期封装测试。
 *
 * ECharts 真渲染需要 canvas（happy-dom 没有），所以这里把 `echarts/core` 换成受控替身：
 * 断言的不是「图画得对不对」，而是**封装契约**——
 * 1. 用真实容器元素初始化，并把首个 option 立刻喂进去；
 * 2. option 变化时复用同一实例重绘（不重建，避免图表闪一下、也避免实例泄漏）；
 * 3. 窗口 resize 自动重绘，**卸载时摘掉监听并 dispose()**（不 dispose 就是内存泄漏）；
 * 4. 无 canvas / init 抛错时静默降级，页面照常可用（不能因为一个图表把整页打挂）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import type { MockInstance } from 'vitest'

/** 模块替身：工厂里引用的外层变量必须走 vi.hoisted，否则 mock 提升后会拿到 undefined */
const echarts = vi.hoisted(() => {
  const instance = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }
  return { instance, init: vi.fn(() => instance), use: vi.fn() }
})

vi.mock('echarts/core', () => ({ init: echarts.init, use: echarts.use }))
vi.mock('echarts/charts', () => ({ LineChart: {}, PieChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import { useECharts } from './useECharts'

/** 造一个最小宿主组件：真实 <div> 作为图表容器，并把 option 放在外面以便改写 */
function mountChart(options: { bindRef?: boolean } = {}) {
  const bindRef = options.bindRef !== false
  const option = ref<Record<string, unknown>>({ series: [{ type: 'line' }] })
  const elRef = ref<HTMLElement | null>(null)
  let api: ReturnType<typeof useECharts> | null = null

  const Host = defineComponent({
    setup() {
      api = useECharts(elRef, () => option.value)
      return { elRef }
    },
    // bindRef=false 用于模拟「模板里还没挂上 ref」的场景
    template: bindRef ? '<div class="chart-host" ref="elRef" />' : '<div class="chart-host" />',
  })

  const wrapper = mount(Host)
  return { option, wrapper, elRef, api: api! }
}

/** 控制「环境是否有 2D canvas」：happy-dom 下 getContext 返回 null，等于测试环境不支持 */
function stubCanvas2d(supported: boolean): MockInstance {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: (id: string) => unknown }
  return vi.spyOn(proto, 'getContext').mockReturnValue(supported ? {} : null)
}

let canvasSpy: MockInstance | null = null

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  canvasSpy?.mockRestore()
  canvasSpy = null
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useECharts · 正常环境（有 2D canvas）', () => {
  beforeEach(() => {
    canvasSpy = stubCanvas2d(true)
  })

  it('挂载时用真实容器初始化，并把首个 option 立刻设置上去', () => {
    const { wrapper, option } = mountChart()

    expect(echarts.init).toHaveBeenCalledTimes(1)
    // 容器必须是模板里那个真实 DOM 节点，而不是 ref 对象或空值
    expect(echarts.init).toHaveBeenCalledWith(wrapper.element)
    // 第二个参数 true = notMerge：换图表类型时旧 series 不清会叠在一起
    expect(echarts.instance.setOption).toHaveBeenCalledWith(option.value, true)
    wrapper.unmount()
  })

  it('option 变化时复用同一实例重绘，而不是重新 init', async () => {
    const { wrapper, option, api } = mountChart()
    expect(echarts.init).toHaveBeenCalledTimes(1)
    expect(echarts.instance.setOption).toHaveBeenCalledTimes(1)

    option.value = { series: [{ type: 'pie' }] }
    await nextTick()

    expect(echarts.init).toHaveBeenCalledTimes(1)
    expect(echarts.instance.setOption).toHaveBeenCalledTimes(2)
    expect(echarts.instance.setOption).toHaveBeenLastCalledWith(option.value, true)
    expect(api.chart.value).toBe(echarts.instance)
    wrapper.unmount()
  })

  it('窗口 resize 时自动重绘：屏幕旋转/分栏拖动后图表不会变形', () => {
    const { wrapper } = mountChart()
    expect(echarts.instance.resize).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('resize'))
    expect(echarts.instance.resize).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('resize'))
    expect(echarts.instance.resize).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('卸载时 dispose 实例并摘掉 resize 监听（不 dispose 就是内存泄漏）', () => {
    const { wrapper, api } = mountChart()

    wrapper.unmount()

    expect(echarts.instance.dispose).toHaveBeenCalledTimes(1)
    expect(api.chart.value).toBeNull()

    // 监听没摘干净的话，页面已经销毁还会继续调 resize
    window.dispatchEvent(new Event('resize'))
    expect(echarts.instance.resize).not.toHaveBeenCalled()
  })

  it('对外暴露的 resize 可手动调用（侧边栏折叠等容器变化场景）', () => {
    const { wrapper, api } = mountChart()

    api.resize()
    expect(echarts.instance.resize).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    // 卸载后实例已置空：再调不能抛错（可选链兜底）
    expect(() => api.resize()).not.toThrow()
  })
})

describe('useECharts · 降级路径', () => {
  it('环境没有 2D canvas 时标记 unsupported，不 init 也不设置 option', async () => {
    canvasSpy = stubCanvas2d(false)
    const { wrapper, option, api } = mountChart()

    expect(api.unsupported.value).toBe(true)
    expect(echarts.init).not.toHaveBeenCalled()
    expect(echarts.instance.setOption).not.toHaveBeenCalled()

    // 降级状态下 option 变化也不能抛错（rebuild 里 chart 为空直接返回）
    option.value = { series: [{ type: 'pie' }] }
    await nextTick()
    expect(echarts.instance.setOption).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('init 抛错时静默降级、chart 置空，不让异常冒到页面', () => {
    canvasSpy = stubCanvas2d(true)
    echarts.init.mockImplementationOnce(() => {
      throw new Error('canvas 2d context 不可用')
    })

    const { wrapper, api } = mountChart()

    expect(api.unsupported.value).toBe(true)
    expect(api.chart.value).toBeNull()
    // 降级后卸载不能对空实例调 dispose
    expect(() => wrapper.unmount()).not.toThrow()
    expect(echarts.instance.dispose).not.toHaveBeenCalled()
  })

  it('容器 ref 尚未绑定时直接降级，不对 null 调 init', () => {
    canvasSpy = stubCanvas2d(true)
    const { wrapper, api } = mountChart({ bindRef: false })

    expect(echarts.init).not.toHaveBeenCalled()
    expect(api.unsupported.value).toBe(true)
    wrapper.unmount()
  })

  it('canvas.getContext 本身抛错（环境实现不全）时判定为不支持，而不是把异常抛到页面', () => {
    canvasSpy = stubCanvas2d(true)
    canvasSpy.mockImplementation(() => {
      throw new Error('getContext 未实现')
    })

    const { wrapper } = mountChart()

    expect(echarts.init).not.toHaveBeenCalled()
    expect(() => wrapper.unmount()).not.toThrow()
  })
})
