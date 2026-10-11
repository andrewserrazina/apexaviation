// Pure formatting for a mm:ss countdown clock -- used by DPE Rapid Fire's
// session timer (Phase 5, item 5). Extracted so it's testable directly.
export function formatCountdownClock(remainingSeconds: number): string {
  const clamped = Math.max(0, Math.round(remainingSeconds))
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
