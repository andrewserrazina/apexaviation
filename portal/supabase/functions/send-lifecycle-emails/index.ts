// Server-side reconciliation for Apex Advantage lifecycle emails.
//
// site/portal.js already fires readiness-milestone, first-question,
// Checkride-Mode-complete, and weak-area emails -- but only from the
// browser, on page load/UI events. A member who crosses a milestone
// without the portal tab open at the right moment never gets that
// email. This function recomputes the exact same conditions
// server-side so nothing depends on the client being open, plus adds
// email types nothing client-side can do at all: the 7-day inactivity
// nudge, the checkride countdown (30/14/7/3/1 days out), a pre-purchase
// Checkride Prep upsell drip (1/3/7/14 days after signup, for members
// who haven't unlocked it yet), and (Phase 6) a post-attendance ground
// school follow-up.
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
//   - weak_area_<category>: logged before send and protected by the
//     portal_email_log weak-area unique index. This makes each weak-area
//     recommendation one-time per member/category so a misconfigured cron
//     or repeated portal loads cannot drip the same subject repeatedly.
//   - inactivity_7day: throttled to once every 30 days so a member who
//     stays inactive doesn't get nudged daily forever. Dedup source:
//     portal_email_log.sent_at.
//   - checkride_countdown_<N>: brand new, no client-side equivalent, no
//     compatibility concern -- one-time per day-mark, dedup via
//     portal_email_log alone.
//   - checkride_upsell_day<1|3|7|14>: brand new, no client-side
//     equivalent. One-time per stage via portal_events (reusing
//     hasMilestoneFired/markMilestoneSent), keyed off days since
//     profile.created_at rather than study progress. Only sent to
//     members with checkride_prep_unlocked = false; stops entirely the
//     moment they unlock it. Only the latest reached-but-unsent stage
//     fires per run (see processCheckrideUpsell) so a profile that
//     predates this feature doesn't get all four stages back-to-back
//     in one run. Pricing (get_checkride_prep_pricing) is fetched fresh
//     per-profile inside processCheckrideUpsell, not once globally, since
//     the launch tier depends on that profile's own created_at -- day1
//     is the stage most likely to still land inside the 48-hour launch
//     window given this job's daily cron cadence, so it's the one with
//     real urgency copy; day3/7/14 fall back to whatever live tier the
//     RPC actually returns by the time they fire.
//   - ground_followup_<registration_id>: brand new (Phase 6), no
//     client-side equivalent. One-time per registration (not per
//     profile/day), so a member who attends multiple sessions gets one
//     follow-up per session attended.
//   - abandoned_checkout_<attempt_id>: brand new. Reads
//     checkout_session_attempts (populated by create-checkout-session,
//     stamped completed_at by stripe-webhook) for rows still
//     uncompleted between ABANDONED_CHECKOUT_MIN_HOURS and
//     ABANDONED_CHECKOUT_MAX_DAYS after creation, and sends exactly one
//     recovery nudge per attempt (dedup: checkout_session_attempts.
//     recovery_email_sent_at itself, not portal_email_log -- an attempt
//     row is already a one-per-checkout-click record, so it doubles as
//     its own dedup key). Deliberately does not regenerate a fresh
//     Stripe Checkout Session or link directly to one: prices/seat
//     availability can change between the attempt and the recovery
//     email, so the email links back into the portal (or portal-login,
//     for a visitor who never finished setting a password) and lets the
//     existing "click to check out" buttons compute a fresh, correct
//     price at click time -- same as any other visit.
//
// Env vars required (Supabase Edge Function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided)
//   LIFECYCLE_CRON_SECRET (optional but recommended -- see
//   RETENTION_SYSTEM.md; if set, the caller must send it as
//   `Authorization: Bearer <secret>` or the request is rejected, so this
//   can't be triggered by anyone who finds the function's public URL)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { emailTemplate as template } from '../_shared/emailTemplate.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('LIFECYCLE_CRON_SECRET')

