import type { LarkWriteInput } from '../shared/types'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

export function extractLarkDocumentUrl(value: unknown): string | undefined {
  return findString(value, new Set(['url', 'document_url']))
}

export function extractLarkAuthFlow(value: unknown): { verificationUrl?: string; deviceCode?: string } {
  return {
    verificationUrl: findString(value, new Set(['verification_url', 'verification_uri_complete', 'verification_uri'])),
    deviceCode: findString(value, new Set(['device_code']))
  }
}
