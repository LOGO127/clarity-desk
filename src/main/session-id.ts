export const SESSION_ID_PATTERN = /^session-[0-9TZ-]+-[a-f0-9]{8}$/

export function createSessionId(date: Date, entropy: string): string {
  if (!/^[a-f0-9]{8}$/i.test(entropy)) throw new Error('Session entropy must be eight hexadecimal characters.')
  const datePart = date.toISOString().replaceAll(':', '-').replace('.', '-')
  return `session-${datePart}-${entropy.toLowerCase()}`
}

export function isValidSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value)
}
