import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { ReviewOutcomeValue } from '../../shared/mobile-dto'
import type { RevealableAnswerContent } from '../components/RevealContent'
import { fetchReviewQueue, revealReviewItem, submitReviewOutcome } from '../lib/api/reviewQueue'
import { ApiError, logDevError } from '../lib/api/errors'
import { generateReviewIdempotencyKey } from '../lib/reviewIdempotencyKey'
import {
  buildReviewSessionItems,
  createReviewSessionState,
  currentReviewItem,
  isReviewSessionComplete,
  reviewSessionReducer,
} from '../lib/reviewSessionReducer'

interface UseReviewSessionOptions {
  // Must stay false until bootstrap has resolved and confirmed
  // entitlement -- mirrors every other mobile-* controller hook's gate.
  enabled: boolean
}

// The Load (fetch+build) -> Reveal -> Reinforced/Needs Another Pass ->
// next item controller for one Review Queue session. Unlike
// useAdHocPracticeSession/useDpeSession, there is no server-side session
// to resume -- sync_review_queue() is cheap and idempotent to re-call, so
// this hook simply (re)builds its own linear item list from a fresh
// mobile-review-queue `list` call every time it's enabled (see
// reviewSessionReducer.ts's own comment on why no
// activeReviewSessionStorage.ts exists). No route param is needed for the
// screen this backs -- there is no session_id, and passing a whole
// fetched item list through navigation params would duplicate the
// fetch/serialize cost for no benefit.
export function useReviewSession(options: UseReviewSessionOptions) {
  const [state, dispatch] = useReducer(reviewSessionReducer, createReviewSessionState([]))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<ApiError | null>(null)

  const [revealContent, setRevealContent] = useState<RevealableAnswerContent | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [revealError, setRevealError] = useState<ApiError | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<ApiError | null>(null)
  // Debounces Reinforced/Needs Another Pass -- same reasoning as every
  // other mobile-* controller's *InFlight ref.
  const submitInFlight = useRef(false)

  const load = useCallback(async () => {
    if (!options.enabled) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await fetchReviewQueue()
      const items = buildReviewSessionItems(result.items, generateReviewIdempotencyKey)
      dispatch({ type: 'initialize', items })
    } catch (err) {
      logDevError('useReviewSession.load', err)
      setLoadError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t load your review queue.' }))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (options.enabled) load()
  }, [options.enabled])

  const item = currentReviewItem(state)

  const reveal = useCallback(async () => {
    if (!item) return
    setRevealing(true)
    setRevealError(null)
    try {
      const content = await revealReviewItem(item.reviewItemId)
      setRevealContent(content)
      dispatch({ type: 'reveal' })
    } catch (err) {
      logDevError('useReviewSession.reveal', err)
      setRevealError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t reveal the answer.' }))
    } finally {
      setRevealing(false)
    }
  }, [item])

  // Never regenerates item.submissionKey -- a retry after a failed/
  // ambiguous submission reuses the exact same key (minted once in
  // buildReviewSessionItems), so if the first attempt actually committed
  // server-side, record_review_outcome() replays its stored result with
  // zero side effects repeated; if it didn't commit, this performs the
  // real write once. Mirrors web's advanceReviewSession()/
  // showReviewRetryState() contract exactly.
  const submitOutcome = useCallback(
    async (outcome: ReviewOutcomeValue) => {
      if (!item || submitInFlight.current) return
      submitInFlight.current = true
      setSubmitting(true)
      setSubmitError(null)
      try {
        await submitReviewOutcome(item.reviewItemId, outcome, item.submissionKey)
        setRevealContent(null)
        dispatch({ type: 'outcomeApplied', outcome })
      } catch (err) {
        logDevError('useReviewSession.submitOutcome', err)
        setSubmitError(
          err instanceof ApiError
            ? err
            : new ApiError({ kind: 'server', userMessage: 'Connection issue — your answer wasn’t confirmed. Tap to try again.' })
        )
      } finally {
        setSubmitting(false)
        submitInFlight.current = false
      }
    },
    [item]
  )

  return {
    loading,
    loadError,
    retryLoad: load,

    item,
    index: state.index,
    total: state.items.length,
    complete: isReviewSessionComplete(state),
    reinforcedCount: state.reinforcedCount,
    needsPassCount: state.needsPassCount,
    revealed: state.revealed,

    revealContent,
    revealing,
    revealError,
    reveal,

    submitting,
    submitError,
    submitOutcome,
  }
}
