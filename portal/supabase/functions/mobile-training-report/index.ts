// Mobile Training Report -- Phase 5 (final phase) of the mobile feature-
// parity roadmap. A single aggregate action supplying the few pieces of
// report data that don't already exist on another mobile-* response --
// everything else the report needs (the readiness snapshot itself, the
// due Review Queue, recent AI DPE history) is composed client-side from
// the existing mobile-readiness/mobile-review-queue/mobile-dpe calls
// (see mobile-expo/lib/buildTrainingReportView.ts), so this function
// stays a thin, genuinely-new-data-only addition rather than a fourth
// copy of logic those functions already expose.
//
// Mirrors web's computeTrainingReportAggregates() (site/portal-stable.js)
// for the Ground School rollup and the review_outcome_submissions count
// -- same tables, same "-rating"-suffixed prompt_id structural match (a
// column-level convention, never a coincidental text match against a
// free-text field), same privacy rule: only ever selects
// guided_notes.response_text for rows matching that structural key, never
// any free-text Guided Notes/Scenario Workshop/Checkride Corner answer.
//
// due-Review-Queue category matching mirrors web's own
// computeTrainingReportAggregates()/renderUnifiedTrainingReport() due-by-
// category logic exactly: only 'dpe_question'-sourced due items with a
// non-null acs_category count toward review_queue_due_categories (Ground
// School-sourced review items don't yet carry a reliable ACS category
// mapping on mobile -- same scope boundary Phase 2 already drew for its
// own UI).
//
// No new schema. Every table read here (guided_notes, module_quiz_
// attempts, review_outcome_submissions, portal_review_items) already has
// RLS scoping this learner's own profile_id -- reads go through the
// service-role client with an explicit .eq('profile_id', userId) filter,
// same pattern mobile-review-queue's own `list` action already uses,
// rather than relying on RLS alone. get_my_recent_ai_dpe_sessions() is
// auth.uid()-bound (Phase 1), so that one call runs through the caller's
// own JWT-forwarding client.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requirePremiumAccess, PremiumAccessError } from '../_shared/premiumAccess.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const COURSE_ID = 'PPL'
const MODULE_IDS = Array.from({ length: 20 }, (_, i) => `${COURSE_ID}-M${String(i + 1).padStart(2, '0')}`)
const CONFIDENCE_VALUES = ['confident', 'needs_review', 'not_yet'] as const
type ConfidenceValue = (typeof CONFIDENCE_VALUES)[number]

interface RatingRow {
  module_id: string
  response_text: string
  updated_at: string
}
interface QuizAttemptRow {
  module_id: string
  completed_at: string
}
interface ReviewItemRow {
  source_type: string
  acs_category: string | null
}

function isConfidenceValue(v: string): v is ConfidenceValue {
  return (CONFIDENCE_VALUES as readonly string[]).includes(v)
}

function laterOf(a: string | null, b: string): string {
  if (!a) return b
  return new Date(b) > new Date(a) ? b : a
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') || ''
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  // get_my_recent_ai_dpe_sessions() is auth.uid()-bound (Phase 1's
  // mobile-dpe already establishes this) -- must run as the caller's own
  // JWT, never the service-role client.
  const authedClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  try {
    const { userId } = await requirePremiumAccess(serviceClient, authHeader)

    const [ratingsRes, quizRes, reviewCountRes, reviewItemsRes, dpeHistoryRes] = await Promise.all([
      serviceClient
        .from('guided_notes')
        .select('module_id, response_text, updated_at')
        .eq('profile_id', userId)
        .eq('course_id', COURSE_ID)
        .like('prompt_id', '%-rating')
        .in('response_text', CONFIDENCE_VALUES as unknown as string[]),
      serviceClient.from('module_quiz_attempts').select('module_id, completed_at').eq('profile_id', userId),
      serviceClient
        .from('review_outcome_submissions')
        .select('idempotency_key', { count: 'exact', head: true })
        .eq('profile_id', userId),
      serviceClient
        .from('portal_review_items')
        .select('source_type, acs_category')
        .eq('profile_id', userId)
        .eq('status', 'active')
        .lte('next_review_at', new Date().toISOString()),
      authedClient.rpc('get_my_recent_ai_dpe_sessions', { p_limit: 1 }),
    ])

    if (ratingsRes.error) throw ratingsRes.error
    if (quizRes.error) throw quizRes.error
    if (reviewCountRes.error) throw reviewCountRes.error
    if (reviewItemsRes.error) throw reviewItemsRes.error
    if (dpeHistoryRes.error) throw dpeHistoryRes.error

    const ratingRows = (ratingsRes.data || []) as RatingRow[]
    const quizRows = (quizRes.data || []) as QuizAttemptRow[]
    const reviewItems = (reviewItemsRes.data || []) as ReviewItemRow[]

    const activityByModule = new Map<string, string | null>()
    const confidenceByModule = new Map<string, { confident: number; needs_review: number; not_yet: number }>()
    for (const id of MODULE_IDS) {
      activityByModule.set(id, null)
      confidenceByModule.set(id, { confident: 0, needs_review: 0, not_yet: 0 })
    }

    ratingRows.forEach((r) => {
      if (!activityByModule.has(r.module_id)) return
      activityByModule.set(r.module_id, laterOf(activityByModule.get(r.module_id) ?? null, r.updated_at))
      if (isConfidenceValue(r.response_text)) {
        confidenceByModule.get(r.module_id)![r.response_text]++
      }
    })
    quizRows.forEach((r) => {
      if (!activityByModule.has(r.module_id)) return
      activityByModule.set(r.module_id, laterOf(activityByModule.get(r.module_id) ?? null, r.completed_at))
    })

    const groundSchool = MODULE_IDS.map((moduleId) => ({
      module_id: moduleId,
      has_activity: activityByModule.get(moduleId) !== null,
      last_activity_at: activityByModule.get(moduleId) ?? null,
      confidence_counts: confidenceByModule.get(moduleId)!,
    }))

    const dueCategories = new Set<string>()
    reviewItems.forEach((it) => {
      if (it.source_type === 'dpe_question' && it.acs_category) dueCategories.add(it.acs_category)
    })

    const dpeSessions = (dpeHistoryRes.data || []) as Array<{
      id: string
      status: string
      questions_asked: number
      debrief: unknown
      started_at: string
      ended_at: string | null
    }>
    const recentDpeSession = dpeSessions[0]
      ? {
          id: dpeSessions[0].id,
          status: dpeSessions[0].status,
          questionsAsked: dpeSessions[0].questions_asked,
          debrief: dpeSessions[0].debrief,
          startedAt: dpeSessions[0].started_at,
          endedAt: dpeSessions[0].ended_at,
        }
      : null

    return json({
      ground_school: groundSchool,
      review_queue_due_count: reviewItems.length,
      review_queue_due_categories: Array.from(dueCategories),
      review_queue_completed_count: reviewCountRes.count || 0,
      ai_dpe_recent_session: recentDpeSession,
    })
  } catch (err) {
    if (err instanceof PremiumAccessError) return json({ error: err.message }, err.status)
    console.error('mobile-training-report error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
