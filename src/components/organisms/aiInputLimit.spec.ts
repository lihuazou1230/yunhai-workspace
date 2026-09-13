import { describe, expect, it } from 'vitest'

// 用 `?raw` 读源文件：这两个输入框是模板里的原生 input，不引入 node 类型也能断言
import aiTodoInput from './AiTodoInput.vue?raw'
import aiBreakdownDialog from './AiBreakdownDialog.vue?raw'

/**
 * AI 输入的**长度上限**守卫（BYOK 场景下的基本防线）。
 *
 * 这两个框是直接把用户输入塞进 messages 发给模型的，而请求用的是**用户自己的
 * API Key**：没有上限时，一次整篇文档的粘贴就会变成一大笔（用户自付的）token 消耗，
 * 也更容易触发上游的长度报错。手动表单那条路径有 validateTodoTitle（上限 100），
 * AI 这条路径此前完全没有约束。
 */
describe('AI 输入的长度上限', () => {
  it('「AI 添加」的一句话输入有 maxlength', () => {
    expect(aiTodoInput).toContain('maxlength="500"')
  })

  it('「AI 拆解」的目标输入有 maxlength', () => {
    expect(aiBreakdownDialog).toContain('maxlength="500"')
  })

  it('上限值保持一致（换数值时两处要一起改）', () => {
    const inAdd = aiTodoInput.match(/maxlength="(\d+)"/)?.[1]
    const inBreakdown = aiBreakdownDialog.match(/maxlength="(\d+)"/)?.[1]
    expect(inAdd).toBeTruthy()
    expect(inAdd).toBe(inBreakdown)
  })
})
