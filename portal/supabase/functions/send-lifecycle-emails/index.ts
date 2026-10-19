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
//   LIFECYCLE_CRON_SECRET (required -- see RETENTION_SYSTEM.md; the
//   caller must send it in the `X-Lifecycle-Cron-Secret` header or the
//   request is rejected. Fail-closed as of the Stage 2 auth hardening
//   below: if this env var is itself unset, the function refuses to run
//   at all (500) rather than skipping the check, so a misconfigured
//   deploy can't become an open send-to-anyone endpoint.)
//   LIFECYCLE_TEST_MODE_ENABLED / LIFECYCLE_TEST_RECIPIENT_EMAIL
//   (Stage 3 single-recipient test mode, both optional and OFF by
//   default -- see the `X-Lifecycle-Test-Recipient` branch in serve()
//   below for the full design. Neither one alone can trigger a send:
//   the request still needs the real LIFECYCLE_CRON_SECRET too.)
//
// Auth contract (corrected, Stage 2 auth hardening, Oct 2026): this
// function is deployed with `verify_jwt = false` (see
// portal/supabase/config.toml's `[functions.send-lifecycle-emails]`
// entry and its own comment) -- that is the established, intended
// design, not a shortcut. This function has no signed-in caller to
// verify a session JWT for in the first place: pg_cron/pg_net calls it
// on a schedule with no Supabase session at all. Gateway-level JWT
// verification was explored in an earlier pass of this audit and ruled
// out, not adopted -- a prior revision of this comment incorrectly
// claimed the opposite (that `verify_jwt = true` plus sending the
// project's legacy anon key in `Authorization` was the fix) and that
// was wrong; it's corrected here. `Authorization` is not used for
// authentication by this function at all; the only credential that
// matters is `X-Lifecycle-Cron-Secret`, checked below against
// LIFECYCLE_CRON_SECRET. This function always builds its own
// service-role client below regardless of what, if anything, is sent
// in `Authorization`, so no caller identity there grants it any
// elevated access.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Inlined (not imported from ../_shared/emailTemplate.ts) because the
// Supabase deploy path used for this function (the MCP deploy_edge_
// function tool's single-file deploy, used to ship the v151 abandoned-
// checkout second-touch feature) cannot resolve a relative import that
// reaches outside this function's own directory -- same issue and same
// fix as stripe-webhook/create-checkout-session's own inlining. Must be
// kept byte-identical to _shared/emailTemplate.ts's exports (verified by
// portal/test/emailTemplates.test.js). See that file's own header
// comment for the design-system rationale.
function template(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#E5E7EB;font-family:Arial,Helvetica,sans-serif;color:#1F2937;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B1F3A;">
      <tr><td align="center" style="padding:28px 16px;">
        <img src="https://apexaviationtx.com/apexwhite.png" alt="Apex Advantage" width="160" style="display:block;margin:0 auto 10px;height:auto;max-width:160px;">
        <div style="font-size:14px;font-weight:700;letter-spacing:2px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">APEX ADVANTAGE</div>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:32px 24px 8px;">
        ${content}
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:20px 24px 28px;border-top:1px solid #E5E7EB;margin-top:12px;">
        <p style="font-size:12px;color:#4B5563;margin:16px 0 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;">Apex Aviation &middot; Austin, TX</p>
        <p style="font-size:11px;margin:0 0 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
          <a href="https://apexaviationtx.com" style="color:#4B5563;text-decoration:underline;">apexaviationtx.com</a>
        </p>
        <p style="font-size:11px;margin:0;text-align:center;font-family:Arial,Helvetica,sans-serif;">
          <a href="https://apexaviationtx.com/email-preferences.html" style="color:#4B5563;text-decoration:underline;">Manage email preferences</a>
        </p>
      </td></tr>
    </table>
  </div>
</body></html>`
}

// Escapes ilike's own wildcard characters so a case-insensitive *exact*
// match on a lead's stored email actually only matches that literal
// email -- same helper and reasoning as create-checkout-session/index.ts's
// own escapeIlike(), duplicated here since these functions share no
// module today.
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => '\\' + c)
}

function emailHeadline(text: string): string {
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">${text}</h2>`
}

function emailParagraph(text: string, opts?: { muted?: boolean }): string {
  const color = opts?.muted ? '#4B5563' : '#1F2937'
  const size = opts?.muted ? '13px' : '15px'
  return `<p style="color:${color};font-size:${size};line-height:1.7;margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;">${text}</p>`
}

function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;"><tr><td style="background:#F4B400;">` +
    `<a href="${href}" style="display:inline-block;padding:14px 28px;color:#0B1F3A;text-decoration:none;font-weight:bold;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${label}</a>` +
    `</td></tr></table>`
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('LIFECYCLE_CRON_SECRET')
// Same default as create-free-account/index.ts's own SITE_ORIGIN --
// needed here only for processActivationEmail1CatchUp's generateLink call.
const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://apexaviationtx.com'

// Single-recipient test mode (Stage 3 lifecycle-email recovery, Oct
// 2026) -- see the serve() branch below for the full design. Both of
// these are deliberately separate env vars from LIFECYCLE_CRON_SECRET:
// knowing the cron secret alone must not be enough to trigger a test
// send, and test mode must be off by default even if someone sets
// LIFECYCLE_TEST_RECIPIENT_EMAIL but forgets this flag (or vice versa).
// Exact-string 'true' (not just "truthy") so a stray empty string or
// typo can't accidentally enable it.
const LIFECYCLE_TEST_MODE_ENABLED = Deno.env.get('LIFECYCLE_TEST_MODE_ENABLED') === 'true'
const LIFECYCLE_TEST_RECIPIENT_EMAIL = Deno.env.get('LIFECYCLE_TEST_RECIPIENT_EMAIL')
// Replay guard: refuses a second test send within this window. See
// lifecycle_test_sends (supabase-portal-schema-v159) for why this is
// backed by its own dedicated, non-customer table rather than an
// in-memory counter (which a cold start would silently reset) or any
// real dedup/log table (which Task 2 forbids touching).
const LIFECYCLE_TEST_SEND_COOLDOWN_MS = 5 * 60 * 1000

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
// email-system audit, item 2: inactivity_7day (login-based, throttled
// 30 days) and reactivation_inactive (activity-based, throttled 14
// days) are two independent triggers on two different clocks that
// nonetheless overlap almost every time a member goes quiet for more
// than two weeks straight. Because "last meaningful activity" can never
// be more recent than "last login" (portal_last_active_at), a member
// who stops opening the portal entirely crosses the 7-day inactivity
// threshold before -- not after -- the 14-day reactivation threshold, so
// a fully-idle member previously got "We miss you at Apex Advantage" at
// day 7 and "Pick up where you left off" at day 14: two structurally
// different nudges seven days apart saying essentially the same thing,
// exactly the "bombard the same student" case this constant closes.
// Neither type may fire while the OTHER type was sent within this many
// days, on top of (never instead of) that type's own throttle above --
// whichever nudge reaches the student first "owns" that stretch of
// inactivity for this long before the other is allowed to also land.
const INACTIVITY_COORDINATION_GAP_DAYS = 10
// Bounded age window (operator-approved recovery safeguard, Oct 2026):
// the lifecycle-email dry-run inventory found 287 profiles currently
// eligible for reactivation_inactive and 230 for inactivity_7day -- but
// checking the real age distribution showed 280 of those 287
// reactivation_inactive candidates have had ZERO meaningful study
// activity for over 180 days (many since signup -- they never engaged
// at all), not a handful of days because of this ~3-week outage. A
// profile dormant for months was never "swept up" by the outage --
// re-sending a "pick up where you left off" nudge that far after the
// fact reads as random, not timely, and risks training members to
// ignore these emails going forward. 90 days is the line: long enough
// that anyone who went quiet because of (or shortly before) the outage
// is still covered -- checking inactivity_7day's own distribution,
// 90 days excludes only 20 of 230 candidates, almost all of whom are
// genuinely outage-adjacent -- short enough that a "come back" message
// still plausibly reads as timely rather than a non-sequitur. A profile
// past this ceiling is simply never nudged by either campaign again
// until it has new activity to measure from -- not a retry-later skip,
// since nothing about an already-dormant account changes on its own.
const ENGAGEMENT_NUDGE_STALE_CEILING_DAYS = 90
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
// Timing: existing, intentional values, not changed by the v152 repair --
// see ABANDONED_CHECKOUT_RECOVERY_REPAIR_REPORT.md's "Recovery Timing"
// section for the audit. Real-world caveat documented there too: this
// cron (see cron.job id 1) runs once daily at 13:00 UTC, not hourly, so
// the actual delay before an eligible row is first picked up is
// "whatever's left until the next 13:00 UTC," i.e. anywhere from just
// over ABANDONED_CHECKOUT_MIN_HOURS up to ~24 hours after abandonment --
// not a tight 1-3 hour window. That cron-cadence question is explicitly
// out of scope for this repair (the bug was never about lateness -- the
// Sep 27/28/30 rows were never sent at all); flagged here rather than
// silently changed.
const ABANDONED_CHECKOUT_MIN_HOURS = 1
const ABANDONED_CHECKOUT_MAX_DAYS = 7
// Second touch (Checkride-Prep-only): sent this many hours after the
// first recovery email, if checkout is still incomplete. No separate
// max-age cutoff needed beyond this -- it's gated on recovery_email_
// sent_at, which itself only ever gets set inside the first email's own
// 1-hour-to-7-day window, so a second touch is never sent more than
// ~9 days after the original attempt.
const ABANDONED_CHECKOUT_FOLLOWUP_HOURS = 48

// v152 repair: the two Checkride Prep purposes processAbandonedCheckouts/
// processAbandonedCheckoutsFollowup/emailTemplateAbandonedCheckridePrep*
// all need to recognize, named once instead of repeated as inline string
// literals in four different places (the original scattered-literal form
// is exactly how it would've been easy to add a new Checkride Prep
// purpose somewhere and forget one of the four call sites).
const CHECKRIDE_PREP_CHECKOUT_PURPOSES = ['unlock-checkride-prep', 'signup-and-unlock-checkride-prep']
// Every purpose processAbandonedCheckouts actually has template copy for
// today (Ground School and Mock Oral keep their existing single-email
// behavior -- only Checkride Prep gets suppression beyond opt-out, since
// it's the only one with a server-checkable entitlement flag to verify
// against; Ground School/Mock Oral's "did they already get in" would
// require a different check this repair doesn't attempt to add).
const ABANDONED_CHECKOUT_SUPPORTED_PURPOSES = [...CHECKRIDE_PREP_CHECKOUT_PURPOSES, 'ground-school-registration', 'book-mock-oral']

// v152 repair: every reason processAbandonedCheckouts/
// processAbandonedCheckoutsFollowup can write to the new
// recovery_suppressed_reason column (supabase-portal-schema-v152.sql) --
// kept in sync with that column's own comment.
const ABANDONED_CHECKOUT_SUPPRESSION_REASONS = {
  OPT_OUT: 'marketing_opt_out',
  ALREADY_ENTITLED: 'already_entitled',
  ALREADY_ENTITLED_AT_SEND_TIME: 'already_entitled_at_send_time',
  UNSUPPORTED_PURPOSE: 'unsupported_purpose',
  MISSING_EMAIL: 'missing_email',
} as const

// v152 repair: same UTM-tagging convention every other lifecycle email's
// CTA already uses (see lifecycleCtaUrl/activationCtaUrl above) -- the
// abandoned-checkout emails were the one exception, linking with a bare
// `?dest=checkride-prep` and no utm_* params at all, so a member who
// clicked through and later completed checkout could never be attributed
// back to the recovery email that brought them back (Section 6/9 of the
// repair brief). portal-login.html's existing dest=checkride-prep special
// case and portalDestUrl()'s utm forwarding (site/portal-stable.js) both
// already carry arbitrary utm_* params through to the dashboard's
// "Unlock Now" button, which already forwards window.apexGetUtm() into
// create-checkout-session -- this just needed to actually set them.
function abandonedCheckoutCtaUrl(recoveryStage: 'recovery_1' | 'recovery_2'): string {
  return `${PORTAL_LOGIN_URL}?dest=checkride-prep&utm_source=email&utm_medium=email&utm_campaign=abandoned_checkout&utm_content=${recoveryStage}`
}

// v152 repair: Section 2/5's "re-check authoritative entitlement/purchase
// state" requirement, for Checkride Prep specifically. profiles.
// checkride_prep_unlocked is the single authoritative flag -- stripe-
// webhook's handleUnlockCheckridePrep() sets it and inserts the
// portal_access_purchases row in the same handler, for every completed
// Checkride Prep purchase regardless of which checkout_session_attempts
// row (if any) initiated it, so there's no separate "purchased through a
// different session" state to check beyond this one flag.
async function hasCheckridePrepEntitlement(supabase: any, profileId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('checkride_prep_unlocked').eq('id', profileId).maybeSingle()
  return !!data?.checkride_prep_unlocked
}

