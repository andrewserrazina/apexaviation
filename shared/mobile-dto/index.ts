// Apex Advantage -- Sprint 0 Phase C mobile API contract types (C11).
//
// This file is intentionally dependency-free (plain interfaces and type
// aliases only, no imports). That is the whole point of its location:
// it lives OUTSIDE portal/src (the web app's Vite build) and OUTSIDE
// mobile/ (the existing Capacitor web-view wrapper app) so that neither
// picks up a React Native dependency, and it is plain enough TypeScript
// that a future Expo/React Native app, a Deno Edge Function, and a
// Node-based test/tooling script can all import it unmodified.
//
// These types describe the WIRE SHAPE returned by the mobile-* Edge
// Functions in portal/supabase/functions/. They are hand-kept in sync
// with those functions today (Sprint 0 has no generated-types pipeline
// for Edge Function responses); if the Edge Functions and this file
// ever disagree, the Edge Function source is the source of truth --
// update this file to match it, not the other way around.
//
// NOT YET DEPLOYED / NOT YET CONSUMED. Source-controlled only, ahead of
// Sprint 1 Expo development (which has not started -- see the Sprint 0
// report's stop gate).
//
// REV2: added MobilePracticeRevealRequest/Response for the new `reveal`
// action (REV2.9), ReadinessReasonCode for the new insufficient_content_
// coverage code (REV2.14), and MobilePracticeCompleteRequest's session_id
// param is now routed through complete_mobile_practice_session() -- see
// that RPC in v113 -- rather than orchestrated client-side; the wire shape
// of the request/response is unchanged.
//
// REV3: added AircraftClass and MobileTrainingContext (surfaced on
// mobile-bootstrap per REV3.15 -- the client must never infer its own
// certificate_type/aircraft_class/acs_version), and MobileAcsTaskInfo for a
// future ACS map screen (REV3.14) -- not wired to any endpoint yet, kept
// here so the shape is agreed on ahead of that screen's construction.
// error_codes.ts-style validation codes for mobile-practice `complete`
// (REV3.13) are plain string literals in each response type below rather
// than a separate enum, matching how the Edge Function actually emits them.

// ---------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------

export type EvidenceLevel = 'low' | 'moderate' | 'high'
export type DrillStatus = 'pending' | 'in_progress' | 'completed'
export type MobilePlatform = 'ios' | 'android'
export type SelfRating = 'correct' | 'incorrect' | 'partial'
export type AircraftClass = 'ASEL' | 'AMEL' | 'ASES' | 'AMES'

export interface MobileAcsTaskRef {
  acs_task_id: string
  area_code: string
  task_code: string
}

// REV3.4/3.15: the one resolved training context every mobile surface
// (bootstrap, readiness, Daily Drill) is scoped to. The client renders
// this; it never computes or guesses any part of it.
export interface MobileTrainingContext {
  certificate_type: string
  aircraft_class: AircraftClass
  acs_version: string | null
}

// REV3.14: shape for a future ACS map/coverage screen. Wired to
// mobile-readiness's 'tasks' action (V142, ACS Explorer's task-level
// drill-down). Deliberately does not expose acs_task_applicability or
// content_acs_mappings row shapes directly.
export interface MobileAcsTaskInfo extends MobileAcsTaskRef {
  area_title: string
  task_title: string
  // V142: which of the 9 real dpe_categories (category_breakdown's own
  // `category` field) this task rolls up under -- lets a client group
  // this flat task list under the category card the learner tapped,
  // without a second lookup.
  dpe_category: string
  applicable: boolean
  content_available: boolean
  evidence_summary: { attempt_count: number; evidence_score: number } | null
}

// V142: mobile-readiness's 'tasks' action response. Scoped to exactly
// the same digital-assessment-supported task set
// compute_readiness_snapshot() already uses to build category_breakdown
// (get_readiness_scoped_acs_tasks()), so this list's per-category counts
// always agree with category_breakdown's assessable_task_count/
// evidenced_task_count for the same category.
export interface MobileAcsTaskBreakdownResponse {
  tasks: MobileAcsTaskInfo[]
}

