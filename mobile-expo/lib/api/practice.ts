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
import { assertShape, isNonEmptyString, isNullableString, isPlainObject } from './validate'

export function startAdHocPractice(params?: { acs_task_id?: string; session_size?: number }): Promise<MobilePracticeStartResponse> {
  return invokeMobileFunction<MobilePracticeStartResponse, { action: 'start'; acs_task_id?: string; session_size?: number }>(
    'mobile-practice',
    { action: 'start', ...params }
  )
}

export async function revealQuestion(sessionId: string, questionId: string): Promise<MobilePracticeRevealResponse> {
  const data = await invokeMobileFunction<MobilePracticeRevealResponse, { action: 'reveal'; session_id: string; question_id: string }>(
    'mobile-practice',
    { action: 'reveal', session_id: sessionId, question_id: questionId }
  )
  // Sprint 1A Rev2 section 9 (hardened Rev3 section 3): the reveal screen
  // renders model_answer unconditionally, and common_mistakes/
  // dpe_evaluating/real_world_application only when non-null -- so all
  // four must actually be null-or-string, never e.g. a number or object
  // that would reach RevealContent's render logic unchecked.
  assertShape(
    isPlainObject(data) &&
      isNonEmptyString(data.question_id) &&
      typeof data.model_answer === 'string' &&
      isNullableString(data.common_mistakes) &&
      isNullableString(data.dpe_evaluating) &&
      isNullableString(data.real_world_application),
    'revealQuestion',
    data
  )
  return data
}

export async function completePractice(
  sessionId: string,
  responses: Array<{ question_id: string; self_rating: SelfRating }>
): Promise<MobilePracticeCompleteResponse> {
  const data = await invokeMobileFunction<
    MobilePracticeCompleteResponse,
    { action: 'complete'; session_id: string; responses: Array<{ question_id: string; self_rating: SelfRating }> }
  >('mobile-practice', { action: 'complete', session_id: sessionId, responses })
  // The completion screen renders score/total directly and branches on
  // already_completed -- all three (plus completed_at, echoed back but
  // not currently rendered) must be usable. Rev3 section 3: score/total
  // must additionally be finite, non-negative numbers -- a NaN, negative,
  // or Infinity value would still pass a bare `typeof === 'number'`
  // check but render as garbage on the completion screen.
  assertShape(
    isPlainObject(data) &&
      typeof data.score === 'number' &&
      Number.isFinite(data.score) &&
      data.score >= 0 &&
      typeof data.total === 'number' &&
      Number.isFinite(data.total) &&
      data.total >= 0 &&
      typeof data.completed_at === 'string' &&
      typeof data.already_completed === 'boolean',
    'completePractice',
    data
  )
  return data
}
