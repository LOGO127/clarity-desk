import type { LarkWriteInput } from '../shared/types'

type JsonRecord = Record<string, unknown>

export type StandaloneFormulaBlock = {
  blockId: string
  kind: 'equation' | 'text'
  align?: number
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function quoteForWindowsCmd(argument: string): string {
  if (/[\r\n&|<>^%!]/.test(argument)) throw new Error('命令参数包含不安全字符。')
  return `"${argument.replaceAll('"', '""')}"`
}

export function buildLarkWindowsCommand(executable: string, args: string[]): string {
  const command = [quoteForWindowsCmd(executable), ...args.map(quoteForWindowsCmd)].join(' ')
  return `"${command}"`
}

function findString(value: unknown, keys: ReadonlySet<string>): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findString(item, keys)
      if (match) return match
    }
    return undefined
  }
  if (!isRecord(value)) return undefined

  for (const [key, item] of Object.entries(value)) {
    if (keys.has(key) && typeof item === 'string' && item.length > 0) return item
  }
  for (const item of Object.values(value)) {
    const match = findString(item, keys)
    if (match) return match
  }
  return undefined
}

export function buildLarkWriteArgs(input: LarkWriteInput): string[] {
  const common = ['--api-version', 'v2', '--as', 'user']
  if (input.mode === 'create') {
    return ['docs', '+create', ...common, '--content', '@content.xml', '--format', 'json']
  }
  return [
    'docs',
    '+update',
    ...common,
    '--doc',
    input.docUrl!,
    '--command',
    input.mode,
    '--content',
    '@content.xml',
    '--format',
    'json'
  ]
}

export function buildLarkResolveDocumentArgs(docUrl: string): string[] {
  return [
    'docs',
    '+fetch',
    '--as',
    'user',
    '--doc',
    docUrl,
    '--scope',
    'outline',
    '--max-depth',
    '1',
    '--detail',
    'with-ids',
    '--format',
    'json'
  ]
}

export function buildLarkListBlocksArgs(documentId: string): string[] {
  return [
    'api',
    'GET',
    `/open-apis/docx/v1/documents/${documentId}/blocks`,
    '--as',
    'user',
    '--params',
    JSON.stringify({ document_revision_id: -1 }),
    '--page-all',
    '--page-limit',
    '100',
    '--page-size',
    '500',
    '--format',
    'json'
  ]
}

export function buildLarkCenterBatchArgs(
  documentId: string,
  formulas: StandaloneFormulaBlock[],
  clientToken: string
): string[] {
  const requests = formulas.map((formula) => ({
    block_id: formula.blockId,
    ...(formula.kind === 'equation'
      ? { update_text: { style: { align: 2 }, fields: [1] } }
      : { update_text_style: { style: { align: 2 }, fields: [1] } })
  }))

  return [
    'api',
    'PATCH',
    `/open-apis/docx/v1/documents/${documentId}/blocks/batch_update`,
    '--as',
    'user',
    '--params',
    JSON.stringify({ document_revision_id: -1, client_token: clientToken }),
    '--data',
    JSON.stringify({ requests }),
    '--format',
    'json'
  ]
}

export function extractLarkDocumentUrl(value: unknown): string | undefined {
  return findString(value, new Set(['url', 'document_url']))
}

export function extractLarkDocumentId(value: unknown): string | undefined {
  return findString(value, new Set(['document_id']))
}

function isBlock(value: unknown): value is JsonRecord {
  return isRecord(value) && typeof value.block_id === 'string' && typeof value.block_type === 'number'
}

export function extractLarkDocumentBlocks(value: unknown): JsonRecord[] {
  const blocks = new Map<string, JsonRecord>()

  function visit(item: unknown): void {
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (!isRecord(item)) return
    if (isBlock(item)) blocks.set(item.block_id as string, item)
    Object.values(item).forEach(visit)
  }

  visit(value)
  return [...blocks.values()]
}

function styleAlign(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.style)) return undefined
  return typeof value.style.align === 'number' ? value.style.align : undefined
}

function isWhitespaceTextElement(element: unknown): boolean {
  if (!isRecord(element) || !isRecord(element.text_run)) return false
  return typeof element.text_run.content === 'string' && element.text_run.content.trim().length === 0
}

function isEquationElement(element: unknown): boolean {
  return isRecord(element) && isRecord(element.equation)
}

export function classifyStandaloneFormulaBlock(block: JsonRecord): StandaloneFormulaBlock | null {
  if (typeof block.block_id !== 'string') return null

  if (block.block_type === 16 && isRecord(block.equation)) {
    return { blockId: block.block_id, kind: 'equation', align: styleAlign(block.equation) }
  }

  if (block.block_type !== 2 || !isRecord(block.text) || !Array.isArray(block.text.elements)) return null
  const meaningfulElements = block.text.elements.filter((element) => !isWhitespaceTextElement(element))
  if (meaningfulElements.length === 0 || !meaningfulElements.every(isEquationElement)) return null

  return { blockId: block.block_id, kind: 'text', align: styleAlign(block.text) }
}

export function findStandaloneFormulaBlocks(value: unknown): StandaloneFormulaBlock[] {
  return extractLarkDocumentBlocks(value)
    .map(classifyStandaloneFormulaBlock)
    .filter((formula): formula is StandaloneFormulaBlock => formula !== null)
}

export function extractLarkAuthFlow(value: unknown): { verificationUrl?: string; deviceCode?: string } {
  return {
    verificationUrl: findString(value, new Set(['verification_url', 'verification_uri_complete', 'verification_uri'])),
    deviceCode: findString(value, new Set(['device_code']))
  }
}
