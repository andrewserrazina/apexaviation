// Mobile AI DPE Practice -- text-first native port of dpe-chat/index.ts
// (web). start/message/end mirror dpe-chat's own logic exactly (same
// ownership/status checks, same Claude conversation mechanics via
// ../_shared/dpeChatCore.ts) -- there is no web-specific access-control
// difference to diverge from, so this is a thin sibling function, not a
// modification of dpe-chat. Two actions are new, mobile-only:
//
//   resume  -- a phone gets backgrounded/killed far more than a browser
//              tab keeps a page open, so unlike web (which never reloads
//              mid-session -- the whole transcript lives in an in-page
//              JS array) mobile needs to reconstruct the chat-bubble
//              array from the persisted `ai_dpe_sessions.transcript`
//              after an app restart. Never creates a new attempt, never
//              calls Claude, never mutates the row -- a pure read.
//   history -- thin wrapper over get_my_recent_ai_dpe_sessions(), reused
//              verbatim (no transcript exposed, matching the RPC's
//              existing contract).
//
// V143-equivalent note: unlike complete_mobile_practice_session()/
// resume_mobile_practice_session(), get_my_recent_ai_dpe_sessions() is
// SECURITY DEFINER and scoped entirely by its own internal `auth.uid()`
// read -- there is no caller-suppliable profile id to spoof -- so it is
// called through the caller's own JWT-forwarding client, never the
// service-role client (which would make `auth.uid()` resolve to
// nothing inside the function).
//
// Env vars required (Supabase Edge Function secrets):
//   ANTHROPIC_API_KEY (consumed by dpeChatCore.ts)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Reconstructs display-ready chat bubbles from the raw persisted
// transcript for `resume`. 'dpe' entries store JSON.stringify(turn) as
// their content (see dpeChatCore.ts/dpe-chat's own transcript-write
// sites) -- re-parse to pull out just the message text, never the raw
// JSON envelope, so a resumed chat renders identically to a live one.
// A turn that somehow fails to parse (should never happen -- this
// function is the only writer of these rows) is skipped rather than
// shown as raw JSON to the student.
function transcriptToTurns(transcript: TranscriptTurn[]): Array<{ role: 'dpe' | 'student'; message: string; at: string }> {
  const turns: Array<{ role: 'dpe' | 'student'; message: string; at: string }> = []
  for (const t of transcript) {
    if (t.role === 'student') {
      turns.push({ role: 'student', message: t.content, at: t.at })
      continue
    }
    try {
      const parsed = JSON.parse(t.content)
      if (parsed && typeof parsed.message === 'string') {
        turns.push({ role: 'dpe', message: parsed.message, at: t.at })
      }
    } catch (_e) {
      // Skip an unparseable dpe turn rather than surface raw JSON.
    }
  }
  return turns
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  // auth.uid()-bound RPC calls (history's get_my_recent_ai_dpe_sessions)
  // must go through a client carrying the caller's own JWT -- the
  // service-role client above would make auth.uid() resolve to nothing.
  const authedClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader || '' } },
  })

  try {
    const { userId } = await requirePremiumAccess(supabase, authHeader)
    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'start') {
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

    if (action === 'resume') {
      const sessionId = body?.sessionId
      if (!sessionId || typeof sessionId !== 'string') return json({ error: 'sessionId is required' }, 400)

      const { data: session, error: fetchErr } = await supabase
        .from('ai_dpe_sessions')
        .select('id, profile_id, status, transcript, questions_asked, debrief')
        .eq('id', sessionId)
        .maybeSingle()
      if (fetchErr) throw fetchErr
      if (!session) return json({ error: 'Session not found' }, 404)
      if (session.profile_id !== userId) return json({ error: 'Not your session' }, 403)

      const turns = transcriptToTurns(session.transcript || [])

      return json({
        sessionId: session.id,
        status: session.status,
        questionsAsked: session.questions_asked,
        debrief: session.debrief,
        turns,
      })
    }

    if (action === 'history') {
      const limit = Number.isInteger(body?.limit) && body.limit > 0 ? body.limit : 10
      const { data, error } = await authedClient.rpc('get_my_recent_ai_dpe_sessions', { p_limit: limit })
      if (error) throw error
      const sessions = (data || []).map((row: {
        id: string
        status: string
        questions_asked: number
        debrief: unknown
        started_at: string
        ended_at: string | null
      }) => ({
        id: row.id,
        status: row.status,
        questionsAsked: row.questions_asked,
        debrief: row.debrief,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      }))
      return json({ sessions })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    if (err instanceof PremiumAccessError) {
      return json({ error: err.message }, err.status)
    }
    console.error('mobile-dpe error', err)
    if (err instanceof Error && err.message === 'The examiner had trouble responding. Please try again.') {
      return json({ error: err.message }, 502)
    }
    return json({ error: 'Internal error' }, 500)
  }
})
