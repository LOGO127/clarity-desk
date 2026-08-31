import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { FormulaDocumentStats } from '../../../shared/types'

interface MarkdownNode {
  type: string
  value?: string
  depth?: number
  ordered?: boolean
  url?: string
  alt?: string
  lang?: string | null
  align?: Array<'left' | 'right' | 'center' | null>
  children?: MarkdownNode[]
}

export interface FormulaConversionResult {
  normalizedMarkdown: string
  xml: string
  stats: FormulaDocumentStats
}

export function normalizeMathDelimiters(markdown: string): string {
  const normalized = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return normalized
    .replace(/^\s*\\\[\s*$/gm, () => '$$')
    .replace(/^\s*\\\]\s*$/gm, () => '$$')
    .replace(/\\\[([^\n]+?)\\\]/g, (_match, formula: string) => `$$\n${formula.trim()}\n$$`)
    .replace(/\\\(([^\n]+?)\\\)/g, (_match, formula: string) => `$${formula.trim()}$`)
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeXml(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function safeUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : null
  } catch {
    return null
  }
}

interface InlineContext {
  href?: string
  strong?: boolean
  emphasis?: boolean
  deleted?: boolean
}

function wrapInline(content: string, context: InlineContext): string {
  let result = content
  if (context.deleted) result = `<del>${result}</del>`
  if (context.emphasis) result = `<em>${result}</em>`
  if (context.strong) result = `<b>${result}</b>`
  if (context.href) result = `<a href="${escapeAttribute(context.href)}">${result}</a>`
  return result
}

function renderInline(node: MarkdownNode, context: InlineContext = {}): string {
  const children = (next = context) => (node.children ?? []).map((child) => renderInline(child, next)).join('')
  switch (node.type) {
    case 'text':
      return wrapInline(escapeXml(node.value ?? ''), context)
    case 'strong':
      return children({ ...context, strong: true })
    case 'emphasis':
      return children({ ...context, emphasis: true })
    case 'delete':
      return children({ ...context, deleted: true })
    case 'inlineCode':
      return wrapInline(`<code>${escapeXml(node.value ?? '')}</code>`, context)
    case 'inlineMath':
      return wrapInline(`<latex>${escapeXml(node.value?.trim() ?? '')}</latex>`, context)
    case 'link': {
      const url = safeUrl(node.url)
      return url ? children({ ...context, href: url }) : children()
    }
    case 'image': {
      const url = safeUrl(node.url)
      return url
        ? wrapInline(`<img href="${escapeAttribute(url)}" caption="${escapeAttribute(node.alt ?? '')}"/>`, context)
        : ''
    }
    case 'break':
      return wrapInline('<br/>', context)
    case 'html':
      return wrapInline(escapeXml(node.value ?? ''), context)
    default:
      return node.value ? wrapInline(escapeXml(node.value), context) : children()
  }
}

function renderTable(node: MarkdownNode): string {
  const rows = node.children ?? []
  if (rows.length === 0) return ''
  const renderRow = (row: MarkdownNode, header: boolean) => {
    const tag = header ? 'th' : 'td'
    const attributes = header ? ' background-color="light-gray"' : ''
    return `<tr>${(row.children ?? [])
      .map((cell) => `<${tag}${attributes}>${(cell.children ?? []).map((child) => renderInline(child)).join('')}</${tag}>`)
      .join('')}</tr>`
  }
  const [head, ...body] = rows
  return `<table><thead>${head ? renderRow(head, true) : ''}</thead><tbody>${body
    .map((row) => renderRow(row, false))
    .join('')}</tbody></table>`
}

function renderListItem(node: MarkdownNode, ordered: boolean): string {
  const parts = (node.children ?? []).map((child) => {
    if (child.type === 'paragraph') return (child.children ?? []).map((item) => renderInline(item)).join('')
    return renderBlock(child)
  })
  return `<li${ordered ? ' seq="auto"' : ''}>${parts.join('')}</li>`
}

function renderBlock(node: MarkdownNode): string {
  switch (node.type) {
    case 'heading': {
      const depth = Math.min(9, Math.max(1, node.depth ?? 1))
      return `<h${depth}>${(node.children ?? []).map((child) => renderInline(child)).join('')}</h${depth}>`
    }
    case 'paragraph':
      return `<p>${(node.children ?? []).map((child) => renderInline(child)).join('')}</p>`
    case 'math':
      return `<p align="center"><latex>${escapeXml(node.value?.trim() ?? '')}</latex></p>`
    case 'code':
      return `<pre lang="${escapeAttribute(node.lang || 'text')}"><code>${escapeXml(node.value ?? '')}</code></pre>`
    case 'blockquote':
      return `<blockquote>${(node.children ?? []).map(renderBlock).join('')}</blockquote>`
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul'
      return `<${tag}>${(node.children ?? []).map((item) => renderListItem(item, Boolean(node.ordered))).join('')}</${tag}>`
    }
    case 'thematicBreak':
      return '<hr/>'
    case 'table':
      return renderTable(node)
    case 'html':
      return `<p>${escapeXml(node.value ?? '')}</p>`
    default:
      return (node.children ?? []).map(renderBlock).join('')
  }
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function parse(markdown: string): MarkdownNode {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(markdown) as MarkdownNode
}

export function convertMarkdownForLark(markdown: string, title?: string): FormulaConversionResult {
  const normalizedMarkdown = normalizeMathDelimiters(markdown)
  const root = parse(normalizedMarkdown)
  const stats: FormulaDocumentStats = { displayFormulaCount: 0, inlineFormulaCount: 0, blockCount: 0 }
  walk(root, (node) => {
    if (node.type === 'math') stats.displayFormulaCount += 1
    if (node.type === 'inlineMath') stats.inlineFormulaCount += 1
    if (['paragraph', 'heading', 'math', 'code', 'blockquote', 'list', 'table', 'thematicBreak'].includes(node.type)) {
      stats.blockCount += 1
    }
  })
  const titleXml = title?.trim() ? `<title>${escapeXml(title.trim())}</title>\n\n` : ''
  const xml = `${titleXml}${(root.children ?? []).map(renderBlock).filter(Boolean).join('\n\n')}\n`
  return { normalizedMarkdown, xml, stats }
}

export function suggestDocumentTitle(markdown: string): string {
  const match = normalizeMathDelimiters(markdown).match(/^#\s+(.+)$/m)
  return match?.[1]?.replace(/[*_`]/g, '').trim().slice(0, 80) || 'AI 整理文档'
}