// v152 repair: the actual eligibility/suppression decision, pulled out as
// a pure function (no I/O) so it can be exhaustively unit tested without
// a database -- see portal/test/abandonedCheckoutRecovery.test.js. Takes
// the attempt row and its already-fetched profile (null for a guest
// checkout with no profile_id) and returns exactly what the caller should
// do; the caller is the only thing that touches the database.
type AbandonedCheckoutAttempt = { id: string; purpose: string; email: string | null; profile_id: string | null }
type AbandonedCheckoutProfile = { email_marketing_opt_out?: boolean; checkride_prep_unlocked?: boolean } | null
type AbandonedCheckoutDecision = { action: 'send' | 'suppress' | 'skip'; reason?: string }

function decideAbandonedCheckoutAction(attempt: AbandonedCheckoutAttempt, profile: AbandonedCheckoutProfile): AbandonedCheckoutDecision {
  if (!attempt.email) return { action: 'suppress', reason: ABANDONED_CHECKOUT_SUPPRESSION_REASONS.MISSING_EMAIL }
  if (!ABANDONED_CHECKOUT_SUPPORTED_PURPOSES.includes(attempt.purpose)) {
    return { action: 'skip', reason: ABANDONED_CHECKOUT_SUPPRESSION_REASONS.UNSUPPORTED_PURPOSE }
  }
  if (profile?.email_marketing_opt_out) return { action: 'suppress', reason: ABANDONED_CHECKOUT_SUPPRESSION_REASONS.OPT_OUT }
  if (CHECKRIDE_PREP_CHECKOUT_PURPOSES.includes(attempt.purpose) && profile?.checkride_prep_unlocked) {
    return { action: 'suppress', reason: ABANDONED_CHECKOUT_SUPPRESSION_REASONS.ALREADY_ENTITLED }
  }
  return { action: 'send' }
}

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

// Same UTM convention as activationCtaUrl() above, for every lifecycle/
// retention email that links to the already-logged-in member portal
// directly (portal.html) rather than through the login redirect
// (portal-login.html?dest=). Query string comes before the hash so the
// member still lands on the right section (email-system audit, item
// "audit every link/CTA/UTM").
function lifecycleCtaUrl(campaign: string, content: string, hash: string = ''): string {
  return `https://apexaviationtx.com/portal.html?utm_source=email&utm_medium=email&utm_campaign=${campaign}&utm_content=${content}${hash}`
}