const READINESS_THRESHOLDS = [25, 50, 75, 90]
const COUNTDOWN_DAYS = [30, 14, 7, 3, 1]
const WEAK_AREA_THROTTLE_DAYS = 14
const INACTIVITY_THROTTLE_DAYS = 30
const INACTIVITY_TRIGGER_DAYS = 7
const STUDY_SECONDS_TARGET = 5 * 3600
const UPSELL_DAYS = [1, 3, 7, 14]
const ABANDONED_CHECKOUT_MIN_HOURS = 1
const ABANDONED_CHECKOUT_MAX_DAYS = 7

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
    '<a href="https://advantage.apexaviationtx.com/portal.html#dpe-library" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Keep Studying →</a>'
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
    '<a href="https://advantage.apexaviationtx.com/portal.html" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">View Your Dashboard →</a>'
}

function emailTemplateCheckrideModeDone() {
  return '<h2 style="color:#F4B400;margin:0 0 4px;">Checkride Mode: complete</h2>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You just simulated a real oral exam — 20 questions, no labels, no hints. That\'s exactly the kind of pressure practice that makes checkride day feel routine.</p>'
}

function emailTemplateInactivity(firstName: string) {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Still working toward your checkride, ${firstName}?</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">It\'s been a week since your last visit to the portal. A few minutes of review keeps everything from going stale before checkride day.</p>' +
    '<a href="https://advantage.apexaviationtx.com/portal.html" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Pick Up Where You Left Off →</a>'
}

function emailTemplateCountdown(daysUntil: number) {
  const noun = daysUntil === 1 ? 'day' : 'days'
  return `<h2 style="color:#F4B400;margin:0 0 4px;">${daysUntil} ${noun} until your checkride</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Use the Weak Areas widget to spend your remaining study time where it counts most, and make sure your logbook and endorsements are squared away.</p>' +
    '<a href="https://advantage.apexaviationtx.com/portal.html#progress" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Review Your Progress →</a>'
}

// Ground school is live, instructor-led, in-person -- there is no
// recording/replay system anywhere in this codebase, so this
// deliberately does not promise a "replay link" the way the original
// Phase 6 ask's wording suggested. "Resources" here is a real, working
// link to browse upcoming sessions (repeat attendance); the portal CTA
// is generic rather than personalized to unlock status, since that would
// require an extra profiles lookup per registration for a soft nudge
// that reads fine either way.
function emailTemplateGroundSchoolFollowUp(sessionTitle: string) {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Thanks for coming to ${sessionTitle}</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Hope it was a good session. Keep the momentum going with the Checkride Prep System in your member portal, or grab a spot at the next ground school session while it\'s fresh.</p>' +
    '<a href="https://advantage.apexaviationtx.com/portal.html#ground-school" style="display:inline-block;margin-top:8px;margin-right:10px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">See Upcoming Sessions →</a>' +
    '<a href="https://advantage.apexaviationtx.com/portal.html" style="display:inline-block;margin-top:8px;border:1.5px solid rgba(244,180,0,0.4);color:#F4B400;border-radius:8px;padding:11px 21px;text-decoration:none;font-weight:700;font-size:14px;">Go to My Portal →</a>'
}

type PricingPreview = { tier: 'founding' | 'launch' | 'standard'; amount_cents: number; founding_seats_remaining: number; launch_expires_at: string | null }

// Pre-purchase drip for members who haven't unlocked Checkride Prep yet --
// distinct from processMilestones/processWeakArea/processCountdown above,
// which all require checkride_prep_unlocked (they're about studying
// content the member already paid for). This one's job is the opposite:
// nudge a free-portal member toward paying $29/$49 to unlock it, using
// the exact same dedup/one-time-per-stage machinery as the milestone
// emails (hasMilestoneFired/markMilestoneSent), keyed off days since
// profile.created_at instead of a study-progress trigger.
// If the member is still inside their founding/launch discount window
// when this fires, day1 pushes real urgency (exact price, exact hours
// left) instead of a generic "here's what's waiting" pitch -- day1 is
// the most likely email to still land inside the 48-hour launch window
// (see UPSELL_DAYS/launch-window comment below), so it's worth being
// specific here even though day3/day7/day14 mostly can't be anymore.
function emailTemplateUpsellDay1(pricing: PricingPreview) {
  const intro = '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Your free portal account already includes the "10 Questions DPEs Love to Ask" guide. The full Checkride Prep System adds a 256-question DPE-style bank covering every ACS area of operation — each with a model answer, the common mistakes examiners watch for, and real-world context — plus scenario training and progress tracking.</p>'
  if (pricing.tier === 'founding' || pricing.tier === 'launch') {
    const price = '$' + Math.round(pricing.amount_cents / 100)
    const urgency = pricing.tier === 'founding'
      ? `${pricing.founding_seats_remaining} founding spot${pricing.founding_seats_remaining === 1 ? '' : 's'} left at ${price}, then $49`
      : `${price} new-member pricing is still active on your account for a limited time, then $49`
    return `<h2 style="color:#F4B400;margin:0 0 4px;">${urgency}</h2>` + intro +
      `<a href="https://advantage.apexaviationtx.com/portal.html#checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Unlock for ${price} →</a>`
  }
  return '<h2 style="color:#F4B400;margin:0 0 4px;">Here\'s what\'s waiting for you</h2>' + intro +
    '<a href="https://advantage.apexaviationtx.com/portal.html#checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">See What\'s Inside →</a>'
}

