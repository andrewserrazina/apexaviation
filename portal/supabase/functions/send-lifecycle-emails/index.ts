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
// Checkride Prep upsell drip (days after signup, for members who
// haven't unlocked it yet -- the exact schedule and urgency depend on
// how close the member said their checkride is, see
// CHECKRIDE_TIMING_SCHEDULES below), and (Phase 6) a post-attendance
// ground school follow-up.
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
//   - checkride_upsell_day<N>: brand new, no client-side equivalent.
//     One-time per stage via portal_events (reusing
//     hasMilestoneFired/markMilestoneSent), keyed off days since
//     profile.created_at rather than study progress. Only sent to
//     members with checkride_prep_unlocked = false; stops entirely the
//     moment they unlock it. Only the latest reached-but-unsent stage
//     fires per run (see processCheckrideUpsell) so a profile that
//     predates this feature doesn't get every passed stage back-to-back
//     in one run. Which day numbers exist depends on the member's
//     checkride_timing bucket (CHECKRIDE_TIMING_SCHEDULES) -- members
//     closer to their checkride get a shorter, more urgent schedule;
//     the day-number dedup keys are deliberately reused across buckets
//     (not namespaced) rather than introducing new keys, so an existing
//     subscriber already mid-sequence under the old flat schedule is
//     never double-emailed. Pricing (get_checkride_prep_pricing) is
//     fetched fresh per-profile inside processCheckrideUpsell, not once
//     globally, since the launch tier depends on that profile's own
//     created_at.
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
// Same default as create-free-account/index.ts's own SITE_ORIGIN --
// needed here only for processActivationEmail1CatchUp's generateLink call.
const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://apexaviationtx.com'

const READINESS_THRESHOLDS = [25, 50, 75, 90]
const COUNTDOWN_DAYS = [30, 14, 7, 3, 1]
const WEAK_AREA_THROTTLE_DAYS = 14
const INACTIVITY_THROTTLE_DAYS = 30
const INACTIVITY_TRIGGER_DAYS = 7
// Retention Sprint Tier 3 reactivation tier -- distinct from the
// inactivity_7day nudge above. That existing email is login-based
// (portal_last_active_at) and already deployed/verified against real
// data; changing its trigger to a stricter activity-based signal risks
// regressing something already working, so it's left untouched and
// keeps serving as the "AT_RISK" tier in spirit (7+ days, general
// nudge). This new tier is a genuinely distinct, stronger signal for
// members whose real training has gone properly stale -- 14+ days
// since real work (not just a login), matching the sprint brief's
// ACTIVE/AT_RISK/INACTIVE definitions. The two aren't mutually
// exclusive/boundary-clean (a member inactive 45 days could still get
// both independently, on their own schedules) -- a real limitation,
// documented rather than papered over with a false "clean 3-tier"
// claim.
const REACTIVATION_INACTIVE_TRIGGER_DAYS = 14
const REACTIVATION_INACTIVE_THROTTLE_DAYS = 14
const WEEKLY_PROGRESS_THROTTLE_DAYS = 7
const STUDY_SECONDS_TARGET = 5 * 3600
// Checkride-timing-aware upsell cadence -- schedule (days since signup)
// gets more compressed the closer profiles.checkride_timing says the
// member's checkride actually is, per the product ask: increasing
// urgency for tighter timelines. within_60_days is the historical
// default (identical to the flat schedule this replaced) and is also
// the fallback for null/unrecognized checkride_timing, so any profile
// that predates this feature (or never set a timing) behaves exactly as
// it did before.
//
// Deliberately reuses day numbers 1/3/7/14 wherever a bucket's schedule
// happens to land on one, rather than namespacing milestone keys by
// bucket -- a member only ever has one checkride_timing value at a time
// (so only ever walks one schedule), and this way every profile that
// already received a "day7"/"day14" email under the old flat schedule
// keeps that exact same dedup state instead of getting a duplicate,
// differently-keyed touchpoint the day this shipped. Only day numbers
// that never existed before (2, 6, 12, 21, 30) are genuinely new keys.
const CHECKRIDE_TIMING_SCHEDULES: Record<string, number[]> = {
  within_14_days: [1, 3, 6],
  within_30_days: [1, 3, 7, 12],
  within_60_days: [1, 3, 7, 14],
  more_than_60_days: [1, 7, 21],
  not_scheduled: [1, 14, 30],
}
const DEFAULT_UPSELL_TIMING_BUCKET = 'within_60_days'
const ABANDONED_CHECKOUT_MIN_HOURS = 1
const ABANDONED_CHECKOUT_MAX_DAYS = 7

// New Member Activation sequence -- Emails #2/#3/#4 from the activation
// brief (Email #1 fires synchronously at signup, in create-free-account/
// index.ts, since training_stage/focus_area aren't known yet at that
// point -- see that file's own comment). Same day-schedule/catch-up/
// backfill shape as processCheckrideUpsell below: at most one stage per
// run, picking the latest reached-but-unsent day, backfilling earlier
// dedup keys so a profile that skipped a cron run doesn't get every
// earlier stage back-to-back. 1/3/7 = ~24h/~72h/~7 days, per the brief.
const NEW_MEMBER_ACTIVATION_SCHEDULE = [1, 3, 7]
// Unset by default -- this sequence enrolls NO profiles at all until an
// operator explicitly sets this Supabase Edge Function secret to an ISO
// timestamp (e.g. the deploy date). This is the deliberate guard against
// the brief's own explicit warning: "Do not backfill 104 historical
// users into a new-member sequence." A profile is only ever eligible if
// created_at >= this timestamp.
const NEW_MEMBER_ACTIVATION_SINCE = Deno.env.get('NEW_MEMBER_ACTIVATION_SINCE')
// Optional, additive window (days) to also catch very recent signups
// from just before that cutover -- e.g. profiles created in the day or
// two before this feature was actually deployed. Configurable per the
// brief's own suggestion (section 22); defaults to 0 (no backfill at
// all beyond the exact cutover instant).
const NEW_MEMBER_ACTIVATION_BACKFILL_DAYS = Number(Deno.env.get('NEW_MEMBER_ACTIVATION_BACKFILL_DAYS') ?? '0')

