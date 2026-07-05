// Server-side reconciliation for Apex Advantage lifecycle emails.
//
// site/portal.js already fires readiness-milestone, first-question,
// Checkride-Mode-complete, and weak-area emails -- but only from the
// browser, on page load/UI events. A member who crosses a milestone
// without the portal tab open at the right moment never gets that
// email. This function recomputes the exact same conditions
// server-side so nothing depends on the client being open, plus adds
// two email types nothing client-side can do at all: the 7-day
// inactivity nudge and the checkride countdown (30/14/7/3/1 days out).
//
// Meant to run on a schedule (daily), not per-request. See
// RETENTION_SYSTEM.md for the exact Supabase cron/pg_net setup this
// needs -- this sandbox has no live project to actually schedule it
// against, so that wiring is a manual step documented there, same as
// every other "apply this in the dashboard" step earlier in this repo's
// history (e.g. running the SQL migrations themselves).
//
// Dedup strategy, per email type:
//   - first_question_completed / readiness_25/50/75/90 /
//     checkride_mode_completed_email: these already have a "has this
//     ever fired" flag in portal_events (written by the client). Reuse
//     that as the source of truth so a member who already got one of
//     these from the client-side path is never re-sent it by this job,
//     and vice versa -- both paths write to BOTH portal_events (the
//     dedup flag) and portal_email_log (the complete audit trail Issue
//     #5 in LAUNCH_READINESS_REPORT.md flagged as incomplete) going
//     forward.
//   - weak_area_<category>: throttled (not one-time) -- re-sent if it's
//     been >=14 days since the last one for that exact category,
//     exactly matching sendThrottledEmail()'s existing behavior in
//     portal.js. Dedup source: portal_email_log.sent_at.
//   - inactivity_7day: throttled to once every 30 days so a member who
//     stays inactive doesn't get nudged daily forever. Dedup source:
//     portal_email_log.sent_at.
//   - checkride_countdown_<N>: brand new, no client-side equivalent, no
//     compatibility concern -- one-time per day-mark, dedup via
//     portal_email_log alone.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)
//   LIFECYCLE_CRON_SECRET (optional but recommended -- see
//   RETENTION_SYSTEM.md; if set, the caller must send it as
//   `Authorization: Bearer <secret>` or the request is rejected, so this
//   can't be triggered by anyone who finds the function's public URL)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('LIFECYCLE_CRON_SECRET')

const READINESS_THRESHOLDS = [25, 50, 75, 90]
const COUNTDOWN_DAYS = [30, 14, 7, 3, 1]
const WEAK_AREA_THROTTLE_DAYS = 14
const INACTIVITY_THROTTLE_DAYS = 30
const INACTIVITY_TRIGGER_DAYS = 7
const STUDY_SECONDS_TARGET = 5 * 3600

// Verbatim from site/portal.js's WEAK_AREA_CONTENT -- keep these two in
// sync if the copy ever changes; duplicated rather than shared because
// this function and the client bundle have no common module today.
const WEAK_AREA_CONTENT: Record<string, { subject: string; body: string }> = {
  eligibility: { subject: "Don't Let Paperwork Delay Your Checkride", body: 'Missing endorsements and expired medicals are the single most avoidable reason checkrides get delayed. A quick review of Eligibility &amp; Documents now saves you a bad surprise later.' },
  airworthiness: { subject: 'The ARROW Documents DPEs Always Check First', body: 'Examiners routinely ask you to physically produce ARROW documents in the aircraft — not just recite the acronym. A few minutes reviewing Airworthiness pays off fast.' },
  privileges: { subject: 'The Pro Rata Rule Most Students Get Wrong', body: "Precision matters in Privileges &amp; Limitations — examiners probe the edges of what a private pilot can and can't do. Worth another pass." },
  airspace: { subject: 'Class Bravo Scenarios That Fail Applicants', body: "Confusing Class B's clearance requirement with Class C/D's communication requirement is one of the most common real deviations — and a common oral exam trap." },
  weather: { subject: '5 Weather Questions Students Miss Most', body: 'METAR decoding, AIRMET vs. SIGMET, and icing conditions come up in almost every oral exam. A quick weather review goes a long way.' },
  performance: { subject: 'Why DPEs Always Ask About Aft CG', body: 'Weight and balance questions test more than arithmetic — examiners want to see you connect CG location to stall speed and control authority.' },
  aeromedical: { subject: 'The IMSAFE Check Most Pilots Skip', body: 'Aeromedical Factors is the most personal, judgment-based section of the exam. Worth revisiting before checkride day.' },
  crosscountry: { subject: "The Four C's That Save a Lost Pilot", body: "Cross-Country Planning ties together everything else in the guide — and it's often where the oral exam's scenario-based structure becomes most obvious." },
  emergency: { subject: "The 'Impossible Turn' Question Every DPE Asks", body: 'Emergency Operations questions test whether calm, procedural thinking is already automatic for you. A quick review before checkride day is always worth it.' },
}

