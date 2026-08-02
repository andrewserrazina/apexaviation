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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const ANTHROPIC_MODEL = 'claude-sonnet-5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_QUESTIONS = 9
const CONTROL_END_NOTE =
  '[SYSTEM: The candidate has requested to end the exam now. Do not ask another ' +
  'question or follow-up. Immediately respond with phase="debrief" and a full ' +
  'debrief based only on what has actually been covered so far.]'

interface TranscriptTurn {
  role: 'dpe' | 'student'
  content: string
  at: string
}

interface DpeTurn {
  phase: 'question' | 'followup' | 'debrief'
  message: string
  debrief: DebriefPayload | null
}

interface DebriefPayload {
  overallReadiness: 'ready' | 'almost' | 'not_yet'
  summary: string
  strengths: string[]
  weaknesses: string[]
  perDomain: { domain: string; verdict: 'strong' | 'ok' | 'weak'; note: string }[]
}

function buildSystemPrompt(categories: { label: string; intro: string }[]): string {
  const domainList = categories.map((c) => `- ${c.label}: ${c.intro}`).join('\n')
  return `You are role-playing as an FAA Designated Pilot Examiner (DPE) conducting the oral portion of a Private Pilot checkride with a well-prepared applicant. Stay fully in character as the DPE for every "question" and "followup" phase — never break character to explain what you're doing.

Your goal is a realistic, rigorous practice oral exam, not a quiz:
- Ask one question at a time. Cover a mix of the ACS areas below across the session, weighted toward whichever areas the candidate seems weaker in based on their answers so far.
- After each answer, decide whether to ask a natural DPE-style follow-up (phase="followup") that probes further on the same topic, or move to a new question in a different area (phase="question"). Real DPEs follow up on vague, incomplete, or shaky answers — don't let a weak answer pass unchallenged.
- A follow-up must reference something specific the candidate actually said (a number, a term, a condition they named) — never a generic continuation like "tell me more about that" or "let's continue." If you don't have a specific, genuine follow-up question, that means the answer was complete: move on with phase="question" instead.
- If the candidate's answer was complete and correct (e.g. they stated a certificate/rating, a limitation, and its expiration or condition), do not manufacture a follow-up just to fill time — proceed to a new topic.
- Keep each message focused — one question or one follow-up, not a list. Write the way a real examiner talks: direct, plain, no bullet points, no headers, 1-4 sentences.
- Never reveal a score, grade, or "correct answer" mid-exam. Save all evaluation for the debrief.
- Ask no more than ${MAX_QUESTIONS} primary questions total (follow-ups don't count against this limit). Once you've asked ${MAX_QUESTIONS} primary questions and given the candidate a chance to answer the last one, conclude the exam and produce the debrief on your next turn.
- If you receive a message wrapped in [SYSTEM: ...], that is a meta-instruction from the practice app, not something the candidate said — follow it exactly (it is used to end the session early and request the debrief immediately).

ACS areas to draw from:
${domainList}

You must respond with ONLY a single raw JSON object — no markdown, no code fences, no commentary before or after it — matching exactly this shape:

{"phase": "question" | "followup" | "debrief", "message": string, "debrief": null | {"overallReadiness": "ready" | "almost" | "not_yet", "summary": string, "strengths": string[], "weaknesses": string[], "perDomain": [{"domain": string, "verdict": "strong" | "ok" | "weak", "note": string}]}}

Rules for the JSON:
- "message" is always required. For "question"/"followup" it's what the DPE says next, in character. For "debrief" it's a short, warm, in-character closing line (e.g. "Alright, that concludes our oral. Nice work today — here's how I'd assess it.").
- "debrief" must be null unless phase is "debrief". When phase is "debrief", fill it in fully and honestly based on the actual conversation — do not pad strengths or weaknesses with generic filler if the exam was short.
- perDomain should only include ACS areas you actually asked about.
- Never wrap the JSON in backticks or add any text outside the JSON object.`
}

// Returns null (rather than a canned filler turn) when the model's
// response genuinely can't be read as a DPE turn -- a silent fallback
// here previously showed the literal placeholder text "Let's continue —
// tell me more about that." to students whenever the model's raw
// response came back empty/unparseable, and because that fake turn got
// persisted into the transcript and replayed to the model as its own
// prior turn on the next call, the model had no real content to follow
// up on -- which is exactly the "stuck in a loop, asks bad follow-ups"
// bug this was reported as. Callers must retry or fail loudly instead.
function parseDpeTurn(raw: string): DpeTurn | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.message === 'string') {
      return {
        phase: parsed.phase === 'debrief' || parsed.phase === 'followup' ? parsed.phase : 'question',
        message: parsed.message,
        debrief: parsed.phase === 'debrief' && parsed.debrief ? parsed.debrief : null,
      }
    }
  } catch (_e) {
    // fall through to regex-extraction attempt below
  }
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (parsed && typeof parsed.message === 'string') {
        return {
          phase: parsed.phase === 'debrief' || parsed.phase === 'followup' ? parsed.phase : 'question',
          message: parsed.message,
          debrief: parsed.phase === 'debrief' && parsed.debrief ? parsed.debrief : null,
        }
      }
    } catch (_e2) {
      // fall through to null below
    }
  }
  return null
}

async function callClaudeOnce(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<DpeTurn | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      // 700 was tight enough that a full debrief payload (summary +
      // strengths/weaknesses + a note per ACS domain covered) could get
      // truncated mid-JSON, which read as a parse failure below.
      model: ANTHROPIC_MODEL,
      max_tokens: 1536,
      system: systemPrompt,
      messages,
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${errText}`)
  }
  const data = await res.json()
  const text = (data.content || []).map((block: { text?: string }) => block.text || '').join('')
  return parseDpeTurn(text)
}

// One retry on a genuinely malformed/empty response (a transient model
// hiccup, not something worth failing the whole turn over) before
// giving up and throwing -- the caller's catch block turns that into a
// real error response the frontend already displays gracefully, instead
// of a fake DPE turn getting written into the transcript and confusing
// every turn after it.
async function callClaude(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<DpeTurn> {
  const first = await callClaudeOnce(systemPrompt, messages)
  if (first) return first
  console.error('dpe-chat: malformed response from Claude, retrying once')
  const retry = await callClaudeOnce(systemPrompt, messages)
  if (retry) return retry
  throw new Error('The examiner had trouble responding. Please try again.')
}

function toClaudeMessages(transcript: TranscriptTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  return transcript.map((t) => ({
    role: t.role === 'dpe' ? 'assistant' : 'user',
    content: t.content,
  }))
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
