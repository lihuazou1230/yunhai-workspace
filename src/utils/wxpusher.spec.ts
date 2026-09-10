import { describe, expect, it } from 'vitest'

import {
  EMPTY_TODO_TITLE,
  WXPUSHER_APP_URL,
  WXPUSHER_UID_KEY,
  buildReminderMessage,
  deepLink,
  escapeHtml,
  isValidUid,
  wxpusherBindHint,
} from './wxpusher'

describe('UID 校验', () => {
  it('接受真 UID（UID_ + 24 位）以及宽松区间内的其它写法', () => {
    // 表格化：用例 = [输入, 期望]
    const cases: Array<[unknown, boolean]> = [
      ['UID_abcdefghijklmnopqrstuvwx', true], // 真 UID 的样子（28 位）
      ['UID_1234', true], // 长度下限 8
      ['UID_' + 'a'.repeat(60), true], // 长度上限 64
      ['  UID_abcdefghijkl  ', true], // 前后空白先 trim（用户从微信里复制常带空格）
      ['UID_abc-123', false], // 连字符不在允许字符集里
      ['UID_abc 123', false], // 内部空白
      ['UID_abc', false], // 太短
      ['UID_' + 'a'.repeat(61), false], // 超过 64
      ['', false],
      ['   ', false],
      [null, false],
      [undefined, false],
      [12345678, false], // 非字符串
      [{ uid: 'UID_abcdefghijkl' }, false],
    ]

    for (const [input, expected] of cases) {
      expect(isValidUid(input), `输入 ${JSON.stringify(input)}`).toBe(expected)
    }
  })

  it('常量与引导文案就位（设置页与存储共用同一份口径）', () => {
    expect(WXPUSHER_UID_KEY).toBe('smart-workspace:wxpusher-uid')
    expect(WXPUSHER_APP_URL).toContain('wxpusher.zjiecode.com')
    expect(wxpusherBindHint.invalid).toContain('UID')
    expect(wxpusherBindHint.missing).toContain('UID')
  })
})

describe('HTML 转义', () => {
  it('五个危险字符全部转义，且 & 先于其它（不会二次转义）', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;')
    // 先转 & 再转 <，否则 `&lt;` 会被写成 `&amp;lt;`
    expect(escapeHtml('<')).toBe('&lt;')
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })
})

describe('深链', () => {
  const base = 'https://lihuazou1230.github.io/vue3-smart-workspace/'

  it('带尾斜杠的部署地址：拼出单斜杠的规范地址', () => {
    expect(deepLink('t1', base)).toBe(
      'https://lihuazou1230.github.io/vue3-smart-workspace/todos?focus=t1',
    )
  })

  it('不带尾斜杠同样只产生一个斜杠（GitHub Pages 子路径部署）', () => {
    const expected = 'https://lihuazou1230.github.io/vue3-smart-workspace/todos?focus=t1'
    expect(deepLink('t1', 'https://lihuazou1230.github.io/vue3-smart-workspace')).toBe(expected)
    expect(deepLink('t1', base.replace(/\/$/, ''))).toBe(expected)
    // 多个尾斜杠也只留一个
    expect(deepLink('t1', `${base}///`)).toBe(expected)
  })

  it('根目录部署（本地 / Vercel）也对', () => {
    expect(deepLink('t1', 'https://app.example.com/')).toBe(
      'https://app.example.com/todos?focus=t1',
    )
    expect(deepLink('t1', 'https://app.example.com')).toBe('https://app.example.com/todos?focus=t1')
  })

  it('任务 id 做 URL 编码（脏 id 不会把 query 拆坏）', () => {
    expect(deepLink('a b&c=d', base)).toBe(
      'https://lihuazou1230.github.io/vue3-smart-workspace/todos?focus=a%20b%26c%3Dd',
    )
  })

  it('是**路径式**深链而不是 hash 式（history 路由不认 hash）', () => {
    const url = deepLink('t1', base)
    // 这条断言是在保护一个真实的坑：改成 `#/todos?focus=` 后，
    // 用户从微信点进来会落在仪表板——vue-router 的 history 模式根本不会读 hash。
    expect(url).not.toContain('#')
    expect(url).toContain('/todos?focus=t1')
  })

  it('空 id / 空基地址：原样返回基地址，不产生坏链接', () => {
    expect(deepLink('', base)).toBe(base)
    expect(deepLink('   ', base)).toBe(base)
    expect(deepLink('', 'https://app.example.com')).toBe('https://app.example.com')
    expect(deepLink('t1', '')).toBe('')
    expect(deepLink('t1', '   ')).toBe('')
  })
})

