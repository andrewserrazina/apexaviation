import { useCallback, useEffect, useState } from 'react'
import type { MobileReviewQueueListResponse } from '../../shared/mobile-dto'
import { fetchReviewQueue } from '../lib/api/reviewQueue'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseReviewQueueOptions {
  // Must stay false until bootstrap has resolved and confirmed
  // entitlement -- mirrors useDpeHistory's/useLibraryCatalog's own gate.
  enabled: boolean
}

interface UseReviewQueueResult {
  data: MobileReviewQueueListResponse | null
  loading: boolean
  refreshing: boolean
  error: ApiError | null
  refresh: () => Promise<void>
}

export function useReviewQueue({ enabled }: UseReviewQueueOptions): UseReviewQueueResult {
  const [data, setData] = useState<MobileReviewQueueListResponse | null>(null)
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
        const result = await fetchReviewQueue()
        setData(result)
      } catch (err) {
        logDevError('useReviewQueue', err)
        setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load your review queue.' }))
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
