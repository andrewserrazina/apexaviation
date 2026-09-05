import { useCallback, useEffect, useState } from 'react'
import type { MobileBootstrapDTO } from '../../shared/mobile-dto'
import { fetchBootstrap } from '../lib/api/bootstrap'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseBootstrapResult {
  data: MobileBootstrapDTO | null
  loading: boolean
  refreshing: boolean
  error: ApiError | null
  refresh: () => Promise<void>
}

// Home's one required call. `refresh()` is exposed separately from the
// initial load so pull-to-refresh can reuse it and Home can guard against
// firing a second concurrent refresh (Sprint 1A section 18).
export function useBootstrap(): UseBootstrapResult {
  const [data, setData] = useState<MobileBootstrapDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [inFlight, setInFlight] = useState(false)

  const load = useCallback(async (isRefresh: boolean) => {
    if (inFlight) return
    setInFlight(true)
    isRefresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const result = await fetchBootstrap()
      setData(result)
    } catch (err) {
      logDevError('useBootstrap', err)
      setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'Something went wrong. Please try again.' }))
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false)
      setInFlight(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight])

  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(() => load(true), [load])

  return { data, loading, refreshing, error, refresh }
}
