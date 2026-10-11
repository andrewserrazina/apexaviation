import { useCallback, useEffect, useState } from 'react'
import type { MobileDpeLibraryResponse } from '../../shared/mobile-dto'
import { fetchDpeLibrary } from '../lib/api/dpeLibrary'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseDpeLibraryOptions {
  // Must stay false until bootstrap has resolved and confirmed
  // entitlement -- mirrors useReviewQueue's/useDpeHistory's own gate.
  enabled: boolean
}

interface UseDpeLibraryResult {
  data: MobileDpeLibraryResponse | null
  loading: boolean
  refreshing: boolean
  error: ApiError | null
  refresh: () => Promise<void>
}

export function useDpeLibrary({ enabled }: UseDpeLibraryOptions): UseDpeLibraryResult {
  const [data, setData] = useState<MobileDpeLibraryResponse | null>(null)
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
        const result = await fetchDpeLibrary()
        setData(result)
      } catch (err) {
        logDevError('useDpeLibrary', err)
        setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load the question library.' }))
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