function emailTemplateUpsellDay3() {
  return '<h2 style="color:#F4B400;margin:0 0 4px;">A question DPEs love to ask</h2>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">"You want to split the cost of a cross-country flight with a friend who isn\'t a pilot. Is that legal for a private pilot to do?"</p>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Most applicants know the pro rata rule exists — fewer can explain it precisely enough to satisfy a DPE\'s follow-up questions. That\'s exactly the gap the full Checkride Prep System closes: 256 questions like this one, each with a model answer and the specific mistake examiners watch for.</p>' +
    '<a href="https://advantage.apexaviationtx.com/portal.html#checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Unlock the Full System →</a>'
}

function emailTemplateUpsellDay7(pricing: PricingPreview) {
  const price = '$' + Math.round(pricing.amount_cents / 100)
  let heading: string
  let body: string
  if (pricing.tier === 'founding') {
    heading = `${pricing.founding_seats_remaining} founding spot${pricing.founding_seats_remaining === 1 ? '' : 's'} left at ${price}`
    body = `Founding pricing (${price}, versus $49 after the first 25 members) won't last much longer. The full system is 256 DPE-style questions, model answers, scenario training, and progress tracking — built to make oral exam day feel like a conversation, not an interrogation.`
  } else if (pricing.tier === 'launch') {
    heading = `Your ${price} new-member price is still active`
    body = `You're still inside your new-member pricing window — ${price} instead of the usual $49. The full system is 256 DPE-style questions, model answers, scenario training, and progress tracking — built to make oral exam day feel like a conversation, not an interrogation.`
  } else {
    heading = 'Still thinking about the Checkride Prep System?'
    body = `256 DPE-style questions, model answers, scenario training, and progress tracking — built to make oral exam day feel like a conversation, not an interrogation. Unlock it whenever you're ready.`
  }
  return `<h2 style="color:#F4B400;margin:0 0 4px;">${heading}</h2>` +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">${body}</p>` +
    `<a href="https://advantage.apexaviationtx.com/portal.html#checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Unlock for ${price} →</a>`
}