describe('推送文案拼装', () => {
  const base = 'https://lihuazou1230.github.io/vue3-smart-workspace/'

  it('标题 + 截止信息 + 回跳链接齐全', () => {
    const message = buildReminderMessage({ id: 't1', title: '写周报', dueDate: '2026-09-10' }, base)

    expect(message.title).toBe('写周报')
    expect(message.url).toBe('https://lihuazou1230.github.io/vue3-smart-workspace/todos?focus=t1')
    expect(message.content).toContain('写周报')
    expect(message.content).toContain('截止：2026-09-10')
    expect(message.content).toContain(`href="${message.url}"`)
  })

  it('没有截止日期时给出「未设置」，消息结构不塌', () => {
    const message = buildReminderMessage({ id: 't2', title: '交房租' }, base)
    expect(message.content).toContain('截止：未设置')
  })

  it('标题里的 <script> 被转义，不会被当成标签渲染（注入面）', () => {
    const message = buildReminderMessage({ id: 't3', title: '<script>alert("x")</script>' }, base)

    expect(message.content).not.toContain('<script>')
    expect(message.content).toContain('&lt;script&gt;')
    // 双引号也被转义，否则能提前闭合属性
    expect(message.content).toContain('&quot;x&quot;')
    // 摘要（通知栏纯文本）保持原文，不做 HTML 转义
    expect(message.title).toBe('<script>alert("x")</script>')
  })

  it('标题里的 & 与引号不会破坏 HTML 结构', () => {
    const message = buildReminderMessage({ id: 't4', title: `A & B "C" 'D' <b>` }, base)
    expect(message.content).toContain('A &amp; B &quot;C&quot; &#39;D&#39; &lt;b&gt;')
    expect(message.content).not.toContain('<b>')
  })

  it('截止日期同样转义（脏数据也不会注入）', () => {
    const message = buildReminderMessage(
      { id: 't5', title: '任务', dueDate: '<img src=x onerror=alert(1)>' },
      base,
    )
    expect(message.content).not.toContain('<img')
    expect(message.content).toContain('&lt;img')
  })

  it('空标题仍然是一条可用的消息（兜底文案 + 可点链接）', () => {
    const message = buildReminderMessage({ id: 't6', title: '   ' }, base)

    expect(message.title).toBe(EMPTY_TODO_TITLE)
    expect(message.content).toContain(EMPTY_TODO_TITLE)
    expect(message.content).toContain('href="')
    expect(message.url).toContain('focus=t6')
  })

  it('标题非字符串的脏数据不崩（旧数据 / 手改 localStorage）', () => {
    const message = buildReminderMessage({ title: undefined as unknown as string }, base)
    expect(message.title).toBe(EMPTY_TODO_TITLE)
    expect(message.content).toContain('截止：未设置')
  })

  it('没有 id 时链接退化成应用首页（仍可点，落在哪儿交给应用自己决定）', () => {
    const message = buildReminderMessage({ title: '散装提醒' }, base)
    expect(message.url).toBe(base)
    expect(message.content).toContain(`href="${base}"`)
  })

  it('基地址为空（不该发生）时不放坏链接，正文依旧可读', () => {
    const message = buildReminderMessage({ id: 't9', title: '任务' }, '')
    expect(message.url).toBe('')
    expect(message.content).not.toContain('href=')
    expect(message.content).toContain('任务')
  })
})
