// Narrow runtime invariant checks for the mobile-* API responses Sprint
// 1A actually renders. TypeScript types don't validate runtime JSON --
// this is deliberately NOT a schema-validation library, just the minimum
// shape assertions the UI depends on, so a malformed 200 response can
// never crash a render or leave the client in a non-completable state
// (Sprint 1A Rev2 section 9, hardened in Rev3 section 3). A failure here
// becomes the same normalized, user-safe ApiError every other failure
// mode produces -- the raw payload is only ever dev-logged.
import type { DpePhase, DpeSessionStatus, DrillStatus, EvidenceLevel, MobilePlatform, MobileStudyPackContent, ReadinessEvidenceLevel } from '../../../shared/mobile-dto'
import { ApiError, logDevError } from './errors'

const MALFORMED_RESPONSE_MESSAGE = 'Something went wrong loading that. Please try again.'

const DRILL_STATUSES: readonly DrillStatus[] = ['pending', 'in_progress', 'completed']
const EVIDENCE_LEVELS: readonly EvidenceLevel[] = ['low', 'moderate', 'high']
const MOBILE_PLATFORMS: readonly MobilePlatform[] = ['ios', 'android']
const READINESS_EVIDENCE_LEVELS: readonly ReadinessEvidenceLevel[] = ['none', 'limited', 'developing', 'strong']
const DPE_SESSION_STATUSES: readonly DpeSessionStatus[] = ['in_progress', 'completed', 'abandoned']
const DPE_PHASES: readonly DpePhase[] = ['question', 'followup', 'debrief']
const DPE_OVERALL_READINESS = ['ready', 'almost', 'not_yet'] as const
const DPE_DOMAIN_VERDICTS = ['strong', 'ok', 'weak'] as const

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

export function isReadinessEvidenceLevel(value: unknown): value is ReadinessEvidenceLevel {
  return typeof value === 'string' && (READINESS_EVIDENCE_LEVELS as readonly string[]).includes(value)
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isOptionalNullableFiniteNumber(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))
}

// V142/Sprint 4: mobile-readiness snapshot's category_breakdown -- now
// directly rendered by the ACS Explorer (app/(app)/acs.tsx), which keys
// EVIDENCE_COLOR/EVIDENCE_LABEL off evidence_level and calls
// Math.round(score) whenever score isn't null. An unrecognized
// evidence_level or a non-numeric score would crash that render (an
// undefined lookup's `.bg`/`.text`), so this validates every field the
// screen actually reads -- score stays null-or-finite-number (never
// fabricated), matching this type's own "score is null whenever
// evidence_level is 'none'" comment.
export function isValidReadinessCategoryBreakdown(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  return (
    isNonEmptyString(value.category) &&
    isNonEmptyString(value.label) &&
    (value.score === null || (typeof value.score === 'number' && Number.isFinite(value.score))) &&
    isReadinessEvidenceLevel(value.evidence_level) &&
    typeof value.attempt_volume === 'number' &&
    Number.isFinite(value.attempt_volume) &&
    typeof value.task_breadth_pct === 'number' &&
    Number.isFinite(value.task_breadth_pct) &&
    isOptionalFiniteNumber(value.assessable_task_count) &&
    isOptionalFiniteNumber(value.evidenced_task_count) &&
    typeof value.weak_task_count === 'number' &&
    Number.isFinite(value.weak_task_count) &&
    isOptionalFiniteNumber(value.strong_task_count) &&
    isNullableString(value.last_demonstrated_at) &&
    (value.ai_dpe_reason_code === null || value.ai_dpe_reason_code === 'recent_ai_dpe_weak')
  )
}