function emailTemplateUpsellDay14(pricing: PricingPreview) {
  const price = '$' + Math.round(pricing.amount_cents / 100)
  return '<h2 style="color:#F4B400;margin:0 0 4px;">One more look before we stop emailing about this</h2>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">No pressure — the free guide is yours either way. But if your checkride is getting closer, the full 256-question Checkride Prep System (DPE insight, scenario training, progress tracking) is one click away whenever you want it.</p>' +
    `<a href="https://advantage.apexaviationtx.com/portal.html#checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Unlock for ${price} →</a>`
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
    `<a href="https://advantage.apexaviationtx.com/portal.html#dpe-library" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Review ${CATEGORY_LABELS[weakest.cat] || weakest.cat} →</a>`
  const { error: logError } = await supabase.from('portal_email_log').insert({ profile_id: profile.id, email_type: emailType })
  if (logError) {
    if (logError.code !== '23505') results.errors.push(`weak_area_log:${profile.id}:${logError.message}`)
    return
  }
  await sendEmail(supabase, profile.email, content.subject, html)
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

// Sends at most one upsell stage per run, picking the latest stage the
// member has reached that they haven't already received (checked
// highest-day-first). This deliberately does NOT send every stage the
// member has passed in a single run: a profile that's 20 days old and
// has never gotten one of these (e.g. signed up before this feature
// shipped) gets only the day14 email, not day1+day3+day7+day14 all at
// once. Each stage is still a one-time send via hasMilestoneFired/
// markMilestoneSent -- once day14 fires, the sequence is exhausted and
// this is a no-op for that profile going forward, same terminal
// behavior as the other one-time milestone types above.
// Pricing is fetched per-profile (not once globally) because the
// launch tier depends on *this* profile's created_at -- two members at
// different signup ages can legitimately see different tiers/prices on
// the same run of this job.
async function processCheckrideUpsell(supabase: any, profile: any, results: any) {
  if (profile.checkride_prep_unlocked) return
  const daysSinceSignup = (Date.now() - new Date(profile.created_at).getTime()) / 86400000

  for (const day of [...UPSELL_DAYS].reverse()) {
    if (daysSinceSignup < day) continue
    const emailType = 'checkride_upsell_day' + day
    if (await hasMilestoneFired(supabase, profile.id, emailType)) continue

    const { data: pricingRows } = await supabase.rpc('get_checkride_prep_pricing', { p_profile_id: profile.id })
    const pricing: PricingPreview = (pricingRows && pricingRows[0]) || { tier: 'standard', amount_cents: 4900, founding_seats_remaining: 0, launch_expires_at: null }

    const subjectsAndTemplates: Record<number, [string, string]> = {
      1: ['Here\'s what\'s waiting in your Checkride Prep System', emailTemplateUpsellDay1(pricing)],
      3: ['A question DPEs love to ask', emailTemplateUpsellDay3()],
      7: [pricing.tier === 'founding' ? `${pricing.founding_seats_remaining} founding spots left at $${Math.round(pricing.amount_cents / 100)}` : 'Still thinking about the Checkride Prep System?', emailTemplateUpsellDay7(pricing)],
      14: ['Last look: the Checkride Prep System', emailTemplateUpsellDay14(pricing)],
    }
    const [subject, html] = subjectsAndTemplates[day]
    await sendEmail(supabase, profile.email, subject, html)
    await markMilestoneSent(supabase, profile.id, emailType)
    results.checkride_upsell++
    return
  }
}

// Phase 6: post-attendance follow-up. Iterates ground_registrations
// directly rather than profiles -- a walk-in registrant with no matching
// portal account (profile_id null) still has a real email on the
// registration row and should still get this, same as the registration/
// waitlist confirmation emails already sent from the Stripe webhook and
// GroundSchedule.jsx. Dedup key includes the registration id itself
// (not just profile_id), so a member who attends multiple sessions over
// time gets one follow-up per session, not just once ever. Bounded to
// the last 45 days so this doesn't rescan an ever-growing full history
// on every run.
async function processGroundSchoolFollowUps(supabase: any, results: any) {
  const cutoff = new Date(Date.now() - 45 * 86400000).toISOString()
  const { data: regs } = await supabase
    .from('ground_registrations')
    .select('id, email, profile_id, checked_out_at, session:ground_sessions(title)')
    .eq('attendance_status', 'completed')
    .gte('checked_out_at', cutoff)

  for (const reg of regs ?? []) {
    if (!reg.email) continue
    const emailType = 'ground_followup_' + reg.id
    try {
      const { data: already } = await supabase.from('portal_email_log').select('id').eq('email_type', emailType).limit(1)
      if (already && already.length) continue

      const sessionTitle = reg.session?.title || 'Ground School'
      await sendEmail(supabase, reg.email, `Thanks for coming to ${sessionTitle}`, emailTemplateGroundSchoolFollowUp(sessionTitle))
      await supabase.from('portal_email_log').insert({ profile_id: reg.profile_id, email_type: emailType })
      results.ground_followup++
    } catch (err) {
      results.errors.push(`ground_registration ${reg.id}: ${err}`)
    }
  }
}

const PORTAL_LOGIN_URL = 'https://advantage.apexaviationtx.com/portal-login.html'

function emailTemplateAbandonedCheckridePrep(firstName: string) {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Still want in, ${firstName}?</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Looks like you started unlocking the Checkride Prep System but didn\'t finish checkout. Nothing was charged — pick up right where you left off whenever you\'re ready.</p>' +
    `<a href="${PORTAL_LOGIN_URL}?dest=checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Finish Unlocking →</a>`
}

function emailTemplateAbandonedGroundSchool(firstName: string) {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Still want a seat, ${firstName}?</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Looks like you started registering for a live ground school session but didn\'t finish checkout. Nothing was charged — spots are first-come, first-served, so it\'s worth finishing up if you still want in.</p>' +
    `<a href="${PORTAL_LOGIN_URL}?dest=ground-school" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Finish Registering →</a>`
}

function emailTemplateAbandonedMockOral(firstName: string) {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Still want to book, ${firstName}?</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Looks like you started booking a Mock Oral but didn\'t finish checkout. Nothing was charged — pick up right where you left off whenever you\'re ready.</p>' +
    `<a href="${PORTAL_LOGIN_URL}?dest=mock-oral" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Finish Booking →</a>`
}

// Abandoned-checkout recovery: a one-time nudge per checkout_session_
// attempts row still uncompleted between ABANDONED_CHECKOUT_MIN_HOURS
// and ABANDONED_CHECKOUT_MAX_DAYS after it was created. Deliberately
// links back to portal-login.html (not a regenerated Stripe session or
// the plain portal.html dashboard) since that page already handles
// both "not signed in yet" (e.g. a signup-and-unlock-checkride-prep
// attempt whose password was never set) and "already signed in"
// (auto-redirects straight past the login form) correctly today -- see
// its existing apexSupabase.auth.getSession() check.
async function processAbandonedCheckouts(supabase: any, results: any) {
  const minAge = new Date(Date.now() - ABANDONED_CHECKOUT_MIN_HOURS * 3600000).toISOString()
  const maxAge = new Date(Date.now() - ABANDONED_CHECKOUT_MAX_DAYS * 86400000).toISOString()

  const { data: attempts } = await supabase
    .from('checkout_session_attempts')
    .select('id, purpose, email, profile_id, created_at')
    .is('completed_at', null)
    .is('recovery_email_sent_at', null)
    .lte('created_at', minAge)
    .gte('created_at', maxAge)

  for (const attempt of attempts ?? []) {
    if (!attempt.email) continue
    try {
      let firstName = 'there'
      if (attempt.profile_id) {
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', attempt.profile_id).maybeSingle()
        if (profile?.full_name) firstName = profile.full_name.split(' ')[0]
      }

      let subject: string
      let html: string
      if (attempt.purpose === 'unlock-checkride-prep' || attempt.purpose === 'signup-and-unlock-checkride-prep') {
        subject = 'You started unlocking Checkride Prep'
        html = emailTemplateAbandonedCheckridePrep(firstName)
      } else if (attempt.purpose === 'ground-school-registration') {
        subject = 'You started registering for ground school'
        html = emailTemplateAbandonedGroundSchool(firstName)
      } else if (attempt.purpose === 'book-mock-oral') {
        subject = 'You started booking a Mock Oral'
        html = emailTemplateAbandonedMockOral(firstName)
      } else {
        continue
      }

      // Mark before sending, not after -- same reasoning as
      // processWeakArea's log-before-send: a crash between send and log
      // would otherwise re-send this exact nudge on every future run
      // forever, which is worse than the reverse (a rare skipped send on
      // a genuine one-off failure, same tradeoff already accepted
      // elsewhere in this file).
      const { error: markError } = await supabase
        .from('checkout_session_attempts')
        .update({ recovery_email_sent_at: new Date().toISOString() })
        .eq('id', attempt.id)
        .is('recovery_email_sent_at', null)
      if (markError) {
        results.errors.push(`abandoned_checkout_mark:${attempt.id}:${markError.message}`)
        continue
      }

      await sendEmail(supabase, attempt.email, subject, html)
      results.abandoned_checkout++
    } catch (err) {
      results.errors.push(`abandoned_checkout:${attempt.id}: ${err}`)
    }
  }
}

serve(async (req) => {
  if (CRON_SECRET) {
    const authHeader = req.headers.get('Authorization') || ''
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const results = { inactivity: 0, first_question: 0, readiness: 0, checkride_mode: 0, weak_area: 0, countdown: 0, checkride_upsell: 0, ground_followup: 0, abandoned_checkout: 0, errors: [] as string[] }

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
      } else {
        await processCheckrideUpsell(supabase, profile, results)
      }
    } catch (err) {
      results.errors.push(`${profile.id}: ${err}`)
    }
  }

  await processGroundSchoolFollowUps(supabase, results)
  await processAbandonedCheckouts(supabase, results)

  return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } })
})