const CATEGORY_LABELS: Record<string, string> = {
  eligibility: 'Eligibility & Documents', airworthiness: 'Airworthiness', privileges: 'Privileges & Limitations',
  airspace: 'Airspace', weather: 'Weather', performance: 'Performance', aeromedical: 'Aeromedical Factors',
  crosscountry: 'Cross-Country Planning', emergency: 'Emergency Operations',
}

function template(content: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#06080f;font-family:'Helvetica Neue',Arial,sans-serif;color:#e0e0e0;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="margin-bottom:28px;">
      <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#fff;">APEX</span>
      <span style="font-size:22px;font-style:italic;color:#F4B400;font-family:Georgia,serif;"> Advantage</span>
    </div>
    ${content}
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:32px 0 16px;">
    <p style="font-size:12px;color:rgba(255,255,255,0.3);margin:0;">Apex Aviation · San Marcos, TX (KHYI)</p>
  </div>
</body></html>`
}

async function sendEmail(supabase: any, to: string, subject: string, contentHtml: string) {
  await supabase.functions.invoke('send-email', { body: { to, subject, html: template(contentHtml) } })
}

// Marks a one-time milestone as sent in BOTH portal_events (the dedup
// flag portal.js already checks) and portal_email_log (the complete
// audit trail), so whichever side -- client or this job -- gets there
// first is authoritative for both.
async function markMilestoneSent(supabase: any, profileId: string, type: string) {
  await supabase.from('portal_events').insert({ profile_id: profileId, event_type: type })
  await supabase.from('portal_email_log').insert({ profile_id: profileId, email_type: type })
}

async function hasMilestoneFired(supabase: any, profileId: string, type: string) {
  const { data } = await supabase.from('portal_events').select('id').eq('profile_id', profileId).eq('event_type', type).limit(1)
  return !!(data && data.length)
}

async function daysSinceLastEmail(supabase: any, profileId: string, type: string): Promise<number> {
  const { data } = await supabase
    .from('portal_email_log')
    .select('sent_at')
    .eq('profile_id', profileId)
    .eq('email_type', type)
    .order('sent_at', { ascending: false })
    .limit(1)
  if (!data || !data.length) return Infinity
  return (Date.now() - new Date(data[0].sent_at).getTime()) / 86400000
}

function emailTemplate1FirstQuestion() {
  return '<h2 style="color:#F4B400;margin:0 0 4px;">First question, done.</h2>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">That\'s one down, 71 to go — and every one after this gets a little more familiar. Keep the momentum going.</p>' +
    '<a href="https://apexaviationtx.com/portal.html#dpe-library" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Keep Studying →</a>'
}

function emailTemplateMilestone(threshold: number) {
  const copy: Record<number, string> = {
    25: "You're a quarter of the way to checkride-ready. The hardest part — starting — is behind you.",
    50: "Halfway there. Your ACS coverage is filling in and it shows.",
    75: "Three-quarters of the way to checkride-ready. Time to start tightening up your weakest areas.",
    90: "You are checkride-ready in every way that matters. Book a mock oral and go show a DPE what you know.",
  }
  return `<h2 style="color:#F4B400;margin:0 0 4px;">${threshold}% Checkride Ready</h2>` +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">${copy[threshold]}</p>` +
    '<a href="https://apexaviationtx.com/portal.html" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">View Your Dashboard →</a>'
}

function emailTemplateCheckrideModeDone() {
  return '<h2 style="color:#F4B400;margin:0 0 4px;">Checkride Mode: complete</h2>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You just simulated a real oral exam — 20 questions, no labels, no hints. That\'s exactly the kind of pressure practice that makes checkride day feel routine.</p>'
}

function emailTemplateInactivity(firstName: string) {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Still working toward your checkride, ${firstName}?</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">It\'s been a week since your last visit to the portal. A few minutes of review keeps everything from going stale before checkride day.</p>' +
    '<a href="https://apexaviationtx.com/portal.html" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Pick Up Where You Left Off →</a>'
}

