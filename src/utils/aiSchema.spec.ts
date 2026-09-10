import { describe, expect, it } from 'vitest'

import { extractJson, validateSubtaskDrafts, validateTodoDraft } from './aiSchema'

const TODAY = '2026-09-10'

describe('validateTodoDraft（智能添加的 schema 校验）', () => {
  it('完整合法输入原样通过', () => {
    const result = validateTodoDraft(
      { title: '交周报', dueDate: '2026-09-11', priority: 'high', note: '听到「明天」' },
      TODAY,
    )
    expect(result).toEqual({
      ok: true,
      value: { title: '交周报', dueDate: '2026-09-11', priority: 'high', note: '听到「明天」' },
    })
  })

  it('标题去空白；空标题/缺标题判失败并给出原因', () => {
    expect(validateTodoDraft({ title: '  写周报  ' }, TODAY)).toEqual({
      ok: true,
      value: { title: '写周报', dueDate: undefined, priority: 'medium', note: undefined },
    })
    expect(validateTodoDraft({ title: '   ' }, TODAY)).toMatchObject({ ok: false })
    expect(validateTodoDraft({}, TODAY)).toMatchObject({
      ok: false,
      error: expect.stringContaining('title'),
    })
  })

  it('非对象输入全部判失败（数组也算）', () => {
    for (const bad of [null, undefined, '文本', 42, [], true]) {
      expect(validateTodoDraft(bad, TODAY).ok).toBe(false)
    }
  })

  it('相对日期短语自己换算（模型没换算出绝对日期时的兜底）', () => {
    const cases: Array<[string, string]> = [
      ['今天', '2026-09-10'],
      ['明天', '2026-09-11'],
      ['后天', '2026-09-12'],
      ['3天后', '2026-09-13'],
      ['下周一', '2026-09-14'],
    ]
    for (const [input, expected] of cases) {
      const result = validateTodoDraft({ title: 'x', dueDate: input }, TODAY)
      expect(result).toMatchObject({ ok: true })
      if (result.ok) expect(result.value.dueDate).toBe(expected)
    }
  })

  it('非法日期不判失败而是丢掉该字段（不因为日期写错就整条重来）', () => {
    const result = validateTodoDraft({ title: '写周报', dueDate: '2026-13-45' }, TODAY)
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.value.dueDate).toBeUndefined()

    const weird = validateTodoDraft({ title: '写周报', dueDate: '随便哪天' }, TODAY)
    if (weird.ok) expect(weird.value.dueDate).toBeUndefined()
  })

  it('日期字段别名 date / due 也认', () => {
    for (const key of ['date', 'due']) {
      const result = validateTodoDraft({ title: 'x', [key]: '2026-09-20' }, TODAY)
      if (result.ok) expect(result.value.dueDate).toBe('2026-09-20')
    }
  })

  it('优先级：英文枚举 + 中文 + 常见近义词都能收敛，认不出按中', () => {
    const cases: Array<[unknown, string]> = [
      ['high', 'high'],
      ['HIGH', 'high'],
      ['高', 'high'],
      ['urgent', 'high'],
      ['low', 'low'],
      ['低', 'low'],
      ['minor', 'low'],
      ['medium', 'medium'],
      ['中', 'medium'],
      ['normal', 'medium'],
      ['不知道', 'medium'],
      [undefined, 'medium'],
      [42, 'medium'], // 非字符串
    ]
    for (const [input, expected] of cases) {
      const result = validateTodoDraft({ title: 'x', priority: input }, TODAY)
      if (result.ok) expect(result.value.priority).toBe(expected)
    }
  })
})

describe('validateSubtaskDrafts（拆解的 schema 校验）', () => {
  const row = (title: string, priority = 'medium') => ({ title, priority })

  it('3~6 条合法输入通过', () => {
    const result = validateSubtaskDrafts([row('a'), row('b'), row('c')])
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.value).toHaveLength(3)
  })

  it('接受被包在 { subtasks: [...] } 里的形式', () => {
    const result = validateSubtaskDrafts({ subtasks: [row('a'), row('b'), row('c')] })
    if (result.ok) expect(result.value.map((s) => s.title)).toEqual(['a', 'b', 'c'])
  })

  it('少于 3 条判失败（没拆开），多于 6 条也判失败（静默截断会丢步骤）', () => {
    expect(validateSubtaskDrafts([row('a'), row('b')])).toMatchObject({
      ok: false,
      error: expect.stringContaining('至少要 3 条'),
    })
    const seven = Array.from({ length: 7 }, (_, i) => row(`s${i}`))
    expect(validateSubtaskDrafts(seven)).toMatchObject({
      ok: false,
      error: expect.stringContaining('最多 6 条'),
    })
  })

  it('刚好 6 条通过，刚好 3 条通过', () => {
    expect(validateSubtaskDrafts(Array.from({ length: 6 }, (_, i) => row(`s${i}`))).ok).toBe(true)
    expect(validateSubtaskDrafts(Array.from({ length: 3 }, (_, i) => row(`s${i}`))).ok).toBe(true)
  })

  it('纯字符串数组也接受（优先级给中）；空标题被丢掉后数量不足则判失败', () => {
    const ok = validateSubtaskDrafts(['收集资料', '写大纲', '成稿'])
    expect(ok).toMatchObject({ ok: true })
    if (ok.ok) expect(ok.value.every((s) => s.priority === 'medium')).toBe(true)

    expect(validateSubtaskDrafts(['收集资料', '   ', '成稿']).ok).toBe(false)
  })

  it('缺 subtasks / 非数组判失败', () => {
    expect(validateSubtaskDrafts({})).toMatchObject({ ok: false })
    expect(validateSubtaskDrafts('文本')).toMatchObject({ ok: false })
    expect(validateSubtaskDrafts(null)).toMatchObject({ ok: false })
  })

  it('脏条目（非对象、无标题）被跳过而不是整条崩掉；结构化数组里的裸字符串视为噪音', () => {
    const result = validateSubtaskDrafts([
      { title: '有效' },
      'garbage',
      null,
      { notitle: true },
      { title: '也有效' },
      { title: '再一条' },
    ])
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.value.map((s) => s.title)).toEqual(['有效', '也有效', '再一条'])
  })
})

describe('extractJson（从模型回复里抽 JSON）', () => {
  it('纯 JSON 直接解析', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('剥掉 markdown 代码块围栏', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('```\n{"a":2}\n```')).toEqual({ a: 2 })
  })

  it('前后夹了说明文字时截取第一个 { 到最后一个 }', () => {
    expect(extractJson('好的，结果如下：{"a":3} 以上。')).toEqual({ a: 3 })
  })

  it('确实不是 JSON 时返回 null', () => {
    expect(extractJson('我不知道')).toBeNull()
    expect(extractJson('')).toBeNull()
    expect(extractJson('   ')).toBeNull()
  })

  it('围栏里不是合法 JSON 时返回 null（模型把解释写进了代码块）', () => {
    // 剥掉 ```json 之后仍然是自然语言：不能再往后猜，直接判为「没抽到」
    expect(extractJson('```json\n{这里其实是解释，不是 JSON}\n```')).toBeNull()
    expect(extractJson('```\n{也不是}\n```')).toBeNull()
  })

  it('花括号之间不是合法 JSON 时返回 null（避免把散文里的括号当成结果）', () => {
    expect(extractJson('结果是 {不是 JSON} 大概吧')).toBeNull()
    expect(extractJson('{1, 2, 3}')).toBeNull()
  })
})