// REV2: known reason_codes values, for consumers that want to render
// specific limitation copy rather than a generic string. Not exhaustive by
// type (reason_codes is still string[] at the wire level, new codes can
// appear without a type change) -- this is a reference list, not a closed
// enum.
//   low_sample_size                    -- <10 total attempts across all tasks
//   confidence_calibration_not_yet_available -- no real confidence capture exists yet (v1 placeholder)
//   score_change_dampened              -- a >15pt swing was clamped (single-session-swing guard)
//   insufficient_content_coverage      -- (REV2.14) at least one ACS task in the
//     active version has zero Apex content mapped to it -- the learner is
//     not being scored down for content Apex hasn't written yet, but the
//     coverage denominator still includes that task honestly.
export type ReadinessReasonCode =
  | 'low_sample_size'
  | 'confidence_calibration_not_yet_available'
  | 'score_change_dampened'
  | 'insufficient_content_coverage'
  | (string & {})

// Sprint 3 (algorithm_version 'v2'): a more accurate, two-dimensional
// evidence_level (none/limited/developing/strong, from a volume x
// breadth rule) than the top-level MobileReadinessSummary.evidence_level
// still uses -- see EvidenceLevel's own comment for why the top-level
// field deliberately keeps its original 3-value vocabulary. `category`
// is one of Apex's existing dpe_categories ids (the student-facing
// taxonomy), not an FAA Area of Operation code -- acs_tasks.dpe_category
// is a display-rollup layer on top of the real ACS task structure, not
// a claim that a dpe_category *is* an Area of Operation. `score` is
// null whenever evidence_level is 'none' -- never a fabricated 0%.
export type ReadinessEvidenceLevel = 'none' | 'limited' | 'developing' | 'strong'
export interface ReadinessCategoryBreakdown {
  category: string
  label: string
  score: number | null
  evidence_level: ReadinessEvidenceLevel
  attempt_volume: number
  task_breadth_pct: number
  // Sprint 4: exact integer counts alongside the pre-existing percentage
  // fields above -- a consumer that needs to state "N of M tasks have
  // evidence" must use these, not reverse-engineer them from the rounded
  // task_breadth_pct (which cannot reliably reconstruct the original
  // numerator/denominator). assessable_task_count is the category's own
  // scoped-task denominator (sums to the full digitally-assessable task
  // count across all categories); evidenced_task_count is how many of
  // those have attempt_count > 0. Additive fields, present on 'v2'
  // snapshots computed after this sprint; absent on older 'v2' rows
  // computed before it.
  assessable_task_count?: number
  evidenced_task_count?: number
  weak_task_count: number
  strong_task_count?: number
  last_demonstrated_at: string | null
  ai_dpe_reason_code: 'recent_ai_dpe_weak' | null
}

// A training-readiness INDICATOR, never a pass-probability estimate.
// Every consumer of this type must render evidence_level and
// reason_codes alongside overall_score -- never overall_score alone --
// and must never phrase any of these fields as "chance of passing."
export interface MobileReadinessSummary {
  overall_score: number
  coverage_score: number
  knowledge_score: number
  risk_management_score: number
  confidence_score: number
  evidence_level: EvidenceLevel
  weak_tasks: Array<MobileAcsTaskRef & { evidence_score: number }>
  reason_codes: ReadinessReasonCode[]
  // Sprint 3, additive -- present on every 'v2' snapshot, empty on
  // historical 'v1' rows. Not yet consumed by ReadinessCard.tsx (the
  // only mobile screen that renders this type today); the web Readiness
  // Detail view is the current sole consumer. A future mobile sprint can
  // wire a per-category breakdown screen against this same field without
  // any further backend change.
  category_breakdown?: ReadinessCategoryBreakdown[]
  algorithm_version: string
  computed_at: string
  // Sprint 4.1, additive -- present (non-null) on every 'v3' snapshot,
  // null on historical 'v1'/'v2' rows. Same not-yet-consumed status as
  // category_breakdown above: exposed for a future mobile screen, not
  // read by ReadinessCard.tsx today.
  assessable_task_count?: number | null
  evidenced_task_count?: number | null
  strong_task_count?: number | null
  weak_task_count?: number | null
}

// ---------------------------------------------------------------------
// mobile-bootstrap (POST, no action -- single call after sign-in)
// ---------------------------------------------------------------------

