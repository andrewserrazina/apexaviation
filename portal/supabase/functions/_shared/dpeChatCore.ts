// AI DPE — platform-agnostic conversational core shared by dpe-chat
// (web) and mobile-dpe (native app). Extracted verbatim out of
// dpe-chat/index.ts so both platforms drive the exact same system
// prompt, JSON-turn parsing/retry behavior, and Claude call shape —
// there is no web-specific access-control or business logic in any of
// this, only the Claude conversation mechanics, so a single shared
// module is the correct boundary (each platform's own index.ts still
// owns its own auth/session/transcript-persistence logic).
//
// Env vars required (set as Supabase Edge Function secrets on every
// function that imports this module):
//   ANTHROPIC_API_KEY

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const ANTHROPIC_MODEL = 'claude-sonnet-5'

export const MAX_QUESTIONS = 9
export const CONTROL_END_NOTE =
  '[SYSTEM: The candidate has requested to end the exam now. Do not ask another ' +
  'question or follow-up. Immediately respond with phase="debrief" and a full ' +
  'debrief based only on what has actually been covered so far.]'

export interface TranscriptTurn {
  role: 'dpe' | 'student'
  content: string
  at: string
}

export interface DebriefPayload {
  overallReadiness: 'ready' | 'almost' | 'not_yet'
  summary: string
  strengths: string[]
  weaknesses: string[]
  perDomain: { domain: string; verdict: 'strong' | 'ok' | 'weak'; note: string }[]
}

export interface DpeTurn {
  phase: 'question' | 'followup' | 'debrief'
  message: string
  debrief: DebriefPayload | null
}

export function buildSystemPrompt(categories: { label: string; intro: string }[]): string {
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
export function parseDpeTurn(raw: string): DpeTurn | null {
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
export async function callClaude(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<DpeTurn> {
  const first = await callClaudeOnce(systemPrompt, messages)
  if (first) return first
  console.error('dpeChatCore: malformed response from Claude, retrying once')
  const retry = await callClaudeOnce(systemPrompt, messages)
  if (retry) return retry
  throw new Error('The examiner had trouble responding. Please try again.')
}

export function toClaudeMessages(transcript: TranscriptTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  return transcript.map((t) => ({
    role: t.role === 'dpe' ? 'assistant' : 'user',
    content: t.content,
  }))
}
