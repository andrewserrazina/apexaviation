import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { MobileAcsTaskRef, MobilePracticeRevealResponse, SelfRating } from '../../shared/mobile-dto'
import { completePractice, resumePractice, revealQuestion } from '../lib/api/practice'
import { ApiError, logDevError } from '../lib/api/errors'
import { clearActivePracticeSessionIfMatches } from '../lib/activePracticeStorage'
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
// 'not_found', `not_your_session` -> 'forbidden').
//
// Rev2 blocker 4: v119's `invalid_question_set` case is a genuine,
// permanent server-data-integrity failure for that ONE stored session
// (an empty/duplicate/dangling stored question_ids array) -- it is not a
// transient infra blip, and offering only Retry forever would strand the
// learner behind permanently disabled Quick/Standard/Weak-Area buttons
// (Sprint 1B.1 section 12 explicitly forbids that). client.ts's
// invokeMobileFunction now preserves the Edge Function's machine-readable
// `code` even for 5xx responses (errors.ts's serverError(raw, status,
// code)), so this specific code is checked before falling back to the
// kind-only classification. Every OTHER 5xx (an actual infra failure, or
// any future/unknown server code) still classifies transient -- this is
// deliberately narrow, not "every server error is permanent."
export type ResumeErrorKind = 'permanent' | 'transient'

export function classifyResumeError(error: ApiError | null): ResumeErrorKind | null {
  if (!error) return null
  if (error.kind === 'not_found' || error.kind === 'forbidden') return 'permanent'
  if (error.kind === 'server' && error.code === 'invalid_question_set') return 'permanent'
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
        //
        // Rev2 blockers 2 + 3: clearActivePracticeSessionIfMatches only
        // removes the stored pointer if it still points at THIS sessionId
        // -- a deep-linked older/already-completed session must never
        // wipe out a DIFFERENT, still-unfinished session's saved pointer.
        // And alreadyCompletedOnResume (the flag the screen actually
        // renders on) is only published AFTER both cleanup awaits settle,
        // so the "already complete" screen can never appear while a
        // stale pointer or rating cache might still exist underneath it
        // on a slower device.
        setSessionMeta({ mode: result.mode, startedAt: result.started_at, targetAcsTasks: result.target_acs_tasks })
        if (options.userId) await clearActivePracticeSessionIfMatches(options.userId, sessionId)
        await clearDrillProgress(sessionId)
        setResumedCompletedAt(result.completed_at)
        setAlreadyCompletedOnResume(true)
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
      // Rev2 blocker 3: perform local cleanup BEFORE publishing
      // completeResult -- these storage helpers already fail safe/no-op
      // internally, so awaiting them can never turn a successful server
      // completion into a failure, but publishing completeResult (which
      // renders the completion screen and its "Back to Practice" CTA)
      // before cleanup finishes let a fast tap on a slower device return
      // to the hub while a stale active-session pointer still existed,
      // making a completed session's "Continue Practice" card briefly
      // reappear. Blocker 2: session-matched, never a blind per-user
      // clear -- this must only ever remove THIS session's own pointer.
      await clearDrillProgress(sessionId)
      if (options.userId) await clearActivePracticeSessionIfMatches(options.userId, sessionId)
      setCompleteResult({ score: result.score, total: result.total, alreadyCompleted: result.already_completed })
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
    // Blocker 2: session-matched -- never clear a different session's
    // saved pointer just because THIS route's resume turned out to be
    // permanently non-resumable.
    if (options.userId) await clearActivePracticeSessionIfMatches(options.userId, sessionId)
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