export interface MobileBootstrapDTO {
  user: {
    id: string
    full_name: string | null
    email: string | null
    // App-role UI handling only (e.g. an instructor-specific screen).
    // Never a content gate on its own -- every underlying table/RPC
    // still enforces its own entitlement/RLS regardless of this value.
    role: string | null
  }
  training: MobileTrainingContext & {
    checkride_date: string | null
  }
  access: {
    checkride_prep: boolean
    ground_school_pack: boolean
    study_pack_entitlements: string[]
  }
  progress: {
    xp: number
    current_rank: string | null
    current_streak: number
    longest_streak: number
    readiness_summary: Pick<
      MobileReadinessSummary,
      'overall_score' | 'evidence_level' | 'algorithm_version' | 'reason_codes' | 'computed_at'
    > | null
  }
  home: {
    todays_drill: {
      id: string
      status: DrillStatus
      estimated_minutes: number
      target_acs_tasks: MobileAcsTaskRef[]
    } | null
    weak_areas: Array<MobileAcsTaskRef & { evidence_score: number }>
  }
}

// ---------------------------------------------------------------------
// mobile-practice (POST action: 'start' | 'complete')
// ---------------------------------------------------------------------

export interface MobilePracticeStartRequest {
  action: 'start'
  acs_task_id?: string
  session_size?: number // 1-20, default 10
}

export interface MobilePracticeQuestion {
  id: string
  question: string
  category: string | null
}

export interface MobilePracticeStartResponse {
  session_id: string
  mode: string
  started_at: string
  target_acs_tasks: MobileAcsTaskRef[]
  questions: MobilePracticeQuestion[]
}

export interface MobilePracticeCompleteRequest {
  action: 'complete'
  session_id: string
  responses: Array<{ question_id: string; self_rating: SelfRating }>
}

export interface MobilePracticeCompleteResponse {
  session_id: string
  score: number
  total: number
  completed_at: string
  already_completed: boolean
}

// REV2.9: QUESTION -> answer out loud -> REVEAL -> self-rate. Server
// verifies session ownership and that question_id belongs to that session
// before returning any debrief field -- never a generic question-bank dump.
export interface MobilePracticeRevealRequest {
  action: 'reveal'
  session_id: string
  question_id: string
}

export interface MobilePracticeRevealResponse {
  question_id: string
  model_answer: string
  common_mistakes: string | null
  dpe_evaluating: string | null
  real_world_application: string | null
}

// V119: authenticated resume -- re-fetch a caller's own in-progress or
// completed ad-hoc practice session after the client lost its in-memory
// state (restart, force-close). Never creates a new attempt, never
// reorders/reshuffles the stored question set, never returns debrief
// fields (model_answer / common_mistakes / dpe_evaluating /
// real_world_application) -- those still only come from `reveal`.
export interface MobilePracticeResumeRequest {
  action: 'resume'
  session_id: string
}

export interface MobilePracticeResumeResponse {
  session_id: string
  mode: string
  started_at: string
  completed_at: string | null
  target_acs_tasks: MobileAcsTaskRef[]
  questions: MobilePracticeQuestion[]
}

// ---------------------------------------------------------------------
// mobile-readiness (POST action: 'latest' (default) | 'refresh')
// ---------------------------------------------------------------------

export interface MobileReadinessResponse {
  snapshot: MobileReadinessSummary | null
  refreshed: boolean
}

// ---------------------------------------------------------------------
// mobile-daily-drill (POST, no action = fetch-or-create; action: 'start')
// ---------------------------------------------------------------------

export interface MobileDailyDrill {
  id: string
  drill_date: string
  status: DrillStatus
  estimated_minutes: number
  target_acs_tasks: MobileAcsTaskRef[]
  started_at: string | null
  completed_at: string | null
  // v118: the portal_practice_attempts row backing this drill, created (or
  // resumed) via start_daily_drill_practice_session(). null until the
  // learner has called `start` on this drill at least once. Once set, the
  // client drives reveal/complete through the existing mobile-practice
  // contract using this id -- it is not a separate practice concept.
  session_id: string | null
}

