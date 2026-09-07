// Typed client for mobile-practice -- reveal + complete are used by both
// the Daily Drill flow (against a v118-linked session_id) and Sprint 1B.1's
// ad-hoc practice flow. `start` creates an INDEPENDENT ad-hoc practice
// session (its own server-selected question set, optionally scoped to one
// ACS task) -- see the Practice hub's Quick/Standard/Weak Area cards.
// `resume` (v119) re-fetches the caller's own existing ad-hoc session
// after the client's in-memory state was lost (app restart, force-close,
// or simply navigating back to the Practice hub and tapping Continue
// Practice) -- it never creates a new attempt and never reorders the
// stored question set.
import type {
  MobilePracticeCompleteResponse,
  MobilePracticeRevealResponse,
  MobilePracticeResumeResponse,
  MobilePracticeStartResponse,
  SelfRating,
} from '../../../shared/mobile-dto'
import { invokeMobileFunction } from './client'
import { assertShape, isNonEmptyString, isNullableString, isPlainObject, isValidAcsTaskRef, isValidQuestion } from './validate'

// Sprint 1B.1 (independent review of the original Rev1 client): `start`
// and `resume` share the same render-critical shape -- a non-empty
// session_id/mode/started_at, a target_acs_tasks array of valid ACS task
// refs, and a NONEMPTY questions array of valid questions (an ad-hoc
// session with zero questions is never a legitimate response -- v119's
// backend fails closed to a 404 before ever creating one). `resume` adds
// one more field, completed_at, which `start` doesn't have at all.
interface CommonPracticeShape {
  session_id: unknown
  mode: unknown
  started_at: unknown
  target_acs_tasks: unknown[]
  questions: unknown[]
}

function assertCommonPracticeShape(data: unknown, context: string): CommonPracticeShape {
  assertShape(isPlainObject(data) && Array.isArray(data.target_acs_tasks) && Array.isArray(data.questions), context, data)
  const shape = data as CommonPracticeShape
  assertShape(isNonEmptyString(shape.session_id) && isNonEmptyString(shape.mode) && typeof shape.started_at === 'string', context, data)
  assertShape(shape.target_acs_tasks.every(isValidAcsTaskRef), context, data)
  assertShape(shape.questions.length > 0 && shape.questions.every(isValidQuestion), context, data)
  return shape
}

function validateStartResponse(data: unknown, context: string): MobilePracticeStartResponse {
  assertCommonPracticeShape(data, context)
  return data as MobilePracticeStartResponse
}

// completed_at is nullable on resume (an already-completed session still
// resumes cleanly, per v119) -- never required to be a string the way
// started_at is.
function validateResumeResponse(data: unknown, context: string): MobilePracticeResumeResponse {
  const shape = assertCommonPracticeShape(data, context)
  assertShape(isNullableString((shape as { completed_at?: unknown }).completed_at), context, data)
  return data as MobilePracticeResumeResponse
}

export async function startAdHocPractice(params?: { acs_task_id?: string; session_size?: number }): Promise<MobilePracticeStartResponse> {
  const data = await invokeMobileFunction<MobilePracticeStartResponse, { action: 'start'; acs_task_id?: string; session_size?: number }>(
    'mobile-practice',
    { action: 'start', ...params }
  )
  return validateStartResponse(data, 'startAdHocPractice')
}

export async function resumePractice(sessionId: string): Promise<MobilePracticeResumeResponse> {
  const data = await invokeMobileFunction<MobilePracticeResumeResponse, { action: 'resume'; session_id: string }>('mobile-practice', {
    action: 'resume',
    session_id: sessionId,
  })
  return validateResumeResponse(data, 'resumePractice')
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
  responses: { question_id: string; self_rating: SelfRating }[]
): Promise<MobilePracticeCompleteResponse> {
  const data = await invokeMobileFunction<
    MobilePracticeCompleteResponse,
    { action: 'complete'; session_id: string; responses: { question_id: string; self_rating: SelfRating }[] }
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
