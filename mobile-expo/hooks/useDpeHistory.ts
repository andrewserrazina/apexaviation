import { useCallback, useEffect, useState } from 'react'
import type { MobileDpeHistoryResponse } from '../../shared/mobile-dto'
import { fetchDpeHistory } from '../lib/api/dpe'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseDpeHistoryOptions {
  // Must stay false until bootstrap has resolved and confirmed
  // entitlement, mirroring useLibraryCatalog's/useDailyDrill's own gate.
  enabled: boolean
}

interface UseDpeHistoryResult {
  data: MobileDpeHistoryResponse | null
  loading: boolean
  refreshing: boolean
  error: ApiError | null
  refresh: () => Promise<void>
}

export function useDpeHistory({ enabled }: UseDpeHistoryOptions): UseDpeHistoryResult {
  const [data, setData] = useState<MobileDpeHistoryResponse | null>(null)
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
        const result = await fetchDpeHistory()
        setData(result)
      } catch (err) {
        logDevError('useDpeHistory', err)
        setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load your oral practice history.' }))
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
