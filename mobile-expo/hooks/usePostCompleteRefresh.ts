import { useEffect, useState } from 'react'
import type { MobileBootstrapDTO, MobileReadinessSummary } from '../../shared/mobile-dto'
import { fetchBootstrap } from '../lib/api/bootstrap'
import { fetchLatestReadiness } from '../lib/api/readiness'
import { logDevError } from '../lib/api/errors'

interface PostCompleteState {
  loading: boolean
  progress: MobileBootstrapDTO['progress'] | null
  readiness: MobileReadinessSummary | null
}

// Sprint 1A section 14: after a successful (or already_completed)
// completion, refresh bootstrap + readiness IN PARALLEL where safe, then
// show a restrained completion screen with updated XP/readiness. This
// fetches independently of Home's own useBootstrap instance -- Home
// re-syncs itself the next time it mounts/refreshes (see the Sprint 1A
// report's "known limitations" for the one edge case this doesn't cover:
// a backgrounded Home tab kept mounted by React Navigation won't
// automatically pick up the new numbers until the learner pulls to
// refresh there).
export function usePostCompleteRefresh(trigger: boolean) {
  const [state, setState] = useState<PostCompleteState>({ loading: false, progress: null, readiness: null })

  useEffect(() => {
    if (!trigger) return
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    Promise.allSettled([fetchBootstrap(), fetchLatestReadiness()]).then(([bootstrapResult, readinessResult]) => {
      if (cancelled) return
      const progress = bootstrapResult.status === 'fulfilled' ? bootstrapResult.value.progress : null
      if (bootstrapResult.status === 'rejected') logDevError('usePostCompleteRefresh.bootstrap', bootstrapResult.reason)
      const readiness = readinessResult.status === 'fulfilled' ? readinessResult.value.snapshot : null
      if (readinessResult.status === 'rejected') logDevError('usePostCompleteRefresh.readiness', readinessResult.reason)
      setState({ loading: false, progress, readiness })
    })
    return () => {
      cancelled = true
    }
  }, [trigger])

  return state
}