// Shared by mobile-bootstrap's progress.readiness_summary and
// mobile-readiness's snapshot -- both are either null or must carry the
// exact fields components/ReadinessCard.tsx renders: overall_score,
// evidence_level, reason_codes. Deliberately does not require
// algorithm_version/computed_at to be present-and-typed here even though
// the DTO declares them -- neither is ever rendered, and Rev3 section 3
// says to validate what's "directly rendered/used," not the full DTO
// shape.
//
// category_breakdown is additive/optional on the DTO -- absent on
// mobile-bootstrap's Pick<...> readiness_summary entirely, and absent on
// legacy pre-Sprint-4 mobile-readiness snapshot rows -- so it's only
// validated when present, never required. When it IS present (the ACS
// Explorer's data source), every element must satisfy
// isValidReadinessCategoryBreakdown -- see that function's own comment
// for the render crash a malformed element would otherwise cause.
export function isValidReadinessSummaryOrNull(value: unknown): boolean {
  if (value === null) return true
  if (
    !isPlainObject(value) ||
    typeof value.overall_score !== 'number' ||
    !Number.isFinite(value.overall_score) ||
    !isEvidenceLevel(value.evidence_level) ||
    !Array.isArray(value.reason_codes) ||
    !value.reason_codes.every((code) => typeof code === 'string')
  ) {
    return false
  }
  if (value.category_breakdown !== undefined && (!Array.isArray(value.category_breakdown) || !value.category_breakdown.every(isValidReadinessCategoryBreakdown))) {
    return false
  }
  // Sprint 4.1's top-level counts (the ACS Explorer's "N of M assessable
  // ACS tasks have evidence" line) -- same optional-additive shape as
  // category_breakdown, validated the same way when present.
  if (
    !isOptionalNullableFiniteNumber(value.assessable_task_count) ||
    !isOptionalNullableFiniteNumber(value.evidenced_task_count) ||
    !isOptionalNullableFiniteNumber(value.strong_task_count) ||
    !isOptionalNullableFiniteNumber(value.weak_task_count)
  ) {
    return false
  }
  return true
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

// V142: the ACS Explorer's task-level drill-down (mobile-readiness's
// 'tasks' action). Builds on isValidAcsTaskRef() the same way
// isValidWeakArea() does. evidence_summary is either null (no
// task_evidence row yet -- must render as an honest "no evidence yet,"
// never a fabricated 0) or an object with the same finite, 0..1-ranged
// evidence_score isValidWeakArea() already enforces.
export function isValidAcsTaskInfo(value: unknown): boolean {
  if (!isValidAcsTaskRef(value)) return false
  const v = value as Record<string, unknown>
  if (!isNonEmptyString(v.area_title) || !isNonEmptyString(v.task_title) || !isNonEmptyString(v.dpe_category)) return false
  if (typeof v.applicable !== 'boolean' || typeof v.content_available !== 'boolean') return false
  if (v.evidence_summary === null) return true
  if (!isPlainObject(v.evidence_summary)) return false
  const summary = v.evidence_summary
  return (
    typeof summary.attempt_count === 'number' &&
    Number.isFinite(summary.attempt_count) &&
    summary.attempt_count >= 0 &&
    typeof summary.evidence_score === 'number' &&
    Number.isFinite(summary.evidence_score) &&
    summary.evidence_score >= 0 &&
    summary.evidence_score <= 1
  )
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

// Sprint 1C Phase 7: the exact fields register/revoke/list actually
// render (registration-lifecycle bookkeeping, the Profile devices list) --
// mirrors mobile-push-token/index.ts's own select() column lists.
export function isValidMobilePlatform(value: unknown): value is MobilePlatform {
  return typeof value === 'string' && (MOBILE_PLATFORMS as readonly string[]).includes(value)
}

export function isValidMobileDevice(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    isValidMobilePlatform(value.platform) &&
    isNullableString(value.installation_id) &&
    isNullableString(value.app_version) &&
    isNonEmptyString(value.last_seen_at) &&
    isNonEmptyString(value.created_at)
  )
}

// Sprint 1C Phase 9: notification_preferences (v116) mirrored exactly --
// no field this validator doesn't require is ever read by the native
// preferences UI, and no field it does require is optional on the wire
// (get_preferences always returns all five, whether from a real row or
// the table-default fallback -- see mobile-push-token/index.ts).
export function isValidNotificationPreferences(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.daily_drill_enabled === 'boolean' &&
    typeof value.daily_drill_time === 'string' &&
    typeof value.checkride_countdown_enabled === 'boolean' &&
    typeof value.weak_area_enabled === 'boolean' &&
    typeof value.streak_enabled === 'boolean'
  )
}

// Phase 1 (AI DPE mobile): the exact fields DebriefView.tsx and the
// history list render -- overallReadiness drives a verdict badge,
// strengths/weaknesses render as two lists, perDomain as a per-ACS-area
// verdict row. Fails closed on the whole debrief (never a partially
// rendered assessment) rather than rendering an incomplete verdict.
export function isValidDpeDebrief(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  return (
    (DPE_OVERALL_READINESS as readonly string[]).includes(value.overallReadiness as string) &&
    typeof value.summary === 'string' &&
    isStringArray(value.strengths) &&
    isStringArray(value.weaknesses) &&
    Array.isArray(value.perDomain) &&
    value.perDomain.every(
      (d) =>
        isPlainObject(d) &&
        typeof d.domain === 'string' &&
        (DPE_DOMAIN_VERDICTS as readonly string[]).includes(d.verdict as string) &&
        typeof d.note === 'string'
    )
  )
}

