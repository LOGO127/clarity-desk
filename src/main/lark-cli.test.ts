import { describe, expect, it } from 'vitest'
import {
  buildLarkCenterBatchArgs,
  buildLarkCenterProgressResult,
  buildLarkListBlocksArgs,
  buildLarkResolveDocumentArgs,
  buildLarkWindowsCommand,
  buildLarkWriteArgs,
  extractLarkAuthFlow,
  extractLarkDocumentId,
  extractLarkDocumentUrl,
  extractLarkCliErrorMessage,
  findStandaloneFormulaBlocks,
  readAllLarkDocumentBlocks
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
    expect(buildLarkResolveDocumentArgs(url)).toEqual(expect.arrayContaining(['--api-version', 'v2']))

    const firstPage = buildLarkListBlocksArgs('doc-token')
    const nextPage = buildLarkListBlocksArgs('doc-token', 'next-token')
    expect(firstPage).toContain('GET')
    expect(firstPage).not.toContain('--page-all')
    expect(JSON.parse(firstPage[firstPage.indexOf('--params') + 1]!)).toEqual({
      document_revision_id: -1,
      page_size: 500
    })
    expect(JSON.parse(nextPage[nextPage.indexOf('--params') + 1]!)).toEqual({
      document_revision_id: -1,
      page_size: 500,
      page_token: 'next-token'
    })
  })

  it('reads every block page explicitly and passes the returned page token', async () => {
    const calls: string[][] = []
    const pages = [
      {
        code: 0,
        msg: 'success',
        data: {
          items: [{ block_id: 'first', block_type: 2, text: { elements: [] } }],
          has_more: true,
          page_token: 'page-2'
        }
      },
      {
        code: 0,
        msg: 'success',
        data: {
          items: [{ block_id: 'second', block_type: 16, equation: {} }],
          has_more: false
        }
      }
    ]

    const blocks = await readAllLarkDocumentBlocks('doc-token', async (args) => {
      calls.push(args)
      return pages[calls.length - 1]
    })

    expect(blocks.map((block) => block.block_id)).toEqual(['first', 'second'])
    expect(calls).toHaveLength(2)
    const secondParams = JSON.parse(calls[1]![calls[1]!.indexOf('--params') + 1]!)
    expect(secondParams.page_token).toBe('page-2')
  })

  it('fails closed on a later-page API error or invalid pagination response', async () => {
    const laterError = [
      { code: 0, data: { items: [], has_more: true, page_token: 'page-2' } },
      { code: 999, msg: 'permission denied' }
    ]
    let callCount = 0
    await expect(readAllLarkDocumentBlocks('doc-token', async () => laterError[callCount++]))
      .rejects.toThrow('permission denied')

    await expect(readAllLarkDocumentBlocks('doc-token', async () => ({ code: 0, data: { items: [] } })))
      .rejects.toThrow('响应结构无效')
    await expect(readAllLarkDocumentBlocks('doc-token', async () => ({
      code: 0,
      data: { items: [], has_more: true, page_token: 'same-token' }
    }))).rejects.toThrow('分页游标重复')
  })

  it('fails when explicit block pagination reaches the safety limit', async () => {
    let callCount = 0
    await expect(readAllLarkDocumentBlocks('doc-token', async () => {
      callCount += 1
      return { code: 0, data: { items: [], has_more: true, page_token: `page-${callCount}` } }
    })).rejects.toThrow('超过 100 页')
    expect(callCount).toBe(100)
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

  it('only builds the documented text-style update and rejects native Equation blocks', () => {
    const args = buildLarkCenterBatchArgs(
      'doc-token',
      [{ blockId: 'text', kind: 'text' }],
      'client-token'
    )
    const dataIndex = args.indexOf('--data')
    const body = JSON.parse(args[dataIndex + 1]!)

    expect(body).toEqual({
      requests: [{ block_id: 'text', update_text_style: { style: { align: 2 }, fields: [1] } }]
    })
    expect(() => buildLarkCenterBatchArgs(
      'doc-token',
      [{ blockId: 'equation', kind: 'equation', align: 1 }],
      'client-token'
    )).toThrow('已拒绝生成写请求')
  })

  it('extracts nested lark-cli errors', () => {
    expect(extractLarkCliErrorMessage({ ok: false, error: { message: 'permission denied' } })).toBe('permission denied')
  })

  it('reports submitted and verified counts when a later batch fails', () => {
    const formulas = [
      { blockId: 'a', kind: 'equation' as const, align: 1 },
      { blockId: 'b', kind: 'text' as const, align: 1 },
      { blockId: 'c', kind: 'equation' as const, align: 2 }
    ]
    const result = buildLarkCenterProgressResult(
      formulas,
      new Set(['b']),
      [
        { block_id: 'a', block_type: 16, equation: { style: { align: 1 } } },
        { block_id: 'b', block_type: 2, text: { style: { align: 2 }, elements: [{ equation: {} }] } },
        { block_id: 'c', block_type: 16, equation: { style: { align: 2 } } }
      ],
      '第二批请求失败。',
      'doc-token'
    )

    expect(result).toMatchObject({
      ok: false,
      status: 'partial',
      totalFormulaCount: 3,
      submittedFormulaCount: 1,
      updatedFormulaCount: 1,
      alreadyCenteredCount: 1,
      verifiedCenteredCount: 2,
      unsupportedFormulaCount: 1
    })
    expect(result.message).toContain('部分完成')
    expect(result.message).toContain('Equation')
    expect(result.message).toContain('已跳过')
  })

  it('requires a complete readback even when every recognized formula was already centered', () => {
    const formulas = [{ blockId: 'text', kind: 'text' as const, align: 2 }]
    const missingReadback = buildLarkCenterProgressResult(formulas, new Set(), [])
    const verifiedReadback = buildLarkCenterProgressResult(formulas, new Set(), [
      { block_id: 'text', block_type: 2, text: { style: { align: 2 }, elements: [{ equation: {} }] } }
    ])

    expect(missingReadback).toMatchObject({ ok: false, status: 'failed', verifiedCenteredCount: 0 })
    expect(verifiedReadback).toMatchObject({ ok: true, status: 'completed', verifiedCenteredCount: 1 })
  })

  it('does not report success when there are no recognized formulas', () => {
    expect(buildLarkCenterProgressResult([], new Set(), [])).toMatchObject({
      ok: false,
      status: 'failed',
      totalFormulaCount: 0,
      unsupportedFormulaCount: 0
    })
  })
})
