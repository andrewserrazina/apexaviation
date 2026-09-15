// Mobile readiness -- wraps compute_readiness_snapshot() (v114) for the
// Expo app: GET-style ('latest') returns the most recent snapshot without
// recomputing, 'refresh' recomputes and returns the new one. Kept as a
// thin Edge Function (rather than the app calling the RPC directly)
// because it's the one place mobile-specific response shaping and the
// pass-probability-language ban get enforced identically to
// mobile-bootstrap's readiness_summary shape.
//
// PRODUCT CONSTRAINT: readiness is a training-readiness INDICATOR, never
// a pass-probability estimate. This function must never add "chance of
// passing" language, and must always surface evidence_level and
// reason_codes alongside overall_score -- never overall_score alone.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requirePremiumAccess, PremiumAccessError } from '../_shared/premiumAccess.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Pre-merge integrity patch -- the one authoritative readiness algorithm
// version, mirroring site/portal-stable.js's CURRENT_READINESS_ALGORITHM_VERSION.
// `latest` below filters on this explicitly rather than trusting
// `order by created_at desc limit 1` alone: a row's timestamp being the
// newest never by itself means it's the CURRENT model -- a stale prior-
// version row could in principle be newer than expected (clock skew, a
// manual DB fix, a future version bump before every writer is updated).
// `latest` must stay read-only (mobile's own completion-refresh logic
// relies on that contract -- see usePostCompleteRefresh.ts), so the
// fallback for "no current-version snapshot exists yet" is `null`, never
// a silent recompute and never a wrong-version row labeled current.
const CURRENT_READINESS_ALGORITHM_VERSION = 'v3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// v2 (Sprint 3) computes a more accurate 4-value evidence sufficiency
// (none/limited/developing/strong, from a volume x breadth rule) for the
// overall snapshot, but the top-level evidence_level column still only
// ever stores v1's original 3-value vocabulary (low/moderate/high) --
// verified directly against mobile-expo/components/ReadinessCard.tsx
// before making this change: its EVIDENCE_LABEL is a TypeScript Record
// keyed on exactly those three strings, and any other value would render
// as `undefined` and crash `.toUpperCase()`. So evidence_level is passed
// through unchanged here (mobile's existing contract, untouched), and
// category_breakdown is exposed as a new, additive field only the web
// Readiness Detail view (Sprint 3) reads -- mobile's ReadinessCard.tsx
// does not consume it and is unaffected by its presence.
function shape(row: Record<string, unknown> | null) {
  if (!row) return null
  return {
    overall_score: row.overall_score,
    coverage_score: row.coverage_score,
    knowledge_score: row.knowledge_score,
    risk_management_score: row.risk_management_score,
    confidence_score: row.confidence_score,
    evidence_level: row.evidence_level,
    weak_tasks: row.weak_tasks,
    reason_codes: row.reason_codes,
    category_breakdown: row.category_breakdown ?? [],
    algorithm_version: row.algorithm_version,
    computed_at: row.created_at,
    // Sprint 4.1, additive -- present on every 'v3' snapshot, null on
    // historical 'v1'/'v2' rows. Same not-yet-consumed status as
    // category_breakdown above: forwarded so a future mobile screen can
    // read the exact top-level counts without another backend change,
    // not because any mobile screen renders them today.
    assessable_task_count: row.assessable_task_count ?? null,
    evidenced_task_count: row.evidenced_task_count ?? null,
    strong_task_count: row.strong_task_count ?? null,
    weak_task_count: row.weak_task_count ?? null,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  })
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const { userId } = await requirePremiumAccess(serviceClient, req.headers.get('Authorization'))
    const body = await req.json().catch(() => ({}))
    const action = body?.action === 'refresh' ? 'refresh' : 'latest'

    if (action === 'refresh') {
      // compute_readiness_snapshot() is auth.uid()-bound -- it must run
      // through a client carrying the caller's own JWT, not the
      // service-role client, so RLS/auth.uid() resolve to the real member
      // rather than nothing.
      const { data, error } = await supabase.rpc('compute_readiness_snapshot')
      if (error) throw error
      return json({ snapshot: shape(data as Record<string, unknown>), refreshed: true })
    }

    const { data, error } = await serviceClient
      .from('readiness_snapshots')
      .select('overall_score, coverage_score, knowledge_score, risk_management_score, confidence_score, evidence_level, weak_tasks, reason_codes, category_breakdown, algorithm_version, created_at, assessable_task_count, evidenced_task_count, strong_task_count, weak_task_count')
      .eq('profile_id', userId)
      .eq('algorithm_version', CURRENT_READINESS_ALGORITHM_VERSION)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error

    return json({ snapshot: shape(data), refreshed: false })
  } catch (err) {
    if (err instanceof PremiumAccessError) return json({ error: err.message }, err.status)
    console.error('mobile-readiness error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
