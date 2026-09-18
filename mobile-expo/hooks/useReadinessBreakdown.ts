import { useCallback, useEffect, useState } from 'react'
import type { MobileReadinessSummary } from '../../shared/mobile-dto'
import { fetchLatestReadiness } from '../lib/api/readiness'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseReadinessBreakdownOptions {
  // Same gate as useDailyDrill's `enabled` -- must stay false until
  // bootstrap has resolved and confirmed the learner is entitled, so an
  // unentitled learner opening the ACS tab never generates a
  // mobile-readiness request.
  enabled: boolean
}

interface UseReadinessBreakdownResult {
  data: MobileReadinessSummary | null
  loading: boolean
  refreshing: boolean
  error: ApiError | null
  refresh: () => Promise<void>
}

// The ACS Explorer's data source. `mobile-readiness`'s 'latest' action is
// a passive read (never recomputes) -- category_breakdown already
// reflects the most recent evidence by the time a learner opens this
// screen, since every practice-completion path elsewhere already
// triggers its own readiness refresh. Deliberately does not call
// `refresh` (recompute) itself; pull-to-refresh here just re-reads the
// latest snapshot, matching every other screen's non-mutating refresh.
export function useReadinessBreakdown({ enabled }: UseReadinessBreakdownOptions): UseReadinessBreakdownResult {
  const [data, setData] = useState<MobileReadinessSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (!enabled) {
        setData(null)
        setLoading(false)
        setRefreshing(false)
        setError(null)
        return
      }
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const result = await fetchLatestReadiness()
        setData(result.snapshot)
      } catch (err) {
        logDevError('useReadinessBreakdown', err)
        setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load your ACS coverage.' }))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [enabled]
  )

  useEffect(() => {
    load(false)
  }, [load])

  return { data, loading, refreshing, error, refresh: () => load(true) }
}
