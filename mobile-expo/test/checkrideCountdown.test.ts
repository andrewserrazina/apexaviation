// Mobile parity (Phase 5, item 6): CheckrideCountdownCard ports web's
// renderCheckrideCountdown() day-math from site/portal-stable.js. These
// are real executions of the pure logic, not a source scan.
import { countdownLabel, daysUntil, parseDateParts, urgencyBand } from '../lib/checkrideCountdown'

function isoDateDaysFromNow(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('daysUntil / urgencyBand / countdownLabel', () => {
  it('reports 0 days and the "today" band/label for today', () => {
    const days = daysUntil(isoDateDaysFromNow(0))
    expect(days).toBe(0)
    expect(urgencyBand(days)).toBe('today')
    expect(countdownLabel(days)).toBe('Checkride is today!')
  })

  it('reports a negative count and the "past" band/label for a past date', () => {
    const days = daysUntil(isoDateDaysFromNow(-3))
    expect(days).toBeLessThan(0)
    expect(urgencyBand(days)).toBe('past')
    expect(countdownLabel(days)).toBe('Checkride day has passed')
  })

  it('bands 1-7 days out as urgent', () => {
    const days = daysUntil(isoDateDaysFromNow(5))
    expect(urgencyBand(days)).toBe('urgent')
    expect(countdownLabel(days)).toBe('5 Days Until Checkride')
  })

  it('singularizes "1 Day" (not "1 Days")', () => {
    const days = daysUntil(isoDateDaysFromNow(1))
    expect(countdownLabel(days)).toBe('1 Day Until Checkride')
  })

  it('bands 8-30 days out as soon, and beyond 30 as normal', () => {
    expect(urgencyBand(daysUntil(isoDateDaysFromNow(20)))).toBe('soon')
    expect(urgencyBand(daysUntil(isoDateDaysFromNow(60)))).toBe('normal')
  })
})

describe('parseDateParts', () => {
  it('accepts a real, plausible calendar date', () => {
    expect(parseDateParts('2026', '6', '15')).toBe('2026-06-15')
    expect(parseDateParts('2026', '06', '05')).toBe('2026-06-05')
  })

  it('rejects an impossible calendar date (Feb 30) rather than silently rolling it over to March', () => {
    expect(parseDateParts('2026', '02', '30')).toBeNull()
  })

  it('rejects a month or day out of range', () => {
    expect(parseDateParts('2026', '13', '01')).toBeNull()
    expect(parseDateParts('2026', '01', '32')).toBeNull()
    expect(parseDateParts('2026', '00', '15')).toBeNull()
  })

  it('rejects incomplete input', () => {
    expect(parseDateParts('', '6', '15')).toBeNull()
    expect(parseDateParts('2026', '', '15')).toBeNull()
    expect(parseDateParts('2026', '6', '')).toBeNull()
    expect(parseDateParts('26', '6', '15')).toBeNull()
  })
})
