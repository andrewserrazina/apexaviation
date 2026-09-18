import { useCallback, useEffect, useState } from 'react'
import type { MobileAcsTaskInfo } from '../../shared/mobile-dto'
import { fetchAcsTaskBreakdown } from '../lib/api/readiness'
import { ApiError, logDevError } from '../lib/api/errors'

interface UseAcsTaskBreakdownOptions {
  // Same gate as useReadinessBreakdown's `enabled` -- must stay false
  // until bootstrap has resolved and confirmed the learner is entitled,
  // so opening a category's task list before that never generates a
  // mobile-readiness request.
  enabled: boolean
}

interface UseAcsTaskBreakdownResult {
  tasks: MobileAcsTaskInfo[]
  loading: boolean
  error: ApiError | null
  refetch: () => Promise<void>
}

// The ACS Explorer's per-category task list. Fetches the FULL scoped
// task set in one call (not per-category) -- get_member_acs_task_breakdown()
// already returns every digitally-assessable task across all 9
// categories, so the screen filters client-side by dpe_category rather
// than making a separate request per category card a learner happens to
// expand.
export function useAcsTaskBreakdown({ enabled }: UseAcsTaskBreakdownOptions): UseAcsTaskBreakdownResult {
  const [tasks, setTasks] = useState<MobileAcsTaskInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    if (!enabled) {
      setTasks([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchAcsTaskBreakdown()
      setTasks(result.tasks)
    } catch (err) {
      logDevError('useAcsTaskBreakdown', err)
      setError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load that ACS category’s tasks.' }))
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    load()
  }, [load])

  return { tasks, loading, error, refetch: load }
}
