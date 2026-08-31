import { describe, expect, it } from 'vitest'
import { convertMarkdownForLark, normalizeMathDelimiters, suggestDocumentTitle } from './formula-document'

describe('formula document conversion', () => {
  it('centers display math while preserving inline math', () => {
    const result = convertMarkdownForLark('正文 $E=mc^2$。\n\n$$\na^2+b^2=c^2\n$$')
    expect(result.xml).toContain('<p>正文 <latex>E=mc^2</latex>。</p>')
    expect(result.xml).toContain('<p align="center"><latex>a^2+b^2=c^2</latex></p>')
    expect(result.stats).toMatchObject({ displayFormulaCount: 1, inlineFormulaCount: 1 })
  })

  it('normalizes bracket display delimiters', () => {
    expect(normalizeMathDelimiters('\\[\nx+y\n\\]')).toBe('$$\nx+y\n$$')
    expect(normalizeMathDelimiters('正文 \\(x+y\\)')).toBe('正文 $x+y$')
  })

  it('converts common markdown structures', () => {
    const result = convertMarkdownForLark('# 标题\n\n- **重点**\n- `代码`\n\n| A | B |\n|---|---|\n| 1 | 2 |')
    expect(result.xml).toContain('<h1>标题</h1>')
    expect(result.xml).toContain('<ul><li><b>重点</b></li><li><code>代码</code></li></ul>')
    expect(result.xml).toContain('<table>')
    expect(result.xml).toContain('<th background-color="light-gray">A</th>')
  })

  it('uses valid ordered-list and canonical rich-text nesting', () => {
    const result = convertMarkdownForLark('1. 第一项\n2. 第二项\n\n[***重点***](https://example.com)')
    expect(result.xml).toContain('<ol><li seq="auto">第一项</li><li seq="auto">第二项</li></ol>')
    expect(result.xml).toContain('<a href="https://example.com"><b><em>重点</em></b></a>')
  })

  it('escapes raw HTML instead of injecting it', () => {
    const result = convertMarkdownForLark('<script>alert(1)</script>')
    expect(result.xml).not.toContain('<script>')
    expect(result.xml).toContain('&lt;script&gt;')
  })

  it('suggests a title from the first heading', () => {
    expect(suggestDocumentTitle('# **面试**复盘\n内容')).toBe('面试复盘')
  })
})
