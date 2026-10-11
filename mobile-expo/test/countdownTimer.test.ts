// Phase 5 (mobile parity), item 5: DPE Rapid Fire's countdown clock
// formatting. Real executions of the pure function.
import { formatCountdownClock } from '../lib/countdownTimer'

describe('formatCountdownClock', () => {
  it('formats minutes and seconds as m:ss', () => {
    expect(formatCountdownClock(300)).toBe('5:00')
    expect(formatCountdownClock(65)).toBe('1:05')
    expect(formatCountdownClock(9)).toBe('0:09')
  })

  it('clamps negative input to 0:00 rather than showing a negative clock', () => {
    expect(formatCountdownClock(-5)).toBe('0:00')
  })

  it('rounds a fractional number of seconds', () => {
    expect(formatCountdownClock(59.6)).toBe('1:00')
  })
})
