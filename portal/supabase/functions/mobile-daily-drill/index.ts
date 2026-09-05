// Mobile daily drill -- wraps get_or_create_daily_drill() and
// start_daily_drill_practice_session() (v118) plus resolves the drill's
// question_ids into safe display content, mirroring mobile-practice's
// "server decides, client just renders" shape.
//
// v118 CHANGE NOTE: `start` now calls start_daily_drill_practice_session()
// instead of the superseded mark_daily_drill_started() -- that RPC
// atomically creates (or resumes) the ONE portal_practice_attempts row
// linked to this drill, whose question_ids are exactly the drill's own,
// so the client can proceed straight into the existing mobile-practice
// reveal/complete contract using the returned session_id. See v118's
// migration header comment for the full integration-gap rationale.
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

interface DrillRow {
  id: string
  drill_date: string
  status: string
  estimated_minutes: number
  target_acs_tasks: unknown
  question_ids: unknown
  started_at: string | null
  completed_at: string | null
  practice_attempt_id: string | null
}

function shapeDrill(drill: DrillRow) {
  return {
    id: drill.id,
    drill_date: drill.drill_date,
    status: drill.status,
    estimated_minutes: drill.estimated_minutes,
    target_acs_tasks: drill.target_acs_tasks,
    started_at: drill.started_at,
    completed_at: drill.completed_at,
    session_id: drill.practice_attempt_id ?? null,
  }
}

// Resolves a drill's question_ids into safe display content (id/question/
// category only -- never model_answer/etc. upfront), preserving the
// drill's own stored ordering exactly rather than whatever order the
// database happens to return rows in.
async function resolveDrillQuestions(serviceClient: ReturnType<typeof createClient>, questionIds: string[]) {
  if (!questionIds.length) return []
  const { data: qRows, error } = await serviceClient
    .from('dpe_questions')
    .select('id, question, category')
    .in('id', questionIds)
  if (error) throw error
  const byId = new Map((qRows || []).map((q: { id: string }) => [q.id, q]))
  return questionIds.map((id) => byId.get(id)).filter(Boolean)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // get_or_create_daily_drill()/start_daily_drill_practice_session() are
  // both auth.uid()-bound, so RPC calls must go through a client carrying
  // the caller's own JWT rather than the service-role client.
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
      const { data: drill, error } = await authedClient.rpc('start_daily_drill_practice_session', { p_drill_id: drillId })
      if (error) throw error

      const questionIds: string[] = Array.isArray(drill?.question_ids) ? drill.question_ids : []
      const questions = await resolveDrillQuestions(serviceClient, questionIds)

      return json({
        drill: shapeDrill(drill),
        session_id: drill.practice_attempt_id ?? null,
        questions,
      })
    }

    // Default action: fetch-or-generate today's drill, then resolve its
    // question_ids into safe display content.
    const { data: drill, error: drillErr } = await authedClient.rpc('get_or_create_daily_drill')
    if (drillErr) throw drillErr

    const questionIds: string[] = Array.isArray(drill?.question_ids) ? drill.question_ids : []
    const questions = await resolveDrillQuestions(serviceClient, questionIds)

    return json({
      drill: shapeDrill(drill),
      session_id: drill.practice_attempt_id ?? null,
      questions,
    })
  } catch (err) {
    if (err instanceof PremiumAccessError) return json({ error: err.message }, err.status)
    console.error('mobile-daily-drill error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