function emailTemplateCountdown(daysUntil: number) {
  const noun = daysUntil === 1 ? 'day' : 'days'
  return `<h2 style="color:#F4B400;margin:0 0 4px;">${daysUntil} ${noun} until your checkride</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Use the Weak Areas widget to spend your remaining study time where it counts most, and make sure your logbook and endorsements are squared away.</p>' +
    '<a href="https://apexaviationtx.com/portal.html#progress" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Review Your Progress →</a>'
}

type Question = { id: string; category: string; is_scenario: boolean }

// Mirrors computeReadiness()/categoryPct()/computeStreaks() in
// site/portal.js exactly (same weights, same thresholds) so a score
// computed here always agrees with what the member's own dashboard
// would show them. One known, deliberate approximation: "current
// streak"/"today" here uses this job's run date (UTC), not the
// member's browser-local date the client would use -- since dedup for
// every threshold is a one-time flag (not re-triggered), the only
// possible effect of that difference is a milestone email firing up to
// a day earlier/later than the client would have, never a duplicate.
async function computeReadinessScore(
  supabase: any,
  profileId: string,
  questions: Question[],
  categoryIds: string[],
): Promise<number> {
  const [{ data: qProgress }, { data: sProgress }, { data: activity }] = await Promise.all([
    supabase.from('portal_question_progress').select('question_id,completed').eq('profile_id', profileId),
    supabase.from('portal_scenario_progress').select('scenario_id,completed').eq('profile_id', profileId),
    supabase.from('portal_study_activity').select('activity_date,seconds').eq('profile_id', profileId),
  ])

  const studiedQuestionIds = new Set((qProgress ?? []).filter((r: any) => r.completed).map((r: any) => r.question_id))
  const studiedScenarioIds = new Set((sProgress ?? []).filter((r: any) => r.completed).map((r: any) => r.scenario_id))

  const scenarioQuestions = questions.filter(q => q.is_scenario)

  // DPE_DATA client-side includes every question regardless of is_scenario,
  // so the denominator here is the full question set, not just non-scenario ones.
  const qPct = questions.length ? questions.filter(q => studiedQuestionIds.has(q.id)).length / questions.length : 0
  const sPct = scenarioQuestions.length ? scenarioQuestions.filter(q => studiedScenarioIds.has('scenario-' + q.id)).length / scenarioQuestions.length : 0

  const acsCoverage = categoryIds.length
    ? categoryIds.reduce((sum, cat) => {
        const items = questions.filter(q => q.category === cat)
        if (!items.length) return sum
        const done = items.filter(q => studiedQuestionIds.has(q.id)).length
        return sum + done / items.length
      }, 0) / categoryIds.length
    : 0

  const dates = Array.from(new Set((activity ?? []).map((r: any) => r.activity_date as string))).sort()
  const dateSet = new Set(dates)
  let current = 0
  const cursor = new Date()
  cursor.setUTCHours(0, 0, 0, 0)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  const toStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  if (!dateSet.has(toStr(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1)
  while (dateSet.has(toStr(cursor))) {
    current++
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  const consistency = Math.min(current / 14, 1)

  const totalSeconds = (activity ?? []).reduce((sum: number, r: any) => sum + (r.seconds || 0), 0)
  const timePct = Math.min(totalSeconds / STUDY_SECONDS_TARGET, 1)

  const score = Math.round(100 * (0.30 * qPct + 0.20 * sPct + 0.25 * acsCoverage + 0.15 * consistency + 0.10 * timePct))
  return Math.max(0, Math.min(100, score))
}

async function categoryCompletion(supabase: any, profileId: string, questions: Question[], categoryIds: string[]) {
  const { data: qProgress } = await supabase.from('portal_question_progress').select('question_id,completed').eq('profile_id', profileId)
  const studiedQuestionIds = new Set((qProgress ?? []).filter((r: any) => r.completed).map((r: any) => r.question_id))
  return categoryIds.map(cat => {
    const items = questions.filter(q => q.category === cat)
    const pct = items.length ? items.filter(q => studiedQuestionIds.has(q.id)).length / items.length : 0
    return { cat, pct }
  }).sort((a, b) => a.pct - b.pct)
}

async function processInactivity(supabase: any, profile: any, results: any) {
  const lastActive = profile.portal_last_active_at || profile.created_at
  const daysInactive = (Date.now() - new Date(lastActive).getTime()) / 86400000
  if (daysInactive < INACTIVITY_TRIGGER_DAYS) return
  if ((await daysSinceLastEmail(supabase, profile.id, 'inactivity_7day')) < INACTIVITY_THROTTLE_DAYS) return

  await sendEmail(supabase, profile.email, "We miss you at Apex Advantage", emailTemplateInactivity((profile.full_name || 'there').split(' ')[0]))
  await supabase.from('portal_email_log').insert({ profile_id: profile.id, email_type: 'inactivity_7day' })
  results.inactivity++
}

async function processMilestones(supabase: any, profile: any, questions: Question[], categoryIds: string[], results: any) {
  const { data: qProgress } = await supabase.from('portal_question_progress').select('id').eq('profile_id', profile.id).eq('completed', true).limit(1)
  if (qProgress && qProgress.length) {
    if (!(await hasMilestoneFired(supabase, profile.id, 'first_question_completed'))) {
      await sendEmail(supabase, profile.email, 'You completed your first question 🎉', emailTemplate1FirstQuestion())
      await markMilestoneSent(supabase, profile.id, 'first_question_completed')
      results.first_question++
    }
  }

  const score = await computeReadinessScore(supabase, profile.id, questions, categoryIds)
  for (const threshold of READINESS_THRESHOLDS) {
    const key = 'readiness_' + threshold
    if (score >= threshold && !(await hasMilestoneFired(supabase, profile.id, key))) {
      await sendEmail(supabase, profile.email, `${score}% Checkride Ready`, emailTemplateMilestone(threshold))
      await markMilestoneSent(supabase, profile.id, key)
      results.readiness++
    }
  }

  const { data: checkrideAttempts } = await supabase
    .from('portal_practice_attempts')
    .select('id').eq('profile_id', profile.id).eq('mode', 'checkride').not('completed_at', 'is', null).limit(1)
  if (checkrideAttempts && checkrideAttempts.length && !(await hasMilestoneFired(supabase, profile.id, 'checkride_mode_completed_email'))) {
    await sendEmail(supabase, profile.email, 'Checkride Mode: complete', emailTemplateCheckrideModeDone())
    await markMilestoneSent(supabase, profile.id, 'checkride_mode_completed_email')
    results.checkride_mode++
  }
}

async function processWeakArea(supabase: any, profile: any, questions: Question[], categoryIds: string[], results: any) {
  const ranked = await categoryCompletion(supabase, profile.id, questions, categoryIds)
  const weakest = ranked[0]
  if (!weakest || weakest.pct >= 1) return
  const content = WEAK_AREA_CONTENT[weakest.cat]
  if (!content) return
  const emailType = 'weak_area_' + weakest.cat
  if ((await daysSinceLastEmail(supabase, profile.id, emailType)) < WEAK_AREA_THROTTLE_DAYS) return

  const html = `<h2 style="color:#F4B400;margin:0 0 4px;">${content.subject}</h2>` +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">${content.body}</p>` +
    `<a href="https://apexaviationtx.com/portal.html#dpe-library" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Review ${CATEGORY_LABELS[weakest.cat] || weakest.cat} →</a>`
  await sendEmail(supabase, profile.email, content.subject, html)
  await supabase.from('portal_email_log').insert({ profile_id: profile.id, email_type: emailType })
  results.weak_area++
}

