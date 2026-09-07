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

// REV3.14: shape for a future ACS map/coverage screen. Not wired to any
// Edge Function response yet -- agreed here ahead of that screen's
// construction so the eventual endpoint has a settled contract to target.
// Deliberately does not expose acs_task_applicability or
// content_acs_mappings row shapes directly.
export interface MobileAcsTaskInfo extends MobileAcsTaskRef {
  area_title: string
  task_title: string
  applicable: boolean
  content_available: boolean
  evidence_summary: { attempt_count: number; evidence_score: number } | null
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
  algorithm_version: string
  computed_at: string
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
// mobile-push-token (POST action: 'register' | 'revoke' | list (default))
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

export interface MobilePushTokenRevokeRequest {
  action: 'revoke'
  device_id: string
}

export interface MobilePushTokenListResponse {
  devices: MobileDeviceDTO[]
}