function isValidDpeDebriefOrNull(value: unknown): boolean {
  return value === null || isValidDpeDebrief(value)
}

export function isDpeSessionStatus(value: unknown): value is DpeSessionStatus {
  return typeof value === 'string' && (DPE_SESSION_STATUSES as readonly string[]).includes(value)
}

export function isDpePhase(value: unknown): value is DpePhase {
  return typeof value === 'string' && (DPE_PHASES as readonly string[]).includes(value)
}

// The response shape for start/message/end -- one screen (the chat
// controller) renders all three identically, so one validator covers
// all three call sites.
export function isValidDpeTurnResponse(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.sessionId) &&
    isDpePhase(value.phase) &&
    typeof value.message === 'string' &&
    isValidDpeDebriefOrNull(value.debrief) &&
    typeof value.questionsAsked === 'number' &&
    Number.isFinite(value.questionsAsked) &&
    isDpeSessionStatus(value.status)
  )
}

// mobile-dpe's `resume` action -- reconstructs the chat screen after an
// app restart. Each turn must have a role/message/timestamp the chat
// bubble list can render directly; a malformed turn anywhere in the
// array fails the whole resume closed (never a chat with silent gaps).
export function isValidDpeResumeResponse(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  return (
    isNonEmptyString(value.sessionId) &&
    isDpeSessionStatus(value.status) &&
    typeof value.questionsAsked === 'number' &&
    Number.isFinite(value.questionsAsked) &&
    isValidDpeDebriefOrNull(value.debrief) &&
    Array.isArray(value.turns) &&
    value.turns.every(
      (t) => isPlainObject(t) && (t.role === 'dpe' || t.role === 'student') && typeof t.message === 'string' && typeof t.at === 'string'
    )
  )
}

// mobile-dpe's `history` action -- the session list + trend summary the
// Oral hub renders. debrief is nullable (an abandoned/in-progress
// session has none yet).
export function isValidDpeSessionSummary(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    isDpeSessionStatus(value.status) &&
    typeof value.questionsAsked === 'number' &&
    Number.isFinite(value.questionsAsked) &&
    isValidDpeDebriefOrNull(value.debrief) &&
    isNonEmptyString(value.startedAt) &&
    isNullableString(value.endedAt)
  )
}

export function isValidDpeHistoryResponse(value: unknown): boolean {
  return isPlainObject(value) && Array.isArray(value.sessions) && value.sessions.every(isValidDpeSessionSummary)
}

// Phase 2 (Review Queue mobile): the exact fields the Review hub/session
// screens render. `question` is nullable (only populated server-side for
// source_type === 'dpe_question', see shared/mobile-dto's comment) but
// must still be null-or-string, never e.g. a number, so a malformed
// non-dpe_question row can't crash a render the client never intended to
// attempt in the first place.
const REVIEW_SOURCE_TYPES = ['dpe_question', 'module_quiz_question', 'checkride_corner', 'scenario'] as const

export function isReviewSourceType(value: unknown): boolean {
  return typeof value === 'string' && (REVIEW_SOURCE_TYPES as readonly string[]).includes(value)
}

export function isValidReviewItem(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    isReviewSourceType(value.source_type) &&
    isNonEmptyString(value.source_id) &&
    isNullableString(value.module_id) &&
    isNullableString(value.acs_category) &&
    typeof value.reason === 'string' &&
    typeof value.priority === 'number' &&
    Number.isFinite(value.priority) &&
    typeof value.review_count === 'number' &&
    Number.isFinite(value.review_count) &&
    isNonEmptyString(value.next_review_at) &&
    isNullableString(value.question)
  )
}

export function isValidReviewQueueListResponse(value: unknown): boolean {
  return isPlainObject(value) && Array.isArray(value.items) && value.items.every(isValidReviewItem)
}

export function isValidReviewRevealResponse(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.review_item_id) &&
    typeof value.model_answer === 'string' &&
    isNullableString(value.common_mistakes) &&
    isNullableString(value.dpe_evaluating) &&
    isNullableString(value.real_world_application)
  )
}

export function isValidReviewOutcomeResponse(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.review_item_id) &&
    (value.outcome === 'reinforced' || value.outcome === 'needs_another_pass') &&
    isNonEmptyString(value.next_review_at) &&
    typeof value.was_replay === 'boolean'
  )
}
