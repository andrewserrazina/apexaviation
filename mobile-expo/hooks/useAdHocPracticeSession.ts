import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { MobileAcsTaskRef, MobilePracticeRevealResponse, SelfRating } from '../../shared/mobile-dto'
import { completePractice, resumePractice, revealQuestion } from '../lib/api/practice'
import { ApiError, logDevError } from '../lib/api/errors'
import { clearActivePracticeSession } from '../lib/activePracticeStorage'
import { clearDrillProgress, loadDrillProgress, saveDrillProgress } from '../lib/drillProgressStorage'
import {
  allQuestionsRated,
  buildCompleteResponses,
  createDrillSessionState,
  currentQuestion,
  currentRating,
  drillSessionReducer,
  isCurrentRevealed,
  isLastQuestion,
} from '../lib/drillSessionReducer'

interface CompleteResult {
  score: number
  total: number
  alreadyCompleted: boolean
}

interface SessionMeta {
  mode: string
  startedAt: string
  targetAcsTasks: MobileAcsTaskRef[]
}

// Sprint 1B.1: a resume failure that means the local ActivePracticeSession
// pointer can never resolve to a real session again (the session, or this
// learner's ownership of it, is genuinely gone) vs. one that might
// resolve on retry (a network hiccup, a transient server error). Only the
// former offers "Remove Saved Session" -- see section 12's explicit
// instruction not to strand the learner behind disabled mode buttons for
// a stale pointer, but also not to silently discard a valid session on a
// transient failure. Classified from the SAME normalized ApiError.kind
// every other screen already renders from (`session_not_found` ->
// 'not_found', `not_your_session` -> 'forbidden') -- v119's
// `invalid_question_set` case currently also surfaces as a generic 500
// ('server' kind, no stable code passed through by the existing error-
// normalization pipeline -- see mobile-practice/index.ts's resume error
// mapping), which is indistinguishable here from a transient
// infrastructure failure. Treating it as transient (retry-only) is the
// conservative, honest choice: it never risks discarding a resumable
// session pointer on a real infra blip, at the cost of a genuinely
// corrupt (very rare) server-side question set needing a manual "Remove
// Saved Session" tap after the learner sees repeated retry failures,
// rather than being offered it immediately.
export type ResumeErrorKind = 'permanent' | 'transient'

export function classifyResumeError(error: ApiError | null): ResumeErrorKind | null {
  if (!error) return null
  if (error.kind === 'not_found' || error.kind === 'forbidden') return 'permanent'
  return 'transient'
}

interface UseAdHocPracticeSessionOptions {
  // Must stay false until bootstrap has resolved and confirmed the
  // learner is entitled -- mirrors useDailyDrill's own `enabled` gate
  // (Sprint 1A Rev2 section 3) so a deep-linked, unentitled, or not-yet-
  // resolved session route never fires a premium resume call (section 13).
  enabled: boolean
  userId: string | null
}