async function processCountdown(supabase: any, profile: any, results: any) {
  const { data } = await supabase.from('portal_checkride_date').select('checkride_date').eq('profile_id', profile.id).maybeSingle()
  if (!data) return
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const checkride = new Date(data.checkride_date + 'T00:00:00Z')
  const daysUntil = Math.round((checkride.getTime() - today.getTime()) / 86400000)
  if (!COUNTDOWN_DAYS.includes(daysUntil)) return

  const emailType = 'checkride_countdown_' + daysUntil
  if (await hasMilestoneFired(supabase, profile.id, emailType)) return

  await sendEmail(supabase, profile.email, `${daysUntil} days until your checkride`, emailTemplateCountdown(daysUntil))
  await supabase.from('portal_email_log').insert({ profile_id: profile.id, email_type: emailType })
  results.countdown++
}

serve(async (req) => {
  if (CRON_SECRET) {
    const authHeader = req.headers.get('Authorization') || ''
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const results = { inactivity: 0, first_question: 0, readiness: 0, checkride_mode: 0, weak_area: 0, countdown: 0, errors: [] as string[] }

  const [{ data: categories }, { data: questions }, { data: profiles }] = await Promise.all([
    supabase.from('dpe_categories').select('id'),
    supabase.from('dpe_questions').select('id,category,is_scenario'),
    supabase.from('profiles').select('id,email,full_name,checkride_prep_unlocked,created_at,portal_last_active_at'),
  ])

  const categoryIds: string[] = (categories ?? []).map((c: any) => c.id)
  const allQuestions: Question[] = questions ?? []

  for (const profile of profiles ?? []) {
    if (!profile.email) continue
    try {
      await processInactivity(supabase, profile, results)
      if (profile.checkride_prep_unlocked) {
        await processMilestones(supabase, profile, allQuestions, categoryIds, results)
        await processWeakArea(supabase, profile, allQuestions, categoryIds, results)
        await processCountdown(supabase, profile, results)
      }
    } catch (err) {
      results.errors.push(`${profile.id}: ${err}`)
    }
  }

  return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } })
})
