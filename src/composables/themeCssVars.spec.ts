import { beforeEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import { useTheme } from '@/composables/useTheme'

/**
 * 运行时主题变量必须落在 **`<html>`** 上。
 *
 * 回归的是这条真实缺陷：变量原先绑在 App 根 div 的 `:style` 上，
 * 而 Element Plus 的弹窗/下拉/日期面板会 teleport 到 `body` 下 ——
 * 不在根节点子树里就继承不到变量，用户改的主题色与圆角在浮层里会回退成静态兜底值。
 */
describe('主题 CSS 变量写在 <html> 上', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    document.documentElement.removeAttribute('style')
    document.documentElement.classList.remove('dark')
  })

  it('初始化即写入 documentElement（不是返回就算）', () => {
    const scope = effectScope()
    let api: ReturnType<typeof useTheme> | undefined
    scope.run(() => {
      api = useTheme()
    })

    // 直接调用 composable 时 themeVars 仍是 ComputedRef（组件里才自动解包）
    const expected = api?.themeVars.value['--el-color-primary']
    expect(expected).toBeTruthy()
    expect(document.documentElement.style.getPropertyValue('--el-color-primary')).toBe(expected)
    // 圆角同理（浮层里的输入框/弹窗也用这两个变量）
    expect(document.documentElement.style.getPropertyValue('--app-radius')).toBe(
      api?.themeVars.value['--app-radius'],
    )

    scope.stop()
  })

  it('派生档位一并写入（light-3/5/9 与 dark-2 都要可用）', () => {
    const scope = effectScope()
    let api: ReturnType<typeof useTheme> | undefined
    scope.run(() => {
      api = useTheme()
    })

    const style = document.documentElement.style
    for (const key of [
      '--el-color-primary-light-3',
      '--el-color-primary-light-5',
      '--el-color-primary-light-9',
      '--el-color-primary-dark-2',
    ]) {
      expect(style.getPropertyValue(key)).toBe(api?.themeVars.value[key])
    }

    scope.stop()
  })
})
