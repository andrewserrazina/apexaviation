import { useCallback, useEffect, useState } from 'react'
import type { MobileBootstrapDTO } from '../../shared/mobile-dto'
import { fetchDailyDrill } from '../lib/api/dailyDrill'
import { ApiError, logDevError } from '../lib/api/errors'

type TodaysDrill = MobileBootstrapDTO['home']['todays_drill']

interface UseHomeDrillOptions {
  // Gate on bootstrap having resolved AND the learner being entitled --
  // this hook must never call mobile-daily-drill while bootstrap is
  // still loading (entitlement isn't known yet) or once bootstrap has
  // confirmed the learner lacks Checkride Prep access (Sprint 1A Rev2
  // section 2).
  enabled: boolean
}

interface UseHomeDrillResult {
  drill: TodaysDrill
  loading: boolean
  error: ApiError | null
  retry: () => void
}

// Sprint 1A section 8E: "If bootstrap already contains today's drill:
// render it. If bootstrap has no drill: call mobile-daily-drill default
// action to fetch/create it." This hook is exactly that branch -- it only
// calls mobile-daily-drill when bootstrap's own todays_drill is null,
// rather than unconditionally re-fetching what bootstrap already gave us
// -- and, per Rev2 section 2, only once `enabled` says bootstrap has
// actually resolved and the learner is entitled.
export function useHomeDrill(bootstrapDrill: TodaysDrill, { enabled }: UseHomeDrillOptions): UseHomeDrillResult {
  const [drill, setDrill] = useState<TodaysDrill>(enabled ? bootstrapDrill : null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const fetchIfNeeded = useCallback(async () => {
    if (!enabled) {
      // Not ready to know yet (bootstrap still loading) or the learner
      // isn't entitled -- never fetch/create a Daily Drill in either
      // case.
      setDrill(null)
      setLoading(false)
      setError(null)
      return
    }
    if (bootstrapDrill) {
      setDrill(bootstrapDrill)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchDailyDrill()
      setDrill({
        id: result.drill.id,
        status: result.drill.status,
        estimated_minutes: result.drill.estimated_minutes,
        target_acs_tasks: result.drill.target_acs_tasks,
      })
    } catch (err) {
      logDevError('useHomeDrill', err)
      setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load today’s drill.' }))
    } finally {
      setLoading(false)
    }
  }, [enabled, bootstrapDrill])

  useEffect(() => {
    fetchIfNeeded()
  }, [fetchIfNeeded])

  return { drill, loading, error, retry: fetchIfNeeded }
}
