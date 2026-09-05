import { useCallback, useEffect, useState } from 'react'
import type { MobileDailyDrillResponse } from '../../shared/mobile-dto'
import { fetchDailyDrill } from '../lib/api/dailyDrill'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseDailyDrillResult {
  data: MobileDailyDrillResponse | null
  loading: boolean
  error: ApiError | null
  refetch: () => Promise<void>
}

// Home's Today's Drill card. Per Sprint 1A section 8E: if mobile-bootstrap
// already told us about today's drill, this still needs to be called
// exactly once to get session_id/questions (bootstrap's todays_drill
// shape deliberately excludes both -- see mobile-bootstrap/index.ts) --
// this hook IS that one call, fetch-or-create either way.
export function useDailyDrill(): UseDailyDrillResult {
  const [data, setData] = useState<MobileDailyDrillResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, refetch: load }
}
