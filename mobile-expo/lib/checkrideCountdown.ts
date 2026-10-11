// Pure day-math/validation for CheckrideCountdownCard, extracted so it can
// be tested directly rather than through simulated TextInput typing (this
// project's jest-expo/@testing-library/react-native setup does not commit
// state updates from fireEvent.changeText -- see test/SignUpScreen.test.tsx's
// own comment on this environment limitation). Mirrors web's
// renderCheckrideCountdown() in site/portal-stable.js exactly.

export type CheckrideUrgencyBand = 'past' | 'today' | 'urgent' | 'soon' | 'normal'

// Returns a 'YYYY-MM-DD' string only for a real, plausible calendar date --
// never a value that round-trips through Date() into a different day (the
// classic "Feb 30" silent-rollover bug), since that would silently save
// the wrong date.
export function parseDateParts(year: string, month: string, day: string): string | null {
  if (year.length !== 4 || month.length === 0 || day.length === 0) return null
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function daysUntil(checkrideDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${checkrideDate}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export function urgencyBand(days: number): CheckrideUrgencyBand {
  if (days < 0) return 'past'
  if (days === 0) return 'today'
  if (days <= 7) return 'urgent'
  if (days <= 30) return 'soon'
  return 'normal'
}

export function countdownLabel(days: number): string {
  if (days < 0) return 'Checkride day has passed'
  if (days === 0) return 'Checkride is today!'
  return `${days} Day${days === 1 ? '' : 's'} Until Checkride`
}
