import { afterEach, describe, expect, it, vi } from 'vitest'

import { appUrl, buildAppUrl } from './appUrl'

describe('buildAppUrl（部署子路径感知）', () => {
  const ORIGIN = 'https://lihuazou1230.github.io'

  it('根目录部署：origin + / + path', () => {
    expect(buildAppUrl('https://app.example.com', '/', '')).toBe('https://app.example.com/')
    expect(buildAppUrl('https://app.example.com', '/', 'reset-password')).toBe(
      'https://app.example.com/reset-password',
    )
  })

  it('GitHub Pages 子路径部署：保留仓库前缀（回归保护）', () => {
    const base = '/vue3-smart-workspace/'
    expect(buildAppUrl(ORIGIN, base)).toBe(`${ORIGIN}/vue3-smart-workspace/`)
    expect(buildAppUrl(ORIGIN, base, 'reset-password')).toBe(
      `${ORIGIN}/vue3-smart-workspace/reset-password`,
    )
    expect(buildAppUrl(ORIGIN, base, 'login')).toBe(`${ORIGIN}/vue3-smart-workspace/login`)
  })

  it('base 缺尾斜杠时自动补，不会拼出 //', () => {
    expect(buildAppUrl(ORIGIN, '/vue3-smart-workspace', 'todos')).toBe(
      `${ORIGIN}/vue3-smart-workspace/todos`,
    )
  })

  it('path 带前导斜杠也正常（不会出现双斜杠）', () => {
    expect(buildAppUrl(ORIGIN, '/vue3-smart-workspace/', '/reset-password')).toBe(
      `${ORIGIN}/vue3-smart-workspace/reset-password`,
    )
  })

  it('base 为空时按根目录处理', () => {
    expect(buildAppUrl(ORIGIN, '', 'reset-password')).toBe(`${ORIGIN}/reset-password`)
  })

  it('origin 尾部多斜杠会被归一化', () => {
    expect(buildAppUrl('https://app.example.com/', '/', 'todos')).toBe(
      'https://app.example.com/todos',
    )
  })

  it('嵌套子路径同样成立', () => {
    expect(buildAppUrl(ORIGIN, '/a/b/', 'c')).toBe(`${ORIGIN}/a/b/c`)
  })
})

describe('appUrl（读当前 origin + 构建期 BASE_URL）', () => {
  it('测试环境的 BASE_URL 是 /：拼出当前 origin 下的地址', () => {
    expect(appUrl('reset-password')).toBe(`${location.origin}/reset-password`)
    expect(appUrl()).toBe(`${location.origin}/`)
  })

  it('BASE_URL 变成子路径时（模拟 GitHub Pages 构建），地址自动带上前缀', async () => {
    const original = import.meta.env.BASE_URL
    try {
      // 用 stub 让运行时 base 指向子路径，验证 appUrl 不是写死 origin
      ;(import.meta.env as Record<string, unknown>).BASE_URL = '/vue3-smart-workspace/'
      expect(appUrl('reset-password')).toBe(
        `${location.origin}/vue3-smart-workspace/reset-password`,
      )
    } finally {
      ;(import.meta.env as Record<string, unknown>).BASE_URL = original
    }
  })
})

describe('appUrl 的运行时兜底（没有 location / 没有 BASE_URL）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('没有 location 时 origin 当成空串，拼出站内相对路径（SSR 预渲染不崩）', () => {
    vi.stubGlobal('location', undefined)
    expect(appUrl('reset-password')).toBe('/reset-password')
    expect(appUrl()).toBe('/')
  })

  it('构建期没注入 BASE_URL 时退回根目录（换宿主或自定义构建下仍是可用地址）', () => {
    const env = import.meta.env as Record<string, unknown>
    const original = env.BASE_URL
    try {
      // 用 delete 而不是赋 undefined：vite 的 env 代理会把 undefined 变成字符串
      // 'undefined'，那样 `?? '/'` 兜不住，地址会拼成 hostundefined/todos
      delete env.BASE_URL
      expect(appUrl('todos')).toBe(`${location.origin}/todos`)
    } finally {
      env.BASE_URL = original
    }
  })
})
