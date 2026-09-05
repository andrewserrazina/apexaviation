// Mobile daily drill -- wraps get_or_create_daily_drill() and
// mark_daily_drill_started() (v115) plus resolves the drill's
// question_ids/scenario_ids into safe display content, mirroring
// mobile-practice's "server decides, client just renders" shape.
//
// NOT YET DEPLOYED. Source-controlled only.
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // get_or_create_daily_drill()/mark_daily_drill_started() are both
  // auth.uid()-bound, so RPC calls must go through a client carrying the
  // caller's own JWT rather than the service-role client.
  const authedClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  })
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    await requirePremiumAccess(serviceClient, req.headers.get('Authorization'))
    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'start') {
      const drillId = body?.drill_id
      if (!drillId) return json({ error: 'drill_id is required' }, 400)
      const { data, error } = await authedClient.rpc('mark_daily_drill_started', { p_drill_id: drillId })
      if (error) throw error
      return json({ drill: data })
    }

    // Default action: fetch-or-generate today's drill, then resolve its
    // question_ids into safe display content (id/question/category only
    // -- same fields mobile-practice exposes, never model_answer/etc.
    // upfront).
    const { data: drill, error: drillErr } = await authedClient.rpc('get_or_create_daily_drill')
    if (drillErr) throw drillErr

    const questionIds: string[] = Array.isArray(drill?.question_ids) ? drill.question_ids : []
    let questions: Array<{ id: string; question: string; category: string | null }> = []
    if (questionIds.length) {
      const { data: qRows, error: qErr } = await serviceClient
        .from('dpe_questions')
        .select('id, question, category')
        .in('id', questionIds)
      if (qErr) throw qErr
      questions = qRows || []
    }

    return json({
      drill: {
        id: drill.id,
        drill_date: drill.drill_date,
        status: drill.status,
        estimated_minutes: drill.estimated_minutes,
        target_acs_tasks: drill.target_acs_tasks,
        started_at: drill.started_at,
        completed_at: drill.completed_at,
      },
      questions,
    })
  } catch (err) {
    if (err instanceof PremiumAccessError) return json({ error: err.message }, err.status)
    console.error('mobile-daily-drill error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