// The Resume -> Question -> Reveal -> Self-Rate -> Complete controller for
// one ad-hoc practice session. Deliberately separate from useDrillSession
// rather than branching inside it (Sprint 1B.1 section 6) -- the two
// differ in session origin (this hook only ever RESUMES an
// already-created server session; it never starts one) and in the extra
// already-completed-on-resume and local-pointer-cleanup handling below,
// which would make useDrillSession harder to read for its own,
// unaffected Daily Drill contract.
export function useAdHocPracticeSession(sessionId: string, options: UseAdHocPracticeSessionOptions) {
  const [resuming, setResuming] = useState(true)
  const [resumeError, setResumeError] = useState<ApiError | null>(null)
  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null)
  const [alreadyCompletedOnResume, setAlreadyCompletedOnResume] = useState(false)
  const [resumedCompletedAt, setResumedCompletedAt] = useState<string | null>(null)

  const [state, dispatch] = useReducer(drillSessionReducer, createDrillSessionState([]))
  const [revealContent, setRevealContent] = useState<MobilePracticeRevealResponse | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [revealError, setRevealError] = useState<ApiError | null>(null)

  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<ApiError | null>(null)
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null)
  // Debounces the Complete Practice CTA, same reasoning as useDrillSession
  // (Sprint 1A section 13).
  const completeInFlight = useRef(false)

  const resume = useCallback(async () => {
    if (!options.enabled) return
    setResuming(true)
    setResumeError(null)
    try {
      const result = await resumePractice(sessionId)

      if (result.completed_at) {
        // Section 11: v119 may resume a session that is already complete
        // -- never attempt to complete it again, and never promise
        // historical score detail the resume DTO doesn't contain. The
        // stale local pointer/ratings for THIS session are cleared here
        // (not left for the learner to clear manually) since there is
        // nothing left to resume toward.
        setAlreadyCompletedOnResume(true)
        setResumedCompletedAt(result.completed_at)
        setSessionMeta({ mode: result.mode, startedAt: result.started_at, targetAcsTasks: result.target_acs_tasks })
        if (options.userId) await clearActivePracticeSession(options.userId)
        await clearDrillProgress(sessionId)
        return
      }

      setSessionMeta({ mode: result.mode, startedAt: result.started_at, targetAcsTasks: result.target_acs_tasks })

      // Restore saved ratings only -- never `revealed`, same reasoning as
      // Daily Drill (drillProgressStorage.ts, Sprint 1A Rev2 section 1):
      // debrief content isn't itself persisted, so a restored question
      // always needs a fresh Reveal tap before it can be rated again.
      const saved = await loadDrillProgress(sessionId)
      dispatch({
        type: 'initialize',
        questions: result.questions,
        ratings: saved?.ratings ?? {},
        revealed: {},
      })
    } catch (err) {
      logDevError('useAdHocPracticeSession.resume', err)
      setResumeError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t resume this practice session.' }))
    } finally {
      setResuming(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, options.enabled, options.userId])

  useEffect(() => {
    // Same established shape as useDailyDrill.ts/useHomeDrill.ts/
    // useDrillSession.ts -- see practice/index.tsx's identical comment.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (options.enabled) resume()
  }, [sessionId, options.enabled])

  const q = currentQuestion(state)

  const reveal = useCallback(async () => {
    if (!q) return
    setRevealing(true)
    setRevealError(null)
    try {
      const content = await revealQuestion(sessionId, q.id)
      setRevealContent(content)
      dispatch({ type: 'reveal', questionId: q.id })
    } catch (err) {
      logDevError('useAdHocPracticeSession.reveal', err)
      setRevealError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t reveal the answer.' }))
    } finally {
      setRevealing(false)
    }
  }, [sessionId, q])

  const rate = useCallback(
    (rating: SelfRating) => {
      if (!q) return
      dispatch({ type: 'rate', questionId: q.id, rating })
    },
    [q]
  )

  const goNext = useCallback(() => {
    setRevealContent(null)
    dispatch({ type: 'goToNext' })
  }, [])

  // Persist ratings locally after every change, keyed to this session_id
  // -- best-effort, see drillProgressStorage.ts. This is the exact same
  // storage Daily Drill already uses: its key shape (session_id only, no
  // drill-specific coupling) is already generic enough that ad-hoc
  // practice reuses it directly rather than needing a parallel module.
  useEffect(() => {
    if (!state.questions.length || alreadyCompletedOnResume) return
    saveDrillProgress({ sessionId, ratings: state.ratings })
  }, [sessionId, state.questions.length, state.ratings, alreadyCompletedOnResume])

  const complete = useCallback(async () => {
    if (completeInFlight.current) return
    completeInFlight.current = true
    setCompleting(true)
    setCompleteError(null)
    try {
      const responses = buildCompleteResponses(state)
      const result = await completePractice(sessionId, responses)
      setCompleteResult({ score: result.score, total: result.total, alreadyCompleted: result.already_completed })
      await clearDrillProgress(sessionId)
      if (options.userId) await clearActivePracticeSession(options.userId)
    } catch (err) {
      logDevError('useAdHocPracticeSession.complete', err)
      setCompleteError(
        err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t submit your practice session. You can try again.' })
      )
    } finally {
      setCompleting(false)
      completeInFlight.current = false
    }
  }, [sessionId, state, options.userId])

  // Section 12: clears ONLY the local pointer/rating cache for this
  // session -- never touches the server attempt. Used when a resume
  // failure is classified 'permanent' (the local pointer is stale and can
  // never resolve), so the learner isn't stranded behind disabled
  // Quick/Standard/Weak-Area buttons indefinitely.
  const removeSavedSession = useCallback(async () => {
    if (options.userId) await clearActivePracticeSession(options.userId)
    await clearDrillProgress(sessionId)
  }, [sessionId, options.userId])

  return {
    resuming,
    resumeError,
    resumeErrorKind: classifyResumeError(resumeError),
    retryResume: resume,
    removeSavedSession,
    sessionMeta,
    alreadyCompletedOnResume,
    resumedCompletedAt,

    currentQuestion: q,
    currentIndex: state.index,
    total: state.questions.length,
    isRevealed: q ? isCurrentRevealed(state) : false,
    currentRating: q ? currentRating(state) : null,
    isLastQuestion: isLastQuestion(state),
    allRated: allQuestionsRated(state),

    revealContent,
    revealing,
    revealError,
    reveal,
    rate,
    goNext,

    completing,
    completeError,
    completeResult,
    complete,
  }
}
