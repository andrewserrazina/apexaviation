import { useCallback, useEffect, useState } from 'react'
import type { MobileDailyDrillResponse } from '../../shared/mobile-dto'
import { fetchDailyDrill } from '../lib/api/dailyDrill'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseDailyDrillOptions {
  // Same gate as useHomeDrill's `enabled` -- must be false until
  // bootstrap has resolved and confirmed the learner is entitled, so an
  // unentitled learner opening the Practice tab never generates a
  // mobile-daily-drill request (Sprint 1A Rev2 section 3).
  enabled: boolean
}

interface UseDailyDrillResult {
  data: MobileDailyDrillResponse | null
  loading: boolean
  error: ApiError | null
  refetch: () => Promise<void>
}

// The Practice tab's Today's Drill card. Per Sprint 1A section 8E: if
// mobile-bootstrap already told us about today's drill, this still needs
// to be called exactly once to get session_id/questions (bootstrap's
// todays_drill shape deliberately excludes both -- see
// mobile-bootstrap/index.ts) -- this hook IS that one call, fetch-or-
// create either way, gated on `enabled`.
export function useDailyDrill({ enabled }: UseDailyDrillOptions): UseDailyDrillResult {
  const [data, setData] = useState<MobileDailyDrillResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    if (!enabled) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchDailyDrill()
      setData(result)
    } catch (err) {
      logDevError('useDailyDrill', err)
      setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load today’s drill.' }))
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, refetch: load }
}
