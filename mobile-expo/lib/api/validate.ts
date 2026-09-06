// Narrow runtime invariant checks for the mobile-* API responses Sprint
// 1A actually renders. TypeScript types don't validate runtime JSON --
// this is deliberately NOT a schema-validation library, just the minimum
// shape assertions the UI depends on, so a malformed 200 response can
// never crash a render or leave the client in a non-completable state
// (Sprint 1A Rev2 section 9, hardened in Rev3 section 3). A failure here
// becomes the same normalized, user-safe ApiError every other failure
// mode produces -- the raw payload is only ever dev-logged.
import type { DrillStatus, EvidenceLevel } from '../../../shared/mobile-dto'
import { ApiError, logDevError } from './errors'

const MALFORMED_RESPONSE_MESSAGE = 'Something went wrong loading that. Please try again.'

const DRILL_STATUSES: readonly DrillStatus[] = ['pending', 'in_progress', 'completed']
const EVIDENCE_LEVELS: readonly EvidenceLevel[] = ['low', 'moderate', 'high']

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function assertShape(condition: boolean, context: string, raw: unknown): void {
  if (!condition) {
    logDevError(`${context}: malformed response shape`, raw)
    throw new ApiError({ kind: 'server', userMessage: MALFORMED_RESPONSE_MESSAGE, raw })
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

export function isDrillStatus(value: unknown): value is DrillStatus {
  return typeof value === 'string' && (DRILL_STATUSES as readonly string[]).includes(value)
}

export function isEvidenceLevel(value: unknown): value is EvidenceLevel {
  return typeof value === 'string' && (EVIDENCE_LEVELS as readonly string[]).includes(value)
}

// Shared by mobile-bootstrap's progress.readiness_summary and
// mobile-readiness's snapshot -- both are either null or must carry the
// exact fields components/ReadinessCard.tsx renders: overall_score,
// evidence_level, reason_codes. Deliberately does not require
// algorithm_version/computed_at to be present-and-typed here even though
// the DTO declares them -- neither is ever rendered, and Rev3 section 3
// says to validate what's "directly rendered/used," not the full DTO
// shape.
export function isValidReadinessSummaryOrNull(value: unknown): boolean {
  if (value === null) return true
  return (
    isPlainObject(value) &&
    typeof value.overall_score === 'number' &&
    Number.isFinite(value.overall_score) &&
    isEvidenceLevel(value.evidence_level) &&
    Array.isArray(value.reason_codes) &&
    value.reason_codes.every((code) => typeof code === 'string')
  )
}

// mobile-bootstrap's home.todays_drill -- either null or the render-safe
// shape TodaysDrillCard/Home actually use.
export function isValidTodaysDrillOrNull(value: unknown): boolean {
  if (value === null) return true
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    isDrillStatus(value.status) &&
    typeof value.estimated_minutes === 'number' &&
    Number.isFinite(value.estimated_minutes) &&
    Array.isArray(value.target_acs_tasks)
  )
}

// A Daily Drill question as the Sprint 1A UI actually consumes it
// (question/reveal screens) -- id/question text, optional category. Ad-hoc
// practice questions (mobile-practice start/resume) share this exact
// shape, so Sprint 1B.1 reuses this same validator rather than defining a
// second, identical one.
export function isValidQuestion(value: unknown): boolean {
  return isPlainObject(value) && isNonEmptyString(value.id) && typeof value.question === 'string' && isNullableString(value.category)
}

// Sprint 1B.1: an ACS task reference as rendered by TodaysDrillCard's chip
// row, the Practice hub's weak-area cards, and mobile-practice's
// target_acs_tasks -- the ACS task id plus the two display codes, nothing
// else (no fabricated title -- see practice.ts's isValidAcsTaskRef usage).
export function isValidAcsTaskRef(value: unknown): boolean {
  return isPlainObject(value) && isNonEmptyString(value.acs_task_id) && typeof value.area_code === 'string' && typeof value.task_code === 'string'
}
