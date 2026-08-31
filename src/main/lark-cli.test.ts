import { describe, expect, it } from 'vitest'
import { buildLarkWriteArgs, extractLarkAuthFlow, extractLarkDocumentUrl } from './lark-cli'

describe('lark-cli integration helpers', () => {
  it('always selects the versioned v2 XML workflow', () => {
    const create = buildLarkWriteArgs({ mode: 'create', xml: '<title>Demo</title>' })
    const append = buildLarkWriteArgs({ mode: 'append', docUrl: 'https://example.feishu.cn/docx/demo', xml: '<p>x</p>' })

    expect(create).toEqual([
      'docs', '+create', '--api-version', 'v2', '--as', 'user', '--content', '@content.xml', '--format', 'json'
    ])
    expect(append).toContain('+update')
    expect(append).toContain('append')
    expect(append).toContain('v2')
  })

  it('extracts the document URL from current lark-cli envelopes', () => {
    expect(extractLarkDocumentUrl({ ok: true, data: { document: { url: 'https://example.feishu.cn/docx/abc' } } })).toBe(
      'https://example.feishu.cn/docx/abc'
    )
  })

  it('extracts split-flow authorization values from nested output', () => {
    expect(
      extractLarkAuthFlow({ data: { verification_url: 'https://accounts.example/verify', device_code: 'device-code' } })
    ).toEqual({ verificationUrl: 'https://accounts.example/verify', deviceCode: 'device-code' })
  })
})
