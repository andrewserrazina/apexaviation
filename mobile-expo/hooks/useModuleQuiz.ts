import { useCallback, useRef, useState } from 'react'
import type { MobileModuleQuizQuestion } from '../../shared/mobile-dto'
import { recordGroundSchoolEvidence, submitModuleQuizAttempt } from '../lib/api/groundSchoolDirect'
import { refreshReadiness } from '../lib/api/readiness'
import { ApiError, logDevError } from '../lib/api/errors'

// Self-study, not a proctored exam -- correct answers/model answers
// arrive with the questions (mirrors dpe_questions' own model_answer
// trust model), and the score is computed client-side against that same
// payload, matching site/portal-stable.js's wireModuleQuizSection()
// exactly. Only multiple_choice questions are objectively scored; other
// question_types are self-graded free text and never contribute to
// score/total.
export function useModuleQuiz(profileId: string | null, courseId: string, moduleId: string, quiz: MobileModuleQuizQuestion[]) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [results, setResults] = useState<Record<string, boolean>>({})
  const [score, setScore] = useState(0)
  const [total, setTotal] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<ApiError | null>(null)
  const submitInFlight = useRef(false)

  const setAnswer = useCallback((questionId: string, value: string) => {
    setAnswers((a) => ({ ...a, [questionId]: value }))
  }, [])

  const submit = useCallback(async () => {
    if (submitInFlight.current || submitted || !profileId) return
    submitInFlight.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const mcQuestions = quiz.filter((q) => q.question_type === 'multiple_choice')
      const newResults: Record<string, boolean> = {}
      let newScore = 0
      mcQuestions.forEach((q) => {
        const isCorrect = answers[q.id] === q.correct_choice
        newResults[q.id] = isCorrect
        if (isCorrect) newScore++
      })
      const newTotal = mcQuestions.length

      const { id: attemptId } = await submitModuleQuizAttempt(profileId, courseId, moduleId, answers, newResults, newScore, newTotal)
      setResults(newResults)
      setScore(newScore)
      setTotal(newTotal)
      setSubmitted(true)

      // Sprint 3/4 evidence pipeline, ported verbatim: only questions with
      // a real content_acs_mappings row ever produce evidence (the RPC is
      // a no-op otherwise), and the readiness refresh waits for the whole
      // batch to settle so it always reflects every write this attempt
      // made, never a partial one. Both run detached from the UI's own
      // submitting state -- quiz-completion feedback is already shown
      // above and must never wait on either.
      const evidencePromises = Object.keys(newResults).map((qid) =>
        recordGroundSchoolEvidence(profileId, 'module_quiz_question', qid, `${attemptId}:${qid}`, newResults[qid], null).catch((err) =>
          logDevError('useModuleQuiz.recordGroundSchoolEvidence', err)
        )
      )
      Promise.allSettled(evidencePromises).then(() => {
        refreshReadiness().catch((err) => logDevError('useModuleQuiz.refreshReadiness', err))
      })
    } catch (err) {
      logDevError('useModuleQuiz.submit', err)
      setSubmitError(
        err instanceof ApiError
          ? err
          : new ApiError({ kind: 'server', userMessage: 'We couldn’t submit this quiz. Your answers above are still shown.' })
      )
    } finally {
      setSubmitting(false)
      submitInFlight.current = false
    }
  }, [answers, quiz, profileId, courseId, moduleId, submitted])

  return { answers, setAnswer, submitted, results, score, total, submitting, submitError, submit }
}
