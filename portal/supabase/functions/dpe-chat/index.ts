// AI DPE Practice — a text-based simulated Private Pilot oral exam.
//
// Gated identically to get-premium-content (checkride_prep_unlocked via
// requirePremiumAccess) — no separate purchase, included with the
// existing Checkride Prep Pack unlock. Every turn is a single Claude
// Messages API call; the model is instructed to always reply with a
// strict JSON envelope ({phase, message, debrief}) so the frontend has a
// stable contract to render instead of parsing free-form prose.
//
// action: 'start'   — begins a new session, DPE opens the exam.
// action: 'message' — student's answer; returns the DPE's next turn.
// action: 'end'     — student ends early; forces an immediate debrief
//                      based on the conversation so far.
//
// Env vars required (set as Supabase Edge Function secrets):
//   ANTHROPIC_API_KEY
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requirePremiumAccess, PremiumAccessError } from '../_shared/premiumAccess.ts'
import {
  buildSystemPrompt,
  callClaude,
  toClaudeMessages,
  CONTROL_END_NOTE,
  type TranscriptTurn,
} from '../_shared/dpeChatCore.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const { userId } = await requirePremiumAccess(supabase, req.headers.get('Authorization'))
    const body = await req.json()
    const action = body?.action

    if (action === 'start') {
      // exam_type hard-coded to 'private_pilot' — see get-premium-content
      // for why instrument content must never be reachable this way yet.
      const { data: categories, error: catErr } = await supabase
        .from('dpe_categories')
        .select('label, intro')
        .eq('exam_type', 'private_pilot')
        .order('sort_order')
      if (catErr) throw catErr

      const systemPrompt = buildSystemPrompt(categories || [])
      const kickoff = 'Begin the oral exam now with your opening question.'
      const turn = await callClaude(systemPrompt, [{ role: 'user', content: kickoff }])

      const transcript: TranscriptTurn[] = [
        { role: 'dpe', content: JSON.stringify(turn), at: new Date().toISOString() },
      ]

      const { data: session, error: insErr } = await supabase
        .from('ai_dpe_sessions')
        .insert({
          profile_id: userId,
          status: turn.phase === 'debrief' ? 'completed' : 'in_progress',
          transcript,
          questions_asked: turn.phase === 'question' ? 1 : 0,
          debrief: turn.debrief,
          ended_at: turn.phase === 'debrief' ? new Date().toISOString() : null,
        })
        .select('id, status, questions_asked')
        .single()
      if (insErr) throw insErr

      return json({
        sessionId: session.id,
        phase: turn.phase,
        message: turn.message,
        debrief: turn.debrief,
        questionsAsked: session.questions_asked,
        status: session.status,
      })
    }

    if (action === 'message' || action === 'end') {
      const sessionId = body?.sessionId
      if (!sessionId) return json({ error: 'sessionId is required' }, 400)

      const { data: session, error: fetchErr } = await supabase
        .from('ai_dpe_sessions')
        .select('*')
        .eq('id', sessionId)
        .single()
      if (fetchErr || !session) return json({ error: 'Session not found' }, 404)
      if (session.profile_id !== userId) return json({ error: 'Not your session' }, 403)
      if (session.status !== 'in_progress') return json({ error: 'Session already ended' }, 409)

      // exam_type hard-coded to 'private_pilot' — see get-premium-content
      // for why instrument content must never be reachable this way yet.
      const { data: categories, error: catErr } = await supabase
        .from('dpe_categories')
        .select('label, intro')
        .eq('exam_type', 'private_pilot')
        .order('sort_order')
      if (catErr) throw catErr

      const transcript: TranscriptTurn[] = session.transcript || []
      const claudeHistory = toClaudeMessages(transcript)

      if (action === 'message') {
        const studentMessage = (body?.message || '').toString().trim()
        if (!studentMessage) return json({ error: 'message is required' }, 400)
        claudeHistory.push({ role: 'user', content: studentMessage })
        transcript.push({ role: 'student', content: studentMessage, at: new Date().toISOString() })
      } else {
        claudeHistory.push({ role: 'user', content: CONTROL_END_NOTE })
      }

      const systemPrompt = buildSystemPrompt(categories || [])
      const turn = await callClaude(systemPrompt, claudeHistory)

      transcript.push({ role: 'dpe', content: JSON.stringify(turn), at: new Date().toISOString() })

      const questionsAsked = session.questions_asked + (turn.phase === 'question' ? 1 : 0)
      const nowCompleted = turn.phase === 'debrief'

      const { error: updErr } = await supabase
        .from('ai_dpe_sessions')
        .update({
          transcript,
          questions_asked: questionsAsked,
          status: nowCompleted ? 'completed' : 'in_progress',
          debrief: turn.debrief,
          ended_at: nowCompleted ? new Date().toISOString() : null,
        })
        .eq('id', sessionId)
      if (updErr) throw updErr

      return json({
        sessionId,
        phase: turn.phase,
        message: turn.message,
        debrief: turn.debrief,
        questionsAsked,
        status: nowCompleted ? 'completed' : 'in_progress',
      })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    if (err instanceof PremiumAccessError) {
      return json({ error: err.message }, err.status)
    }
    console.error('dpe-chat error', err)
    // A retried-and-still-malformed Claude response (callClaude above) is
    // a real, if uncommon, upstream hiccup -- worth a clearer message and
    // a 502 (bad upstream response) instead of the generic 500, since the
    // frontend surfaces this message directly to the student.
    if (err instanceof Error && err.message === 'The examiner had trouble responding. Please try again.') {
      return json({ error: err.message }, 502)
    }
    return json({ error: 'Internal error' }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
