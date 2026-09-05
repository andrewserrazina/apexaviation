// Mobile readiness -- wraps compute_readiness_snapshot() (v114) for the
// Expo app: GET-style ('latest') returns the most recent snapshot without
// recomputing, 'refresh' recomputes and returns the new one. Kept as a
// thin Edge Function (rather than the app calling the RPC directly)
// because it's the one place mobile-specific response shaping and the
// pass-probability-language ban get enforced identically to
// mobile-bootstrap's readiness_summary shape.
//
// NOT YET DEPLOYED. Source-controlled only.
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

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
    algorithm_version: row.algorithm_version,
    computed_at: row.created_at,
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
      .select('overall_score, coverage_score, knowledge_score, risk_management_score, confidence_score, evidence_level, weak_tasks, reason_codes, algorithm_version, created_at')
      .eq('profile_id', userId)
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
