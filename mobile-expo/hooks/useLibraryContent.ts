import { useCallback, useEffect, useState } from 'react'
import type { MobileStudyPackContent } from '../../shared/mobile-dto'
import { fetchLibraryContent } from '../lib/api/library'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseLibraryContentOptions {
  packId: string
  // Sprint 1C Phase 3: a locked pack must never call the content action --
  // the catalog's own `owned` flag is the only thing that gates this
  // fetch client-side. The server independently re-checks entitlement on
  // every content request regardless (see mobile-library/index.ts), so a
  // stale/incorrect locally-cached `owned=true` still fails closed via the
  // 403 branch below rather than ever rendering privileged content.
  enabled: boolean
}

interface UseLibraryContentResult {
  content: MobileStudyPackContent | null
  version: string | null
  loading: boolean
  error: ApiError | null
  refetch: () => Promise<void>
}

export function useLibraryContent({ packId, enabled }: UseLibraryContentOptions): UseLibraryContentResult {
  const [content, setContent] = useState<MobileStudyPackContent | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    if (!enabled || !packId) {
      setContent(null)
      setVersion(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchLibraryContent(packId)
      setContent(result.content)
      setVersion(result.version)
    } catch (err) {
      logDevError('useLibraryContent', err)
      // A 403 here means the server's own entitlement re-check disagreed
      // with whatever made `enabled` true (e.g. a stale local catalog) --
      // it must fail closed exactly like any other error, never fall back
      // to a cached or partially-rendered pack.
      setContent(null)
      setVersion(null)
      setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load this Study Pack.' }))
    } finally {
      setLoading(false)
    }
  }, [packId, enabled])

  useEffect(() => {
    load()
  }, [load])

  return { content, version, loading, error, refetch: load }
}
