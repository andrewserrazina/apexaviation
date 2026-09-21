import { useCallback, useEffect, useState } from 'react'
import { clearOfflineContent, loadOfflineContent, saveOfflineContent, type OfflineContentEntry, type OfflineContentType } from '../lib/offlineContent'

interface UseOfflineContentCacheOptions<T> {
  userId: string | null
  contentType: OfflineContentType
  contentId: string
  isValidPayload: (value: unknown) => value is T
  // Mirrors every other mobile-* hook's gate -- must stay false until
  // bootstrap/entitlement/route params are all resolved, so this never
  // reads/writes a cache slot for a not-yet-known user or content id.
  enabled: boolean
}

// Wraps lib/offlineContent.ts for one content item (a Study Pack or a
// Ground School module) -- loads any existing cached copy on mount, and
// exposes a `download()` action for the item's own "Download for
// Offline" button to call with content it already has in memory (never
// a second network fetch).
export function useOfflineContentCache<T>({ userId, contentType, contentId, isValidPayload, enabled }: UseOfflineContentCacheOptions<T>) {
  const [cached, setCached] = useState<OfflineContentEntry<T> | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const loadCache = useCallback(async () => {
    if (!enabled || !userId) {
      setCached(null)
      setLoaded(true)
      return
    }
    setLoaded(false)
    const entry = await loadOfflineContent(userId, contentType, contentId, isValidPayload)
    setCached(entry)
    setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, contentType, contentId, enabled])

  useEffect(() => {
    loadCache()
  }, [loadCache])

  // saveOfflineContent() itself is best-effort/silent (matching every
  // other *Storage.ts write in this codebase) -- this verifies success by
  // reading the cache back rather than trusting a save call that can
  // never itself report failure, so a genuinely failed write still
  // surfaces as a real, user-visible error here.
  const download = useCallback(
    async (contentVersion: string, payload: T) => {
      if (!userId) return
      setDownloading(true)
      setDownloadError(null)
      try {
        await saveOfflineContent(userId, contentType, contentId, contentVersion, payload)
        const confirmed = await loadOfflineContent(userId, contentType, contentId, isValidPayload)
        if (!confirmed) {
          setDownloadError('We couldn’t save this for offline use. Please try again.')
          return
        }
        setCached(confirmed)
      } finally {
        setDownloading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, contentType, contentId]
  )

  const clear = useCallback(async () => {
    if (!userId) return
    await clearOfflineContent(userId, contentType, contentId)
    setCached(null)
  }, [userId, contentType, contentId])

  return { cached, loaded, downloading, downloadError, download, clear, refreshCache: loadCache }
}
