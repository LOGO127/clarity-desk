import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl, isTrustedIpcContext, isTrustedRendererUrl, normalizedDocumentUrl } from './navigation-security'

describe('renderer navigation security', () => {
  it('accepts only the configured renderer document while ignoring its hash and query', () => {
    const trusted = 'file:///C:/Program%20Files/Clarity/resources/app.asar/out/renderer/index.html'
    expect(isTrustedRendererUrl(`${trusted}?page=formula#top`, trusted)).toBe(true)
    expect(isTrustedRendererUrl('file:///C:/Windows/System32/index.html', trusted)).toBe(false)
    expect(isTrustedRendererUrl('https://attacker.example/', trusted)).toBe(false)
  })

  it('allows only HTTPS links to leave the app', () => {
    expect(isSafeExternalUrl('https://open.feishu.cn/document')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(false)
    expect(isSafeExternalUrl('file:///C:/secret.txt')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects malformed URLs deterministically', () => {
    expect(normalizedDocumentUrl('not a URL')).toBeNull()
    expect(isTrustedRendererUrl('not a URL', 'file:///app/index.html')).toBe(false)
  })

  it('requires the owning webContents and top frame for IPC access', () => {
    const trustedRendererUrl = 'file:///C:/app/index.html'
    const base = { senderUrl: trustedRendererUrl, trustedRendererUrl, ownsWebContents: true, isMainFrame: true }
    expect(isTrustedIpcContext(base)).toBe(true)
    expect(isTrustedIpcContext({ ...base, ownsWebContents: false })).toBe(false)
    expect(isTrustedIpcContext({ ...base, isMainFrame: false })).toBe(false)
    expect(isTrustedIpcContext({ ...base, senderUrl: 'https://example.com/' })).toBe(false)
  })
})
