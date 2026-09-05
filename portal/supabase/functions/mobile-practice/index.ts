// Mobile practice session -- covers POST /mobile/practice/session (start),
// POST /mobile/practice/reveal (reveal), and POST /mobile/practice/complete
// (complete) from the Phase C mobile API contract, dispatched by `action`
// in the body, matching this codebase's existing action-routed Edge
// Function convention (see dpe-chat/index.ts).
//
// NOT YET DEPLOYED. Source-controlled only.
//
// REV2 CHANGE NOTE: `complete` is now a THIN wrapper (REV2.8) -- it
// authenticates the caller, validates basic request shape, and calls the
// atomic, concurrency-safe complete_mobile_practice_session() RPC
// (v113). It no longer orchestrates progress/evidence/study-activity/XP
// writes itself -- see that RPC's own extensive comment for why: two
// concurrent completion requests for the same session must serialize into
// exactly one real completion, which a multi-step Edge Function cannot
// guarantee on its own (proven with a real two-process concurrency test,
// not a sequential retry -- see test/run_security_regression_tests.sh and
// SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT_REV2.md section 13).
//
// dpe_questions is an ORAL-EXAM question bank (question / model_answer /
// common_mistakes / dpe_evaluating / real_world_application), not a
// multiple-choice bank -- there is no correct_answer column to auto-grade
// against. Scoring is self-assessed: the learner reads the question,
// answers out loud, calls `reveal` to see the model answer / debrief, then
// submits a self_rating per question via `complete`.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requirePremiumAccess, PremiumAccessError } from '../_shared/premiumAccess.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DEFAULT_SESSION_SIZE = 10

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

interface SelfRating {
  question_id: string
  self_rating: 'correct' | 'incorrect' | 'partial'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') || ''
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  // Auth-forwarding client: complete_mobile_practice_session() is
  // auth.uid()-bound, so the RPC call must run as the caller's own JWT,
  // never the service-role client -- otherwise auth.uid() would resolve to
  // nothing inside the function and every call would fail "Not signed in."
  const authedClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  try {
    const { userId } = await requirePremiumAccess(serviceClient, authHeader)
    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'start') {
      const acsTaskId = typeof body?.acs_task_id === 'string' ? body.acs_task_id : null
      const sessionSize = Number.isInteger(body?.session_size) && body.session_size > 0 && body.session_size <= 20
        ? body.session_size
        : DEFAULT_SESSION_SIZE

      let questionIds: string[]
      if (acsTaskId) {
        const { data: mapped, error: mapErr } = await serviceClient
          .from('content_acs_mappings')
          .select('content_id')
          .eq('content_type', 'dpe_question')
          .eq('acs_task_id', acsTaskId)
          .limit(sessionSize * 3)
        if (mapErr) throw mapErr
        questionIds = (mapped || []).map((r: { content_id: string }) => r.content_id)
      } else {
        questionIds = []
      }

      let questionQuery = serviceClient
        .from('dpe_questions')
        .select('id, question, category, acs_reference')
        .eq('exam_type', 'private_pilot')
        .eq('is_scenario', false)

      if (questionIds.length) {
        questionQuery = questionQuery.in('id', questionIds)
      }

      const { data: candidates, error: qErr } = await questionQuery.limit(sessionSize * 3)
      if (qErr) throw qErr
      if (!candidates?.length) return json({ error: 'No questions available for this request' }, 404)

      const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, sessionSize)
      const finalIds = shuffled.map((q) => q.id)

      const { data: mappings } = await serviceClient
        .from('content_acs_mappings')
        .select('content_id, acs_task_id, acs_tasks(area_code, task_code)')
        .eq('content_type', 'dpe_question')
        .in('content_id', finalIds)

      const targetAcsTasks = Array.from(
        new Map((mappings || []).map((m: any) => [m.acs_task_id, { acs_task_id: m.acs_task_id, area_code: m.acs_tasks?.area_code, task_code: m.acs_tasks?.task_code }])).values()
      )

      const { data: attempt, error: insErr } = await serviceClient
        .from('portal_practice_attempts')
        .insert({
          profile_id: userId,
          mode: 'dpe_questions',
          question_ids: finalIds,
          total: finalIds.length,
          started_at: new Date().toISOString(),
        })
        .select('id, mode, question_ids, started_at')
        .single()
      if (insErr) throw insErr

      return json({
        session_id: attempt.id,
        mode: attempt.mode,
        started_at: attempt.started_at,
        target_acs_tasks: targetAcsTasks,
        questions: shuffled.map((q) => ({ id: q.id, question: q.question, category: q.category })),
      })
    }

    if (action === 'reveal') {
      // REV2.9: the QUESTION -> answer out loud -> REVEAL -> self-rate
      // contract. Server verifies the session belongs to the caller and
      // that the question is actually part of that session before
      // returning any debrief field -- this is not a generic premium
      // question-bank dump endpoint.
      const sessionId = body?.session_id
      const questionId = body?.question_id
      if (!sessionId || !questionId) return json({ error: 'session_id and question_id are required' }, 400)

      const { data: attempt, error: fetchErr } = await serviceClient
        .from('portal_practice_attempts')
        .select('id, profile_id, question_ids')
        .eq('id', sessionId)
        .maybeSingle()
      if (fetchErr) throw fetchErr
      if (!attempt) return json({ error: 'Session not found' }, 404)
      if (attempt.profile_id !== userId) return json({ error: 'Not your session' }, 403)
      if (!(attempt.question_ids as string[]).includes(questionId)) {
        return json({ error: 'That question is not part of this session' }, 403)
      }

      const { data: question, error: qErr } = await serviceClient
        .from('dpe_questions')
        .select('id, model_answer, common_mistakes, dpe_evaluating, real_world_application')
        .eq('id', questionId)
        .maybeSingle()
      if (qErr) throw qErr
      if (!question) return json({ error: 'Question not found' }, 404)

      return json({
        question_id: question.id,
        model_answer: question.model_answer,
        common_mistakes: question.common_mistakes,
        dpe_evaluating: question.dpe_evaluating,
        real_world_application: question.real_world_application,
      })
    }

    if (action === 'complete') {
      const sessionId = body?.session_id
      const responses: SelfRating[] = Array.isArray(body?.responses) ? body.responses : []
      if (!sessionId) return json({ error: 'session_id is required' }, 400)

      // Thin wrapper (REV2.8): all state-changing work, and all
      // concurrency/idempotency guarantees, live in the RPC.
      const { data, error } = await authedClient.rpc('complete_mobile_practice_session', {
        p_attempt_id: sessionId,
        p_responses: responses,
      })
      if (error) {
        const msg = error.message || ''
        if (msg.includes('Not your session')) return json({ error: 'Not your session' }, 403)
        if (msg.includes('Session not found')) return json({ error: 'Session not found' }, 404)
        throw error
      }

      const result = Array.isArray(data) ? data[0] : data
      return json({
        session_id: result.session_id,
        score: result.score,
        total: result.total,
        completed_at: result.completed_at,
        already_completed: result.already_completed,
      })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    if (err instanceof PremiumAccessError) return json({ error: err.message }, err.status)
    console.error('mobile-practice error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
