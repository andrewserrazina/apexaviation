import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileDpeDebrief, MobileDpeResumeTurn } from '../../shared/mobile-dto'
import { endDpeSession, resumeDpeSession, sendDpeMessage } from '../lib/api/dpe'
import { ApiError, logDevError } from '../lib/api/errors'
import { clearActiveOralSessionIfMatches } from '../lib/activeOralSessionStorage'

export interface DpeChatTurn {
  role: 'dpe' | 'student'
  message: string
  at: string
  // Client-generated turns (an optimistic student message not yet
  // confirmed by the server) get a local-only key so the chat list can
  // key/render them before the round trip completes.
  pending?: boolean
}

interface UseDpeSessionOptions {
  // Mirrors useAdHocPracticeSession's enabled gate -- must stay false
  // until bootstrap has resolved and confirmed the learner is entitled,
  // so a deep-linked or not-yet-resolved session route never fires a
  // premium resume call.
  enabled: boolean
  userId: string | null
}

function turnsFromResume(turns: MobileDpeResumeTurn[]): DpeChatTurn[] {
  return turns.map((t) => ({ role: t.role, message: t.message, at: t.at }))
}

// The Resume -> chat (send/receive) -> End -> Debrief controller for one
// AI DPE oral-practice session. Mirrors useAdHocPracticeSession.ts's
// resume/act/complete shape, simplified: there's no reveal/self-rate
// step, just message-in, response-out, matching web's dpe-chat exactly
// (fetch-per-turn, no streaming).
export function useDpeSession(sessionId: string, options: UseDpeSessionOptions) {
  const [resuming, setResuming] = useState(true)
  const [resumeError, setResumeError] = useState<ApiError | null>(null)

  const [turns, setTurns] = useState<DpeChatTurn[]>([])
  const [status, setStatus] = useState<'in_progress' | 'completed' | 'abandoned'>('in_progress')
  const [questionsAsked, setQuestionsAsked] = useState(0)
  const [debrief, setDebrief] = useState<MobileDpeDebrief | null>(null)

  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<ApiError | null>(null)
  // Debounces the Send button, same reasoning as useAdHocPracticeSession's
  // completeInFlight -- a single Claude turn already takes several
  // seconds; a double-tap must never fire two concurrent messages for
  // the same session (each of which would append its own transcript
  // turn server-side, with no dedup -- see mobile-dpe/index.ts's own
  // documented limitation).
  const sendInFlight = useRef(false)

  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState<ApiError | null>(null)

  const resume = useCallback(async () => {
    if (!options.enabled) return
    setResuming(true)
    setResumeError(null)
    try {
      const result = await resumeDpeSession(sessionId)
      setTurns(turnsFromResume(result.turns))
      setStatus(result.status)
      setQuestionsAsked(result.questionsAsked)
      setDebrief(result.debrief)
      if (result.status !== 'in_progress' && options.userId) {
        await clearActiveOralSessionIfMatches(options.userId, sessionId)
      }
    } catch (err) {
      logDevError('useDpeSession.resume', err)
      setResumeError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t resume this oral practice session.' }))
    } finally {
      setResuming(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, options.enabled, options.userId])

  useEffect(() => {
    // Same established shape as useAdHocPracticeSession.ts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (options.enabled) resume()
  }, [sessionId, options.enabled])

  const sendMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim()
      if (!trimmed || sendInFlight.current || status !== 'in_progress') return
      sendInFlight.current = true
      setSending(true)
      setSendError(null)

      // Optimistic append -- the chat should feel immediate even though
      // a Claude turn can take a few seconds. Marked `pending` so the
      // screen can render a subtle sent-but-unconfirmed affordance if it
      // wants to; never removed on success (the server's own turn is
      // simply appended after it).
      const optimisticAt = new Date().toISOString()
      setTurns((prev) => [...prev, { role: 'student', message: trimmed, at: optimisticAt, pending: true }])

      try {
        const result = await sendDpeMessage(sessionId, trimmed)
        setTurns((prev) => {
          // Clear the pending flag on the optimistic turn we just added
          // (matched by role+at, the only local-only identity we have)
          // and append the confirmed dpe turn.
          const confirmed = prev.map((t) => (t.role === 'student' && t.at === optimisticAt ? { ...t, pending: false } : t))
          return [...confirmed, { role: 'dpe', message: result.message, at: new Date().toISOString() }]
        })
        setStatus(result.status)
        setQuestionsAsked(result.questionsAsked)
        setDebrief(result.debrief)
        if (result.status === 'completed' && options.userId) {
          await clearActiveOralSessionIfMatches(options.userId, sessionId)
        }
      } catch (err) {
        logDevError('useDpeSession.sendMessage', err)
        // Roll back the optimistic bubble -- the server never confirmed
        // this turn, so showing it as sent would be a lie. The screen is
        // responsible for keeping the student's typed text available to
        // retry (this hook doesn't own the input field).
        setTurns((prev) => prev.filter((t) => !(t.role === 'student' && t.at === optimisticAt && t.pending)))
        setSendError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t send that. Please try again.' }))
      } finally {
        setSending(false)
        sendInFlight.current = false
      }
    },
    [sessionId, status, options.userId]
  )

  const endSession = useCallback(async () => {
    if (ending || status !== 'in_progress') return
    setEnding(true)
    setEndError(null)
    try {
      const result = await endDpeSession(sessionId)
      setTurns((prev) => [...prev, { role: 'dpe', message: result.message, at: new Date().toISOString() }])
      setStatus(result.status)
      setQuestionsAsked(result.questionsAsked)
      setDebrief(result.debrief)
      if (options.userId) await clearActiveOralSessionIfMatches(options.userId, sessionId)
    } catch (err) {
      logDevError('useDpeSession.endSession', err)
      setEndError(err instanceof ApiError ? err : new ApiError({ kind: 'server', userMessage: 'We couldn’t end the session. Please try again.' }))
    } finally {
      setEnding(false)
    }
  }, [sessionId, status, ending, options.userId])

  return {
    resuming,
    resumeError,
    retryResume: resume,

    turns,
    status,
    questionsAsked,
    debrief,

    sending,
    sendError,
    sendMessage,

    ending,
    endError,
    endSession,
  }
}