// profiles.training_stage values, set by showWelcomeOnboarding() (site/
// portal-stable.js) on the member's first portal login -- supabase-
// portal-schema-v70.sql. Maps each stage to the single free action this
// brief calls the best first step for that stage (section 3), as a
// portal.html hash + button label. Every stage still routes to a real,
// audited section -- no fabricated route (dpe-library doesn't have a
// per-stage view, so "the free oral-exam question" is deliberately
// 'dashboard', where QOTD already lives front-and-center, for every
// stage except just_starting).
const TRAINING_STAGE_ACTION: Record<string, { hash: string; label: string; contextPhrase: string }> = {
  just_starting: { hash: 'ground-school', label: 'View Live Ground School', contextPhrase: "just getting started" },
  pre_solo: { hash: 'dashboard', label: "Answer Today's DPE Question", contextPhrase: "in pre-solo training" },
  cross_country: { hash: 'dashboard', label: "Answer Today's DPE Question", contextPhrase: "working on cross-country" },
  preparing_for_written: { hash: 'dashboard', label: "Answer Today's DPE Question", contextPhrase: "preparing for your written exam" },
  written_passed: { hash: 'dashboard', label: "Answer Today's DPE Question", contextPhrase: "past your written and moving toward your checkride" },
  checkride_preparation: { hash: 'dashboard', label: "Answer Today's DPE Question", contextPhrase: "getting into checkride prep" },
}
// Fallback for a still-missing training_stage (member set up their
// account but hasn't reached showWelcomeOnboarding() yet) -- same
// generic recommendation Email #1 uses, per the brief's section 26.
const DEFAULT_ACTIVATION_ACTION = { hash: 'dashboard', label: "Answer Today's DPE Question", contextPhrase: '' }

// profiles.primary_focus_area values, same source as training_stage
// above. 'not_sure' is deliberately absent -- treated exactly like a
// missing value (no focus sentence), not a real topic.
const FOCUS_AREA_LABEL: Record<string, string> = {
  airspace: 'Airspace', weather: 'Weather', aircraft_systems: 'Aircraft Systems', regulations: 'Regulations',
  performance: 'Performance', weight_balance: 'Weight & Balance', navigation: 'Navigation', adm: 'Aeronautical Decision-Making',
}

function activationCtaUrl(hash: string, emailNumber: number): string {
  return `${PORTAL_LOGIN_URL}?dest=${hash}&utm_source=email&utm_medium=email&utm_campaign=new_member_activation&utm_content=welcome_${emailNumber}`
}

// Shared cutover check -- was duplicated inline in processNewMemberActivation
// and processCheckrideUpsell's defer guard; extracted once both needed the
// exact same math, so it can't drift between the two.
function isEligibleForActivationSequence(profile: any): boolean {
  if (!NEW_MEMBER_ACTIVATION_SINCE) return false
  const cutover = new Date(NEW_MEMBER_ACTIVATION_SINCE).getTime() - NEW_MEMBER_ACTIVATION_BACKFILL_DAYS * 86400000
  return new Date(profile.created_at).getTime() >= cutover
}

// Same table as CHECKRIDE_TIMING_CLAUSE in create-free-account/index.ts --
// duplicated rather than imported (no shared module between these two
// functions today, same reasoning as WEAK_AREA_CONTENT above). Used only
// by processActivationEmail1CatchUp, which re-sends Email #1's own copy
// when the synchronous attempt at signup never got a confirmed success.
const CHECKRIDE_TIMING_CLAUSE: Record<string, string> = {
  within_14_days: " and that your checkride's coming up fast",
  within_30_days: " and that your checkride's coming up soon",
  within_60_days: " and that you're working toward your checkride",
  more_than_60_days: " and that you've got some runway before your checkride",
}

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

// Same "meaningful activity" definition as get_retention_kpis()
// (supabase-portal-schema-v69.sql) -- answering/completing a DPE
// question, completing a scenario, a practice-set attempt, or an AI DPE
// session -- deliberately not portal_last_active_at (mere login/visit).
async function daysSinceLastMeaningfulActivity(supabase: any, profileId: string): Promise<number> {
  const [q, s, p, a] = await Promise.all([
    supabase.from('portal_question_progress').select('updated_at').eq('profile_id', profileId).or('answered_count.gt.0,completed.eq.true').order('updated_at', { ascending: false }).limit(1),
    supabase.from('portal_scenario_progress').select('updated_at').eq('profile_id', profileId).eq('completed', true).order('updated_at', { ascending: false }).limit(1),
    supabase.from('portal_practice_attempts').select('started_at').eq('profile_id', profileId).order('started_at', { ascending: false }).limit(1),
    supabase.from('ai_dpe_sessions').select('started_at').eq('profile_id', profileId).order('started_at', { ascending: false }).limit(1),
  ])
  const timestamps = [q.data?.[0]?.updated_at, s.data?.[0]?.updated_at, p.data?.[0]?.started_at, a.data?.[0]?.started_at]
    .filter(Boolean).map((t: string) => new Date(t).getTime())
  if (!timestamps.length) return Infinity
  return (Date.now() - Math.max(...timestamps)) / 86400000
}

function emailTemplateReactivationInactive(firstName: string) {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Pick up where you left off, ${firstName}.</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Start with one DPE question — it only takes a minute, and today\'s question is free for every member.</p>' +
    '<a href="https://advantage.apexaviationtx.com/portal.html" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Answer Today\'s Question →</a>'
}

async function processReactivationInactive(supabase: any, profile: any, results: any) {
  const daysInactive = await daysSinceLastMeaningfulActivity(supabase, profile.id)
  if (daysInactive < REACTIVATION_INACTIVE_TRIGGER_DAYS) return
  if ((await daysSinceLastEmail(supabase, profile.id, 'reactivation_inactive')) < REACTIVATION_INACTIVE_THROTTLE_DAYS) return

  await sendEmail(supabase, profile.email, 'Pick up where you left off', emailTemplateReactivationInactive((profile.full_name || 'there').split(' ')[0]))
  await supabase.from('portal_email_log').insert({ profile_id: profile.id, email_type: 'reactivation_inactive' })
  results.reactivation_inactive++
}

// Weekly progress summary -- Retention Sprint Tier 3. Positive
// reinforcement for members who actually trained this week (the
// reactivation emails above/below cover the opposite case), so this
// only sends when there's real activity to report -- no "you did
// nothing this week" email exists or should exist.
function emailTemplateWeeklyProgress(stats: {
  questions: number; days: number; scenarios: number; aiDpe: number;
  strongest: string | null; weakest: string | null;
}) {
  const topicLine = stats.strongest
    ? `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Strongest: <strong style="color:#fff">${stats.strongest}</strong>` +
      (stats.weakest && stats.weakest !== stats.strongest ? ` &nbsp;·&nbsp; Focus next: <strong style="color:#fff">${stats.weakest}</strong>` : '') + '</p>'
    : ''
  return '<h2 style="color:#F4B400;margin:0 0 4px;">Your Apex Weekly Training Report</h2>' +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">${stats.questions} question${stats.questions === 1 ? '' : 's'} answered · ${stats.days} training day${stats.days === 1 ? '' : 's'} · ${stats.scenarios} scenario${stats.scenarios === 1 ? '' : 's'} · ${stats.aiDpe} AI DPE session${stats.aiDpe === 1 ? '' : 's'}</p>` +
    topicLine +
    '<a href="https://advantage.apexaviationtx.com/portal.html" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Continue Training →</a>'
}