// Returned by both the default (fetch-or-create) action and the `start`
// action. For the normal pending/in_progress case, `start` creates or
// resumes a real session and session_id is non-null on the returned
// drill. The one deliberate exception: a completed drill that has no
// linked session (a shape today's generation code never produces, but the
// v118 bridge's start_daily_drill_practice_session() RPC explicitly
// tolerates rather than assumes impossible) returns the completed drill
// as-is with session_id still null and creates nothing -- callers must
// not assume `start` always yields a non-null session_id and must honor
// the nullable type. session_id is surfaced redundantly at the top level
// below so callers don't have to reach into `drill` for it.
export interface MobileDailyDrillResponse {
  drill: MobileDailyDrill
  session_id: string | null
  questions: MobilePracticeQuestion[]
}

export interface MobileDailyDrillStartRequest {
  action: 'start'
  drill_id: string
}

// ---------------------------------------------------------------------
// mobile-library (POST, no action = catalog; action: 'content')
// ---------------------------------------------------------------------

export interface MobileStudyPackSummary {
  id: string
  name: string
  subtitle: string | null
  price_cents: number
  currency: string
  certificate_type: string
  estimated_minutes_min: number | null
  estimated_minutes_max: number | null
  sort_order: number
  owned: boolean
}

export interface MobileLibraryCatalogResponse {
  packs: MobileStudyPackSummary[]
}

export interface MobileLibraryContentRequest {
  action: 'content'
  pack_id: string
}

// Sprint 1C Phase 0: a READ-ONLY production inspection of the one
// published pack/version (airspace_mastery v1.0.0) established this
// shape, cross-checked field-for-field against the existing trusted
// renderer (site/portal-stable.js's Study Pack engine) -- every field
// below is one that renderer actually reads; nothing here was guessed.
// study_pack_versions.content carries additional top-level keys this
// type deliberately omits because the web renderer itself never surfaces
// them to a learner: $schema, schema_name, schema_version, architecture,
// source_verification, content_freeze_notice, export_generated_from,
// quality_control_notes, completion_requirements, learning_objectives,
// acs_mapping, graphics_manifest -- plus each lesson's own
// portal_presentation_guidance section (content-team authoring
// direction, not student-facing copy -- see SP_LESSON_SECTION_LABELS in
// portal-stable.js) and each scenario's self_rating_options/
// source_self_rating_text/extra (present on the wire but never read by
// the renderer, which hardcodes its own confident/needs_review buttons).
// Only one pack/version exists in production today, so this has not been
// cross-checked against a second pack -- a future pack whose content
// doesn't match this shape fails closed as a normal malformed-content
// error (see lib/api/library.ts), it does not crash the renderer.
export interface MobileStudyPackLessonSections {
  what_is_it: string[]
  why_it_matters: string[]
  flight_operations: string[]
  adm_legal_vs_wise: string[]
  checkride_connection: string[]
  safety_connection: string[]
}

export interface MobileStudyPackKnowledgeCheckQuestion {
  id: string
  question_number: number
  question: string
  correct_answer: string
  explanation: string
  common_mistake: string | null
}

export interface MobileStudyPackLesson {
  id: string
  lesson_number: number
  title: string
  estimated_time: string
  intro: string[]
  sections: MobileStudyPackLessonSections
  knowledge_check: MobileStudyPackKnowledgeCheckQuestion[]
}

export interface MobileStudyPackScenario {
  id: string
  scenario_number: number
  title: string
  situation: string
  decision_point: string
  student_commitment_prompt: string
  reveal_discussion: string
  recommended_action: string
  debrief: string
}

export interface MobileStudyPackCheckrideQuestion {
  id: string
  question_number: number
  topic: string
  question: string
  difficulty_label: string
  model_answer: string
  common_student_mistake: string
  dpe_follow_up: string | null
  strong_follow_up_answer: string | null
}

export interface MobileStudyPackMasteryOption {
  key: string
  text: string
}

export interface MobileStudyPackMasteryQuestion {
  id: string
  question: string
  options: MobileStudyPackMasteryOption[]
  correct_option: string
  explanation: string
}

export interface MobileStudyPackMasteryCheck {
  questions: MobileStudyPackMasteryQuestion[]
  passing_percent: number
  retakes_allowed: boolean
}

export interface MobileStudyPackQuickReferenceTable {
  rows: string[][]
}

