import { describe, expect, it } from 'vitest'

import { describeAuthLinkError, parseAuthRedirect, stripAuthParams } from './authRedirect'

const ORIGIN = 'http://localhost:5173'

describe('parseAuthRedirect（邮件链接落地参数解析）', () => {
  it('普通访问：什么凭据都没有', () => {
    expect(parseAuthRedirect(`${ORIGIN}/`).kind).toBe('none')
    expect(parseAuthRedirect(`${ORIGIN}/login?redirect=/todos`).kind).toBe('none')
  })

  it('implicit（默认模板，`#access_token=`）：交给 supabase-js 自己换，这里不当凭据处理', () => {
    const plan = parseAuthRedirect(`${ORIGIN}/#access_token=abc&refresh_token=def&type=signup`)
    expect(plan.kind).toBe('none')
  })

  it('PKCE：识别 ?code=', () => {
    const plan = parseAuthRedirect(`${ORIGIN}/?code=abc-123`)
    expect(plan).toEqual({ kind: 'code', code: 'abc-123' })
  })

  it('新版模板：识别 ?token_hash= 与 type（库不会自动处理这一种）', () => {
    const plan = parseAuthRedirect(`${ORIGIN}/auth/confirm?token_hash=hash-1&type=signup&next=/`)
    expect(plan).toEqual({ kind: 'otp', tokenHash: 'hash-1', type: 'signup' })
  })

  it('token_hash 缺 type 时按 email 处理，type 乱写也回落到 email', () => {
    expect(parseAuthRedirect(`${ORIGIN}/?token_hash=h`).type).toBe('email')
    expect(parseAuthRedirect(`${ORIGIN}/?token_hash=h&type=not-a-type`).type).toBe('email')
  })

  it('错误形态：hash 里的 error_code 与 query 里的 error 都认', () => {
    expect(parseAuthRedirect(`${ORIGIN}/#error=access_denied&error_code=otp_expired`)).toEqual({
      kind: 'error',
      errorCode: 'otp_expired',
      errorDescription: '',
    })
    expect(
      parseAuthRedirect(`${ORIGIN}/?error=access_denied&error_description=Link+expired`),
    ).toEqual({
      kind: 'error',
      errorCode: 'access_denied',
      errorDescription: 'Link expired',
    })
  })

  it('错误优先于凭据：真的错了就不去换会话', () => {
    const plan = parseAuthRedirect(`${ORIGIN}/?code=abc#error=access_denied&error_code=otp_expired`)
    expect(plan.kind).toBe('error')
  })
})

describe('stripAuthParams（把一次性凭据从地址栏抹掉）', () => {
  it('没有认证参数时返回 null（不改地址）', () => {
    expect(stripAuthParams(`${ORIGIN}/todos?filter=all`)).toBeNull()
  })

  it('清掉 query 里的 code / token_hash，保留业务参数', () => {
    expect(stripAuthParams(`${ORIGIN}/?code=abc&redirect=%2Ftodos`)).toBe(
      `${ORIGIN}/?redirect=%2Ftodos`,
    )
  })

  it('清掉 hash 里的 access_token 一整套（刷新不会拿一次性凭据再换一次）', () => {
    const url = `${ORIGIN}/#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=signup`
    expect(stripAuthParams(url)).toBe(`${ORIGIN}/`)
  })

  it('hash 里混着业务锚点时只删认证参数', () => {
    expect(stripAuthParams(`${ORIGIN}/#access_token=a&section=stats`)).toBe(
      `${ORIGIN}/#section=stats`,
    )
  })
})

describe('describeAuthLinkError（链接出错时的中文提示）', () => {
  it('过期（含被邮件安全扫描器先点掉）指向"重新发送一封"', () => {
    expect(
      describeAuthLinkError({ kind: 'error', errorCode: 'otp_expired', errorDescription: '' }),
    ).toContain('重新发送')
  })

  it('access_denied 也给出可执行动作', () => {
    expect(
      describeAuthLinkError({ kind: 'error', errorCode: 'access_denied', errorDescription: '' }),
    ).toContain('重新发送')
  })

  it('其它错误码优先用服务端描述，没有描述则给兜底文案', () => {
    expect(
      describeAuthLinkError({ kind: 'error', errorCode: 'weird', errorDescription: 'boom' }),
    ).toBe('boom')
    expect(
      describeAuthLinkError({ kind: 'error', errorCode: 'weird', errorDescription: '' }),
    ).toContain('重新发送')
  })
})
