import type { LarkCenterFormulasResult, LarkWriteInput } from '../shared/types'

type JsonRecord = Record<string, unknown>

const MAX_LARK_BLOCK_PAGES = 100

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
    '--api-version',
    'v2',
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

export function buildLarkListBlocksArgs(documentId: string, pageToken?: string): string[] {
  const params: Record<string, string | number> = {
    document_revision_id: -1,
    page_size: 500
  }
  if (pageToken) params.page_token = pageToken

  return [
    'api',
    'GET',
    `/open-apis/docx/v1/documents/${documentId}/blocks`,
    '--as',
    'user',
    '--params',
    JSON.stringify(params),
    '--format',
    'json'
  ]
}

export async function readAllLarkDocumentBlocks(
  documentId: string,
  runRequest: (args: string[]) => Promise<unknown>
): Promise<JsonRecord[]> {
  const blocks: JsonRecord[] = []
  const seenPageTokens = new Set<string>()
  let pageToken: string | undefined

  for (let pageIndex = 0; pageIndex < MAX_LARK_BLOCK_PAGES; pageIndex += 1) {
    const page = await runRequest(buildLarkListBlocksArgs(documentId, pageToken))
    if (!isRecord(page)) throw new Error(`飞书文档块第 ${pageIndex + 1} 页响应不是对象。`)
    if (page.ok === false) {
      throw new Error(extractLarkCliErrorMessage(page) ?? `飞书文档块第 ${pageIndex + 1} 页请求失败。`)
    }
    if ('code' in page) {
      if (typeof page.code !== 'number' || page.code !== 0) {
        throw new Error(extractLarkCliErrorMessage(page) ?? `飞书文档块第 ${pageIndex + 1} 页返回错误码。`)
      }
    } else if (page.ok !== true) {
      throw new Error(`飞书文档块第 ${pageIndex + 1} 页缺少成功状态。`)
    }

    if (!isRecord(page.data) || !Array.isArray(page.data.items) || typeof page.data.has_more !== 'boolean') {
      throw new Error(`飞书文档块第 ${pageIndex + 1} 页响应结构无效。`)
    }
    for (const item of page.data.items) {
      if (!isBlock(item)) throw new Error(`飞书文档块第 ${pageIndex + 1} 页包含无效块。`)
      blocks.push(item)
    }

    if (!page.data.has_more) return blocks
    const nextPageToken = page.data.page_token
    if (typeof nextPageToken !== 'string' || nextPageToken.length === 0) {
      throw new Error(`飞书文档块第 ${pageIndex + 1} 页缺少下一页游标。`)
    }
    if (seenPageTokens.has(nextPageToken)) throw new Error('飞书文档块分页游标重复，已停止以避免遗漏或循环。')
    seenPageTokens.add(nextPageToken)
    pageToken = nextPageToken
  }

  throw new Error(`飞书文档块超过 ${MAX_LARK_BLOCK_PAGES} 页，无法确认已读完整文档。`)
}

export function buildLarkCenterBatchArgs(
  documentId: string,
  formulas: StandaloneFormulaBlock[],
  clientToken: string
): string[] {
  if (formulas.some((formula) => formula.kind === 'equation')) {
    throw new Error('原生 Equation 公式块没有已验证的样式更新契约，已拒绝生成写请求。')
  }

  const requests = formulas.map((formula) => ({
    block_id: formula.blockId,
    update_text_style: { style: { align: 2 }, fields: [1] }
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

export function extractLarkCliErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.message === 'string' && value.message.trim()) return value.message.trim()
  if (typeof value.msg === 'string' && value.msg.trim()) return value.msg.trim()
  if (isRecord(value.error) && typeof value.error.message === 'string' && value.error.message.trim()) {
    return value.error.message.trim()
  }
  return undefined
}

export function buildLarkCenterProgressResult(
  formulas: ReadonlyArray<StandaloneFormulaBlock>,
  submittedBlockIds: ReadonlySet<string>,
  verifiedResponse?: unknown,
  failureMessage?: string,
  documentId?: string
): LarkCenterFormulasResult {
  const alreadyCentered = formulas.filter((formula) => formula.align === 2)
  const pending = formulas.filter((formula) => formula.kind === 'text' && formula.align !== 2)
  const unsupported = formulas.filter((formula) => formula.kind === 'equation' && formula.align !== 2)
  const submittedFormulaCount = pending.filter((formula) => submittedBlockIds.has(formula.blockId)).length
  const verified = verifiedResponse === undefined ? [] : findStandaloneFormulaBlocks(verifiedResponse)
  const verifiedById = new Map(verified.map((formula) => [formula.blockId, formula.align]))
  const updatedFormulaCount = pending.filter((formula) => verifiedById.get(formula.blockId) === 2).length
  const verifiedCenteredCount = formulas.filter((formula) => verifiedById.get(formula.blockId) === 2).length
  const completed = formulas.length > 0
    && !failureMessage
    && unsupported.length === 0
    && verifiedCenteredCount === formulas.length
  const status: LarkCenterFormulasResult['status'] = completed
    ? 'completed'
    : submittedFormulaCount > 0 || updatedFormulaCount > 0
      ? 'partial'
      : 'failed'

  let message: string
  if (completed) {
    message = pending.length > 0
      ? `已将 ${pending.length} 个独立公式居中，并完成回读校验。`
      : '文档中的独立公式已经全部居中。'
  } else if (formulas.length === 0) {
    message = failureMessage ?? '没有找到可识别的独占公式，未执行修改。'
  } else if (unsupported.length > 0) {
    const progress = pending.length > 0
      ? `可安全处理的公式已提交 ${submittedFormulaCount}/${pending.length} 个，回读确认 ${updatedFormulaCount}/${pending.length} 个。`
      : ''
    const unsupportedMessage = `检测到 ${unsupported.length} 个未居中的原生 Equation 公式块；该类型没有已验证的样式更新契约，已跳过且未重写内容。`
    message = `${status === 'partial' ? '操作部分完成：' : '未完成公式居中：'}${progress}${unsupportedMessage}${failureMessage ? ` ${failureMessage}` : ''}`
  } else if (status === 'partial') {
    const progress = `已提交 ${submittedFormulaCount}/${pending.length} 个，回读确认 ${updatedFormulaCount}/${pending.length} 个。`
    message = `操作部分完成：${progress}${failureMessage ? ` ${failureMessage}` : ' 可安全重试剩余公式。'}`
  } else {
    message = failureMessage ?? `回读仅确认 ${verifiedCenteredCount}/${formulas.length} 个独占公式居中，未报告成功。`
  }

  return {
    ok: status === 'completed',
    status,
    message,
    totalFormulaCount: formulas.length,
    submittedFormulaCount,
    updatedFormulaCount,
    alreadyCenteredCount: alreadyCentered.length,
    verifiedCenteredCount,
    unsupportedFormulaCount: unsupported.length,
    documentId
  }
}

export function extractLarkAuthFlow(value: unknown): { verificationUrl?: string; deviceCode?: string } {
  return {
    verificationUrl: findString(value, new Set(['verification_url', 'verification_uri_complete', 'verification_uri'])),
    deviceCode: findString(value, new Set(['device_code']))
  }
}
