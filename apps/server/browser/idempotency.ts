export function idempotencyKey(): string {
  const crypto = globalThis.crypto
  if (crypto != null) {
    try {
      if (typeof crypto.randomUUID == 'function') return crypto.randomUUID()
    } catch {}
    if (typeof crypto.getRandomValues == 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
      const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
