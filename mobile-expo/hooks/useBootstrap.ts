import { useCallback, useEffect, useRef, useState } from 'react'
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
  // Refs, not state: several screens share one bootstrap via
  // BootstrapContext and can each call load()/refresh() in the same
  // render tick (e.g. a save-callback refresh racing a pull-to-refresh).
  // A plain `inFlight` state read is stale until the next render commits,
  // so two calls in the same tick both see inFlight===false and both
  // fetch. requestIdRef additionally guards the *resolution* order: if a
  // newer request has started by the time an older one resolves, the
  // older response is discarded instead of overwriting fresher data with
  // stale data (e.g. a purchase-triggered refresh resolving after a
  // slower earlier refresh would otherwise flip `entitled` back to false).
  const inFlightRef = useRef(false)
  const requestIdRef = useRef(0)

  const load = useCallback(async (isRefresh: boolean) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const requestId = ++requestIdRef.current
    isRefresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const result = await fetchBootstrap()
      if (requestId !== requestIdRef.current) return
      setData(result)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      logDevError('useBootstrap', err)
      setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'Something went wrong. Please try again.' }))
    } finally {
      if (requestId === requestIdRef.current) {
        isRefresh ? setRefreshing(false) : setLoading(false)
      }
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(() => load(true), [load])

  return { data, loading, refreshing, error, refresh }
}
