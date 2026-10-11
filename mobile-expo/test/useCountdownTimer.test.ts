// Phase 5 (mobile parity), item 5: DPE Rapid Fire's countdown hook.
// Real executions against fake timers, matching this codebase's own
// useGuidedNotes.test.tsx convention for timer-driven hooks.
import { act, renderHook } from '@testing-library/react-native'
import { useCountdownTimer } from '../hooks/useCountdownTimer'

describe('useCountdownTimer', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('starts at totalSeconds and is not expired', async () => {
    const { result } = await renderHook(() => useCountdownTimer(10, true))
    expect(result.current.remainingSeconds).toBe(10)
    expect(result.current.expired).toBe(false)
  })

  it('ticks down by one second per second while enabled', async () => {
    jest.useFakeTimers()
    const { result } = await renderHook(() => useCountdownTimer(10, true))

    await act(async () => {
      jest.advanceTimersByTime(3000)
    })

    expect(result.current.remainingSeconds).toBe(7)
    expect(result.current.expired).toBe(false)
  })

  it('stops at 0 and reports expired, never going negative', async () => {
    jest.useFakeTimers()
    const { result } = await renderHook(() => useCountdownTimer(3, true))

    await act(async () => {
      jest.advanceTimersByTime(10_000)
    })

    expect(result.current.remainingSeconds).toBe(0)
    expect(result.current.expired).toBe(true)
  })

  it('freezes the clock while disabled rather than resetting it', async () => {
    jest.useFakeTimers()
    const { result } = await renderHook(() => useCountdownTimer(10, false))

    await act(async () => {
      jest.advanceTimersByTime(5000)
    })

    expect(result.current.remainingSeconds).toBe(10)
  })
})
