import { describe, expect, it } from 'vitest'
import { createSessionId, isValidSessionId } from './session-id'

describe('session identifiers', () => {
  it('accepts IDs generated from ISO timestamps including the trailing Z', () => {
    const id = createSessionId(new Date('2026-08-31T05:08:11.017Z'), '761e4d73')
    expect(id).toBe('session-2026-08-31T05-08-11-017Z-761e4d73')
    expect(isValidSessionId(id)).toBe(true)
  })

  it('rejects traversal and malformed identifiers', () => {
    expect(isValidSessionId('../session-2026-08-31T05-08-11-017Z-761e4d73')).toBe(false)
    expect(isValidSessionId('session-invalid-deadbeef')).toBe(false)
  })
})