export interface MobileStudyPackQuickReferenceSection {
  title: string
  tables: MobileStudyPackQuickReferenceTable[]
  paragraphs: string[]
}

export interface MobileStudyPackQuickReference {
  sections: MobileStudyPackQuickReferenceSection[]
}

export interface MobileStudyPackContent {
  product: { name: string }
  lessons: MobileStudyPackLesson[]
  scenarios: MobileStudyPackScenario[]
  checkride_corner: MobileStudyPackCheckrideQuestion[]
  mastery_check: MobileStudyPackMasteryCheck
  quick_reference: MobileStudyPackQuickReference
}

export interface MobileLibraryContentResponse {
  version: string
  content: MobileStudyPackContent
}

// ---------------------------------------------------------------------
// mobile-push-token (POST action: 'register' | 'revoke' | 'get_preferences'
// | 'update_preferences' | list (default))
// ---------------------------------------------------------------------

export interface MobileDeviceDTO {
  id: string
  platform: MobilePlatform
  installation_id: string | null
  app_version: string | null
  last_seen_at: string
  created_at: string
}

export interface MobilePushTokenRegisterRequest {
  action: 'register'
  platform: MobilePlatform
  expo_push_token: string
  installation_id?: string
  app_version?: string
}

export interface MobilePushTokenRegisterResponse {
  device: MobileDeviceDTO
}

export interface MobilePushTokenRevokeRequest {
  action: 'revoke'
  device_id: string
}

export interface MobilePushTokenRevokeResponse {
  device: MobileDeviceDTO
}

export interface MobilePushTokenListResponse {
  devices: MobileDeviceDTO[]
}

// Sprint 1C Phase 9: notification_preferences already exists in
// production (v116) with these exact field names/defaults -- this DTO
// intentionally mirrors the table 1:1 rather than inventing a different
// client-facing shape, and adds no field the table doesn't already have.
// daily_drill_time is the table's `time` column, serialized as
// "HH:MM:SS" the way postgrest/supabase-js already returns `time` columns
// -- never reinterpreted as a Date or combined with any timezone (the
// table comment is explicit that profiles.timezone is the only source of
// truth for a learner's local time).
export interface MobileNotificationPreferences {
  daily_drill_enabled: boolean
  daily_drill_time: string
  checkride_countdown_enabled: boolean
  weak_area_enabled: boolean
  streak_enabled: boolean
}

export interface MobileGetPreferencesRequest {
  action: 'get_preferences'
}

export interface MobilePreferencesResponse {
  preferences: MobileNotificationPreferences
}

// Every field optional -- update_preferences is a partial merge (upsert),
// never a full-object replace, so a client only ever sends the one
// toggle/time the learner actually changed.
export interface MobileUpdatePreferencesRequest {
  action: 'update_preferences'
  daily_drill_enabled?: boolean
  daily_drill_time?: string
  checkride_countdown_enabled?: boolean
  weak_area_enabled?: boolean
  streak_enabled?: boolean
}

// ---------------------------------------------------------------------
// mobile-dpe (POST action: 'start' | 'message' | 'end' | 'resume' | 'history')
//
// Text-first native port of dpe-chat (web)'s AI DPE oral-exam
// simulator. start/message/end mirror dpe-chat's own wire shape exactly
// (same fields, same semantics) -- see portal/supabase/functions/
// _shared/dpeChatCore.ts for the shared conversation mechanics both
// platforms drive. resume and history are mobile-only additions (a
// phone gets backgrounded/killed far more than a browser tab stays
// open) -- see mobile-dpe/index.ts's own header comment.
// ---------------------------------------------------------------------

export type DpeSessionStatus = 'in_progress' | 'completed' | 'abandoned'
export type DpePhase = 'question' | 'followup' | 'debrief'

export interface MobileDpeDebrief {
  overallReadiness: 'ready' | 'almost' | 'not_yet'
  summary: string
  strengths: string[]
  weaknesses: string[]
  perDomain: Array<{ domain: string; verdict: 'strong' | 'ok' | 'weak'; note: string }>
}

export interface MobileDpeStartRequest {
  action: 'start'
}

export interface MobileDpeMessageRequest {
  action: 'message'
  sessionId: string
  message: string
}

