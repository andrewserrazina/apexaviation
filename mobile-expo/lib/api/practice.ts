// Typed client for mobile-practice -- reveal + complete are used by the
// Daily Drill flow against a v118-linked session_id. `start` here creates
// an INDEPENDENT ad-hoc practice session (its own randomly-selected
// questions) -- Sprint 1A's UI does not expose ad-hoc practice yet (see
// the Practice tab's "more modes coming" placeholder), but the client is
// prepared per this Sprint's instruction to fully integrate this
// function's contract now.
import type {
  MobilePracticeCompleteResponse,
  MobilePracticeRevealResponse,
  MobilePracticeStartResponse,
  SelfRating,
} from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'

export function startAdHocPractice(params?: { acs_task_id?: string; session_size?: number }): Promise<MobilePracticeStartResponse> {
  return invokeMobileFunction<MobilePracticeStartResponse, { action: 'start'; acs_task_id?: string; session_size?: number }>(
    'mobile-practice',
    { action: 'start', ...params }
  )
}

export function revealQuestion(sessionId: string, questionId: string): Promise<MobilePracticeRevealResponse> {
  return invokeMobileFunction<MobilePracticeRevealResponse, { action: 'reveal'; session_id: string; question_id: string }>(
    'mobile-practice',
    { action: 'reveal', session_id: sessionId, question_id: questionId }
  )
}

export function completePractice(
  sessionId: string,
  responses: Array<{ question_id: string; self_rating: SelfRating }>
): Promise<MobilePracticeCompleteResponse> {
  return invokeMobileFunction<
    MobilePracticeCompleteResponse,
    { action: 'complete'; session_id: string; responses: Array<{ question_id: string; self_rating: SelfRating }> }
  >('mobile-practice', { action: 'complete', session_id: sessionId, responses })
}
