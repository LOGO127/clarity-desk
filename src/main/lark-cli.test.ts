import { describe, expect, it } from 'vitest'
import {
  buildLarkCenterBatchArgs,
  buildLarkListBlocksArgs,
  buildLarkResolveDocumentArgs,
  buildLarkWindowsCommand,
  buildLarkWriteArgs,
  extractLarkAuthFlow,
  extractLarkDocumentId,
  extractLarkDocumentUrl,
  findStandaloneFormulaBlocks
} from './lark-cli'

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

  it('wraps Windows cmd scripts correctly when the executable path contains spaces', () => {
    expect(buildLarkWindowsCommand('C:\\Users\\Demo User\\lark-cli.cmd', ['auth', 'status'])).toBe(
      '""C:\\Users\\Demo User\\lark-cli.cmd" "auth" "status""'
    )
    expect(() => buildLarkWindowsCommand('lark-cli.cmd', ['bad&argument'])).toThrow('不安全字符')
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

  it('builds read commands that resolve a URL and list every document block', () => {
    const url = 'https://example.feishu.cn/wiki/wiki-token'
    expect(buildLarkResolveDocumentArgs(url)).toContain(url)
    expect(buildLarkResolveDocumentArgs(url)).toContain('outline')
    expect(buildLarkListBlocksArgs('doc-token')).toEqual(expect.arrayContaining(['GET', '--page-all', '500']))
  })

  it('extracts the resolved document id from nested output', () => {
    expect(extractLarkDocumentId({ ok: true, data: { document: { document_id: 'doc-token' } } })).toBe('doc-token')
  })

  it('finds equation blocks and formula-only text blocks without touching inline formulas', () => {
    const response = {
      data: {
        items: [
          { block_id: 'equation', block_type: 16, equation: { style: { align: 1 }, elements: [] } },
          {
            block_id: 'formula-paragraph',
            block_type: 2,
            text: {
              style: { align: 2 },
              elements: [{ text_run: { content: '  ' } }, { equation: { content: 'x^2' } }]
            }
          },
          {
            block_id: 'inline-formula',
            block_type: 2,
            text: {
              style: { align: 1 },
              elements: [{ text_run: { content: '其中 ' } }, { equation: { content: 'x^2' } }]
            }
          },
          { block_id: 'plain-text', block_type: 2, text: { elements: [{ text_run: { content: '正文' } }] } }
        ]
      }
    }

    expect(findStandaloneFormulaBlocks(response)).toEqual([
      { blockId: 'equation', kind: 'equation', align: 1 },
      { blockId: 'formula-paragraph', kind: 'text', align: 2 }
    ])
  })

  it('uses style-only batch updates for each supported formula block shape', () => {
    const args = buildLarkCenterBatchArgs(
      'doc-token',
      [
        { blockId: 'equation', kind: 'equation', align: 1 },
        { blockId: 'text', kind: 'text' }
      ],
      'client-token'
    )
    const dataIndex = args.indexOf('--data')
    const body = JSON.parse(args[dataIndex + 1]!)

    expect(body).toEqual({
      requests: [
        { block_id: 'equation', update_text: { style: { align: 2 }, fields: [1] } },
        { block_id: 'text', update_text_style: { style: { align: 2 }, fields: [1] } }
      ]
    })
  })
})
