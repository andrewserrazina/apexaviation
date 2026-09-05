import { useEffect, useState } from 'react'
import type { MobileBootstrapDTO, MobileReadinessSummary } from '../../shared/mobile-dto'
import { fetchBootstrap } from '../lib/api/bootstrap'
import { fetchLatestReadiness, refreshReadiness } from '../lib/api/readiness'
import { logDevError } from '../lib/api/errors'

interface PostCompleteState {
  loading: boolean
  progress: MobileBootstrapDTO['progress'] | null
  readiness: MobileReadinessSummary | null
}

// Sprint 1A section 14: after a successful (or already_completed)
// completion, refresh bootstrap + readiness and show a restrained
// completion screen with updated XP/readiness. This fetches
// independently of Home's own useBootstrap instance -- Home re-syncs
// itself on its next focus (see hooks/useHomeDrill.ts's Rev2
// refresh-on-focus fix).
//
// Rev3 section 4: mobile-readiness's `latest` action explicitly never
// recomputes -- only `refresh` (compute_readiness_snapshot()) does. A
// genuinely NEW Daily Drill completion just recorded fresh evidence, so
// fetching `latest` here would show the SAME stale snapshot the learner
// already had before this drill. `alreadyCompleted` (from
// mobile-practice `complete`'s own response) tells us which case this
// is:
//   - a real new completion (alreadyCompleted === false): call
//     refreshReadiness(), and sequence it BEFORE fetchBootstrap() rather
//     than in parallel -- mobile-bootstrap reads the readiness_snapshots
//     table fresh on every call, so once refreshReadiness()'s write has
//     committed, bootstrap's own progress.readiness_summary reflects the
//     same new snapshot too, and nothing racing this call (e.g. Home's
//     own focus-triggered bootstrap refresh once the learner taps "Back
//     to Home") can observe the old one as current.
//   - an idempotent replay (alreadyCompleted === true): no new evidence
//     was recorded, so generating another snapshot would be an
//     unnecessary duplicate write -- fetchLatestReadiness() is
//     sufficient, and safe to run in parallel with fetchBootstrap().
// No local readiness calculation occurs either way.
export function usePostCompleteRefresh(trigger: boolean, alreadyCompleted: boolean) {
  const [state, setState] = useState<PostCompleteState>({ loading: false, progress: null, readiness: null })

  useEffect(() => {
    if (!trigger) return
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))

    async function run() {
      let progress: MobileBootstrapDTO['progress'] | null = null
      let readiness: MobileReadinessSummary | null = null

      if (alreadyCompleted) {
        const [bootstrapResult, readinessResult] = await Promise.allSettled([fetchBootstrap(), fetchLatestReadiness()])
        if (bootstrapResult.status === 'fulfilled') progress = bootstrapResult.value.progress
        else logDevError('usePostCompleteRefresh.bootstrap', bootstrapResult.reason)
        if (readinessResult.status === 'fulfilled') readiness = readinessResult.value.snapshot
        else logDevError('usePostCompleteRefresh.readiness', readinessResult.reason)
      } else {
        try {
          const readinessResponse = await refreshReadiness()
          readiness = readinessResponse.snapshot
        } catch (err) {
          logDevError('usePostCompleteRefresh.refreshReadiness', err)
        }
        try {
          const bootstrapResponse = await fetchBootstrap()
          progress = bootstrapResponse.progress
        } catch (err) {
          logDevError('usePostCompleteRefresh.bootstrap', err)
        }
      }

      if (!cancelled) setState({ loading: false, progress, readiness })
    }

    run()
    return () => {
      cancelled = true
    }
  }, [trigger, alreadyCompleted])

  return state
}
