// A proper canonical UUID v4, ported from site/portal-stable.js's own
// generateUuidV4() so both platforms mint idempotency keys the same way
// for record_review_outcome()'s uuid-typed parameter. Prefers
// crypto.randomUUID() (available in this RN/Hermes runtime, same as
// lib/largeSecureStore.ts's existing crypto.getRandomValues() usage);
// falls back to crypto.getRandomValues(), then Math.random() only as a
// last resort, but always emits valid RFC 4122 v4 formatting either way.
export function generateReviewIdempotencyKey(): string {
  const g = globalThis as unknown as { crypto?: Crypto }
  if (g.crypto && typeof (g.crypto as { randomUUID?: () => string }).randomUUID === 'function') {
    return (g.crypto as { randomUUID: () => string }).randomUUID()
  }

  const bytes = new Array<number>(16)
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(16)
    g.crypto.getRandomValues(arr)
    for (let i = 0; i < 16; i++) bytes[i] = arr[i]
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.map((b) => ('0' + b.toString(16)).slice(-2))
  return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('')
}
