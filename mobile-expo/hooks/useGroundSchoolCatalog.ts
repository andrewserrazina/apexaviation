import { useCallback, useEffect, useState } from 'react'
import type { MobileGroundSchoolCatalogResponse } from '../../shared/mobile-dto'
import { fetchGroundSchoolCatalog } from '../lib/api/groundSchool'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseGroundSchoolCatalogOptions {
  // Ground School's catalog is browsable without checkride_prep (entitlement
  // is per-module, not a flat flag) -- this only waits for bootstrap/auth
  // to have resolved at all, mirroring useLibraryCatalog's own gate.
  enabled: boolean
}

interface UseGroundSchoolCatalogResult {
  data: MobileGroundSchoolCatalogResponse | null
  loading: boolean
  refreshing: boolean
  error: ApiError | null
  refresh: () => Promise<void>
}

export function useGroundSchoolCatalog({ enabled }: UseGroundSchoolCatalogOptions): UseGroundSchoolCatalogResult {
  const [data, setData] = useState<MobileGroundSchoolCatalogResponse | null>(null)
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
        const result = await fetchGroundSchoolCatalog()
        setData(result)
      } catch (err) {
        logDevError('useGroundSchoolCatalog', err)
        setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load Ground School.' }))
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
