import { useCallback, useEffect, useState } from 'react'
import type { MobileBootstrapDTO } from '../../shared/mobile-dto'
import { fetchDailyDrill } from '../lib/api/dailyDrill'
import { ApiError, logDevError } from '../lib/api/errors'

type TodaysDrill = MobileBootstrapDTO['home']['todays_drill']

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
// rather than unconditionally re-fetching what bootstrap already gave us.
export function useHomeDrill(bootstrapDrill: TodaysDrill): UseHomeDrillResult {
  const [drill, setDrill] = useState<TodaysDrill>(bootstrapDrill)
  const [loading, setLoading] = useState(!bootstrapDrill)
  const [error, setError] = useState<ApiError | null>(null)

  const fetchIfNeeded = useCallback(async () => {
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
  }, [bootstrapDrill])

  useEffect(() => {
    fetchIfNeeded()
  }, [fetchIfNeeded])

  return { drill, loading, error, retry: fetchIfNeeded }
}
