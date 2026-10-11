import { useEffect, useRef, useState } from 'react'

interface UseCountdownTimerResult {
  remainingSeconds: number
  expired: boolean
}

// Phase 5 (mobile parity), item 5: a plain ticking countdown for DPE
// Rapid Fire's session timer. Deliberately dumb -- it only tracks time
// remaining and whether it's hit zero; it never submits, navigates, or
// otherwise acts on expiry itself (see app/(app)/practice/session/
// [sessionId].tsx's own comment on why time running out must never
// force-submit a partial session). `enabled=false` freezes the clock
// rather than resetting it, so pausing while e.g. bootstrap re-validates
// doesn't lose progress toward zero.
export function useCountdownTimer(totalSeconds: number, enabled: boolean): UseCountdownTimerResult {
  const [remainingSeconds, setRemainingSeconds] = useState(totalSeconds)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    const interval = setInterval(() => {
      if (!enabledRef.current) return
      setRemainingSeconds((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(interval)
    // Intentionally runs once per mount -- totalSeconds is this timer's
    // starting point, not something a re-render should reset it to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { remainingSeconds, expired: remainingSeconds <= 0 }
}
