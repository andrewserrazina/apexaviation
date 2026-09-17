import { useCallback, useEffect, useState } from 'react'
import type { MobileLibraryCatalogResponse } from '../../shared/mobile-dto'
import { fetchLibraryCatalog } from '../lib/api/library'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseLibraryCatalogOptions {
  // Sprint 1C Phase 2: Library is browsable without checkride_prep
  // entitlement (Study Pack entitlement is separate, see
  // portal/supabase/functions/mobile-library/index.ts), but the catalog
  // call still must not fire before bootstrap/auth has resolved -- this
  // mirrors useDailyDrill's `enabled` gate to avoid the same startup-race
  // class of bug, not to gate on checkride_prep itself.
  enabled: boolean
}

interface UseLibraryCatalogResult {
  data: MobileLibraryCatalogResponse | null
  loading: boolean
  refreshing: boolean
  error: ApiError | null
  refresh: () => Promise<void>
}

export function useLibraryCatalog({ enabled }: UseLibraryCatalogOptions): UseLibraryCatalogResult {
  const [data, setData] = useState<MobileLibraryCatalogResponse | null>(null)
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
        const result = await fetchLibraryCatalog()
        setData(result)
      } catch (err) {
        logDevError('useLibraryCatalog', err)
        setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load the Library.' }))
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