export interface MobileDpeEndRequest {
  action: 'end'
  sessionId: string
}

// Identical response shape for start/message/end -- the client's
// message-handling code is one function regardless of which action
// produced the turn (mirrors web's own handleTurn()).
export interface MobileDpeTurnResponse {
  sessionId: string
  phase: DpePhase
  message: string
  debrief: MobileDpeDebrief | null
  questionsAsked: number
  status: DpeSessionStatus
}

export interface MobileDpeResumeRequest {
  action: 'resume'
  sessionId: string
}

export interface MobileDpeResumeTurn {
  role: 'dpe' | 'student'
  message: string
  at: string
}

export interface MobileDpeResumeResponse {
  sessionId: string
  status: DpeSessionStatus
  questionsAsked: number
  debrief: MobileDpeDebrief | null
  turns: MobileDpeResumeTurn[]
}

export interface MobileDpeHistoryRequest {
  action: 'history'
  limit?: number // 1-50, default 10
}

export interface MobileDpeSessionSummary {
  id: string
  status: DpeSessionStatus
  questionsAsked: number
  debrief: MobileDpeDebrief | null
  startedAt: string
  endedAt: string | null
}

export interface MobileDpeHistoryResponse {
  sessions: MobileDpeSessionSummary[]
}

// ---------------------------------------------------------------------
// mobile-review-queue (POST action: 'list' (default) | 'reveal' | 'outcome')
// ---------------------------------------------------------------------
//
// Phase 2 (Review Queue mobile): mirrors sync_review_queue()/
// record_review_outcome() (Sprint 4/4.1) exactly -- no new backend
// scheduling logic, just a mobile-facing read/reveal/outcome surface over
// the same portal_review_items table web already drives. `list` returns
// EVERY active/due source_type unfiltered (dpe_question,
// module_quiz_question, checkride_corner, scenario) so a later phase that
// adds Ground School content rendering needs no v2 of this response --
// the mobile client itself is the only thing that currently filters down
// to dpe_question-sourced items (the only type it can resolve display
// content for today).

export type ReviewSourceType = 'dpe_question' | 'module_quiz_question' | 'checkride_corner' | 'scenario'
export type ReviewOutcomeValue = 'reinforced' | 'needs_another_pass'

export interface MobileReviewItem {
  id: string
  source_type: ReviewSourceType
  source_id: string
  module_id: string | null
  acs_category: string | null
  reason: string
  priority: number
  review_count: number
  next_review_at: string
  // Only populated for source_type === 'dpe_question' -- the question
  // prompt text, resolved server-side from dpe_questions so the client
  // never needs a second round trip before it can render the card. null
  // for every other source_type in this phase (the client filters those
  // out; a future phase can start populating this for them without any
  // wire-shape change here).
  question: string | null
}

export interface MobileReviewQueueListRequest {
  action?: 'list'
}

export interface MobileReviewQueueListResponse {
  items: MobileReviewItem[]
}

export interface MobileReviewRevealRequest {
  action: 'reveal'
  review_item_id: string
}

// Same content fields as MobilePracticeRevealResponse (RevealContent.tsx
// renders both through one shared, narrower prop type) -- keyed by
// review_item_id instead of session_id/question_id since a review item,
// not a practice session, is the ownership unit here.
export interface MobileReviewRevealResponse {
  review_item_id: string
  model_answer: string
  common_mistakes: string | null
  dpe_evaluating: string | null
  real_world_application: string | null
}

export interface MobileReviewOutcomeRequest {
  action: 'outcome'
  review_item_id: string
  outcome: ReviewOutcomeValue
  // Client-generated UUID v4, minted once per logical review attempt and
  // reused verbatim on any retry -- see reviewIdempotencyKey.ts. Never
  // regenerated for the same submission; a genuinely new scheduled review
  // of the same item later gets a fresh review item id from a fresh
  // `list` call, which naturally gets a fresh key.
  idempotency_key: string
}

export interface MobileReviewOutcomeResponse {
  review_item_id: string
  outcome: ReviewOutcomeValue
  next_review_at: string
  // True when this exact idempotency_key had already been submitted and
  // the server replayed its stored result rather than applying the
  // outcome a second time -- mirrors web's res.data.was_replay, an
  // additional defensive signal alongside the client's own per-item
  // `processed` gate.
  was_replay: boolean
}