// Shared cutover check -- was duplicated inline in processNewMemberActivation
// and processCheckrideUpsell's defer guard; extracted once both needed the
// exact same math, so it can't drift between the two.
function isEligibleForActivationSequence(profile: any): boolean {
  if (!NEW_MEMBER_ACTIVATION_SINCE) return false
  const cutover = new Date(NEW_MEMBER_ACTIVATION_SINCE).getTime() - NEW_MEMBER_ACTIVATION_BACKFILL_DAYS * 86400000
  if (new Date(profile.created_at).getTime() < cutover) return false
  // Reuses ENGAGEMENT_NUDGE_STALE_CEILING_DAYS (recovery safeguard, Oct
  // 2026) -- same reasoning as processReactivationInactive/
  // processInactivity: a profile that signed up and never engaged for
  // 90+ days isn't a "welcome, here's a good place to start" candidate
  // anymore, regardless of which cron run first notices it. Checked
  // here (the one shared gate both processActivationEmail1CatchUp and
  // processNewMemberActivation call) rather than duplicated in both.
  const daysSinceSignup = (Date.now() - new Date(profile.created_at).getTime()) / 86400000
  return daysSinceSignup <= ENGAGEMENT_NUDGE_STALE_CEILING_DAYS
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

// Kept in sync manually with site/portal-stable.js's own WEAK_AREA_CONTENT
// (no shared module between this Edge Function and the client bundle) --
// update both whenever this copy changes, and vice versa.
//
// Email-system audit, item 3: this previously covered 9 of the private
// pilot bank's 13 real dpe_categories rows (verified against production:
// adm, aerodynamics, aeromedical, aircraft-systems, airport-operations,
// airspace, airworthiness, crosscountry, eligibility, emergency,
// performance, privileges, weather). Four had no entry at all -- a
// member whose single weakest category was one of those four simply
// never got a weak-area nudge, silently, forever (processWeakArea/
// checkWeakAreaEmail both no-op when WEAK_AREA_CONTENT[cat] is
// undefined). Added: adm, aerodynamics, aircraft-systems,
// airport-operations, using the real category ids above.
//
// Also, item 7: removed unsupported absolute claims about DPE behavior
// ("Always", "Every DPE", "the single most avoidable reason") that this
// system can't actually substantiate -- softened to defensible framing
// without losing the specific, useful detail underneath each one.
const WEAK_AREA_CONTENT: Record<string, { subject: string; body: string }> = {
  eligibility: { subject: "Don't Let Paperwork Delay Your Checkride", body: 'Missing documents or required endorsements can delay your checkride. A quick review of Eligibility &amp; Documents now can help you catch issues early.' },
  airworthiness: { subject: 'The ARROW Documents DPEs Check First', body: 'Examiners commonly ask you to physically produce ARROW documents in the aircraft — not just recite the acronym. A few minutes reviewing Airworthiness pays off fast.' },
  privileges: { subject: 'The Pro Rata Rule Worth a Second Look', body: "Precision matters in Privileges &amp; Limitations — examiners probe the edges of what a private pilot can and can't do. Worth another pass." },
  airspace: { subject: 'Class Bravo Scenarios That Trip Up Applicants', body: "Confusing Class B's clearance requirement with Class C/D's communication requirement is one of the most common real deviations — and a common oral exam trap." },
  weather: { subject: '5 Weather Questions Students Miss Most', body: 'METAR decoding, AIRMET vs. SIGMET, and icing conditions come up in most oral exams. A quick weather review goes a long way.' },
  performance: { subject: 'Why DPEs Ask About Aft CG', body: 'Weight and balance questions test more than arithmetic — examiners want to see you connect CG location to stall speed and control authority.' },
  aeromedical: { subject: 'The IMSAFE Check Worth Revisiting', body: 'Aeromedical Factors is one of the most personal, judgment-based sections of the exam. Worth revisiting before checkride day.' },
  crosscountry: { subject: "The Four C's That Save a Lost Pilot", body: "Cross-Country Planning ties together everything else in the guide — and it's often where the oral exam's scenario-based structure becomes most obvious." },
  emergency: { subject: "The 'Impossible Turn' Question DPEs Ask", body: 'Emergency Operations questions test whether calm, procedural thinking is already automatic for you. A quick review before checkride day is worth the time.' },
  adm: { subject: 'The ADM Framework Behind Every Go/No-Go Call', body: "Aeronautical Decision-Making questions probe how you'd actually apply a framework like PAVE or the 5 Hazardous Attitudes mid-flight, not just whether you can recite it. Worth reviewing before checkride day." },
  aerodynamics: { subject: 'The Aerodynamics Questions Behind the Maneuvers', body: 'Load factor in a turn, angle of attack vs. airspeed at the stall, adverse yaw — Aerodynamics questions test the theory behind maneuvers you already fly. A quick review connects the two.' },
  'aircraft-systems': { subject: "Know Your Aircraft's Systems Cold", body: "Aircraft Systems questions expect specifics about your training aircraft's electrical, fuel, and powerplant systems — not textbook generalities. Worth a targeted review." },
  'airport-operations': { subject: 'Traffic Pattern and Right-of-Way Questions', body: 'Airport Operations covers traffic pattern procedures, runway markings and lighting, and right-of-way at non-towered fields — the kind of practical knowledge DPEs probe with real scenarios.' },
}

const CATEGORY_LABELS: Record<string, string> = {
  eligibility: 'Eligibility & Documents', airworthiness: 'Airworthiness', privileges: 'Privileges & Limitations',
  airspace: 'Airspace', weather: 'Weather', performance: 'Performance', aeromedical: 'Aeromedical Factors',
  crosscountry: 'Cross-Country Planning', emergency: 'Emergency Operations',
  adm: 'Aeronautical Decision-Making', aerodynamics: 'Aerodynamics', 'aircraft-systems': 'Aircraft Systems',
  'airport-operations': 'Airport Operations',
}

// Global, cross-campaign circuit breaker (operator-approved recovery
// safeguard, Oct 2026). The lifecycle-email dry-run inventory showed
// hundreds of profiles simultaneously eligible across many different
// campaigns after the ~3-week auth outage -- each campaign already
// dedupes so no single PERSON gets the same email twice, but nothing
// previously limited how many DIFFERENT people get emailed in one run.
// GLOBAL_SEND_SUCCESS_CAP bounds the first recovery run(s) regardless of
// which campaigns are eligible. GLOBAL_SEND_FAILURE_CAP is a SEPARATE
// budget: if the email provider itself is down, every eligible profile
// across every campaign would otherwise generate one failed attempt
// each in the same run -- this stops a dead provider from being
// hammered for the length of a full run. Both live in sendEmail()
// itself (not any one campaign function) because an audit of every
// `functions.invoke('send-email', ...)` call site found it is the
// single place all of them funnel through -- two call sites
// (processActivationEmail1CatchUp, processNewMemberActivation) used to
// bypass it with their own inline invoke() call and have been unified
// onto it below specifically so this cap cannot be silently bypassed by
// a future third call site either.
//
// A profile skipped solely because either cap was hit remains eligible
// and is simply picked up on a later run -- nothing about ITS
// eligibility changes. Every campaign below has also been checked (and
// where missing, fixed) to treat a cap-skip exactly like any other send
// failure: never stamp a dedup column/claim as "sent" when sendEmail()
// returns an error, whatever the reason. See each campaign's own
// comments for campaigns where a claim/log commits BEFORE the send
// attempt (first_question_completed, readiness_*, checkride_mode,
// weak_area_*, abandoned-checkout recovery, mock-oral reminders) --
// those explicitly revert the claim on failure so a capped-out send
// still retries next run instead of being silently lost forever.
const GLOBAL_SEND_SUCCESS_CAP = 10
const GLOBAL_SEND_FAILURE_CAP = 10
// Stage 5 incident fix, Oct 2026 -- see claim_marketing_recipient_slot()
// (supabase-portal-schema-v160) for the atomic mechanism this backs.
const MARKETING_RECIPIENT_COOLDOWN_SECONDS = 24 * 3600

// Returns the invoke() result so callers that need to know whether the
// send actually succeeded (readiness-funnel instrumentation audit --
// processReadinessAssessmentFollowup below is the first one that checks
// it) can do so. Every other call site in this file now also checks it,
// since the global cap below needs every one of them to.
//
// `results` carries the run's shared send budget (results.__sendBudget)
// so the cap is genuinely global -- one counter for the whole
// invocation, never reset per campaign or per loop iteration, since every
// campaign function already receives the same `results` object the
// top-level serve() handler created once.
//
// `options.exemptFromGlobalCap` is for genuinely time-sensitive,
// inherently small-volume sends (currently only the mock-oral
// day-before reminder) where missing the message has a real-world cost
// a generic marketing/engagement nudge doesn't carry -- see that call
// site's own comment. Exempt sends neither consume nor are limited by
// the shared budget.
async function sendEmail(
  supabase: any,
  results: any,
  to: string,
  subject: string,
  contentHtml: string,
  options?: { replyTo?: string; exemptFromGlobalCap?: boolean; marketingRecipientCap?: boolean },
) {
  // Thrown exceptions (e.g. a network-level failure before any response
  // is received) are caught HERE and converted to the same { error }
  // shape a resolved failure already has. This matters beyond
  // consistency: without it, a thrown exception would propagate straight
  // out of sendEmail() and skip the `budget.failures++` below entirely --
  // GLOBAL_SEND_FAILURE_CAP would never trip against a provider that
  // fails by throwing instead of resolving with an error, defeating the
  // "bound unbounded attempts against a dead provider" purpose this cap
  // exists for. sendEmail() itself now never throws, for any options.
  const invoke = async () => {
    try {
      return await supabase.functions.invoke('send-email', {
        body: { to, subject, html: template(contentHtml), ...(options?.replyTo ? { replyTo: options.replyTo } : {}) },
      })
    } catch (err) {
      return { error: err }
    }
  }

  if (options?.exemptFromGlobalCap) return await invoke()

  const budget = results.__sendBudget ?? (results.__sendBudget = { successes: 0, failures: 0 })
  // Cap-reached responses return before touching `budget`, the
  // recipient cooldown, or the provider at all, so a skip never itself
  // counts as a failure/success and never reserves a recipient's
  // cooldown slot either -- only a real attempt (whatever its outcome)
  // does either of those. Checked BEFORE the recipient-cooldown claim
  // below on purpose (Stage 5 review fix): claiming a recipient's slot
  // when the global cap is already exhausted would reserve it for 24h
  // even though no email was ever attempted, incorrectly suppressing
  // that recipient on a later run for a send that never happened here.
  if (budget.successes >= GLOBAL_SEND_SUCCESS_CAP) {
    results.global_send_cap_skips = (results.global_send_cap_skips || 0) + 1
    return { error: { message: 'global send success cap reached this run (recovery safeguard, not a provider failure)', code: 'GLOBAL_SEND_CAP' } }
  }
  if (budget.failures >= GLOBAL_SEND_FAILURE_CAP) {
    results.global_send_failure_cap_skips = (results.global_send_failure_cap_skips || 0) + 1
    return { error: { message: 'global send failure cap reached this run -- provider may be down, halting further attempts', code: 'GLOBAL_SEND_FAILURE_CAP' } }
  }

  // Cross-campaign recipient suppression (Stage 5 incident fix, Oct
  // 2026): confirmed in production that one profile received three
  // separate marketing emails (inactivity, new-member activation,
  // checkride upsell) within about a second of each other -- each
  // campaign only dedups against ITSELF, so nothing stopped several
  // independently-eligible campaigns from all firing for the same
  // profile in the same run. claim_marketing_recipient_slot()
  // (supabase-portal-schema-v160) is a single atomic
  // `insert ... on conflict ... do update ... where` against a
  // per-recipient row -- same reservation-before-send principle as
  // Stage 3's lifecycle_test_reserve_send(), so concurrent invocations
  // (or multiple campaigns racing within one invocation) can't both
  // claim the same recipient's slot. Claimed here, immediately before
  // invoke() below -- after both global-cap checks above, so a capped
  // call never reserves a slot for a send it was never going to make.
  // Scoped by each call site passing this option -- exactly the
  // campaigns already gated by email_marketing_opt_out in serve(), the
  // same existing marketing/transactional split this file already
  // draws -- so transactional messages, relationship emails,
  // abandoned-checkout recovery, Readiness Assessment follow-up, and
  // the exempt mock-oral reminder are all unaffected.
  if (options?.marketingRecipientCap) {
    const { data: claimed, error: claimError } = await supabase.rpc('claim_marketing_recipient_slot', {
      p_email: to, p_cooldown_seconds: MARKETING_RECIPIENT_COOLDOWN_SECONDS,
    })
    if (claimError) {
      results.marketing_recipient_cap_check_failures = (results.marketing_recipient_cap_check_failures || 0) + 1
      return { error: { message: `marketing recipient cooldown check failed: ${claimError.message}`, code: 'MARKETING_RECIPIENT_CAP_CHECK_FAILED' } }
    }
    if (!claimed) {
      results.marketing_recipient_cap_skips = (results.marketing_recipient_cap_skips || 0) + 1
      return { error: { message: 'recipient already received a marketing email within the last 24 hours', code: 'MARKETING_RECIPIENT_CAP' } }
    }
  }

  const res = await invoke()
  if (res?.error) budget.failures++
  else budget.successes++
  return res
}

// Marks a one-time milestone as sent in BOTH portal_events (a passive
// historical log only -- see claimMilestoneEmail below for the actual
// dedup decision) and portal_email_log (the complete audit trail).
async function markMilestoneSent(supabase: any, profileId: string, type: string) {
  await supabase.from('portal_events').insert({ profile_id: profileId, event_type: type })
  await supabase.from('portal_email_log').insert({ profile_id: profileId, email_type: type })
}

async function hasMilestoneFired(supabase: any, profileId: string, type: string) {
  const { data } = await supabase.from('portal_events').select('id').eq('profile_id', profileId).eq('event_type', type).limit(1)
  return !!(data && data.length)
}

// Atomic claim for the one-time milestone emails also gated client-side
// via claimMilestoneEmailOnce() (portal-stable.js) -- both sides insert
// into the same portal_milestone_emails table (supabase-portal-schema-
// v87.sql), primary-keyed on (profile_id, milestone_key), so whichever
// one gets there first is the only one that ever sends. Replaces the old
// hasMilestoneFired-then-markMilestoneSent pattern for these specific
// milestones, which read-then-wrote non-atomically and could double-send
// if the client's own claim insert never landed (dropped connection, the
// tab/app backgrounded mid-request) by the time this job ran. This client
// uses the service-role connection, which already bypasses RLS, so no
// RPC wrapper is needed here the way portal-stable.js needs one.
async function claimMilestoneEmail(supabase: any, profileId: string, key: string): Promise<boolean> {
  const { error } = await supabase.from('portal_milestone_emails').insert({ profile_id: profileId, milestone_key: key })
  return !error
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
  return emailHeadline(`Pick up where you left off, ${firstName}.`) +
    emailParagraph('Start with one DPE question — it only takes a minute, and today\'s question is free for every member.') +
    emailButton("Answer Today's Question →", lifecycleCtaUrl('reactivation', 'reactivation_inactive'))
}

async function processReactivationInactive(supabase: any, profile: any, results: any) {
  const daysInactive = await daysSinceLastMeaningfulActivity(supabase, profile.id)
  if (daysInactive < REACTIVATION_INACTIVE_TRIGGER_DAYS) return
  if (daysInactive > ENGAGEMENT_NUDGE_STALE_CEILING_DAYS) return
  if ((await daysSinceLastEmail(supabase, profile.id, 'reactivation_inactive')) < REACTIVATION_INACTIVE_THROTTLE_DAYS) return
  // Don't also send this if the generic 7-day login nudge already
  // reached this student recently -- see INACTIVITY_COORDINATION_GAP_DAYS.
  if ((await daysSinceLastEmail(supabase, profile.id, 'inactivity_7day')) < INACTIVITY_COORDINATION_GAP_DAYS) return

  const res = await sendEmail(supabase, results, profile.email, 'Pick up where you left off', emailTemplateReactivationInactive((profile.full_name || 'there').split(' ')[0]), { marketingRecipientCap: true })
  if (res?.error) {
    results.errors.push(`reactivation_inactive:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
    return
  }
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
    ? `<p style="color:#1F2937;font-size:15px;line-height:1.7;">Strongest: <strong style="color:#0B1F3A">${stats.strongest}</strong>` +
      (stats.weakest && stats.weakest !== stats.strongest ? ` &nbsp;·&nbsp; Focus next: <strong style="color:#0B1F3A">${stats.weakest}</strong>` : '') + '</p>'
    : ''
  return '<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Your Apex Weekly Training Report</h2>' +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">${stats.questions} question${stats.questions === 1 ? '' : 's'} answered · ${stats.days} training day${stats.days === 1 ? '' : 's'} · ${stats.scenarios} scenario${stats.scenarios === 1 ? '' : 's'} · ${stats.aiDpe} AI DPE session${stats.aiDpe === 1 ? '' : 's'}</p>` +
    topicLine +
    `<a href="${lifecycleCtaUrl('weekly_progress', 'weekly_progress')}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Continue Training →</a>`
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

  const res = await sendEmail(supabase, results, profile.email, 'Your Apex Weekly Training Report', emailTemplateWeeklyProgress({ questions, days, scenarios, aiDpe, strongest, weakest }), { marketingRecipientCap: true })
  if (res?.error) {
    results.errors.push(`weekly_progress:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
    return
  }
  await supabase.from('portal_email_log').insert({ profile_id: profile.id, email_type: 'weekly_progress' })
  results.weekly_progress++
}

function emailTemplate1FirstQuestion() {
  return '<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">First question, done.</h2>' +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">That\'s one down — and every one after this gets a little more familiar. Keep the momentum going.</p>' +
    `<a href="${lifecycleCtaUrl('milestone', 'first_question', '#dpe-library')}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Keep Studying →</a>`
}

function emailTemplateMilestone(threshold: number) {
  const copy: Record<number, string> = {
    25: "You're a quarter of the way to checkride-ready. The hardest part — starting — is behind you.",
    50: "Halfway there. Your ACS coverage is filling in and it shows.",
    75: "Three-quarters of the way to checkride-ready. Time to start tightening up your weakest areas.",
    90: "You are checkride-ready in every way that matters. Book a mock oral and go show a DPE what you know.",
  }
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">${threshold}% Checkride Ready</h2>` +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">${copy[threshold]}</p>` +
    `<a href="${lifecycleCtaUrl('milestone', 'milestone_' + threshold)}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">View Your Dashboard →</a>`
}

function emailTemplateCheckrideModeDone() {
  return '<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Checkride Mode: complete</h2>' +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">You just simulated a real oral exam — 20 questions, no labels, no hints. That\'s exactly the kind of pressure practice that makes checkride day feel routine.</p>'
}

function emailTemplateInactivity(firstName: string) {
  return emailHeadline(`Still working toward your checkride, ${firstName}?`) +
    emailParagraph('It\'s been a week since your last visit to the portal. A few minutes of review keeps everything from going stale before checkride day.') +
    emailButton('Pick Up Where You Left Off →', lifecycleCtaUrl('inactivity', 'inactivity_7day'))
}

// Single source of truth for "day" vs "days" -- previously computed
// separately (and correctly) inside emailTemplateCountdown's own body,
// while the SUBJECT LINE at this email's one call site (processCountdown)
// hardcoded the plural unconditionally, so a checkride exactly 1 day out
// sent the subject "1 days until your checkride" with a correctly-
// pluralized "1 day until your checkride" heading directly underneath it
// in the body (email-system audit, item 1).
function daysNoun(n: number): string {
  return n === 1 ? 'day' : 'days'
}

function emailTemplateCountdown(daysUntil: number) {
  const noun = daysNoun(daysUntil)
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">${daysUntil} ${noun} until your checkride</h2>` +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">Use the Weak Areas widget to spend your remaining study time where it counts most, and make sure your logbook and endorsements are squared away.</p>' +
    `<a href="${lifecycleCtaUrl('checkride_countdown', 'countdown_' + daysUntil, '#progress')}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Review Your Progress →</a>`
}

// Recovery Sortie offer -- run_streak_maintenance() (see
// supabase-portal-schema-v48.sql) offers one of these the moment a
// member's streak breaks and they have no banked freeze left. The
// sortie is otherwise invisible DB state until they happen to open the
// portal that same day -- this is the only notification path that
// tells them it exists before it expires at midnight, member-local.
function emailTemplateRecoverySortie(firstName: string) {
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">${firstName}, your streak is on the line tonight</h2>` +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">You missed a day and you\'re out of banked freezes — but your streak isn\'t broken yet. Answer 3 questions before midnight tonight and it carries forward like nothing happened.</p>' +
    `<a href="${lifecycleCtaUrl('streak_recovery', 'recovery_sortie', '#dpe-library')}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Save My Streak →</a>`
}

// This follow-up fires off ground_registrations/ground_sessions -- the
// drop-in live-class flow, where a session can be in-person (location),
// virtual over Google Meet (meet_link), or both, per session. That flow
// has no recording/replay field, so this deliberately does not promise
// a "replay link" the way the original Phase 6 ask's wording suggested.
// (A separate recording_url does exist, but only on scheduled_ground_
// classes for complete-course package members -- see stripe-webhook's
// own copy -- and doesn't apply to this registration/attendance path.)
// "Resources" here is a real, working link to browse upcoming sessions
// (repeat attendance); the portal CTA is generic rather than
// personalized to unlock status, since that would require an extra
// profiles lookup per registration for a soft nudge that reads fine
// either way.
function emailTemplateGroundSchoolFollowUp(sessionTitle: string) {
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Thanks for coming to ${sessionTitle}</h2>` +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">Hope it was a good session. Keep the momentum going with the Checkride Prep System in your member portal, or grab a spot at the next ground school session while it\'s fresh.</p>' +
    `<a href="${lifecycleCtaUrl('ground_school', 'session_followup_sessions', '#ground-school')}" style="display:inline-block;margin-top:8px;margin-right:10px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">See Upcoming Sessions →</a>` +
    `<a href="${lifecycleCtaUrl('ground_school', 'session_followup_portal')}" style="display:inline-block;margin-top:8px;border:1.5px solid #0B1F3A;color:#0B1F3A;border-radius:0;padding:11px 21px;text-decoration:none;font-weight:700;font-size:14px;">Go to My Portal →</a>`
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
  return "It'll be here whenever you're ready" // day 30
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
  const urgencyParagraph = urgencyLine ? `<p style="color:#4B5563;font-size:14px;line-height:1.7;font-style:italic;">${urgencyLine}</p>` : ''
  const cta = (label: string) => `<a href="${lifecycleCtaUrl('checkride_upsell', 'upsell_day' + day, '#checkride-prep')}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">${label}</a>`

  if (day === 1) {
    const intro = '<p style="color:#1F2937;font-size:15px;line-height:1.7;">Your free portal account already includes the "10 Questions DPEs Love to Ask" guide. The full Checkride Prep System adds a 300+ question DPE-style bank covering every ACS area of operation — each with a model answer, the common mistakes examiners watch for, and real-world context — plus scenario training, the Checkride Binder Builder, and progress tracking.</p>'
    if (pricing.tier === 'founding' || pricing.tier === 'launch') {
      const tierUrgency = pricing.tier === 'founding'
        ? `${pricing.founding_seats_remaining} founding spot${pricing.founding_seats_remaining === 1 ? '' : 's'} left at ${price}, then $49`
        : `${price} new-member pricing is still active on your account for a limited time, then $49`
      return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">${tierUrgency}</h2>` + intro + urgencyParagraph + cta(`Unlock for ${price} →`)
    }
    return '<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Here\'s what\'s waiting for you</h2>' + intro + urgencyParagraph + cta('See What\'s Inside →')
  }

  if (day === 3) {
    return '<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">A question DPEs love to ask</h2>' +
      '<p style="color:#1F2937;font-size:15px;line-height:1.7;">"You want to split the cost of a cross-country flight with a friend who isn\'t a pilot. Is that legal for a private pilot to do?"</p>' +
      '<p style="color:#1F2937;font-size:15px;line-height:1.7;">Most applicants know the pro rata rule exists — fewer can explain it precisely enough to satisfy a DPE\'s follow-up questions. That\'s exactly the gap the full Checkride Prep System closes: 300+ questions like this one, each with a model answer and the specific mistake examiners watch for.</p>' +
      urgencyParagraph + cta('Unlock the Full System →')
  }

  if (day === 6) {
    return '<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Checkride oral prep, minus the guesswork</h2>' +
      '<p style="color:#1F2937;font-size:15px;line-height:1.7;">Most applicants prep by re-reading the same materials until it feels familiar — but a DPE isn\'t testing familiarity, they\'re testing whether you can explain it under pressure. The full Checkride Prep System is built around that gap: 300+ DPE-style questions, model answers, and the exact mistakes examiners watch for.</p>' +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  if (day === 7) {
    let heading: string
    let body: string
    if (pricing.tier === 'founding') {
      heading = `${pricing.founding_seats_remaining} founding spot${pricing.founding_seats_remaining === 1 ? '' : 's'} left at ${price}`
      body = `Founding pricing (${price}, versus $49 after the first 25 members) won't last much longer. The full system is 300+ DPE-style questions, model answers, scenario training, the Checkride Binder Builder, and progress tracking — built to make oral exam day feel like a conversation, not an interrogation.`
    } else if (pricing.tier === 'launch') {
      heading = `Your ${price} new-member price is still active`
      body = `You're still inside your new-member pricing window — ${price} instead of the usual $49. The full system is 300+ DPE-style questions, model answers, scenario training, the Checkride Binder Builder, and progress tracking — built to make oral exam day feel like a conversation, not an interrogation.`
    } else {
      heading = 'Still thinking about the Checkride Prep System?'
      body = `300+ DPE-style questions, model answers, scenario training, the Checkride Binder Builder, and progress tracking — built to make oral exam day feel like a conversation, not an interrogation. Unlock it whenever you're ready.`
    }
    return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">${heading}</h2>` +
      `<p style="color:#1F2937;font-size:15px;line-height:1.7;">${body}</p>` +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  if (day === 12) {
    return '<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">What actually happens in the oral</h2>' +
      '<p style="color:#1F2937;font-size:15px;line-height:1.7;">A DPE rarely asks a question exactly the way a textbook phrases it — they adapt it to a scenario and follow up on whatever you say. The full Checkride Prep System trains for that directly: real DPE-style questions, model answers, and the follow-ups examiners actually ask.</p>' +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  if (day === 14) {
    return '<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Last look: the Checkride Prep System</h2>' +
      '<p style="color:#1F2937;font-size:15px;line-height:1.7;">No pressure — the free guide is yours either way. But if your checkride is getting closer, the full 300+ question Checkride Prep System (DPE insight, scenario training, the Checkride Binder Builder, progress tracking) is one click away whenever you want it.</p>' +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  if (day === 21) {
    return '<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Start before you have to cram</h2>' +
      '<p style="color:#1F2937;font-size:15px;line-height:1.7;">The students who feel calmest on checkride day usually started their oral prep well before it felt urgent. The full Checkride Prep System is there whenever you\'re ready — 300+ questions, model answers, scenario training, and the Checkride Binder Builder, at your own pace.</p>' +
      urgencyParagraph + cta(`Unlock for ${price} →`)
  }

  // day === 30 -- longest-running touchpoint, reached only by the
  // not_scheduled bucket.
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">It'll be here whenever you're ready</h2>` +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">The free guide is yours either way. Whenever you do lock in a checkride date, the full Checkride Prep System (300+ DPE-style questions, model answers, scenario training, the Checkride Binder Builder, progress tracking) will be right where you left it.</p>' +
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
  if (daysInactive > ENGAGEMENT_NUDGE_STALE_CEILING_DAYS) return
  if ((await daysSinceLastEmail(supabase, profile.id, 'inactivity_7day')) < INACTIVITY_THROTTLE_DAYS) return
  // Don't also send this if the stronger, activity-based reactivation
  // nudge already reached this student recently -- see
  // INACTIVITY_COORDINATION_GAP_DAYS.
  if ((await daysSinceLastEmail(supabase, profile.id, 'reactivation_inactive')) < INACTIVITY_COORDINATION_GAP_DAYS) return

  const res = await sendEmail(supabase, results, profile.email, "We miss you at Apex Advantage", emailTemplateInactivity((profile.full_name || 'there').split(' ')[0]), { marketingRecipientCap: true })
  if (res?.error) {
    results.errors.push(`inactivity_7day:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
    return
  }
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

// Email-system audit, item 5: the Daily DPE Question is deliberately
// free for every member (see computeQotdQuestion's own comment in
// site/portal-stable.js -- "Question of the Day is deliberately free
// for every member"), and answering it writes the exact same
// portal_question_progress row a paid member's practice does. This
// milestone must therefore be checked for every profile regardless of
// checkride_prep_unlocked -- it was previously folded into
// processMilestones below, which only ever runs for unlocked members,
// so a free member's first completed question silently never earned
// this celebration email at all. Split out on its own so it runs
// unconditionally; readiness-score and Checkride-Mode milestones stay
// gated to unlocked members below, since those two are both genuinely
// scoped to paid-only content (the full ACS-mapped question bank and
// Checkride Mode itself).
async function processFirstQuestionMilestone(supabase: any, profile: any, results: any) {
  const { data: qProgress } = await supabase.from('portal_question_progress').select('id').eq('profile_id', profile.id).eq('completed', true).limit(1)
  if (!qProgress || !qProgress.length) return
  if (!(await claimMilestoneEmail(supabase, profile.id, 'first_question_completed'))) return

  const res = await sendEmail(supabase, results, profile.email, 'You completed your first question', emailTemplate1FirstQuestion())
  if (res?.error) {
    // The claim above already committed (claimMilestoneEmail runs before
    // the send, by design). Undo it here so a capped/failed send doesn't
    // permanently consume this one-time milestone -- safe to delete
    // unconditionally, nothing else writes this row between the claim
    // and here.
    await supabase.from('portal_milestone_emails').delete().eq('profile_id', profile.id).eq('milestone_key', 'first_question_completed')
    results.errors.push(`first_question_completed:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
    return
  }
  await markMilestoneSent(supabase, profile.id, 'first_question_completed')
  results.first_question++
}

async function processMilestones(supabase: any, profile: any, questions: Question[], categoryIds: string[], results: any) {
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
    if (!(await claimMilestoneEmail(supabase, profile.id, key))) continue
    const res = await sendEmail(supabase, results, profile.email, `${score}% Checkride Ready`, emailTemplateMilestone(threshold))
    if (res?.error) {
      // Same claim-already-committed revert as processFirstQuestionMilestone.
      await supabase.from('portal_milestone_emails').delete().eq('profile_id', profile.id).eq('milestone_key', key)
      results.errors.push(`${key}:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
      break
    }
    await markMilestoneSent(supabase, profile.id, key)
    results.readiness++
    break
  }

  const { data: checkrideAttempts } = await supabase
    .from('portal_practice_attempts')
    .select('id').eq('profile_id', profile.id).eq('mode', 'checkride').not('completed_at', 'is', null).limit(1)
  if (checkrideAttempts && checkrideAttempts.length && (await claimMilestoneEmail(supabase, profile.id, 'checkride_mode_completed_email'))) {
    const res = await sendEmail(supabase, results, profile.email, 'Checkride Mode: complete', emailTemplateCheckrideModeDone())
    if (res?.error) {
      // Same claim-already-committed revert as processFirstQuestionMilestone.
      await supabase.from('portal_milestone_emails').delete().eq('profile_id', profile.id).eq('milestone_key', 'checkride_mode_completed_email')
      results.errors.push(`checkride_mode_completed_email:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
    } else {
      await markMilestoneSent(supabase, profile.id, 'checkride_mode_completed_email')
      results.checkride_mode++
    }
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

  const html = `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">${content.subject}</h2>` +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">${content.body}</p>` +
    `<a href="${lifecycleCtaUrl('weak_area', 'weak_area_' + weakest.cat, '#dpe-library')}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Review ${CATEGORY_LABELS[weakest.cat] || weakest.cat} →</a>`
  const { data: logRow, error: logError } = await supabase.from('portal_email_log').insert({ profile_id: profile.id, email_type: emailType }).select('id').single()
  if (logError) {
    if (logError.code !== '23505') results.errors.push(`weak_area_log:${profile.id}:${logError.message}`)
    return
  }
  const res = await sendEmail(supabase, results, profile.email, content.subject, html, { marketingRecipientCap: true })
  if (res?.error) {
    // The log row above is inserted before the send (defends against a
    // concurrent run double-sending) -- undo it here on failure so this
    // doesn't silently consume the 14-day throttle window for an email
    // that never went out.
    if (logRow?.id) await supabase.from('portal_email_log').delete().eq('id', logRow.id)
    results.errors.push(`weak_area:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
    return
  }
  results.weak_area++
}

// Sends at most one countdown stage per run -- the nearest threshold
// the checkride is at or inside of that hasn't already been sent -- same
// catch-up reasoning as processCheckrideUpsell/processMilestones. The
// original exact daysUntil === threshold match had no tolerance for a
// missed cron run: if the job didn't run on the exact day a checkride
// was 7 days out, that email was gone for good, since daysUntil moves
// past 7 by the next run and never matches again.
// en-CA formats as YYYY-MM-DD directly -- the exact shape
// portal_checkride_date.checkride_date is already stored in, so the two
// can be compared as plain UTC-midnight Date objects without a manual
// pad/parse step once each is resolved to its own calendar day.
function localDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

async function processCountdown(supabase: any, profile: any, results: any) {
  const { data } = await supabase.from('portal_checkride_date').select('checkride_date').eq('profile_id', profile.id).maybeSingle()
  if (!data) return

  // Anchored to the member's own local calendar day (profiles.timezone),
  // not UTC -- checkride_date is a bare date with no time component, so
  // "how many days until X" must be measured from the member's own
  // local "today," not this cron run's UTC "today," or the threshold a
  // member near a day boundary sees can be off by one depending purely
  // on how far they are from UTC (email-system audit, item 1). Falls
  // back to UTC for the (common, today) case of a profile with no
  // timezone set, and again if the stored value isn't a real IANA zone
  // name -- either way this must never throw and abort the whole cron
  // run over one profile's bad data.
  let todayStr: string
  try {
    todayStr = localDateString(new Date(), profile.timezone || 'UTC')
  } catch {
    todayStr = localDateString(new Date(), 'UTC')
  }
  const today = new Date(todayStr + 'T00:00:00Z')
  const checkride = new Date(data.checkride_date + 'T00:00:00Z')
  const daysUntil = Math.round((checkride.getTime() - today.getTime()) / 86400000)
  if (daysUntil < 0) return

  for (const threshold of COUNTDOWN_DAYS) {
    if (daysUntil > threshold) continue
    const emailType = 'checkride_countdown_' + threshold
    if (await hasMilestoneFired(supabase, profile.id, emailType)) continue

    const res = await sendEmail(supabase, results, profile.email, `${threshold} ${daysNoun(threshold)} until your checkride`, emailTemplateCountdown(threshold))
    if (res?.error) {
      results.errors.push(`checkride_countdown_${threshold}:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
      return
    }
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

    const res = await sendEmail(supabase, results, profile.email, checkrideUpsellSubject(day, pricing), emailTemplateCheckrideUpsell(day, pricing, timingBucket), { marketingRecipientCap: true })
    if (res?.error) {
      results.errors.push(`checkride_upsell_day${day}:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
      return
    }
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
    .select('id, email, profile_id, checked_out_at, session:ground_sessions(title), profile:profiles(email_marketing_opt_out)')
    .eq('attendance_status', 'completed')
    .gte('checked_out_at', cutoff)

  for (const reg of regs ?? []) {
    if (!reg.email) continue
    // A walk-in with no portal account (profile_id null, see the
    // comment below) has no email_marketing_opt_out to check --
    // reg.profile is null for those, so this only ever suppresses
    // registrants who actually have an account and used it to opt out.
    if (reg.profile?.email_marketing_opt_out) continue
    const emailType = 'ground_followup_' + reg.id
    try {
      const { data: already } = await supabase.from('portal_email_log').select('id').eq('email_type', emailType).limit(1)
      if (already && already.length) continue

      const sessionTitle = reg.session?.title || 'Ground School'
      const res = await sendEmail(supabase, results, reg.email, `Thanks for coming to ${sessionTitle}`, emailTemplateGroundSchoolFollowUp(sessionTitle))
      if (res?.error) {
        results.errors.push(`ground_followup:${reg.id}: send-email failed: ${res.error.message ?? res.error}`)
        continue
      }
      await supabase.from('portal_email_log').insert({ profile_id: reg.profile_id, email_type: emailType })
      results.ground_followup++
    } catch (err) {
      results.errors.push(`ground_registration ${reg.id}: ${err}`)
    }
  }
}

const PORTAL_LOGIN_URL = 'https://apexaviationtx.com/portal-login.html'

function emailTemplateAbandonedCheckridePrep(firstName: string) {
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Still want in, ${firstName}?</h2>` +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">Looks like you started unlocking the Checkride Prep System but didn\'t finish checkout. Nothing was charged — pick up right where you left off whenever you\'re ready.</p>' +
    '<ul style="color:#4B5563;font-size:13.5px;line-height:1.8;margin:0 0 18px;padding-left:20px;">' +
    '<li>300+ ACS-mapped DPE-style questions with model answers</li>' +
    '<li>AI DPE Practice — unlimited simulated oral exams</li>' +
    '<li>The Checkride Binder Builder, ACS Quick Reference, and progress tracking</li>' +
    '</ul>' +
    `<a href="${abandonedCheckoutCtaUrl('recovery_1')}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Finish Unlocking →</a>`
}

// Second touch, Checkride-Prep-only -- sent ~48 hours after the first
// (see ABANDONED_CHECKOUT_FOLLOWUP_HOURS below) if checkout is still
// incomplete. Unlike the first email (a bare "still want in?" nudge),
// this one carries genuine reasons to act now: real Early Access pricing
// urgency (when it's actually active — never a fabricated deadline) and
// the 7-day guarantee, which directly answers "what if I'm not sure this
// is worth it" for anyone still on the fence two days later.
function emailTemplateAbandonedCheckridePrepFollowup(firstName: string, priceLabel: string, urgencyLine: string | null) {
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">One more thing, ${firstName}</h2>` +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">Your Checkride Prep unlock (${priceLabel}) is still waiting — nothing was charged, and it only takes a minute to finish.</p>` +
    (urgencyLine ? `<p style="color:#B45309;font-size:13.5px;font-weight:700;line-height:1.6;">${urgencyLine}</p>` : '') +
    '<p style="color:#6B7280;font-size:13px;line-height:1.6;">Covered by our 7-day guarantee — if it\'s not right for you, email us within 7 days of purchase for a full refund, no questions asked.</p>' +
    `<a href="${abandonedCheckoutCtaUrl('recovery_2')}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Finish Unlocking →</a>`
}

function emailTemplateAbandonedGroundSchool(firstName: string) {
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Still want a seat, ${firstName}?</h2>` +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">Looks like you started registering for a live ground school session but didn\'t finish checkout. Nothing was charged — spots are first-come, first-served, so it\'s worth finishing up if you still want in.</p>' +
    `<a href="${PORTAL_LOGIN_URL}?dest=ground-school" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Finish Registering →</a>`
}

function emailTemplateAbandonedMockOral(firstName: string) {
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Still want to book, ${firstName}?</h2>` +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">Looks like you started booking a Mock Oral but didn\'t finish checkout. Nothing was charged — pick up right where you left off whenever you\'re ready.</p>' +
    `<a href="${PORTAL_LOGIN_URL}?dest=mock-oral" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Finish Booking →</a>`
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
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Your Readiness Assessment result: ${score}%</h2>` +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">Hi ${firstName}, here's a recap of your free Checkride Readiness Assessment: <strong style="color:#0B1F3A;">${level}</strong>. ${weakLine}</p>` +
    `<a href="${PORTAL_LOGIN_URL}?view=signup&dest=checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Build My Complete Study Plan →</a>`
}

// Low-commitment alternative, appended to the later touches only (day1
// leads with the full pitch first) -- Growth Sprint Phase 0 follow-up.
// Real numbers: 109 leads saw the full Checkride Prep pitch and the
// large majority never bought; a lot of that isn't rejection, it's "not
// ready for $29 yet." $19 Airspace Mastery is a real, live product
// (already built, not a placeholder), so this gives that segment an
// actual smaller first step instead of only ever re-pitching the same
// $29 ask three times in six days.
function raLowCommitLine(): string {
  return `<p style="color:#6B7280;font-size:13px;line-height:1.6;margin-top:18px;">Not ready for the full system yet? <a href="${PORTAL_LOGIN_URL}?view=signup&dest=study-packs&utm_source=email&utm_medium=email&utm_campaign=readiness_followup" style="color:#0B1F3A;text-decoration:underline;">Try the $19 Airspace Mastery Study Pack first →</a></p>`
}

function emailTemplateAssessmentDay3(firstName: string, weakCats: string[]) {
  const focus = weakCats.length ? weakCats[0] : 'the areas you missed'
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Quick gut check, ${firstName}</h2>` +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">If you had to sit your oral exam tomorrow, could you confidently explain ${focus} to a DPE — not just recall the fact, but explain why it matters and apply it to a real scenario? That gap between "I know it" and "I can explain it under pressure" is exactly what the full Checkride Prep System closes.</p>` +
    `<a href="${PORTAL_LOGIN_URL}?view=signup&dest=checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">See What's Included →</a>` +
    raLowCommitLine()
}

function emailTemplateAssessmentDay6(firstName: string, timingLabel: string) {
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Last look, ${firstName}</h2>` +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">You told us your checkride is ${timingLabel}. Whenever that is, the difference between scattered studying and a real plan is what actually shows up in the oral exam room. The Checkride Prep System gives you 300+ ACS-mapped questions, DPE-style scenarios, and an AI mock oral — built to close exactly the gaps your assessment turned up.</p>` +
    `<p style="color:#6B7280;font-size:13px;line-height:1.6;">Covered by our 7-day guarantee — not satisfied, email us for a full refund.</p>` +
    `<a href="${PORTAL_LOGIN_URL}?view=signup&dest=checkride-prep" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Build My Complete Study Plan →</a>` +
    raLowCommitLine()
}

// One row per lead (not a log), so each of the three stages is checked
// and marked directly on readiness_assessment_leads (v42) -- same
// dedupe-on-the-row pattern as checkout_session_attempts. Stops the
// instant the lead's email belongs to any real profile (free or
// unlocked): at that point processCheckrideUpsell/processMilestones
// above already nurture them, and sending both would double-email the
// same person from two different sequences.
//
// Not gated by email_marketing_opt_out: that flag lives on profiles,
// and by definition every lead this function emails has no profile row
// yet (the existingProfile check below already excludes anyone who
// does). There is currently no pre-signup opt-out mechanism for this
// specific lead-capture flow -- a real, honest gap, not an oversight to
// paper over. If this needs one, it belongs on readiness_assessment_
// leads itself, not on a table these people were never added to.
// Backlog-safety repair (readiness-funnel instrumentation audit, Oct
// 2026): the cron that calls this function was broken for ~3 weeks (see
// the auth-repair note above `serve()`), so the first run after it's
// fixed sees every lead at whatever age it's actually at, not a tidy
// 1/3/6-day progression. The original `if daysOld>=1 / else if >=3 /
// else if >=6` chain has no upper bound on any branch, so a lead that's
// sat for two weeks hits the *first* true branch and gets "Your
// Readiness Assessment result" copy framed as a same-day follow-up --
// two weeks late -- then Day3 and Day6 fire back-to-back on the next
// two daily runs. Windowing each stage fixes this going forward (not
// just for today's backlog): a stage only fires inside its own window,
// so a lead that's already aged past a stage by the time it's first
// seen skips that stage forever and waits for the next one it still
// qualifies for -- which is exactly "don't send a Day 1 email weeks
// late," not a workaround specific to today's numbers.
// READINESS_FOLLOWUP_STALE_CEILING_DAYS additionally stops the chain
// from ever reaching back into a lead that's aged out of relevance
// entirely (no one in production is past this today -- it's pure
// future-proofing against the next outage, not a reaction to current
// data). Set to 30, not an arbitrary round number: it matches
// CHECKRIDE_TIMING_SCHEDULES' own longest-running touchpoint (the
// not_scheduled bucket's day-30 "it'll be here whenever you're ready"
// email above) -- this codebase's own existing answer to "how long is
// too long to keep nurturing someone who hasn't converted," reused here
// instead of inventing a second, different answer to the same question.
const READINESS_FOLLOWUP_STALE_CEILING_DAYS = 30
// Circuit breaker against any future backlog pileup (e.g. a much longer
// outage than this one): caps real sends per run so a recovery run
// can't become a mass blast. Leads skipped solely because of this cap
// are simply picked up on the next run -- nothing about their
// eligibility changes, so no suppression bookkeeping is needed for
// them.
const READINESS_FOLLOWUP_MAX_SENDS_PER_RUN = 25

type ReadinessFollowupSentFlags = { day1: boolean; day3: boolean; day6: boolean }
type ReadinessFollowupStage = 'day1' | 'day3' | 'day6' | null

function readinessFollowupStage(daysOld: number, sent: ReadinessFollowupSentFlags): ReadinessFollowupStage {
  if (daysOld > READINESS_FOLLOWUP_STALE_CEILING_DAYS) return null
  if (daysOld >= 1 && daysOld < 3 && !sent.day1) return 'day1'
  if (daysOld >= 3 && daysOld < 6 && !sent.day3) return 'day3'
  if (daysOld >= 6 && !sent.day6) return 'day6'
  return null
}

function readinessFollowupEmailContent(stage: 'day1' | 'day3' | 'day6', firstName: string, lead: any, weakCats: string[]) {
  if (stage === 'day1') {
    return { subject: `Your Readiness Assessment result: ${lead.score}%`, html: emailTemplateAssessmentDay1(firstName, lead.score, lead.readiness_level, weakCats) }
  }
  if (stage === 'day3') {
    return { subject: 'Quick gut check before your checkride', html: emailTemplateAssessmentDay3(firstName, weakCats) }
  }
  return { subject: 'Last look at your Checkride Prep options', html: emailTemplateAssessmentDay6(firstName, RA_TIMING_LABELS[lead.checkride_timing] ?? 'coming up') }
}

async function processReadinessAssessmentFollowup(supabase: any, results: any) {
  const { data: leads } = await supabase
    .from('readiness_assessment_leads')
    .select('id, email, full_name, checkride_timing, score, readiness_level, category_results, created_at, email_day1_sent_at, email_day3_sent_at, email_day6_sent_at')

  let sentThisRun = 0

  for (const lead of leads ?? []) {
    try {
      if (!lead.email) continue
      // Case-insensitive on purpose (bug sweep, Oct 2026) -- a lead whose
      // email differs only in case from their real profile.email (mobile
      // auto-capitalization, different browser autofill, etc.) previously
      // read as "not yet a member" here and got the full day1/day3/day6
      // nurture sequence despite already being a real signed-up member.
      // Matches the fix in create-free-account/index.ts and
      // create-checkout-session/index.ts.
      const { data: existingProfile } = await supabase.from('profiles').select('id').ilike('email', escapeIlike(lead.email)).maybeSingle()
      if (existingProfile) continue

      const daysOld = (Date.now() - new Date(lead.created_at).getTime()) / 86400000
      const stage = readinessFollowupStage(daysOld, { day1: !!lead.email_day1_sent_at, day3: !!lead.email_day3_sent_at, day6: !!lead.email_day6_sent_at })
      if (!stage) continue

      if (sentThisRun >= READINESS_FOLLOWUP_MAX_SENDS_PER_RUN) {
        results.readiness_assessment_followup_capped_skips = (results.readiness_assessment_followup_capped_skips || 0) + 1
        continue
      }

      const firstName = (lead.full_name || 'there').split(' ')[0]
      const weakCats = raWeakCategories(lead.category_results)
      const { subject, html } = readinessFollowupEmailContent(stage, firstName, lead, weakCats)

      // Readiness-funnel instrumentation audit: sendEmail() previously
      // returned nothing, so a provider-side send failure (send-email
      // invoke() resolving with an error rather than throwing, which is
      // how supabase-js reports most edge-function-level failures) was
      // indistinguishable from a real send -- email_dayN_sent_at got
      // stamped either way, permanently skipping that lead on every future
      // run. Checking res?.error means a failed send is both retried next
      // run AND visible in results.errors, instead of silently recorded
      // as "sent."
      const res = await sendEmail(supabase, results, lead.email, subject, html)
      if (res?.error) {
        results.errors.push(`readiness_assessment_followup ${stage} ${lead.id}: send-email failed: ${res.error.message ?? res.error}`)
        continue
      }

      sentThisRun++
      results.readiness_assessment_followup++
      // The send already happened by this point -- if this update fails,
      // the lead's _sent_at column stays null and the next run will send
      // this same stage again. That's a real, known at-least-once-delivery
      // risk (documented, not engineered away): the cron runs once daily
      // with no concurrent invocations, so the only way to hit it is two
      // independent failures back to back (a successful send immediately
      // followed by a DB write failure), which is low-likelihood and
      // low-severity (one duplicate email, not a silent data-integrity
      // problem) -- and it's strictly better than the prior behavior,
      // where this exact failure mode was invisible. A full fix would mean
      // a dedicated idempotency/dedup table (the pattern this file's own
      // header comment already uses for weak_area_* emails via
      // portal_email_log's unique index) -- out of scope for "log it so
      // it's visible," which is what this repair set out to do.
      const { error: updateErr } = await supabase.from('readiness_assessment_leads').update({ [`email_${stage}_sent_at`]: new Date().toISOString() }).eq('id', lead.id)
      if (updateErr) {
        results.errors.push(`readiness_assessment_followup ${stage} ${lead.id}: sent_at update failed after a successful send (next run may resend): ${updateErr.message ?? updateErr}`)
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
// Apex Advantage Mock Orals -- 24-hour reminder. One-time per booking
// (dedup via mock_oral_bookings.reminder_sent_at directly on the row,
// same dedupe-on-the-row pattern as checkout_session_attempts and
// readiness_assessment_leads above), sent once the class start time is
// within the next 24 hours and hasn't passed yet.
const MOCK_ORAL_REMINDER_WINDOW_HOURS = 24

function moTzAbbr(tz: string): string {
  return ({ 'America/Chicago': 'CT', 'America/New_York': 'ET', 'America/Denver': 'MT', 'America/Los_Angeles': 'PT', 'UTC': 'UTC' } as Record<string, string>)[tz] || tz
}

// Not gated by email_marketing_opt_out -- a class-start reminder for a
// paid, confirmed booking is a service notice, not a marketing send;
// see the profiles SELECT comment in serve() for the split this follows.
async function processMockOralReminders(supabase: any, results: any) {
  const windowEnd = new Date(Date.now() + MOCK_ORAL_REMINDER_WINDOW_HOURS * 3600000)
  const { data: bookings } = await supabase
    .from('mock_oral_bookings')
    .select('id, full_name, email, meeting_url, reminder_sent_at, availability:mock_oral_availability(class_date, start_time, timezone)')
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)

  for (const b of bookings ?? []) {
    if (!b.email || !b.availability) continue
    try {
      const startAt = new Date(`${b.availability.class_date}T${b.availability.start_time}`)
      if (startAt > windowEnd || startAt < new Date()) continue

      const when = startAt.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      const tz = moTzAbbr(b.availability.timezone)
      const joinLine = b.meeting_url
        ? `<a href="${b.meeting_url}" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Join Instructions →</a>`
        : `<p style="color:#4B5563;font-size:13px;">Your join link will be available in your portal shortly before the session.</p>`

      const { data: claimed, error: markError } = await supabase
        .from('mock_oral_bookings')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', b.id)
        .is('reminder_sent_at', null)
        .select('id')
      if (markError) { results.errors.push(`mock_oral_reminder_mark:${b.id}:${markError.message}`); continue }
      if (!claimed || !claimed.length) continue // lost the race to another concurrent execution

      // exemptFromGlobalCap: a confirmed, paid booking's day-before
      // service notice, not a marketing nudge -- missing it has a real
      // cost (a student shows up unprepared or without a join link) a
      // generic engagement email doesn't carry, and volume is inherently
      // small and time-boxed to the next 24h. See the global cap's own
      // header comment on sendEmail().
      const res = await sendEmail(supabase, results, b.email, 'Your Apex Mock Oral is tomorrow',
        template(`
          <h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">See you soon, ${b.full_name.split(' ')[0]}!</h2>
          <p style="color:#1F2937;font-size:15px;line-height:1.7;">Your Mock Oral is coming up: <strong style="color:#0B1F3A">${when} ${tz}</strong>.</p>
          ${joinLine}
          <p style="color:#4B5563;font-size:13px;line-height:1.7;margin-top:16px;">Have ready if applicable: your student pilot certificate and medical, your aircraft's POH/AFM, a current sectional or EFB, and your Knowledge Test Report.</p>
        `), { exemptFromGlobalCap: true })
      if (res?.error) {
        // The claim above already committed; undo it so this doesn't
        // silently skip a time-sensitive reminder forever.
        await supabase.from('mock_oral_bookings').update({ reminder_sent_at: null }).eq('id', b.id)
        results.errors.push(`mock_oral_reminder:${b.id}: send-email failed: ${res.error.message ?? res.error}`)
        continue
      }
      results.mock_oral_reminder++
    } catch (err) {
      results.errors.push(`mock_oral_reminder:${b.id}: ${err}`)
    }
  }
}

// v152 repair -- see ABANDONED_CHECKOUT_RECOVERY_REPAIR_REPORT.md for the
// full root-cause writeup. Two independent defects fixed here:
//
// 1. The only conditional skip in the old loop (email_marketing_opt_out)
//    left zero trace anywhere -- not in `results`, not in any table -- so
//    an opted-out profile's checkout row was silently rediscovered by the
//    SELECT below and silently re-skipped on every single cron run
//    forever, with nothing to distinguish "will be sent next run" from
//    "permanently stuck." decideAbandonedCheckoutAction() now returns an
//    explicit decision, and a 'suppress' decision is written once to
//    recovery_suppressed_at/recovery_suppressed_reason (v152.sql) so the
//    row drops out of the SELECT below for good, with an auditable reason.
//
// 2. The claim-before-send UPDATE never checked how many rows it actually
//    affected -- `.update(...).eq('id', attempt.id).is('recovery_email_
//    sent_at', null)` returns `error: null` whether it updated one row or
//    zero, so two overlapping executions racing on the same attempt would
//    BOTH see no error and BOTH send, despite the mark-before-send
//    ordering. `.select('id')` + checking the returned row now makes this
//    a real atomic claim: whichever caller's UPDATE actually flips the
//    column from null wins, the other sees an empty result and backs off.
async function processAbandonedCheckouts(supabase: any, results: any) {
  const minAge = new Date(Date.now() - ABANDONED_CHECKOUT_MIN_HOURS * 3600000).toISOString()
  const maxAge = new Date(Date.now() - ABANDONED_CHECKOUT_MAX_DAYS * 86400000).toISOString()

  const { data: attempts } = await supabase
    .from('checkout_session_attempts')
    .select('id, purpose, email, profile_id, created_at')
    .is('completed_at', null)
    .is('recovery_email_sent_at', null)
    .is('recovery_suppressed_at', null)
    .lte('created_at', minAge)
    .gte('created_at', maxAge)

  for (const attempt of attempts ?? []) {
    results.abandoned_checkout_candidates = (results.abandoned_checkout_candidates || 0) + 1
    try {
      let firstName = 'there'
      let profile: { full_name?: string; email_marketing_opt_out?: boolean; checkride_prep_unlocked?: boolean } | null = null
      if (attempt.profile_id) {
        const { data } = await supabase.from('profiles').select('full_name,email_marketing_opt_out,checkride_prep_unlocked').eq('id', attempt.profile_id).maybeSingle()
        profile = data
        if (profile?.full_name) firstName = profile.full_name.split(' ')[0]
      }

      const decision = decideAbandonedCheckoutAction(attempt, profile)

      if (decision.action === 'skip') {
        // Genuinely not something this job handles (e.g. a purpose it has
        // no template for) -- not written to the row at all, same as the
        // original `else continue`, since there's nothing to suppress a
        // future, different repair from reconsidering.
        continue
      }

      if (decision.action === 'suppress') {
        const { data: claimed } = await supabase
          .from('checkout_session_attempts')
          .update({ recovery_suppressed_at: new Date().toISOString(), recovery_suppressed_reason: decision.reason })
          .eq('id', attempt.id)
          .is('recovery_suppressed_at', null)
          .select('id')
        if (claimed && claimed.length) {
          if (decision.reason === ABANDONED_CHECKOUT_SUPPRESSION_REASONS.OPT_OUT) results.abandoned_checkout_suppressed_opt_out = (results.abandoned_checkout_suppressed_opt_out || 0) + 1
          else if (decision.reason === ABANDONED_CHECKOUT_SUPPRESSION_REASONS.ALREADY_ENTITLED) results.abandoned_checkout_suppressed_entitled = (results.abandoned_checkout_suppressed_entitled || 0) + 1
        }
        continue
      }

      // decision.action === 'send' from here on. Re-check entitlement one
      // more time immediately before claiming -- Section 2/5's "before
      // EVERY recovery send" requirement -- since the profile read above
      // could be a moment stale by the time execution reaches here (a
      // weak-area/upsell email earlier in this same run, or simply another
      // row's processing time, could overlap a real purchase completing).
      if (CHECKRIDE_PREP_CHECKOUT_PURPOSES.includes(attempt.purpose) && attempt.profile_id) {
        if (await hasCheckridePrepEntitlement(supabase, attempt.profile_id)) {
          await supabase
            .from('checkout_session_attempts')
            .update({ recovery_suppressed_at: new Date().toISOString(), recovery_suppressed_reason: ABANDONED_CHECKOUT_SUPPRESSION_REASONS.ALREADY_ENTITLED_AT_SEND_TIME })
            .eq('id', attempt.id)
            .is('recovery_suppressed_at', null)
          results.abandoned_checkout_suppressed_entitled = (results.abandoned_checkout_suppressed_entitled || 0) + 1
          continue
        }
      }

      let subject: string
      let html: string
      if (CHECKRIDE_PREP_CHECKOUT_PURPOSES.includes(attempt.purpose)) {
        subject = 'You started unlocking Checkride Prep'
        html = emailTemplateAbandonedCheckridePrep(firstName)
      } else if (attempt.purpose === 'ground-school-registration') {
        subject = 'You started registering for ground school'
        html = emailTemplateAbandonedGroundSchool(firstName)
      } else {
        // attempt.purpose === 'book-mock-oral' -- the only other member of
        // ABANDONED_CHECKOUT_SUPPORTED_PURPOSES.
        subject = 'You started booking a Mock Oral'
        html = emailTemplateAbandonedMockOral(firstName)
      }

      // Atomic claim: only proceeds to send if THIS call is the one that
      // actually flips recovery_email_sent_at from null -- see this
      // function's header comment, defect 2.
      const { data: claimed, error: markError } = await supabase
        .from('checkout_session_attempts')
        .update({ recovery_email_sent_at: new Date().toISOString() })
        .eq('id', attempt.id)
        .is('recovery_email_sent_at', null)
        .select('id')
      if (markError) {
        results.errors.push(`abandoned_checkout_mark:${attempt.id}:${markError.message}`)
        continue
      }
      if (!claimed || !claimed.length) {
        // Lost the race to another concurrent execution -- not an error,
        // just this invocation backing off. Nothing left to do.
        continue
      }

      let res: any
      try {
        res = await sendEmail(supabase, results, attempt.email!, subject, html)
      } catch (sendErr) {
        res = { error: sendErr }
      }
      if (res?.error) {
        // The claim above already committed. Previously this was an
        // accepted "rare skipped send on genuine failure, never a
        // duplicate" tradeoff -- but the global send cap (Oct 2026) makes
        // a non-throwing error response the NORMAL path once the cap is
        // hit, not a rare one, so it's reverted here instead: unclaim by
        // clearing recovery_email_sent_at so this attempt is retried on a
        // later run rather than silently never recovered.
        await supabase.from('checkout_session_attempts').update({ recovery_email_sent_at: null }).eq('id', attempt.id)
        results.abandoned_checkout_send_failures = (results.abandoned_checkout_send_failures || 0) + 1
        results.errors.push(`abandoned_checkout_send:${attempt.id}: ${res.error.message ?? res.error}`)
        continue
      }
      results.abandoned_checkout++

      await supabase.from('analytics_events').insert({
        event_name: 'checkout_recovery_1_sent',
        profile_id: attempt.profile_id || null,
        properties: { purpose: attempt.purpose, recovery_sequence: 1 },
      })

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

// Second touch, Checkride-Prep-only (v151's recovery_email_2_sent_at) --
// a growth-plan audit found the single first-touch email above had sent
// only 10 times ever against 58 real checkout_session_attempts rows,
// with no urgency or reason to act beyond "you didn't finish." This
// fires ABANDONED_CHECKOUT_FOLLOWUP_HOURS after the first email if
// checkout is still incomplete, and only for Checkride Prep -- Ground
// School/Mock Oral have no comparable real urgency (a live class's own
// seat-scarcity messaging on the class picker already covers that case)
// to reference in a second nudge, so they keep the single email as-is
// rather than getting a second touch with nothing new to say.
async function processAbandonedCheckoutsFollowup(supabase: any, results: any) {
  const followupCutoff = new Date(Date.now() - ABANDONED_CHECKOUT_FOLLOWUP_HOURS * 3600000).toISOString()

  const { data: attempts } = await supabase
    .from('checkout_session_attempts')
    .select('id, purpose, email, profile_id, amount_cents')
    .is('completed_at', null)
    .is('recovery_email_2_sent_at', null)
    .is('recovery_suppressed_at', null)
    .not('recovery_email_sent_at', 'is', null)
    .lte('recovery_email_sent_at', followupCutoff)
    .in('purpose', CHECKRIDE_PREP_CHECKOUT_PURPOSES)

  for (const attempt of attempts ?? []) {
    results.abandoned_checkout_followup_candidates = (results.abandoned_checkout_followup_candidates || 0) + 1
    if (!attempt.email) continue
    try {
      let firstName = 'there'
      let optedOut = false
      let alreadyEntitled = false
      if (attempt.profile_id) {
        const { data: profile } = await supabase.from('profiles').select('full_name,email_marketing_opt_out,checkride_prep_unlocked').eq('id', attempt.profile_id).maybeSingle()
        if (profile?.full_name) firstName = profile.full_name.split(' ')[0]
        optedOut = !!profile?.email_marketing_opt_out
        alreadyEntitled = !!profile?.checkride_prep_unlocked
      }

      // Same suppression rules as the first touch, not duplicated as a
      // separate decision function since this job's eligibility shape
      // (Checkride-Prep-only, already filtered in the query above) is
      // simpler -- just the two checks inline.
      if (optedOut || alreadyEntitled) {
        const { data: claimed } = await supabase
          .from('checkout_session_attempts')
          .update({
            recovery_suppressed_at: new Date().toISOString(),
            recovery_suppressed_reason: optedOut ? ABANDONED_CHECKOUT_SUPPRESSION_REASONS.OPT_OUT : ABANDONED_CHECKOUT_SUPPRESSION_REASONS.ALREADY_ENTITLED,
          })
          .eq('id', attempt.id)
          .is('recovery_suppressed_at', null)
          .select('id')
        if (claimed && claimed.length) {
          if (optedOut) results.abandoned_checkout_suppressed_opt_out = (results.abandoned_checkout_suppressed_opt_out || 0) + 1
          else results.abandoned_checkout_suppressed_entitled = (results.abandoned_checkout_suppressed_entitled || 0) + 1
        }
        continue
      }

      // Live pricing, not the quoted amount_cents on the original attempt
      // -- a founding/launch tier could have changed (or Early Access
      // could have ended entirely) in the ~2 days since the first email,
      // and this second touch's whole point is to reference the real,
      // current state, not a stale snapshot.
      const { data: pricingRows } = await supabase.rpc('get_checkride_prep_pricing', { p_profile_id: attempt.profile_id || null })
      const pricing = (pricingRows && pricingRows[0]) || null
      const priceLabel = pricing ? `$${Math.round(pricing.amount_cents / 100)}` : (attempt.amount_cents ? `$${Math.round(attempt.amount_cents / 100)}` : '$29')
      const urgencyLine = pricing && pricing.tier === 'founding'
        ? `Only ${pricing.founding_seats_remaining} founding spots left at ${priceLabel}.`
        : pricing && pricing.tier === 'launch'
          ? `Early Access pricing (${priceLabel}) won't last — regular price is $49.`
          : null

      // Final re-check immediately before claiming, same reasoning as
      // processAbandonedCheckouts' own send-time guard.
      if (attempt.profile_id && await hasCheckridePrepEntitlement(supabase, attempt.profile_id)) {
        await supabase
          .from('checkout_session_attempts')
          .update({ recovery_suppressed_at: new Date().toISOString(), recovery_suppressed_reason: ABANDONED_CHECKOUT_SUPPRESSION_REASONS.ALREADY_ENTITLED_AT_SEND_TIME })
          .eq('id', attempt.id)
          .is('recovery_suppressed_at', null)
        results.abandoned_checkout_suppressed_entitled = (results.abandoned_checkout_suppressed_entitled || 0) + 1
        continue
      }

      const { data: claimed, error: markError } = await supabase
        .from('checkout_session_attempts')
        .update({ recovery_email_2_sent_at: new Date().toISOString() })
        .eq('id', attempt.id)
        .is('recovery_email_2_sent_at', null)
        .select('id')
      if (markError) {
        results.errors.push(`abandoned_checkout_followup_mark:${attempt.id}:${markError.message}`)
        continue
      }
      if (!claimed || !claimed.length) continue // lost the race to another concurrent execution

      let res: any
      try {
        res = await sendEmail(supabase, results, attempt.email, 'Still thinking it over?', emailTemplateAbandonedCheckridePrepFollowup(firstName, priceLabel, urgencyLine))
      } catch (sendErr) {
        res = { error: sendErr }
      }
      if (res?.error) {
        // Same claim-already-committed revert as the first-touch
        // function above -- clear recovery_email_2_sent_at so this is
        // retried on a later run instead of lost.
        await supabase.from('checkout_session_attempts').update({ recovery_email_2_sent_at: null }).eq('id', attempt.id)
        results.abandoned_checkout_send_failures = (results.abandoned_checkout_send_failures || 0) + 1
        results.errors.push(`abandoned_checkout_followup_send:${attempt.id}: ${res.error.message ?? res.error}`)
        continue
      }
      results.abandoned_checkout_followup++

      await supabase.from('analytics_events').insert({
        event_name: 'checkout_recovery_2_sent',
        profile_id: attempt.profile_id || null,
        properties: { purpose: attempt.purpose, recovery_sequence: 2 },
      })
    } catch (err) {
      results.errors.push(`abandoned_checkout_followup:${attempt.id}: ${err}`)
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
// Not gated by email_marketing_opt_out -- like processMockOralReminders,
// this reports the status of something the member's own actions already
// put in motion (a streak they built, a reward that expires tonight),
// not a promotional pitch. See the profiles SELECT comment in serve()
// for the transactional/marketing split this follows.
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
      const res = await sendEmail(supabase, results, email, 'Your streak is on the line tonight', emailTemplateRecoverySortie(firstName))
      if (res?.error) {
        results.errors.push(`recovery_sortie:${sortie.id}: send-email failed: ${res.error.message ?? res.error}`)
        continue
      }
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
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Quick one, ${firstName}</h2>` +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">Have you tried today\'s DPE question yet?</p>' +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">It takes about two minutes, and it\'s probably the easiest way to get value from Apex Advantage right away.</p>' +
    `<a href="${activationCtaUrl('dashboard', 2)}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Answer Today's Question →</a>` +
    '<p style="color:#4B5563;font-size:13px;line-height:1.6;">That\'s it.</p>' +
    '<p style="color:#4B5563;font-size:13px;line-height:1.6;">— Andrew</p>'
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
    ? `<p style="color:#1F2937;font-size:15px;line-height:1.7;">You mentioned you're ${action.contextPhrase}.</p>`
    : ''
  const focusLine = focusLabel
    ? `<p style="color:#1F2937;font-size:15px;line-height:1.7;">You also told us ${focusLabel} is one of the areas you want to work on — that's worth starting with.</p>`
    : ''
  const upsellLine = upsellSentence ? `<p style="color:#4B5563;font-size:13px;line-height:1.6;">${upsellSentence}</p>` : ''
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">This might be useful for where you are in training</h2>` +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">Hi ${firstName}, Andrew here again.</p>` +
    stageLine + focusLine +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">I'd start here:</p>` +
    `<a href="${activationCtaUrl(action.hash, 3)}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">${action.label} →</a>` +
    upsellLine
}

// Email #4 (~7d) -- re-engagement, not a hard sell, per brief section 13.
// Terminal email of the sequence -- NEW_MEMBER_ACTIVATION_SCHEDULE ends
// at day 7, so a profile that reaches this with no activity simply stops
// hearing from this sequence afterward (falls to the normal reactivation_
// inactive / checkride_upsell cadence like any other member from then on).
function emailTemplateActivationDay7(firstName: string, action: { hash: string; label: string; contextPhrase: string }, upsellSentence: string): string {
  const upsellLine = upsellSentence ? `<p style="color:#4B5563;font-size:13px;line-height:1.6;">${upsellSentence}</p>` : ''
  return `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Hi ${firstName}</h2>` +
    '<p style="color:#1F2937;font-size:15px;line-height:1.7;">You\'ve got an Apex Advantage account, but it looks like you haven\'t had a chance to use it yet.</p>' +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">If you want the easiest place to start, I'd do this:</p>` +
    `<a href="${activationCtaUrl(action.hash, 4)}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">${action.label} →</a>` +
    upsellLine +
    '<p style="color:#4B5563;font-size:13px;line-height:1.6;">It\'ll take about 5 minutes.</p>' +
    '<p style="color:#4B5563;font-size:13px;line-height:1.6;">— Andrew</p>'
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
    ? '<p style="color:#4B5563;font-size:13px;line-height:1.6;">If your checkride is coming up, the full Checkride Prep System is there when you\'re ready.</p>'
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

  const html = `<h2 style="color:#0B1F3A;margin:0 0 12px;font-size:22px;line-height:1.3;">Andrew here.</h2>` +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">I saw you just joined Apex Advantage${timingClause}.</p>` +
    `<p style="color:#1F2937;font-size:15px;line-height:1.7;">I'd start here: set your password, then answer today's oral exam question. It's free for every member and only takes a couple of minutes — the best way to start actually using the portal instead of just looking around.</p>` +
    `<a href="${actionLink}" style="display:inline-block;margin:12px 0 20px;background:#F4B400;color:#0B1F3A;border-radius:0;padding:13px 24px;text-decoration:none;font-weight:700;font-size:14px;">Set Up My Account & Get Started →</a>` +
    upsellClause +
    '<p style="color:#4B5563;font-size:13px;line-height:1.6;">If you get stuck on anything, reply to this email.</p>' +
    '<p style="color:#4B5563;font-size:13px;line-height:1.6;">Blue skies,<br>Andrew</p>'

  // Unified onto sendEmail() (Oct 2026) -- this call site previously
  // invoked the send-email function directly, bypassing sendEmail()'s
  // global send cap entirely. sendEmail() applies template() itself, so
  // the raw `html` is passed here, not template(html).
  const emailResult = await sendEmail(supabase, results, profile.email, `A good place to start, ${firstName}`, html, { replyTo: ACTIVATION_REPLY_TO, marketingRecipientCap: true })
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

    // Bug fix + unification onto sendEmail() (Oct 2026 recovery
    // safeguard audit): this call site previously invoked send-email
    // directly, discarded the result entirely, and called
    // markMilestoneSent() unconditionally -- so a provider-side failure
    // here was ALREADY silently recorded as a successful send even
    // before the global send cap existed (the cap just makes hitting
    // this far more likely, since every capped-out attempt returns a
    // non-throwing error the old code never looked at). sendEmail()
    // applies template() itself, so raw `html` is passed, not
    // template(html).
    const res = await sendEmail(supabase, results, profile.email, subject, html, { ...(replyTo ? { replyTo } : {}), marketingRecipientCap: true })
    if (res?.error) {
      results.errors.push(`${emailType}:${profile.id}: send-email failed: ${res.error.message ?? res.error}`)
      return
    }
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
  // Fail-closed (Stage 2 auth hardening, Oct 2026): the prior `if
  // (CRON_SECRET)` guard skipped this check entirely whenever the env
  // var was unset, so a misconfigured deploy (secret never set, or
  // cleared) would process and send real lifecycle email to anyone who
  // found this function's public URL, no credential required. 500 here
  // (not 401) because this case is a server-side misconfiguration, not
  // a bad request -- no credential the caller could supply would ever
  // succeed, and retrying with different headers can't fix it. 401 is
  // reserved for the normal case: a secret IS configured but the
  // request's own credential is missing or wrong, which the caller
  // could in principle correct.
  if (!CRON_SECRET) {
    console.error('LIFECYCLE_CRON_SECRET is not configured -- refusing to run lifecycle processing')
    return new Response('Server misconfigured', { status: 500 })
  }
  const cronSecretHeader = req.headers.get('X-Lifecycle-Cron-Secret') || ''
  if (cronSecretHeader !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Single-recipient test mode (Stage 3 lifecycle-email recovery, Oct
  // 2026). Deliberately placed here -- after the real cron secret check
  // above (a test request still needs that same credential), but before
  // anything below that reads the profiles table or writes to any
  // dedup/log table. Every path through this block ends in `return`,
  // so a request that takes it can NEVER fall through into the real
  // batch that follows -- that is the single property this whole
  // mechanism depends on, and it's covered by an execution-level test,
  // not just this comment.
  //
  // Reuses sendEmail()/template()/emailHeadline()/emailParagraph() --
  // the exact same reviewed send path real campaigns use (via
  // exemptFromGlobalCap, the same mechanism the mock-oral reminder
  // already relies on) -- rather than a second, hand-rolled invoke()
  // call, so a passing test is actually evidence the real pipeline
  // works, not evidence of a parallel implementation that happens to
  // also work.
  const testRecipientHeader = req.headers.get('X-Lifecycle-Test-Recipient')
  if (testRecipientHeader !== null) {
    // Independent of the cron secret on purpose: knowing that secret
    // must not be enough on its own to trigger a send. Off by default
    // -- an unset env var reads as the literal string undefined, which
    // !== 'true'.
    if (!LIFECYCLE_TEST_MODE_ENABLED) {
      return new Response(JSON.stringify({ mode: 'test_single_recipient', authorized: false, reason: 'test mode disabled' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }
    if (!LIFECYCLE_TEST_RECIPIENT_EMAIL) {
      console.error('LIFECYCLE_TEST_RECIPIENT_EMAIL is not configured -- refusing test-mode request')
      return new Response(JSON.stringify({ mode: 'test_single_recipient', authorized: false, reason: 'test recipient not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    // Case-insensitive, same convention as this file's other email
    // comparisons (e.g. readiness_assessment_followup's `ilike`) --
    // email addresses aren't meaningfully case-sensitive in practice,
    // and an exact-case mismatch here would be a confusing way to fail.
    if (testRecipientHeader.trim().toLowerCase() !== LIFECYCLE_TEST_RECIPIENT_EMAIL.trim().toLowerCase()) {
      return new Response(JSON.stringify({ mode: 'test_single_recipient', authorized: false, reason: 'recipient not on allowlist' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }

    const testSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    // Atomic reservation (Stage 3 review fix -- the original version of
    // this block did a plain SELECT-count cooldown check, then called
    // the provider, then INSERTed a row: a check-then-act race across
    // two round trips, where two concurrent requests could both pass
    // the SELECT before either INSERTed. lifecycle_test_reserve_send()
    // (supabase-portal-schema-v159) does the check-and-claim as ONE
    // atomic `update ... where ... returning` against a singleton lock
    // row -- Postgres's row lock on that single statement is what
    // actually prevents two concurrent callers from both reserving.
    // Called BEFORE the provider invocation below on purpose: that
    // ordering is what guarantees an ambiguous provider outcome
    // (timeout, thrown error) still leaves the cooldown claimed, so an
    // immediate manual retry after a failure can't double-send either.
    const { data: reserved, error: reservationError } = await testSupabase.rpc('lifecycle_test_reserve_send', {
      p_cooldown_seconds: LIFECYCLE_TEST_SEND_COOLDOWN_MS / 1000,
    })
    if (reservationError) {
      console.error('lifecycle_test_reserve_send failed:', reservationError.message)
      return new Response(JSON.stringify({ mode: 'test_single_recipient', authorized: true, executed: false, reason: 'reservation check failed -- refusing to send' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    if (!reserved) {
      return new Response(JSON.stringify({ mode: 'test_single_recipient', authorized: true, executed: false, reason: 'cooldown active -- a test send was already reserved recently' }), { status: 429, headers: { 'Content-Type': 'application/json' } })
    }

    const testSendResult = await sendEmail(
      testSupabase, {}, testRecipientHeader,
      '[Apex Lifecycle Test] This is an automated system test',
      emailHeadline('Lifecycle system test') +
        emailParagraph('This is an automated test message from the Apex Advantage lifecycle-email system. No action is needed -- it does not reflect your account, progress, or any real campaign activity.'),
      { exemptFromGlobalCap: true },
    )
    // Audit trail only at this point -- the reservation above (not this
    // insert) is what actually prevents a duplicate send, so a failure
    // here can't be undone by refusing anything; it's just logged
    // loudly, since the send itself has already been attempted.
    const { error: auditLogError } = await testSupabase.from('lifecycle_test_sends').insert({
      provider_accepted: !testSendResult?.error,
      provider_error: testSendResult?.error ? String(testSendResult.error.message ?? testSendResult.error) : null,
    })
    if (auditLogError) {
      console.error('lifecycle_test_sends audit-log insert failed (send already attempted):', auditLogError.message)
    }
    console.log('lifecycle test-mode send attempted:', { provider_accepted: !testSendResult?.error })
    // provider_accepted only means the send-email function/Resend
    // accepted the request -- never treat this as delivery proof. Real
    // delivery confirmation needs the Resend dashboard or the test
    // inbox itself.
    return new Response(JSON.stringify({
      mode: 'test_single_recipient', authorized: true, executed: true,
      provider_accepted: !testSendResult?.error,
      provider_error: testSendResult?.error ? String(testSendResult.error.message ?? testSendResult.error) : null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  // v152 repair (Section 11, observability): abandoned_checkout_candidates/
  // _followup_candidates count every row the eligibility SELECT returned,
  // regardless of what happened to it next -- the single number that was
  // completely absent before this repair and would have made the Sep
  // 27/28/30 defect visible immediately (candidates > 0 every day, sent +
  // suppressed staying flat). _suppressed_opt_out/_suppressed_entitled and
  // _send_failures break down exactly what became of those candidates.
  const results = {
    inactivity: 0, first_question: 0, readiness: 0, checkride_mode: 0, weak_area: 0, countdown: 0, checkride_upsell: 0, ground_followup: 0,
    abandoned_checkout: 0, abandoned_checkout_followup: 0,
    abandoned_checkout_candidates: 0, abandoned_checkout_followup_candidates: 0,
    abandoned_checkout_suppressed_opt_out: 0, abandoned_checkout_suppressed_entitled: 0, abandoned_checkout_send_failures: 0,
    seven_day_active: 0, readiness_assessment_followup: 0, recovery_sortie_notified: 0, reactivation_inactive: 0, weekly_progress: 0,
    new_member_activation: 0, activation_email_1_catchup: 0, mock_oral_reminder: 0, errors: [] as string[],
  }

  // exam_type hard-coded to 'private_pilot' — see get-premium-content
  // for why instrument content must never be reachable this way yet.
  const [{ data: categories }, { data: questions }, { data: profiles }] = await Promise.all([
    supabase.from('dpe_categories').select('id').eq('exam_type', 'private_pilot'),
    supabase.from('dpe_questions').select('id,category,is_scenario').eq('exam_type', 'private_pilot'),
    // timezone added (email-system audit, item 1): processCountdown
    // previously computed "days until checkride" entirely in UTC, which
    // put the calendar-day boundary up to several hours off local
    // midnight for any member not near UTC -- close enough to genuinely
    // flip which threshold "today" matches for a member near a day
    // boundary. Nullable; processCountdown falls back to UTC when unset,
    // same as every other profile in this query today.
    // Explicit order (recovery safeguard, Oct 2026): the global send cap
    // below means which profiles' sends actually go out in a capped run
    // depends on iteration order. Without an explicit order this was
    // whatever Postgres happened to return -- not guaranteed stable
    // across runs. Ordering by id makes a capped run's outcome
    // deterministic and reproducible rather than silently arbitrary.
    supabase.from('profiles').select('id,email,full_name,checkride_prep_unlocked,created_at,portal_last_active_at,checkride_timing,training_stage,primary_focus_area,timezone,email_marketing_opt_out').order('id'),
  ])

  const categoryIds: string[] = (categories ?? []).map((c: any) => c.id)
  const allQuestions: Question[] = questions ?? []

  // Reactivation priority fix (Stage 4 production-readiness audit, Oct
  // 2026): these five calls used to run AFTER the big per-profile loop
  // below. GLOBAL_SEND_SUCCESS_CAP/GLOBAL_SEND_FAILURE_CAP are shared
  // across the whole run, and that per-profile loop alone has hundreds
  // of candidates (checkride_upsell and new_member_activation each run
  // into the hundreds as of this audit) competing for the same 10
  // slots, in ascending profile.id order -- on a first run after any
  // real backlog accumulates, the loop exhausts the entire cap long
  // before reaching this block, so abandoned-checkout recovery and
  // Readiness Assessment follow-up (commercially time-sensitive, and
  // each a handful of candidates at most) would get zero sends while
  // the cap went entirely to bulk engagement/upsell nudges. Moving this
  // whole block earlier -- unchanged internally, same five calls in the
  // same relative order -- means these candidates claim cap slots
  // first. This is a permanent priority change, not just a first-run
  // patch: once the backlog clears, a lead that just abandoned checkout
  // or a Readiness Assessment that just went unclaimed should still
  // outrank a generic weekly-progress nudge for a limited cap slot on
  // any given day, same reasoning. ground_followup/mock_oral_reminder
  // moved along with it since they were already grouped with these
  // calls and reordering only two of five would have been a less
  // auditable change for no behavioral benefit (mock_oral_reminder is
  // exempt from the cap regardless of position; ground_followup has had
  // zero eligible profiles throughout this audit).
  await processGroundSchoolFollowUps(supabase, results)
  await processMockOralReminders(supabase, results)
  await processAbandonedCheckouts(supabase, results)
  await processAbandonedCheckoutsFollowup(supabase, results)
  await processReadinessAssessmentFollowup(supabase, results)

  for (const profile of profiles ?? []) {
    // Resource-limit fix (Stage 5, Oct 2026): once EITHER global send
    // budget is exhausted, sendEmail() already refuses every further
    // non-exempt call regardless of which campaign calls it (both caps
    // are checked unconditionally, before the provider is ever
    // invoked) -- so every remaining profile's processing below would
    // only produce cap-skip results anyway. This loop used to keep
    // querying and processing every remaining profile regardless, which
    // is exactly what produced a real 52-second run that got killed by
    // the platform's own resource limit (sb-error-code
    // WORKER_RESOURCE_LIMIT, confirmed in production logs) before
    // run_streak_maintenance/refresh_mission_progress below ever ran.
    // Breaking here changes no send outcome -- nothing further could
    // have sent anyway -- it only stops the wasted per-profile queries.
    const budget = results.__sendBudget
    if (budget && (budget.successes >= GLOBAL_SEND_SUCCESS_CAP || budget.failures >= GLOBAL_SEND_FAILURE_CAP)) break
    if (!profile.email) continue
    // Email-system audit follow-up: email_marketing_opt_out (see
    // email-preferences.html, self-updated by the member) gates every
    // engagement/promotional nudge below -- inactivity/reactivation
    // reminders, the weekly digest, weak-area and checkride-upsell
    // drips, and the new-member activation series. It never gates
    // processFirstQuestionMilestone/processMilestones/processCountdown:
    // those are relationship messages tied to something the member
    // actually did (answered a question, hit a real percentage, entered
    // a real checkride date), the same transactional/marketing split
    // stripe-webhook's purchase confirmations already sit on the
    // "never suppressed" side of.
    const marketingSuppressed = !!profile.email_marketing_opt_out
    try {
      if (!marketingSuppressed) {
        await processInactivity(supabase, profile, results)
        await processReactivationInactive(supabase, profile, results)
        await processWeeklyProgress(supabase, profile, allQuestions, categoryIds, results)
      }
      await processSevenDayActive(supabase, profile, results)
      if (!marketingSuppressed) {
        // Runs regardless of checkride_prep_unlocked -- a member who paid
        // for instant access still needs to actually USE it (brief section
        // 32, Case 9: "Already premium user -> activation recommendation
        // still useful, no inappropriate purchase pitch"). The function's
        // own stop condition (daysSinceLastMeaningfulActivity) already
        // applies identically either way.
        const justCaughtUpEmail1 = await processActivationEmail1CatchUp(supabase, profile, results)
        if (!justCaughtUpEmail1) await processNewMemberActivation(supabase, profile, results)
      }
      // Unconditional regardless of checkride_prep_unlocked -- see
      // processFirstQuestionMilestone's own comment (email-system audit,
      // item 5): the Daily DPE Question is free for every member, so a
      // free member completing their first question is a real,
      // verified event this must not silently skip.
      await processFirstQuestionMilestone(supabase, profile, results)
      if (profile.checkride_prep_unlocked) {
        await processMilestones(supabase, profile, allQuestions, categoryIds, results)
        if (!marketingSuppressed) await processWeakArea(supabase, profile, allQuestions, categoryIds, results)
        await processCountdown(supabase, profile, results)
      } else if (!marketingSuppressed) {
        await processCheckrideUpsell(supabase, profile, results)
      }
    } catch (err) {
      results.errors.push(`${profile.id}: ${err}`)
    }
  }

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
