// Mobile practice session -- covers POST /mobile/practice/session (start),
// POST /mobile/practice/reveal (reveal), and POST /mobile/practice/complete
// (complete) from the Phase C mobile API contract, dispatched by `action`
// in the body, matching this codebase's existing action-routed Edge
// Function convention (see dpe-chat/index.ts).
//
// NOT YET DEPLOYED. Source-controlled only.
//
// V119 CHANGE NOTE: two hardenings on top of REV2/REV3/v117:
//   1. Fail-closed targeted start -- previously, `start` with an
//      acs_task_id whose content_acs_mappings query returned zero rows
//      fell through to an UNCONSTRAINED general dpe_questions query
//      (because the .in('id', questionIds) filter was only applied
//      `if (questionIds.length)`), silently handing back unrelated
//      general questions for a request that named a specific ACS task.
//      Targeted start now fails closed with a clean 404 and creates no
//      attempt whenever no eligible mapped question survives -- it never
//      backfills with unrelated general questions. General start (no
//      acs_task_id) is unchanged.
//   2. New authenticated `resume` action -- ad-hoc practice sessions had
//      no way to be re-fetched after the client's in-memory state was
//      lost (app restart, force-close), unlike Daily Drill's own
//      fetch-or-create path. `resume` returns the caller's own attempt's
//      already-stored question set, in its stored order, never creating
//      a new attempt and never returning debrief fields. See
//      SPRINT_1B_V119_PRACTICE_CONTRACT_REPORT.md for the full audit and
//      design writeup. No schema migration -- portal_practice_attempts
//      already carries every column resume needs.
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

      // V119: targeted start (acs_task_id supplied) must fail closed --
      // never fall through to an unconstrained general query. A learner
      // who asked to practice one ACS task must get questions mapped to
      // that task, or a clean "nothing available yet" response, never an
      // unrelated general session.
      let candidates: Array<{ id: string; question: string; category: string | null; acs_reference: string | null }>
      if (acsTaskId) {
        const { data: mapped, error: mapErr } = await serviceClient
          .from('content_acs_mappings')
          .select('content_id')
          .eq('content_type', 'dpe_question')
          .eq('acs_task_id', acsTaskId)
          .limit(sessionSize * 3)
        if (mapErr) throw mapErr
        const mappedIds = (mapped || []).map((r: { content_id: string }) => r.content_id)
        if (mappedIds.length === 0) {
          return json({ error: 'No practice questions are available for this ACS task yet.' }, 404)
        }

        const { data: mappedCandidates, error: qErr } = await serviceClient
          .from('dpe_questions')
          .select('id, question, category, acs_reference')
          .eq('exam_type', 'private_pilot')
          .eq('is_scenario', false)
          .in('id', mappedIds)
        if (qErr) throw qErr
        if (!mappedCandidates?.length) {
          return json({ error: 'No practice questions are available for this ACS task yet.' }, 404)
        }
        candidates = mappedCandidates
      } else {
        const { data: generalCandidates, error: qErr } = await serviceClient
          .from('dpe_questions')
          .select('id, question, category, acs_reference')
          .eq('exam_type', 'private_pilot')
          .eq('is_scenario', false)
          .limit(sessionSize * 3)
        if (qErr) throw qErr
        if (!generalCandidates?.length) return json({ error: 'No questions available for this request' }, 404)
        candidates = generalCandidates
      }

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

    if (action === 'resume') {
      // V119: authenticated resume -- a native client that lost its
      // in-memory session (force-close, restart) can re-fetch its own
      // attempt's already-stored question set. Never creates a new
      // attempt, never randomizes, never returns debrief fields -- this
      // is a read of what `start` already decided, nothing more.
      //
      // Thin wrapper (mirrors REV2.8's `complete`): ownership enforcement,
      // fail-closed integrity validation, and order preservation all live
      // in resume_mobile_practice_session() (v119) so those guarantees are
      // provable in the SQL regression harness, not just asserted here.
      // Auth-forwarding client, same reason as `complete` -- the RPC is
      // auth.uid()-bound.
      const sessionId = body?.session_id
      if (!sessionId || typeof sessionId !== 'string') return json({ error: 'session_id is required' }, 400)

      const { data, error } = await authedClient.rpc('resume_mobile_practice_session', {
        p_attempt_id: sessionId,
      })
      if (error) {
        const msg = error.message || ''
        const codeMatch = msg.match(/^(session_not_found|not_your_session|invalid_question_set):\s*(.*)$/)
        if (codeMatch) {
          const [, code, detail] = codeMatch
          const status = code === 'session_not_found' ? 404 : code === 'not_your_session' ? 403 : 500
          return json({ error: detail || code, code }, status)
        }
        throw error
      }

      const attempt = Array.isArray(data) ? data[0] : data
      const storedIds: string[] = attempt.question_ids

      // Resolve question text/category for the RPC-validated ids. The RPC
      // already proved every id resolves to dpe_questions and the count
      // matches, but this second read is a fresh query -- re-check the
      // count rather than trust it can't have changed underneath us.
      const { data: resolved, error: qErr } = await serviceClient
        .from('dpe_questions')
        .select('id, question, category')
        .in('id', storedIds)
      if (qErr) throw qErr
      if (!resolved || resolved.length !== storedIds.length) {
        return json({ error: 'This practice session has no valid question set to resume.' }, 500)
      }

      const byId = new Map(resolved.map((q: { id: string }) => [q.id, q]))
      // Map over storedIds (the RPC's own validated, stored-order array),
      // never over the resolved rows -- .in() does not preserve input
      // order, so this is what actually guarantees the wire order matches
      // the stored order.
      const orderedQuestions = storedIds.map((id) => byId.get(id))
      if (orderedQuestions.some((q) => !q)) {
        return json({ error: 'This practice session has no valid question set to resume.' }, 500)
      }

      const { data: mappings } = await serviceClient
        .from('content_acs_mappings')
        .select('content_id, acs_task_id, acs_tasks(area_code, task_code)')
        .eq('content_type', 'dpe_question')
        .in('content_id', storedIds)

      const targetAcsTasks = Array.from(
        new Map((mappings || []).map((m: any) => [m.acs_task_id, { acs_task_id: m.acs_task_id, area_code: m.acs_tasks?.area_code, task_code: m.acs_tasks?.task_code }])).values()
      )

      return json({
        session_id: attempt.session_id,
        mode: attempt.mode,
        started_at: attempt.started_at,
        completed_at: attempt.completed_at,
        target_acs_tasks: targetAcsTasks,
        questions: orderedQuestions.map((q: any) => ({ id: q.id, question: q.question, category: q.category })),
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
        // REV3.13: map the RPC's stable machine-readable error prefixes to
        // clean client-facing responses -- never a raw Postgres error, and
        // never a 500 for input the RPC rejected as malformed (that's a
        // 4xx, the client's request was bad, not our server).
        const msg = error.message || ''
        const codeMatch = msg.match(/^(session_not_found|not_your_session|invalid_question|invalid_self_rating|duplicate_question_id|incomplete_submission):\s*(.*)$/)
        if (codeMatch) {
          const [, code, detail] = codeMatch
          const status = code === 'session_not_found' ? 404 : code === 'not_your_session' ? 403 : 400
          return json({ error: detail || code, code }, status)
        }
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
