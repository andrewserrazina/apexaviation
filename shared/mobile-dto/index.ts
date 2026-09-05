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

// ---------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------

export type EvidenceLevel = 'low' | 'moderate' | 'high'
export type DrillStatus = 'pending' | 'in_progress' | 'completed'
export type MobilePlatform = 'ios' | 'android'
export type SelfRating = 'correct' | 'incorrect' | 'partial'

export interface MobileAcsTaskRef {
  acs_task_id: string
  area_code: string
  task_code: string
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
  reason_codes: string[]
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
  training: {
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
}

export interface MobileDailyDrillResponse {
  drill: MobileDailyDrill
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

export interface MobileLibraryContentResponse {
  version: string
  content: unknown // opaque Study Pack content payload -- same shape the web portal renders, versioned per study_pack_versions
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
