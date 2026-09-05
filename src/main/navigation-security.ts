export function normalizedDocumentUrl(value: string): string | null {
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    return url.toString()
  } catch {
    return null
  }
}

export function isTrustedRendererUrl(candidate: string, trustedRendererUrl: string | null): boolean {
  if (!trustedRendererUrl) return false
  return normalizedDocumentUrl(candidate) === normalizedDocumentUrl(trustedRendererUrl)
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function isTrustedIpcContext(input: {
  senderUrl: string
  trustedRendererUrl: string | null
  ownsWebContents: boolean
  isMainFrame: boolean
}): boolean {
  return input.ownsWebContents && input.isMainFrame && isTrustedRendererUrl(input.senderUrl, input.trustedRendererUrl)
}