// ---------------------------------------------------------------------
// mobile-ground-school (POST action: 'catalog' (default) | 'content')
// ---------------------------------------------------------------------
//
// Phase 3 (Ground School mobile): a thin sibling of
// get-module-companion-content -- same two-table read, same
// requireModuleAccess() gate. Module titles/order are NOT sent over the
// wire (they're static curriculum metadata, hand-ported to mobile's own
// constants/groundSchool.ts, same as web's client-side GUIDED_NOTES_MODULES) --
// `catalog` only ever returns the per-module facts a server must be
// asked for: whether authored content exists yet, and whether this
// account has it unlocked.

export interface MobileGroundSchoolModuleSummary {
  module_id: string
  has_authored_content: boolean
  unlocked: boolean
}

export interface MobileGroundSchoolCatalogResponse {
  modules: MobileGroundSchoolModuleSummary[]
}

export interface MobileGroundSchoolContentRequest {
  action: 'content'
  module_id: string
}

export interface MobileModuleObjective {
  id: string
  label: string
}

export interface MobileModuleGuidedNote {
  id: string
  section: string
  prompt: string
}

export interface MobileModuleKeyConcept {
  id: string
  term: string
  definition: string
}

export interface MobileModuleScenarioPrompt {
  id: string
  prompt: string
}

export interface MobileModuleScenario {
  narrative: string
  prompts: MobileModuleScenarioPrompt[]
}

export interface MobileModuleCheckrideCornerItem {
  id: string
  question: string
}

export interface MobileModuleApexChallengeField {
  id: string
  type: 'date' | 'text' | 'textarea'
  label: string
}

export interface MobileModuleApexChallenge {
  instructions: string
  fields: MobileModuleApexChallengeField[]
}

export interface MobileModuleReflectionQuestion {
  id: string
  prompt: string
}

export interface MobileModuleKnowledgeCheckQuestion {
  id: string
  prompt: string
}

// Every key optional -- module_companion_content.content is hand-authored
// per module and no module has every section (e.g. M02 has no
// checkrideCorner today). The client renders whichever sections are
// present, in this same fixed order, and fabricates none that are missing.
export interface MobileModuleCompanionContent {
  modulePurpose?: string
  objectives?: MobileModuleObjective[]
  guidedNotes?: MobileModuleGuidedNote[]
  keyConcepts?: MobileModuleKeyConcept[]
  scenario?: MobileModuleScenario
  checkrideCorner?: MobileModuleCheckrideCornerItem[]
  apexChallenge?: MobileModuleApexChallenge
  reflectionQuestions?: MobileModuleReflectionQuestion[]
  knowledgeCheckQuestions?: MobileModuleKnowledgeCheckQuestion[]
}

export interface MobileModuleQuizChoice {
  key: string
  label: string
}

export type MobileModuleQuestionType = 'multiple_choice' | 'short_answer' | 'scenario'

export interface MobileModuleQuizQuestion {
  id: string
  question_type: MobileModuleQuestionType
  prompt: string
  choices: MobileModuleQuizChoice[] | null
  correct_choice: string | null
  model_answer: string
}

// content_version (module_companion_content.updated_at) is Phase 4's
// offline-freshness key -- a client comparing this against a cached
// copy's own stored content_version is what decides "redownload" vs.
// "serve the cache."
export interface MobileGroundSchoolContentResponse {
  content: MobileModuleCompanionContent | null
  quiz: MobileModuleQuizQuestion[]
  content_version: string | null
}

// ---------------------------------------------------------------------
// Direct-write reads (guided_notes / module_quiz_attempts) -- Phase 3's
// one deliberate exception to the mobile-* Edge Function convention (see
// lib/api/groundSchoolDirect.ts). These two rows are read back through
// the same RLS-scoped client that wrote them, never through an Edge
// Function -- RLS is the real security boundary for both tables.
// ---------------------------------------------------------------------

export interface MobileGuidedNoteRow {
  module_id: string
  section_id: string
  prompt_id: string
  response_text: string
  updated_at: string
}

export interface MobileModuleQuizAttemptSummary {
  id: string
  module_id: string
  score: number
  total: number
  completed_at: string
}