async function processWeeklyProgress(supabase: any, profile: any, allQuestions: Question[], categoryIds: string[], results: any) {
  if ((await daysSinceLastEmail(supabase, profile.id, 'weekly_progress')) < WEEKLY_PROGRESS_THROTTLE_DAYS) return

  const weekAgoIso = new Date(Date.now() - 6 * 86400000).toISOString()
  const [qRes, sRes, pRes, aRes] = await Promise.all([
    supabase.from('portal_question_progress').select('updated_at').eq('profile_id', profile.id).or('answered_count.gt.0,completed.eq.true').gte('updated_at', weekAgoIso),
    supabase.from('portal_scenario_progress').select('updated_at').eq('profile_id', profile.id).eq('completed', true).gte('updated_at', weekAgoIso),
    supabase.from('portal_practice_attempts').select('started_at').eq('profile_id', profile.id).gte('started_at', weekAgoIso),
    supabase.from('ai_dpe_sessions').select('started_at').eq('profile_id', profile.id).gte('started_at', weekAgoIso),
  ])
  const [studyRes] = await Promise.all([
    supabase.from('portal_study_activity').select('activity_date,seconds').eq('profile_id', profile.id).gte('activity_date', weekAgoIso.slice(0, 10)),
  ])

  const questions = (qRes.data ?? []).length
  const scenarios = (sRes.data ?? []).length
  const aiDpe = (aRes.data ?? []).length
  const days = new Set((studyRes.data ?? []).filter((r: any) => (r.seconds || 0) > 0).map((r: any) => r.activity_date)).size

  if (questions === 0 && scenarios === 0 && aiDpe === 0 && days === 0) return

  let strongest: string | null = null
  let weakest: string | null = null
  if (profile.checkride_prep_unlocked) {
    const sorted = await categoryCompletion(supabase, profile.id, allQuestions, categoryIds)
    if (sorted.length) {
      weakest = CATEGORY_LABELS[sorted[0].cat] || sorted[0].cat
      strongest = CATEGORY_LABELS[sorted[sorted.length - 1].cat] || sorted[sorted.length - 1].cat
    }
  }

  await sendEmail(supabase, profile.email, 'Your Apex Weekly Training Report', emailTemplateWeeklyProgress({ questions, days, scenarios, aiDpe, strongest, weakest }))
  await supabase.from('portal_email_log').insert({ profile_id: profile.id, email_type: 'weekly_progress' })
  results.weekly_progress++
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

// Recovery Sortie offer -- run_streak_maintenance() (see
// supabase-portal-schema-v48.sql) offers one of these the moment a
// member's streak breaks and they have no banked freeze left. The
// sortie is otherwise invisible DB state until they happen to open the
// portal that same day -- this is the only notification path that
// tells them it exists before it expires at midnight, member-local.
function emailTemplateRecoverySortie(firstName: string) {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">${firstName}, your streak is on the line tonight</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You missed a day and you\'re out of banked freezes — but your streak isn\'t broken yet. Answer 3 questions before midnight tonight and it carries forward like nothing happened.</p>' +
    '<a href="https://advantage.apexaviationtx.com/portal.html#dpe-library" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Save My Streak →</a>'
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
// One sentence of extra framing based on how close profiles.checkride_
// timing says the member's actual checkride is -- layered on top of the
// day-specific base message below, independent of it. within_60_days is
// the historical default and gets no extra line (today's tone,
// unchanged); the other buckets add a line that either raises urgency
// (tight timelines) or explicitly removes it (no date set yet, more
// than 60 days out) rather than guessing.
const CHECKRIDE_TIMING_URGENCY: Record<string, string> = {
  within_14_days: 'Your checkride is coming up fast — this is exactly the window where the full system pays off most.',
  within_30_days: "With your checkride about a month out, now's a great time to lock in the full system.",
  within_60_days: '',
  more_than_60_days: 'Plenty of runway before your checkride — starting now means walking in over-prepared, not cramming later.',
  not_scheduled: "Haven't scheduled your checkride yet? No problem — plenty of students start the full system early to build confidence before picking a date.",
}

function checkrideUpsellSubject(day: number, pricing: PricingPreview): string {
  const price = '$' + Math.round(pricing.amount_cents / 100)
  if (day === 1) return "Here's what's waiting in your Checkride Prep System"
  if (day === 3) return 'A question DPEs love to ask'
  if (day === 6) return 'Checkride oral prep, minus the guesswork'
  if (day === 7) return pricing.tier === 'founding' ? `${pricing.founding_seats_remaining} founding spots left at ${price}` : 'Still thinking about the Checkride Prep System?'
  if (day === 12) return 'What actually happens in the oral'
  if (day === 14) return 'Last look: the Checkride Prep System'
  if (day === 21) return 'Start before you have to cram'
  return 'One more look before we stop emailing about this' // day 30
}

// If the member is still inside their founding/launch discount window
// when this fires, day1 pushes real urgency (exact price, exact hours
// left) instead of a generic "here's what's waiting" pitch -- day1 is
// the most likely email to still land inside the 48-hour launch window,
// so it's worth being specific here even though later days mostly can't
// be anymore.
function emailTemplateCheckrideUpsell(day: number, pricing: PricingPreview, timingBucket: string): string {
  const price = '$' + Math.round(pricing.amount_cents / 100)
  const urgencyLine = CHECKRIDE_TIMING_URGENCY[timingBucket] || ''
  const urgencyParagraph = urgencyLine ? `<p style="color:rgba(255,255,255,0.55);font-size:14px;line-height:1.7;font-style:italic;">${urgencyLine}</p>` : ''
  const cta = (label: string) => `<a href="https://advantage.apexaviationtx.com/portal.html#checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">${label}</a>`

  if (day === 1) {
    const intro = '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Your free portal account already includes the "10 Questions DPEs Love to Ask" guide. The full Checkride Prep System adds a 300+ question DPE-style bank covering every ACS area of operation — each with a model answer, the common mistakes examiners watch for, and real-world context — plus scenario training and progress tracking.</p>'
    if (pricing.tier === 'founding' || pricing.tier === 'launch') {
      const tierUrgency = pricing.tier === 'founding'
        ? `${pricing.founding_seats_remaining} founding spot${pricing.founding_seats_remaining === 1 ? '' : 's'} left at ${price}, then $49`
        : `${price} new-member pricing is still active on your account for a limited time, then $49`
      return `<h2 style="color:#F4B400;margin:0 0 4px;">${tierUrgency}</h2>` + intro + urgencyParagraph + cta(`Unlock for ${price} →`)
    }
    return '<h2 style="color:#F4B400;margin:0 0 4px;">Here\'s what\'s waiting for you</h2>' + intro + urgencyParagraph + cta('See What\'s Inside →')
  }

  if (day === 3) {
    return '<h2 style="color:#F4B400;margin:0 0 4px;">A question DPEs love to ask</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">"You want to split the cost of a cross-country flight with a friend who isn\'t a pilot. Is that legal for a private pilot to do?"</p>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Most applicants know the pro rata rule exists — fewer can explain it precisely enough to satisfy a DPE\'s follow-up questions. That\'s exactly the gap the full Checkride Prep System closes: 300+ questions like this one, each with a model answer and the specific mistake examiners watch for.</p>' +
      urgencyParagraph + cta('Unlock the Full System →')
  }

  if (day === 6) {
    return '<h2 style="color:#F4B400;margin:0 0 4px;">Checkride oral prep, minus the guesswork</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Most applicants prep by re-reading the same materials until it feels familiar — but a DPE isn\'t testing familiarity, they\'re testing whether you can explain it under pressure. The full Checkride Prep System is built around that gap: 300+ DPE-style questions, model answers, and the exact mistakes examiners watch for.</p>' +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  if (day === 7) {
    let heading: string
    let body: string
    if (pricing.tier === 'founding') {
      heading = `${pricing.founding_seats_remaining} founding spot${pricing.founding_seats_remaining === 1 ? '' : 's'} left at ${price}`
      body = `Founding pricing (${price}, versus $49 after the first 25 members) won't last much longer. The full system is 300+ DPE-style questions, model answers, scenario training, and progress tracking — built to make oral exam day feel like a conversation, not an interrogation.`
    } else if (pricing.tier === 'launch') {
      heading = `Your ${price} new-member price is still active`
      body = `You're still inside your new-member pricing window — ${price} instead of the usual $49. The full system is 300+ DPE-style questions, model answers, scenario training, and progress tracking — built to make oral exam day feel like a conversation, not an interrogation.`
    } else {
      heading = 'Still thinking about the Checkride Prep System?'
      body = `300+ DPE-style questions, model answers, scenario training, and progress tracking — built to make oral exam day feel like a conversation, not an interrogation. Unlock it whenever you're ready.`
    }
    return `<h2 style="color:#F4B400;margin:0 0 4px;">${heading}</h2>` +
      `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">${body}</p>` +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  if (day === 12) {
    return '<h2 style="color:#F4B400;margin:0 0 4px;">What actually happens in the oral</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">A DPE rarely asks a question exactly the way a textbook phrases it — they adapt it to a scenario and follow up on whatever you say. The full Checkride Prep System trains for that directly: real DPE-style questions, model answers, and the follow-ups examiners actually ask.</p>' +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  if (day === 14) {
    return '<h2 style="color:#F4B400;margin:0 0 4px;">Last look: the Checkride Prep System</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">No pressure — the free guide is yours either way. But if your checkride is getting closer, the full 300+ question Checkride Prep System (DPE insight, scenario training, progress tracking) is one click away whenever you want it.</p>' +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  if (day === 21) {
    return '<h2 style="color:#F4B400;margin:0 0 4px;">Start before you have to cram</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">The students who feel calmest on checkride day usually started their oral prep well before it felt urgent. The full Checkride Prep System is there whenever you\'re ready — 300+ questions, model answers, and scenario training, at your own pace.</p>' +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  // day === 30 -- longest-running touchpoint, reached only by the
  // not_scheduled bucket.
  return '<h2 style="color:#F4B400;margin:0 0 4px;">One more look before we stop emailing about this</h2>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">No pressure — the free guide is yours either way. Whenever you do lock in a checkride date, the full Checkride Prep System (300+ DPE-style questions, model answers, scenario training, progress tracking) will be right where you left it.</p>' +
    urgencyParagraph + cta(`Unlock for ${price} →`)
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

// seven_day_active_user -- the funnel's retention signal: a profile that
// reached day 7+ and is still showing up, as opposed to processInactivity
// above which flags the opposite case (gone quiet). Fires once ever, via
// the same portal_events dedupe pattern as hasMilestoneFired/
// markMilestoneSent, but this isn't an email -- just an analytics_events
// row (see supabase-portal-schema-v39.sql) -- so it doesn't touch
// portal_email_log.
async function processSevenDayActive(supabase: any, profile: any, results: any) {
  const daysSinceCreated = (Date.now() - new Date(profile.created_at).getTime()) / 86400000
  if (daysSinceCreated < 7) return
  if (await hasMilestoneFired(supabase, profile.id, 'seven_day_active_user')) return

  const lastActive = profile.portal_last_active_at || profile.created_at
  const daysInactive = (Date.now() - new Date(lastActive).getTime()) / 86400000
  if (daysInactive > 3) return

  await supabase.from('portal_events').insert({ profile_id: profile.id, event_type: 'seven_day_active_user' })
  await supabase.from('analytics_events').insert({ event_name: 'seven_day_active_user', profile_id: profile.id, properties: {} })
  results.seven_day_active++
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

  // Sends at most one readiness milestone per run -- the highest
  // threshold the score has reached that hasn't already been sent --
  // same reasoning and shape as processCheckrideUpsell below: a score
  // that jumps from 0% to 95% between runs (a study weekend, or a
  // missed cron run) should get one congratulatory email, not all four
  // back-to-back in the same execution.
  const score = await computeReadinessScore(supabase, profile.id, questions, categoryIds)
  for (const threshold of [...READINESS_THRESHOLDS].reverse()) {
    if (score < threshold) continue
    const key = 'readiness_' + threshold
    if (await hasMilestoneFired(supabase, profile.id, key)) continue
    await sendEmail(supabase, profile.email, `${score}% Checkride Ready`, emailTemplateMilestone(threshold))
    await markMilestoneSent(supabase, profile.id, key)
    results.readiness++
    break
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

// Sends at most one countdown stage per run -- the nearest threshold
// the checkride is at or inside of that hasn't already been sent -- same
// catch-up reasoning as processCheckrideUpsell/processMilestones. The
// original exact daysUntil === threshold match had no tolerance for a
// missed cron run: if the job didn't run on the exact day a checkride
// was 7 days out, that email was gone for good, since daysUntil moves
// past 7 by the next run and never matches again.
async function processCountdown(supabase: any, profile: any, results: any) {
  const { data } = await supabase.from('portal_checkride_date').select('checkride_date').eq('profile_id', profile.id).maybeSingle()
  if (!data) return
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const checkride = new Date(data.checkride_date + 'T00:00:00Z')
  const daysUntil = Math.round((checkride.getTime() - today.getTime()) / 86400000)
  if (daysUntil < 0) return

  for (const threshold of COUNTDOWN_DAYS) {
    if (daysUntil > threshold) continue
    const emailType = 'checkride_countdown_' + threshold
    if (await hasMilestoneFired(supabase, profile.id, emailType)) continue

    await sendEmail(supabase, profile.email, `${threshold} days until your checkride`, emailTemplateCountdown(threshold))
    await markMilestoneSent(supabase, profile.id, emailType)
    results.countdown++
    return
  }
}

// Sends at most one upsell stage per run, picking the latest stage the
// member has reached that they haven't already received (checked
// highest-day-first, within whichever CHECKRIDE_TIMING_SCHEDULES bucket
// this profile's checkride_timing puts them in). This deliberately does
// NOT send every stage the member has passed in a single run: a profile
// old enough to have reached their bucket's last day, having never
// gotten one of these (e.g. signed up before this feature shipped), gets
// only that final email, not every earlier stage at once. Each stage is
// still a one-time send via hasMilestoneFired/markMilestoneSent -- once
// a bucket's last day fires, the sequence is exhausted and this is a
// no-op for that profile going forward, same terminal behavior as the
// other one-time milestone types above.
// Pricing is fetched per-profile (not once globally) because the
// launch tier depends on *this* profile's created_at -- two members at
// different signup ages can legitimately see different tiers/prices on
// the same run of this job.
async function processCheckrideUpsell(supabase: any, profile: any, results: any) {
  if (profile.checkride_prep_unlocked) return
  const daysSinceSignup = (Date.now() - new Date(profile.created_at).getTime()) / 86400000

  // Defer to the New Member Activation sequence (Emails #2-4, above)
  // while it's actively "in charge" of this member's inbox -- both
  // sequences are keyed off days-since-signup and would otherwise fire
  // on the same days (e.g. checkride_upsell's within_14_days schedule is
  // [1,3,6], activation's is [1,3,7]) for the exact profiles most likely
  // to be in both: a brand-new, not-yet-unlocked signup. That's a real
  // "two emails same day" collision, and directly against the brief's
  // own instruction not to aggressively pitch Checkride Prep in the
  // first-week activation window (section 14: SIGNUP -> EXPERIENCE VALUE
  // -> RETURN -> THEN UPGRADE). Deferred only through day 7 and only
  // while genuinely unactivated -- the instant this profile activates
  // (real value experienced) or ages past the activation window, this
  // resumes on its own normal schedule (including catching up on any
  // stage it missed, via its own existing backfill logic below). A no-op
  // when the activation sequence itself is disabled (NEW_MEMBER_
  // ACTIVATION_SINCE unset), so this never changes behavior for anyone
  // unless that feature is actually turned on.
  if (isEligibleForActivationSequence(profile) && daysSinceSignup < 7) {
    const stillUnactivated = (await daysSinceLastMeaningfulActivity(supabase, profile.id)) === Infinity
    if (stillUnactivated) return
  }

  // profiles.checkride_timing (collected at signup, supabase-portal-
  // schema-v39.sql) drives which schedule this profile walks -- a tight
  // timeline gets a compressed, more urgent cadence; a distant or unset
  // one gets a slower, lower-key cadence. Falls back to the historical
  // default schedule for null/unrecognized values (accounts that
  // predate this column, or any value that isn't one of the five real
  // options), so nothing changes for profiles this can't confidently
  // bucket.
  const timingBucket = profile.checkride_timing && CHECKRIDE_TIMING_SCHEDULES[profile.checkride_timing]
    ? profile.checkride_timing
    : DEFAULT_UPSELL_TIMING_BUCKET
  const schedule = CHECKRIDE_TIMING_SCHEDULES[timingBucket]

  for (const day of [...schedule].reverse()) {
    if (daysSinceSignup < day) continue
    const emailType = 'checkride_upsell_day' + day
    if (await hasMilestoneFired(supabase, profile.id, emailType)) continue

    // Never silently fall back to standard/$49 on an RPC error -- that's
    // exactly how this pricing bug went unnoticed in every upsell email
    // for as long as get_checkride_prep_pricing() had its ambiguous-
    // column bug (see supabase-portal-schema-v54.sql). Throwing here is
    // safe: the caller already wraps each profile in try/catch and moves
    // on to the next one, so this profile's email is just skipped and
    // retried next run instead of going out with the wrong price.
    const { data: pricingRows, error: pricingError } = await supabase.rpc('get_checkride_prep_pricing', { p_profile_id: profile.id })
    if (pricingError) throw new Error(`get_checkride_prep_pricing failed for profile ${profile.id}: ${pricingError.message}`)
    const pricing: PricingPreview = (pricingRows && pricingRows[0]) || { tier: 'standard', amount_cents: 4900, founding_seats_remaining: 0, launch_expires_at: null }

    await sendEmail(supabase, profile.email, checkrideUpsellSubject(day, pricing), emailTemplateCheckrideUpsell(day, pricing, timingBucket))
    await markMilestoneSent(supabase, profile.id, emailType)

    // Firing the highest reached stage must exhaust the whole sequence up
    // to that point, not just this one day -- otherwise a profile caught
    // up to day N walks backward through N-1, N-2, ... one extra real
    // send per future run, since each earlier day still reads as
    // "unfired" on its own. Back-fill portal_events only (never
    // portal_email_log -- these earlier stages were never actually sent).
    for (const earlierDay of schedule) {
      if (earlierDay >= day) continue
      const earlierType = 'checkride_upsell_day' + earlierDay
      if (!(await hasMilestoneFired(supabase, profile.id, earlierType))) {
        await supabase.from('portal_events').insert({ profile_id: profile.id, event_type: earlierType })
      }
    }

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

// ── Readiness Assessment lead follow-up (site/readiness-assessment.html) ──
// Matches the assessment's own 8 category ids (see QUESTIONS in that
// file) -- deliberately a separate map from CATEGORY_LABELS above, since
// the assessment's categories (e.g. 'aircraft-systems') don't line up
// 1:1 with the paid product's own weak-area category set.
const RA_CATEGORY_LABELS: Record<string, string> = {
  eligibility: 'Eligibility & Requirements', airworthiness: 'Airworthiness', weather: 'Weather',
  airspace: 'Airspace', performance: 'Performance', 'aircraft-systems': 'Aircraft Systems',
  aeromedical: 'Aeromedical & Human Factors', emergency: 'Emergency Operations',
}
const RA_TIMING_LABELS: Record<string, string> = {
  within_14_days: 'within 14 days', within_30_days: 'within 30 days', within_60_days: 'within 60 days',
  more_than_60_days: 'more than 60 days away', not_scheduled: 'not scheduled yet',
}

function raWeakCategories(categoryResults: Record<string, boolean> | null): string[] {
  return Object.entries(categoryResults || {}).filter(([, ok]) => !ok).map(([cat]) => RA_CATEGORY_LABELS[cat] ?? cat)
}

function emailTemplateAssessmentDay1(firstName: string, score: number, level: string, weakCats: string[]) {
  const weakLine = weakCats.length
    ? `Your weakest area${weakCats.length > 1 ? 's were' : ' was'} ${weakCats.join(', ')}.`
    : 'You answered every question correctly — nice work.'
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Your Readiness Assessment result: ${score}%</h2>` +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Hi ${firstName}, here's a recap of your free Checkride Readiness Assessment: <strong style="color:#fff;">${level}</strong>. ${weakLine}</p>` +
    `<a href="${PORTAL_LOGIN_URL}?view=signup&dest=checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Build My Complete Study Plan →</a>`
}

function emailTemplateAssessmentDay3(firstName: string, weakCats: string[]) {
  const focus = weakCats.length ? weakCats[0] : 'the areas you missed'
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Quick gut check, ${firstName}</h2>` +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">If you had to sit your oral exam tomorrow, could you confidently explain ${focus} to a DPE — not just recall the fact, but explain why it matters and apply it to a real scenario? That gap between "I know it" and "I can explain it under pressure" is exactly what the full Checkride Prep System closes.</p>` +
    `<a href="${PORTAL_LOGIN_URL}?view=signup&dest=checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">See What's Included →</a>`
}

function emailTemplateAssessmentDay6(firstName: string, timingLabel: string) {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Last look, ${firstName}</h2>` +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You told us your checkride is ${timingLabel}. Whenever that is, the difference between scattered studying and a real plan is what actually shows up in the oral exam room. The Checkride Prep System gives you 300+ ACS-mapped questions, DPE-style scenarios, and an AI mock oral — built to close exactly the gaps your assessment turned up.</p>` +
    `<a href="${PORTAL_LOGIN_URL}?view=signup&dest=checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Build My Complete Study Plan →</a>`
}

// One row per lead (not a log), so each of the three stages is checked
// and marked directly on readiness_assessment_leads (v42) -- same
// dedupe-on-the-row pattern as checkout_session_attempts. Stops the
// instant the lead's email belongs to any real profile (free or
// unlocked): at that point processCheckrideUpsell/processMilestones
// above already nurture them, and sending both would double-email the
// same person from two different sequences.
async function processReadinessAssessmentFollowup(supabase: any, results: any) {
  const { data: leads } = await supabase
    .from('readiness_assessment_leads')
    .select('id, email, full_name, checkride_timing, score, readiness_level, category_results, created_at, email_day1_sent_at, email_day3_sent_at, email_day6_sent_at')

  for (const lead of leads ?? []) {
    try {
      const { data: existingProfile } = await supabase.from('profiles').select('id').eq('email', lead.email).maybeSingle()
      if (existingProfile) continue

      const daysOld = (Date.now() - new Date(lead.created_at).getTime()) / 86400000
      const firstName = (lead.full_name || 'there').split(' ')[0]
      const weakCats = raWeakCategories(lead.category_results)

      if (daysOld >= 1 && !lead.email_day1_sent_at) {
        await sendEmail(supabase, lead.email, `Your Readiness Assessment result: ${lead.score}%`, emailTemplateAssessmentDay1(firstName, lead.score, lead.readiness_level, weakCats))
        await supabase.from('readiness_assessment_leads').update({ email_day1_sent_at: new Date().toISOString() }).eq('id', lead.id)
        results.readiness_assessment_followup++
      } else if (daysOld >= 3 && !lead.email_day3_sent_at) {
        await sendEmail(supabase, lead.email, 'Quick gut check before your checkride', emailTemplateAssessmentDay3(firstName, weakCats))
        await supabase.from('readiness_assessment_leads').update({ email_day3_sent_at: new Date().toISOString() }).eq('id', lead.id)
        results.readiness_assessment_followup++
      } else if (daysOld >= 6 && !lead.email_day6_sent_at) {
        await sendEmail(supabase, lead.email, 'Last look at your Checkride Prep options', emailTemplateAssessmentDay6(firstName, RA_TIMING_LABELS[lead.checkride_timing] ?? 'coming up'))
        await supabase.from('readiness_assessment_leads').update({ email_day6_sent_at: new Date().toISOString() }).eq('id', lead.id)
        results.readiness_assessment_followup++
      }
    } catch (err) {
      results.errors.push(`readiness_assessment_followup ${lead.id}: ${err}`)
    }
  }
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

      // checkout_abandoned funnel event -- logged here (not client-side)
      // since abandonment is only detectable server-side, once this same
      // "still uncompleted after a while" check above has already run.
      // See supabase-portal-schema-v39.sql for analytics_events.
      await supabase.from('analytics_events').insert({
        event_name: 'checkout_abandoned',
        profile_id: attempt.profile_id || null,
        properties: { purpose: attempt.purpose, checkout_step: 'abandoned' },
      })
    } catch (err) {
      results.errors.push(`abandoned_checkout:${attempt.id}: ${err}`)
    }
  }
}

// Recovery Sortie notification -- must run AFTER run_streak_maintenance()
// in serve() below, since that RPC is what creates the recovery_sorties
// rows this queries; a sortie offered by this same run is picked up
// immediately rather than waiting for the next cron tick. Dedup via
// portal_email_log keyed on the sortie's own id (not just profile_id),
// same pattern as ground_followup_<registration_id> above -- each sortie
// is a distinct, one-time, expiring offer, not a recurring milestone.
async function processRecoverySortieNotifications(supabase: any, results: any) {
  const { data: sorties } = await supabase
    .from('recovery_sorties')
    .select('id, profile_id, profile:profiles(email, full_name)')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())

  for (const sortie of sorties ?? []) {
    const email = sortie.profile?.email
    if (!email) continue
    const emailType = 'recovery_sortie_' + sortie.id
    try {
      const { data: already } = await supabase.from('portal_email_log').select('id').eq('email_type', emailType).limit(1)
      if (already && already.length) continue

      const firstName = (sortie.profile?.full_name || 'there').split(' ')[0]
      await sendEmail(supabase, email, 'Your streak is on the line tonight', emailTemplateRecoverySortie(firstName))
      await supabase.from('portal_email_log').insert({ profile_id: sortie.profile_id, email_type: emailType })
      results.recovery_sortie_notified++
    } catch (err) {
      results.errors.push(`recovery_sortie ${sortie.id}: ${err}`)
    }
  }
}

// ── New Member Activation, Emails #2-4 ──
// Email #1 (immediate, personal welcome note) lives in create-free-
// account/index.ts -- it fires synchronously at signup, before any of
// this ever runs. These three are the "still haven't done anything
// meaningful" follow-ups, gated entirely on daysSinceLastMeaningfulActivity
// (the exact same "meaningful activity" definition as get_retention_kpis(),
// supabase-portal-schema-v69.sql, and processReactivationInactive above --
// one definition, reused everywhere, not three slightly different ones).

// Email #2 (~24h) -- brief section 11's literal template: short, single
// QOTD nudge, no stage/focus personalization (training_stage may not
// even be set yet this early -- the member's first portal login, where
// showWelcomeOnboarding() asks, might not have happened yet either).
function emailTemplateActivationDay1(firstName: string): string {
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Quick one, ${firstName}</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Have you tried today\'s DPE question yet?</p>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">It takes about two minutes, and it\'s probably the easiest way to get value from Apex Advantage right away.</p>' +
    `<a href="${activationCtaUrl('dashboard', 2)}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Answer Today's Question →</a>` +
    '<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">That\'s it.</p>' +
    '<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">— Andrew</p>'
}

// Email #3 (~72h) -- stage/focus-aware, per brief section 12's examples.
// action comes from TRAINING_STAGE_ACTION (or DEFAULT_ACTIVATION_ACTION
// if training_stage still isn't set); focusLabel is only mentioned when
// primary_focus_area is set to a real topic (not null, not 'not_sure').
// upsellSentence: brief section 14's subtle-secondary-sentence carve-out
// (never the main CTA) -- passed in already-resolved from
// processNewMemberActivation, which is the one place that actually knows
// both training_stage and checkride_prep_unlocked together.
function emailTemplateActivationDay3(firstName: string, action: { hash: string; label: string; contextPhrase: string }, focusLabel: string | null, upsellSentence: string): string {
  const stageLine = action.contextPhrase
    ? `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You mentioned you're ${action.contextPhrase}.</p>`
    : ''
  const focusLine = focusLabel
    ? `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You also told us ${focusLabel} is one of the areas you want to work on — that's worth starting with.</p>`
    : ''
  const upsellLine = upsellSentence ? `<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">${upsellSentence}</p>` : ''
  return `<h2 style="color:#F4B400;margin:0 0 4px;">This might be useful for where you are in training</h2>` +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Hi ${firstName}, Andrew here again.</p>` +
    stageLine + focusLine +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">I'd start here:</p>` +
    `<a href="${activationCtaUrl(action.hash, 3)}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">${action.label} →</a>` +
    upsellLine
}

// Email #4 (~7d) -- re-engagement, not a hard sell, per brief section 13.
// Terminal email of the sequence -- NEW_MEMBER_ACTIVATION_SCHEDULE ends
// at day 7, so a profile that reaches this with no activity simply stops
// hearing from this sequence afterward (falls to the normal reactivation_
// inactive / checkride_upsell cadence like any other member from then on).
function emailTemplateActivationDay7(firstName: string, action: { hash: string; label: string; contextPhrase: string }, upsellSentence: string): string {
  const upsellLine = upsellSentence ? `<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">${upsellSentence}</p>` : ''
  return `<h2 style="color:#F4B400;margin:0 0 4px;">Hi ${firstName}</h2>` +
    '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You\'ve got an Apex Advantage account, but it looks like you haven\'t had a chance to use it yet.</p>' +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">If you want the easiest place to start, I'd do this:</p>` +
    `<a href="${activationCtaUrl(action.hash, 4)}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">${action.label} →</a>` +
    upsellLine +
    '<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">It\'ll take about 5 minutes.</p>' +
    '<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">— Andrew</p>'
}

// ── Email #1 catch-up ──
// create-free-account/index.ts attempts Email #1 synchronously at signup
// and marks portal_events('activation_email_1') only on a CONFIRMED
// successful send (see that file's own comment on why this diverges from
// the mark-before-send convention used elsewhere). If that attempt never
// got confirmed -- Resend was down, the request timed out, the container
// was torn down mid-background-send -- this is the safety net: same
// email, same content, a freshly generated magic link (auth.admin.
// generateLink tokens are single-purpose and time-limited, so the
// original link can't just be re-sent; a new one is the only option).
//
// Deliberately loses one piece of context the synchronous path had: a
// lead-magnet signup's specific ?dest= (e.g. checkride-prep.html's own
// signup link). That request-time value was never persisted anywhere,
// and adding a column/table just to carry it through this rare recovery
// path isn't justified -- documented here rather than silently dropped.
// Every catch-up send routes to the dashboard, same as an organic signup.
//
// GRACE_PERIOD_MINUTES exists purely to avoid racing the synchronous
// path's own EdgeRuntime.waitUntil()-backgrounded attempt, which should
// finish within seconds, not minutes -- this cron only runs once daily
// regardless, so the buffer costs nothing.
const EMAIL1_CATCHUP_GRACE_PERIOD_MINUTES = 10

// Returns true if this run just sent the catch-up -- processNewMemberActivation
// checks this and skips its own send for the same profile on the same run,
// so a very-delayed catch-up (Resend down for a couple of days, say) can't
// stack Email #1 and a backlogged #2/#3/#4 into the same run. Only defers
// by one run (~a day), not the whole sequence -- everything still resumes
// normally next time.
async function processActivationEmail1CatchUp(supabase: any, profile: any, results: any): Promise<boolean> {
  if (!isEligibleForActivationSequence(profile)) return false
  if (await hasMilestoneFired(supabase, profile.id, 'activation_email_1')) return false

  const minutesSinceSignup = (Date.now() - new Date(profile.created_at).getTime()) / 60000
  if (minutesSinceSignup < EMAIL1_CATCHUP_GRACE_PERIOD_MINUTES) return false

  // Same "already found their own way in" reasoning as processNewMemberActivation's
  // stop condition -- if they're already activated, they already have
  // working portal access, so a stale "set your password" catch-up would
  // be redundant at best.
  if ((await daysSinceLastMeaningfulActivity(supabase, profile.id)) < Infinity) return false

  const firstName = (profile.full_name || 'there').split(' ')[0]
  const timingClause = profile.checkride_timing ? (CHECKRIDE_TIMING_CLAUSE[profile.checkride_timing] || '') : ''
  const upsellClause = profile.checkride_timing === 'within_14_days'
    ? '<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">If your checkride is coming up, the full Checkride Prep System is there when you\'re ready.</p>'
    : ''

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: profile.email,
    options: { redirectTo: `${SITE_ORIGIN}/portal-reset-password.html?dest=dashboard&utm_source=email&utm_medium=email&utm_campaign=new_member_activation&utm_content=welcome_1` },
  })
  const actionLink = linkData?.properties?.action_link
  if (linkError || !actionLink) {
    results.errors.push(`activation_email_1_catchup:${profile.id}: ${linkError?.message || 'no action_link'}`)
    return false
  }

  const html = `<h2 style="color:#F4B400;margin:0 0 4px;">Andrew here.</h2>` +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">I saw you just joined Apex Advantage${timingClause}.</p>` +
    `<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">I'd start here: set your password, then answer today's oral exam question. It's free for every member and only takes a couple of minutes — the best way to start actually using the portal instead of just looking around.</p>` +
    `<a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Up My Account & Get Started →</a>` +
    upsellClause +
    '<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">If you get stuck on anything, reply to this email.</p>' +
    '<p style="color:rgba(255,255,255,0.4);font-size:13px;line-height:1.6;">Blue skies,<br>Andrew</p>'

  const emailResult = await supabase.functions.invoke('send-email', {
    body: { to: profile.email, subject: `A good place to start, ${firstName}`, html: template(html), replyTo: ACTIVATION_REPLY_TO },
  })
  if (emailResult.error) {
    results.errors.push(`activation_email_1_catchup:${profile.id}: ${emailResult.error?.message || emailResult.error}`)
    return false // stays eligible for the next run -- no milestone marked
  }

  await markMilestoneSent(supabase, profile.id, 'activation_email_1')
  await supabase.from('analytics_events').insert({
    event_name: 'activation_email_1_sent', profile_id: profile.id, properties: { checkride_timing: profile.checkride_timing || null, via: 'cron_catchup' },
  })
  results.activation_email_1_catchup++
  return true
}

async function processNewMemberActivation(supabase: any, profile: any, results: any) {
  if (!isEligibleForActivationSequence(profile)) return

  // STOP CONDITION: this is the entire "activated" gate for the whole
  // sequence, recomputed fresh every run (never a cached/client-reported
  // flag, per the brief's section 10) -- the moment a profile has ANY
  // meaningful activity, ever, every future run of this function is a
  // no-op for them. Deliberately does not distinguish "activated before
  // vs. after which email" here; that attribution (activation_source)
  // is reconstructed at read time by admin analytics from portal_email_log
  // + the meaningful-activity timestamp, not stored on the profile.
  const daysInactive = await daysSinceLastMeaningfulActivity(supabase, profile.id)
  if (daysInactive < Infinity) return

  const daysSinceSignup = (Date.now() - new Date(profile.created_at).getTime()) / 86400000
  const action = (profile.training_stage && TRAINING_STAGE_ACTION[profile.training_stage]) || DEFAULT_ACTIVATION_ACTION
  const focusLabel = profile.primary_focus_area ? FOCUS_AREA_LABEL[profile.primary_focus_area] || null : null
  const firstName = (profile.full_name || 'there').split(' ')[0]
  // Brief section 14's subtle-secondary-sentence carve-out -- here,
  // training_stage genuinely is known (unlike Email #1's own version of
  // this in create-free-account/index.ts), so this uses the real signal
  // instead of the checkride_timing proxy.
  const upsellSentence = profile.training_stage === 'checkride_preparation' && !profile.checkride_prep_unlocked
    ? "If your checkride is coming up, the full Checkride Prep System is there when you're ready."
    : ''

  for (const day of [...NEW_MEMBER_ACTIVATION_SCHEDULE].reverse()) {
    if (daysSinceSignup < day) continue
    const emailType = 'new_member_activation_day' + day
    if (await hasMilestoneFired(supabase, profile.id, emailType)) continue

    const emailNumber = NEW_MEMBER_ACTIVATION_SCHEDULE.indexOf(day) + 2 // day1=email#2, day3=email#3, day7=email#4
    let subject: string
    let html: string
    let replyTo: string | undefined
    if (day === 1) {
      subject = 'Quick question — have you tried this yet?'
      html = emailTemplateActivationDay1(firstName)
      replyTo = ACTIVATION_REPLY_TO
    } else if (day === 3) {
      subject = 'This might be useful for where you are in training'
      html = emailTemplateActivationDay3(firstName, action, focusLabel, upsellSentence)
    } else {
      subject = "Still there? Here's an easy place to start"
      html = emailTemplateActivationDay7(firstName, action, upsellSentence)
    }

    await supabase.functions.invoke('send-email', { body: { to: profile.email, subject, html: template(html), ...(replyTo ? { replyTo } : {}) } })
    await markMilestoneSent(supabase, profile.id, emailType)
    await supabase.from('analytics_events').insert({
      event_name: `activation_email_${emailNumber}_sent`, profile_id: profile.id,
      properties: { training_stage: profile.training_stage || null, primary_focus_area: profile.primary_focus_area || null },
    })

    // Same "exhaust the whole sequence up to this stage" backfill as
    // processCheckrideUpsell -- a profile that skipped a cron run and is
    // now past day 7 gets only the day-7 email, not day1+day3+day7 all in
    // the same run. Back-fills portal_events only, never portal_email_log
    // or an analytics_events _sent row, since those earlier stages were
    // never actually sent.
    for (const earlierDay of NEW_MEMBER_ACTIVATION_SCHEDULE) {
      if (earlierDay >= day) continue
      const earlierType = 'new_member_activation_day' + earlierDay
      if (!(await hasMilestoneFired(supabase, profile.id, earlierType))) {
        await supabase.from('portal_events').insert({ profile_id: profile.id, event_type: earlierType })
      }
    }

    results.new_member_activation++
    return
  }
}

// Real, monitored inbox -- same address create-free-account/index.ts
// uses for Email #1, and the same one members are already told to use
// elsewhere in the product (checkride-prep.html's refund-policy FAQ
// answer). Duplicated rather than imported -- these two functions have
// no shared module today, same reasoning as WEAK_AREA_CONTENT's own
// "keep these in sync" comment above.
const ACTIVATION_REPLY_TO = 'info@apexaviationtx.com'

serve(async (req) => {
  if (CRON_SECRET) {
    const authHeader = req.headers.get('Authorization') || ''
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const results = { inactivity: 0, first_question: 0, readiness: 0, checkride_mode: 0, weak_area: 0, countdown: 0, checkride_upsell: 0, ground_followup: 0, abandoned_checkout: 0, seven_day_active: 0, readiness_assessment_followup: 0, recovery_sortie_notified: 0, reactivation_inactive: 0, weekly_progress: 0, new_member_activation: 0, activation_email_1_catchup: 0, errors: [] as string[] }

  // exam_type hard-coded to 'private_pilot' — see get-premium-content
  // for why instrument content must never be reachable this way yet.
  const [{ data: categories }, { data: questions }, { data: profiles }] = await Promise.all([
    supabase.from('dpe_categories').select('id').eq('exam_type', 'private_pilot'),
    supabase.from('dpe_questions').select('id,category,is_scenario').eq('exam_type', 'private_pilot'),
    supabase.from('profiles').select('id,email,full_name,checkride_prep_unlocked,created_at,portal_last_active_at,checkride_timing,training_stage,primary_focus_area'),
  ])

  const categoryIds: string[] = (categories ?? []).map((c: any) => c.id)
  const allQuestions: Question[] = questions ?? []

  for (const profile of profiles ?? []) {
    if (!profile.email) continue
    try {
      await processInactivity(supabase, profile, results)
      await processSevenDayActive(supabase, profile, results)
      await processReactivationInactive(supabase, profile, results)
      await processWeeklyProgress(supabase, profile, allQuestions, categoryIds, results)
      // Runs regardless of checkride_prep_unlocked -- a member who paid
      // for instant access still needs to actually USE it (brief section
      // 32, Case 9: "Already premium user -> activation recommendation
      // still useful, no inappropriate purchase pitch"). The function's
      // own stop condition (daysSinceLastMeaningfulActivity) already
      // applies identically either way.
      const justCaughtUpEmail1 = await processActivationEmail1CatchUp(supabase, profile, results)
      if (!justCaughtUpEmail1) await processNewMemberActivation(supabase, profile, results)
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
  await processReadinessAssessmentFollowup(supabase, results)

  // Streak-protection maintenance (freeze earning/consumption, Recovery
  // Sortie offers) -- see run_streak_maintenance() in
  // supabase-portal-schema-v48.sql. A single RPC call rather than a
  // per-profile loop here, since the function already iterates every
  // profile with study history server-side.
  const { error: streakError } = await supabase.rpc('run_streak_maintenance')
  if (streakError) results.errors.push(`run_streak_maintenance: ${streakError.message}`)
  else await processRecoverySortieNotifications(supabase, results)

  // Mission progress (v50) -- recomputed from real activity every cron
  // run rather than incrementally, so a mission's progress is always
  // consistent even if a run is missed.
  const { error: missionError } = await supabase.rpc('refresh_mission_progress')
  if (missionError) results.errors.push(`refresh_mission_progress: ${missionError.message}`)

  return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } })
})
