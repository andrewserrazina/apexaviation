// Mobile practice session -- covers both POST /mobile/practice/session
// (start) and POST /mobile/practice/complete (complete) from the Phase C
// mobile API contract, dispatched by `action` in the body, matching this
// codebase's existing action-routed Edge Function convention (see
// dpe-chat/index.ts).
//
// NOT YET DEPLOYED. Source-controlled only.
//
// dpe_questions is an ORAL-EXAM question bank (question / model_answer /
// common_mistakes / dpe_evaluating / real_world_application), not a
// multiple-choice bank -- there is no correct_answer column to auto-grade
// against. Scoring is self-assessed: the learner reads the question,
// answers out loud (mirroring how the web portal's own DPE practice and
// this same content already work), then reveals model_answer and rates
// their own attempt. `action: 'complete'` accepts that self-rating per
// question; it does not invent auto-grading this content was never built
// for.
//
// Idempotency (Phase C8 requirement): the session row IS
// portal_practice_attempts -- 'start' inserts it, 'complete' updates the
// SAME row by id. If completed_at is already set, 'complete' returns the
// existing stored result unchanged instead of reprocessing -- a mobile
// network retry can safely resend the exact same completion request.
// Downstream side effects (XP, task evidence) additionally carry their
// own idempotency keys derived from the attempt id, so even a completion
// call with a *different* client-side retry id for the same attempt
// cannot double-count.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requirePremiumAccess, PremiumAccessError } from '../_shared/premiumAccess.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DEFAULT_SESSION_SIZE = 10
const ESTIMATED_SECONDS_PER_QUESTION = 45

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

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const { userId } = await requirePremiumAccess(supabase, req.headers.get('Authorization'))
    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'start') {
      const acsTaskId = typeof body?.acs_task_id === 'string' ? body.acs_task_id : null
      const sessionSize = Number.isInteger(body?.session_size) && body.session_size > 0 && body.session_size <= 20
        ? body.session_size
        : DEFAULT_SESSION_SIZE

      let questionIds: string[]
      if (acsTaskId) {
        const { data: mapped, error: mapErr } = await supabase
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

      let questionQuery = supabase
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

      // Shuffle client-side-invisible server order, cap to session size --
      // avoids always handing back the same first N rows in id order.
      const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, sessionSize)
      const finalIds = shuffled.map((q) => q.id)

      const { data: mappings } = await supabase
        .from('content_acs_mappings')
        .select('content_id, acs_task_id, acs_tasks(area_code, task_code)')
        .eq('content_type', 'dpe_question')
        .in('content_id', finalIds)

      const targetAcsTasks = Array.from(
        new Map((mappings || []).map((m: any) => [m.acs_task_id, { acs_task_id: m.acs_task_id, area_code: m.acs_tasks?.area_code, task_code: m.acs_tasks?.task_code }])).values()
      )

      const { data: attempt, error: insErr } = await supabase
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

    if (action === 'complete') {
      const sessionId = body?.session_id
      const responses: SelfRating[] = Array.isArray(body?.responses) ? body.responses : []
      if (!sessionId) return json({ error: 'session_id is required' }, 400)

      const { data: attempt, error: fetchErr } = await supabase
        .from('portal_practice_attempts')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle()
      if (fetchErr) throw fetchErr
      if (!attempt) return json({ error: 'Session not found' }, 404)
      if (attempt.profile_id !== userId) return json({ error: 'Not your session' }, 403)

      // Idempotent short-circuit: already completed, return the stored
      // result unchanged rather than reprocessing (no double XP, no
      // double evidence, no double streak/study-activity credit).
      if (attempt.completed_at) {
        return json({
          session_id: attempt.id,
          score: attempt.score,
          total: attempt.total,
          completed_at: attempt.completed_at,
          already_completed: true,
        })
      }

      const validResponses = responses.filter((r) => (attempt.question_ids as string[]).includes(r.question_id))
      const score = validResponses.filter((r) => r.self_rating === 'correct').length

      // Update question progress + task evidence for every answered
      // question, mapping each to whatever ACS task(s) it's tagged with
      // (a question can map to more than one -- content_acs_mappings
      // supports that natively).
      for (const r of validResponses) {
        const isCorrect = r.self_rating === 'correct'
        await supabase
          .from('portal_question_progress')
          .upsert(
            {
              profile_id: userId,
              question_id: r.question_id,
              completed: true,
              answered_count: 1, // upsert below only sets this on insert; see onConflict merge note
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'profile_id,question_id', ignoreDuplicates: false }
          )

        const { data: taskMappings } = await supabase
          .from('content_acs_mappings')
          .select('acs_task_id')
          .eq('content_type', 'dpe_question')
          .eq('content_id', r.question_id)

        for (const m of taskMappings || []) {
          await supabase.rpc('record_task_evidence', {
            p_profile_id: userId,
            p_acs_task_id: m.acs_task_id,
            p_correct: isCorrect,
            p_is_scenario: false,
          })
        }
      }

      // Study activity credit for today (member-local date, matching the
      // same day-boundary rule streaks use) -- additive seconds, not a
      // replace, so multiple sessions in one day accumulate correctly.
      const { data: localDateRow } = await supabase.rpc('member_local_date', { p_profile_id: userId })
      const today = (localDateRow as unknown as string) || new Date().toISOString().slice(0, 10)
      const { data: existingActivity } = await supabase
        .from('portal_study_activity')
        .select('seconds')
        .eq('profile_id', userId)
        .eq('activity_date', today)
        .maybeSingle()
      await supabase.from('portal_study_activity').upsert(
        {
          profile_id: userId,
          activity_date: today,
          seconds: (existingActivity?.seconds || 0) + validResponses.length * ESTIMATED_SECONDS_PER_QUESTION,
        },
        { onConflict: 'profile_id,activity_date' }
      )

      const { data: updatedAttempt, error: updErr } = await supabase
        .from('portal_practice_attempts')
        .update({ score, completed_at: new Date().toISOString() })
        .eq('id', sessionId)
        .select('id, score, total, completed_at')
        .single()
      if (updErr) throw updErr

      // XP through the existing trusted mechanism (award_xp, service-role
      // only as of v104) -- source_id is the attempt id itself, so
      // award_xp's own unique constraint on (profile_id, event_type,
      // source_id) is what actually prevents double XP on a retried
      // completion call, not just this function's own completed_at check.
      await supabase.rpc('award_xp', {
        p_profile_id: userId,
        p_event_type: 'mobile_practice_completed',
        p_xp_amount: score * 5,
        p_source_table: 'portal_practice_attempts',
        p_source_id: sessionId,
        p_metadata: { score, total: updatedAttempt.total },
      })

      return json({
        session_id: updatedAttempt.id,
        score: updatedAttempt.score,
        total: updatedAttempt.total,
        completed_at: updatedAttempt.completed_at,
        already_completed: false,
      })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    if (err instanceof PremiumAccessError) return json({ error: err.message }, err.status)
    console.error('mobile-practice error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
