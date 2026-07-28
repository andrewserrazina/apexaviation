// Ask Andrew — AI Flight Instructor. An open-ended, ongoing aviation Q&A
// companion for Apex Advantage Members, distinct from AI DPE Practice
// (dpe-chat), which is a bounded, structured oral-exam simulation gated by
// Checkride Prep. This feature is one continuous thread per member rather
// than discrete sessions, gated by the 'ask_andrew' Membership-exclusive
// capability (get_member_capabilities(), supabase-portal-schema-v51.sql).
//
// IMPORTANT: this assistant is an AI, not the real Andrew. The system
// prompt below explicitly instructs the model to identify as an AI
// modeled on Andrew's teaching approach and never claim to literally be
// him -- "Ask Andrew" is the product's brand name, not a claim that the
// user is messaging a real person. It also explicitly declines to make
// real go/no-go or safety-of-flight decisions for an actual upcoming
// flight, redirecting those to the member's real, certificated instructor.
//
// Env vars required (set as Supabase Edge Function secrets):
//   ANTHROPIC_API_KEY
//   SUPABASE_URL              (auto-provided by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireCapability, PremiumAccessError } from '../_shared/premiumAccess.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const ANTHROPIC_MODEL = 'claude-sonnet-5'

// Bounds how much history is sent to Claude per turn (and returned on
// initial load) -- an ever-growing single thread would otherwise make
// every turn's request body (and cost) grow unbounded over a member's
// lifetime.
const MAX_HISTORY_MESSAGES = 40

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `You are the Apex Advantage AI Flight Instructor, branded to members as "Ask Andrew" -- modeled on the teaching approach of Andrew, Apex Aviation's real flight instructor, but you are an AI, not Andrew himself. If a student asks whether you're a real person, or addresses you as if you are Andrew personally, clarify plainly that you're an AI assistant built to answer in his teaching style, not a live conversation with him.

You help student and certificated pilots with aviation knowledge: regulations, procedures, aerodynamics, systems, airspace, weather theory, checkride and career questions, and general study help, at whatever rating level the student is working toward. Answer directly and clearly, the way a good instructor would in a debrief -- plain language first, then the technical detail. It's fine to ask a clarifying question if the student's question is ambiguous.

Hard limits, because this is aviation and real safety matters:
- Never make an actual go/no-go decision for a real, specific upcoming flight, and never evaluate real-time weather, NOTAMs, or aircraft status as if signing off on a real flight. If asked, explain you can discuss the relevant concepts and regulations, but the actual go/no-go call has to come from the student, their real instructor, and current official sources.
- Never claim authority you don't have: you cannot endorse a student, sign a logbook, or substitute for a real CFI's judgment on their actual training and readiness. Encourage bringing anything safety-of-flight-critical or endorsement-related to their real instructor.
- If you're not confident about a specific regulatory citation or number, say so rather than inventing one, and suggest the student verify it in the current FAR/AIM or with their instructor.

Keep answers conversational and appropriately concise -- a few paragraphs at most unless the student is clearly asking for a deep, detailed breakdown. No markdown headers or bullet-heavy formatting; write the way a real instructor talks.`

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function callClaude(history: { role: 'user' | 'assistant'; content: string }[]): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: history,
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${errText}`)
  }
  const data = await res.json()
  return (data.content || []).map((block: { text?: string }) => block.text || '').join('').trim()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const { userId } = await requireCapability(
      supabase,
      req.headers.get('Authorization'),
      'ask_andrew',
      'Ask Andrew is included with an active Apex Advantage Membership.'
    )

    const body = await req.json()
    const studentMessage = (body?.message || '').toString().trim()
    if (!studentMessage) return json({ error: 'message is required' }, 400)
    if (studentMessage.length > 4000) return json({ error: 'Message is too long.' }, 400)

    const { data: priorRows, error: histErr } = await supabase
      .from('ai_cfi_messages')
      .select('role, content')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES)
    if (histErr) throw histErr

    const history = (priorRows || []).slice().reverse().map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
    }))
    history.push({ role: 'user', content: studentMessage })

    const { error: insUserErr } = await supabase
      .from('ai_cfi_messages')
      .insert({ profile_id: userId, role: 'user', content: studentMessage })
    if (insUserErr) throw insUserErr

    const reply = await callClaude(history)

    const { data: assistantRow, error: insAssistantErr } = await supabase
      .from('ai_cfi_messages')
      .insert({ profile_id: userId, role: 'assistant', content: reply })
      .select('id, created_at')
      .single()
    if (insAssistantErr) throw insAssistantErr

    return json({ message: reply, createdAt: assistantRow.created_at })
  } catch (err) {
    if (err instanceof PremiumAccessError) {
      return json({ error: err.message }, err.status)
    }
    console.error('ai-cfi-chat error', err)
    return json({ error: 'Internal error' }, 500)
  }
})
