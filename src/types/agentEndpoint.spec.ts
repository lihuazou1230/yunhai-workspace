import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 默认 agent 基地址的构建期覆盖（`VITE_AGENT_ENDPOINT`）。
 *
 * 这个口子是为自有服务器上的部署页开的：页面跑在服务器上，连不到访问者本机的
 * 127.0.0.1（浏览器对「公网页面 → 回环地址」还有 Local Network Access 限制），
 * 所以部署包构建时把它指到服务器上的同源反代地址。
 *
 * `DEFAULT_AGENT_ENDPOINT` 是**模块加载时**求值的常量，所以必须先 stubEnv 再
 * resetModules + 动态 import，否则拿到的是缓存下来的旧值。
 */
async function importDefaultEndpoint(): Promise<string> {
  vi.resetModules()
  const mod = await import('./agent')
  return mod.DEFAULT_AGENT_ENDPOINT
}

describe('DEFAULT_AGENT_ENDPOINT', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('没配 VITE_AGENT_ENDPOINT 时回退本机默认端口（本地开发形态）', async () => {
    vi.stubEnv('VITE_AGENT_ENDPOINT', '')
    await expect(importDefaultEndpoint()).resolves.toBe('http://127.0.0.1:8000')
  })

  it('配了空白字符也回退本机默认端口，不会产出空基地址', async () => {
    vi.stubEnv('VITE_AGENT_ENDPOINT', '   ')
    await expect(importDefaultEndpoint()).resolves.toBe('http://127.0.0.1:8000')
  })

  it('配了服务器同源反代地址时以它为准（部署形态）', async () => {
    vi.stubEnv('VITE_AGENT_ENDPOINT', 'http://124.220.159.58/yhai')
    await expect(importDefaultEndpoint()).resolves.toBe('http://124.220.159.58/yhai')
  })
})
