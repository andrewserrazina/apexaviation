// Narrow runtime invariant checks for the mobile-* API responses Sprint
// 1A actually renders. TypeScript types don't validate runtime JSON --
// this is deliberately NOT a schema-validation library, just the minimum
// shape assertions the UI depends on, so a malformed 200 response can
// never crash a render or leave the client in a non-completable state
// (Sprint 1A Rev2 section 9, hardened in Rev3 section 3). A failure here
// becomes the same normalized, user-safe ApiError every other failure
// mode produces -- the raw payload is only ever dev-logged.
import type { DrillStatus, EvidenceLevel, MobileStudyPackContent } from '../../../shared/mobile-dto'
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

// Rev2 blocker 5: bootstrap's home.weak_areas was previously only checked
// to be an array -- Sprint 1B.1's Practice hub now directly renders
// weak_area.area_code/task_code/evidence_score AND passes acs_task_id
// straight through as a targeted Start's request body. An
// undefined/malformed acs_task_id can be silently OMITTED during JSON
// serialization, which would make v119's server interpret the request as
// GENERAL practice -- so a visually-targeted "Practice I.A" CTA must
// never be allowed to degrade into untargeted practice because of a
// malformed bootstrap payload. Builds on isValidAcsTaskRef() rather than
// duplicating its field checks, adding the two things a weak area
// specifically needs beyond a bare ACS task reference: non-empty display
// codes (an empty string is exactly as unusable to the UI as a missing
// one) and a finite evidence_score normalized to the same 0..1 range
// task_evidence.evidence_score is authoritatively stored in server-side
// (see supabase-portal-schema-v114-readiness-snapshots.sql's weak_tasks
// aggregation) -- never silently clamped.
export function isValidWeakArea(value: unknown): boolean {
  if (!isValidAcsTaskRef(value)) return false
  const v = value as Record<string, unknown>
  return (
    isNonEmptyString(v.area_code) &&
    isNonEmptyString(v.task_code) &&
    typeof v.evidence_score === 'number' &&
    Number.isFinite(v.evidence_score) &&
    v.evidence_score >= 0 &&
    v.evidence_score <= 1
  )
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

// Sprint 1C: a mobile-library `content` action response's Study Pack
// summary card -- the exact fields the Library catalog screen renders,
// plus `owned`, the one server-authoritative ownership signal (see
// portal/supabase/functions/mobile-library/index.ts's catalog action).
// The client must never infer ownership itself -- this validator exists
// so a malformed/missing `owned` on one pack can't silently be read as
// falsy-but-present and misrender as locked, or crash the map/render.
export function isValidStudyPackSummary(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNullableString(value.subtitle) &&
    typeof value.price_cents === 'number' &&
    Number.isFinite(value.price_cents) &&
    typeof value.currency === 'string' &&
    typeof value.certificate_type === 'string' &&
    (value.estimated_minutes_min === null || typeof value.estimated_minutes_min === 'number') &&
    (value.estimated_minutes_max === null || typeof value.estimated_minutes_max === 'number') &&
    typeof value.sort_order === 'number' &&
    typeof value.owned === 'boolean'
  )
}

// Sprint 1C Phase 0/1: the narrowest truthful runtime model of
// study_pack_versions.content the native Library pack renderer needs --
// see shared/mobile-dto's MobileStudyPackContent doc comment for exactly
// which wire fields this deliberately excludes and why. Fails closed
// (rejects the whole response) rather than rendering a partially-valid
// pack with missing sections, per Sprint 1C's "never fabricate missing
// sections" instruction -- a Library pack detail screen either shows the
// real, complete content or a safe error, never a half-populated pack.
const LESSON_SECTION_KEYS = ['what_is_it', 'why_it_matters', 'flight_operations', 'adm_legal_vs_wise', 'checkride_connection', 'safety_connection'] as const

function isValidLessonSections(value: unknown): boolean {
  return isPlainObject(value) && LESSON_SECTION_KEYS.every((key) => isStringArray(value[key]))
}

function isValidKnowledgeCheckQuestion(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    typeof value.question_number === 'number' &&
    isNonEmptyString(value.question) &&
    isNonEmptyString(value.correct_answer) &&
    typeof value.explanation === 'string' &&
    isNullableString(value.common_mistake)
  )
}

function isValidLesson(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    typeof value.lesson_number === 'number' &&
    isNonEmptyString(value.title) &&
    typeof value.estimated_time === 'string' &&
    isStringArray(value.intro) &&
    isValidLessonSections(value.sections) &&
    Array.isArray(value.knowledge_check) &&
    value.knowledge_check.every(isValidKnowledgeCheckQuestion)
  )
}

function isValidScenario(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    typeof value.scenario_number === 'number' &&
    isNonEmptyString(value.title) &&
    typeof value.situation === 'string' &&
    typeof value.decision_point === 'string' &&
    typeof value.student_commitment_prompt === 'string' &&
    typeof value.reveal_discussion === 'string' &&
    typeof value.recommended_action === 'string' &&
    typeof value.debrief === 'string'
  )
}

function isValidCheckrideQuestion(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    typeof value.question_number === 'number' &&
    isNonEmptyString(value.topic) &&
    isNonEmptyString(value.question) &&
    isNonEmptyString(value.difficulty_label) &&
    typeof value.model_answer === 'string' &&
    typeof value.common_student_mistake === 'string' &&
    isNullableString(value.dpe_follow_up) &&
    isNullableString(value.strong_follow_up_answer)
  )
}

function isValidMasteryOption(value: unknown): boolean {
  return isPlainObject(value) && isNonEmptyString(value.key) && typeof value.text === 'string'
}

function isValidMasteryQuestion(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    typeof value.question === 'string' &&
    Array.isArray(value.options) &&
    value.options.every(isValidMasteryOption) &&
    isNonEmptyString(value.correct_option) &&
    typeof value.explanation === 'string'
  )
}

function isValidMasteryCheck(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    Array.isArray(value.questions) &&
    value.questions.every(isValidMasteryQuestion) &&
    typeof value.passing_percent === 'number' &&
    typeof value.retakes_allowed === 'boolean'
  )
}

function isValidQuickReferenceTable(value: unknown): boolean {
  return isPlainObject(value) && Array.isArray(value.rows) && value.rows.every(isStringArray)
}

function isValidQuickReferenceSection(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.title === 'string' &&
    Array.isArray(value.tables) &&
    value.tables.every(isValidQuickReferenceTable) &&
    isStringArray(value.paragraphs)
  )
}

function isValidQuickReference(value: unknown): boolean {
  return isPlainObject(value) && Array.isArray(value.sections) && value.sections.every(isValidQuickReferenceSection)
}

export function isValidStudyPackContent(value: unknown): value is MobileStudyPackContent {
  return (
    isPlainObject(value) &&
    isPlainObject(value.product) &&
    typeof value.product.name === 'string' &&
    Array.isArray(value.lessons) &&
    value.lessons.every(isValidLesson) &&
    Array.isArray(value.scenarios) &&
    value.scenarios.every(isValidScenario) &&
    Array.isArray(value.checkride_corner) &&
    value.checkride_corner.every(isValidCheckrideQuestion) &&
    isValidMasteryCheck(value.mastery_check) &&
    isValidQuickReference(value.quick_reference)
  )
}
