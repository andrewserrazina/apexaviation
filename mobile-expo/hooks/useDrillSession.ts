import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { MobilePracticeRevealResponse, SelfRating } from '../../shared/mobile-dto'
import { startDailyDrill } from '../lib/api/dailyDrill'
import { completePractice, revealQuestion } from '../lib/api/practice'
import { ApiError, logDevError } from '../lib/api/errors'
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

// The full Start/Resume -> Question -> Reveal -> Self-Rate -> Complete
// controller for one Daily Drill. `state.questions` (from the reducer) is
// the single source of truth for the question list -- there is no
// parallel copy of it in this hook's own useState, so it can never drift
// out of sync with `state.ratings`/`state.revealed`.
export function useDrillSession(drillId: string) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [drillStatus, setDrillStatus] = useState<'pending' | 'in_progress' | 'completed' | null>(null)
  const [starting, setStarting] = useState(true)
  const [startError, setStartError] = useState<ApiError | null>(null)

  const [state, dispatch] = useReducer(drillSessionReducer, createDrillSessionState([]))
  const [revealContent, setRevealContent] = useState<MobilePracticeRevealResponse | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [revealError, setRevealError] = useState<ApiError | null>(null)

  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<ApiError | null>(null)
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null)
  // Debounces the Complete Drill CTA: a second tap while the first
  // request is still in flight is dropped rather than firing a second
  // network call (Sprint 1A section 13).
  const completeInFlight = useRef(false)

  const start = useCallback(async () => {
    setStarting(true)
    setStartError(null)
    try {
      const result = await startDailyDrill(drillId)
      setSessionId(result.session_id)
      setDrillStatus(result.drill.status)

      const saved = result.session_id ? await loadDrillProgress(result.session_id) : null
      dispatch({
        type: 'initialize',
        questions: result.questions,
        ratings: saved?.ratings ?? {},
        revealed: toRevealedMap(saved?.revealedQuestionIds),
      })
    } catch (err) {
      logDevError('useDrillSession.start', err)
      setStartError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t start today’s drill.' }))
    } finally {
      setStarting(false)
    }
  }, [drillId])

  useEffect(() => {
    setSessionId(null)
    dispatch({ type: 'initialize', questions: [], ratings: {}, revealed: {} })
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillId])

  const q = currentQuestion(state)

  const reveal = useCallback(async () => {
    if (!sessionId || !q) return
    setRevealing(true)
    setRevealError(null)
    try {
      const content = await revealQuestion(sessionId, q.id)
      setRevealContent(content)
      dispatch({ type: 'reveal', questionId: q.id })
    } catch (err) {
      logDevError('useDrillSession.reveal', err)
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

  // Persist ratings/reveal progress locally after every change, keyed to
  // this session_id -- best-effort, see drillProgressStorage.ts.
  useEffect(() => {
    if (!sessionId || !state.questions.length) return
    saveDrillProgress({
      sessionId,
      ratings: state.ratings,
      revealedQuestionIds: Object.keys(state.revealed),
    })
  }, [sessionId, state.questions.length, state.ratings, state.revealed])

  const complete = useCallback(async () => {
    if (!sessionId || completeInFlight.current) return
    completeInFlight.current = true
    setCompleting(true)
    setCompleteError(null)
    try {
      const responses = buildCompleteResponses(state)
      const result = await completePractice(sessionId, responses)
      setCompleteResult({ score: result.score, total: result.total, alreadyCompleted: result.already_completed })
      await clearDrillProgress(sessionId)
    } catch (err) {
      logDevError('useDrillSession.complete', err)
      setCompleteError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t submit your drill. You can try again.' }))
    } finally {
      setCompleting(false)
      completeInFlight.current = false
    }
  }, [sessionId, state])

  return {
    sessionId,
    questions: state.questions,
    drillStatus,
    starting,
    startError,
    retryStart: start,

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

function toRevealedMap(ids: string[] | undefined): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const id of ids ?? []) map[id] = true
  return map
}
