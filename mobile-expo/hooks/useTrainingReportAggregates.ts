import { useCallback, useEffect, useState } from 'react'
import type { MobileTrainingReportAggregates } from '../../shared/mobile-dto'
import { fetchTrainingReportAggregates } from '../lib/api/trainingReport'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseTrainingReportAggregatesOptions {
  // Must stay false until bootstrap has resolved and confirmed
  // entitlement, mirroring useReadinessBreakdown's/useReviewQueue's own
  // gate.
  enabled: boolean
}

interface UseTrainingReportAggregatesResult {
  data: MobileTrainingReportAggregates | null
  loading: boolean
  refreshing: boolean
  error: ApiError | null
  refresh: () => Promise<void>
}

export function useTrainingReportAggregates({ enabled }: UseTrainingReportAggregatesOptions): UseTrainingReportAggregatesResult {
  const [data, setData] = useState<MobileTrainingReportAggregates | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [inFlight, setInFlight] = useState(false)

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (!enabled || inFlight) return
      setInFlight(true)
      isRefresh ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const result = await fetchTrainingReportAggregates()
        setData(result)
      } catch (err) {
        logDevError('useTrainingReportAggregates', err)
        setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load your training report.' }))
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false)
        setInFlight(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, inFlight]
  )

  useEffect(() => {
    if (enabled) load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const refresh = useCallback(() => load(true), [load])

  return { data, loading, refreshing, error, refresh }
}
