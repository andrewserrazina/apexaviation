-- Apex Advantage — Readiness Conversion Bridge: historical backfill (v120)
--
-- ⚠️ NOT APPLIED. Per the task brief for this work ("do NOT apply
-- production database migrations automatically -- if one is genuinely
-- necessary, create the migration file and explain why"), this file is
-- written for review but was never run via apply_migration or the SQL
-- editor. A human should read the "Why this is safe" section below,
-- spot-check the SELECT preview queries against production, and only
-- then decide whether to run it.
--
-- ── Why this exists ──────────────────────────────────────────────────
-- Two separate, real root causes were found for "analytics shows real
-- portal activity but profiles.first_portal_login_at / activated_at /
-- training_stage / primary_focus_area stay unset":
--
-- 1. Silent write failures. claim_first_portal_login()/claim_activation_
--    completed() (v83/v84) calls and the onboarding-answer profile
--    updates were fire-and-forget with no error handling, so a
--    transient failure (most likely a session-hydration race right
--    after the post-signup magic-link/password-reset redirect every
--    Readiness signup goes through) silently discarded the write while
--    the paired analytics event still fired from the client before or
--    independent of that write's outcome.
--
-- 2. A separate, structural onboarding-visibility bug (found and fixed
--    independently of this backfill, already live in site/portal-
--    stable.js before this branch): showWelcomeOnboarding() used to be
--    shown ONLY inside claim_first_portal_login()'s one-shot "won"
--    branch -- the same one-time-per-profile-ever gate as the
--    portal_first_login analytics event. That's correct for an event
--    that must fire exactly once, but wrong for a UI prompt that's
--    supposed to keep asking until it actually gets an answer: a member
--    who dismissed the card, or closed the tab before answering on
--    their very first session, permanently lost any future chance to
--    set training_stage/primary_focus_area, even on every later login.
--    maybeShowWelcomeOnboarding() (already in production) decouples
--    onboarding visibility from that one-shot claim -- it re-checks
--    `member.trainingStage` on every render and re-prompts for as long
--    as it stays null, independent of whether first_portal_login_at was
--    ever successfully claimed.
--
-- site/portal-stable.js's claimFirstPortalLoginOnce()/
-- claimActivationCompletedOnce()/showWelcomeOnboarding() are fixed (this
-- branch) to log real errors and retry on the next dashboard render
-- instead of silently giving up, closing root cause #1 for every future
-- session. Root cause #2 was already fixed in production and is
-- preserved, unmodified, by this branch. Neither fix does anything for
-- the ~157 profiles already stuck with a null first_portal_login_at/
-- activated_at from before either fix shipped.
--
-- This migration backfills ONLY those two timestamp columns, and ONLY
-- from signals that already exist and already prove the real event
-- happened -- it never fabricates a value:
--
--   first_portal_login_at <- the EARLIEST of:
--     1. analytics_events.created_at where event_name = 'portal_first_login'
--        (the exact same event the broken claim call was supposed to
--        gate -- direct proof an authenticated portal login happened)
--     2. else analytics_events.created_at where event_name in
--        ('onboarding_viewed', 'first_action_presented') (still direct
--        proof of an authenticated portal session, just from a
--        different milestone in the same session)
--     If neither exists: leave first_portal_login_at NULL.
--
--     portal_study_activity.activity_date is deliberately NOT used as a
--     fallback here (an earlier draft of this file did). activity_date
--     is date-level, not a real login timestamp; study activity proves
--     training activity happened, not that it happened through a WEB
--     PORTAL login specifically (Apex now has multiple client
--     surfaces); and casting a date to timestamptz would manufacture an
--     artificial midnight timestamp with false precision. Leaving these
--     rows null is more honest than backfilling a fabricated time.
--
--   activated_at <- the EARLIEST of:
--     1. portal_question_progress.first_viewed_at where completed = true
--     2. portal_scenario_progress.updated_at where completed = true
--     3. ai_dpe_sessions.started_at (any status -- matches
--        hasMeaningfulActivity()'s own definition in
--        site/portal-stable.js, which counts running an AI DPE session
--        at all, not just a completed one)
--     This one is left unchanged from the original draft: all three
--     signals are real, direct proof of the same "meaningful training
--     action" activated_at is defined to mean, with no date-only/
--     timestamp-precision concern like portal_study_activity has above.
--
-- training_stage / primary_focus_area are DELIBERATELY NOT backfilled.
-- Unlike the two timestamps above, there is no reliable existing signal
-- for what a member would have actually answered on the onboarding
-- survey -- inventing an answer from indirect signals (e.g. guessing
-- "just_starting" from low readiness/study-activity) would fabricate
-- self-reported data the member never gave, which the task brief
-- explicitly prohibits. Members whose onboarding answer was lost to
-- this bug will simply be re-asked -- maybeShowWelcomeOnboarding()
-- already re-shows the onboarding card for anyone with training_stage
-- IS NULL, so this resolves itself the next time they log in, with no
-- backfill needed or possible.
--
-- ── Why this is safe ─────────────────────────────────────────────────
-- - Every UPDATE below is scoped to `and profiles.<col> is null`, so it
--   can only ever fill in a currently-empty value -- it cannot overwrite
--   a real, already-correct timestamp (including one written by a
--   session that starts after this file is drafted but before it's
--   run).
-- - Purely additive: no column is dropped, no existing row is deleted,
--   no function signature changes.
-- - Idempotent: safe to run more than once -- the second run updates
--   zero rows since the `is null` guard is now false everywhere it
--   already applied.
-- - Read-only preview queries are included first so a human can see
--   exactly which profiles and which timestamps this would set before
--   running the UPDATEs.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v119
-- (and after this branch's site/portal-stable.js fix has already shipped
-- to production -- there is no reason to backfill before the root-cause
-- fix is live, since new sessions would just re-break the same rows).

-- ═══════════════════════════════════════════════════════════════════════
-- PREVIEW (read-only) — run this first and eyeball the results
-- ═══════════════════════════════════════════════════════════════════════

-- How many profiles would first_portal_login_at be backfilled for, and
-- from which signal tier? (Two tiers only -- no portal_study_activity
-- fallback, see above.)
/*
with signal as (
  select
    p.id,
    (select min(ae.created_at) from public.analytics_events ae
       where ae.profile_id = p.id and ae.event_name = 'portal_first_login') as tier1,
    (select min(ae.created_at) from public.analytics_events ae
       where ae.profile_id = p.id and ae.event_name in ('onboarding_viewed', 'first_action_presented')) as tier2
  from public.profiles p
  where p.first_portal_login_at is null
)
select
  count(*) filter (where tier1 is not null) as would_backfill_from_event,
  count(*) filter (where tier1 is null and tier2 is not null) as would_backfill_from_onboarding_event,
  count(*) filter (where tier1 is null and tier2 is null) as no_signal_stays_null
from signal;
*/

-- How many profiles would activated_at be backfilled for, and from
-- which signal tier?
/*
with signal as (
  select
    p.id,
    (select min(qp.first_viewed_at) from public.portal_question_progress qp
       where qp.profile_id = p.id and qp.completed) as tier1,
    (select min(sp.updated_at) from public.portal_scenario_progress sp
       where sp.profile_id = p.id and sp.completed) as tier2,
    (select min(ds.started_at) from public.ai_dpe_sessions ds
       where ds.profile_id = p.id) as tier3
  from public.profiles p
  where p.activated_at is null
)
select
  count(*) filter (where tier1 is not null) as would_backfill_from_question_progress,
  count(*) filter (where tier1 is null and tier2 is not null) as would_backfill_from_scenario_progress,
  count(*) filter (where tier1 is null and tier2 is null and tier3 is not null) as would_backfill_from_ai_dpe,
  count(*) filter (where tier1 is null and tier2 is null and tier3 is null) as no_signal_stays_null
from signal;
*/

-- ═══════════════════════════════════════════════════════════════════════
-- BACKFILL — commented out. Uncomment and run only after reviewing the
-- preview above.
-- ═══════════════════════════════════════════════════════════════════════

/*
update public.profiles p
set first_portal_login_at = coalesce(
  (select min(ae.created_at) from public.analytics_events ae
     where ae.profile_id = p.id and ae.event_name = 'portal_first_login'),
  (select min(ae.created_at) from public.analytics_events ae
     where ae.profile_id = p.id and ae.event_name in ('onboarding_viewed', 'first_action_presented'))
)
where p.first_portal_login_at is null
  and coalesce(
    (select min(ae.created_at) from public.analytics_events ae
       where ae.profile_id = p.id and ae.event_name = 'portal_first_login'),
    (select min(ae.created_at) from public.analytics_events ae
       where ae.profile_id = p.id and ae.event_name in ('onboarding_viewed', 'first_action_presented'))
  ) is not null;

update public.profiles p
set activated_at = coalesce(
  (select min(qp.first_viewed_at) from public.portal_question_progress qp
     where qp.profile_id = p.id and qp.completed),
  (select min(sp.updated_at) from public.portal_scenario_progress sp
     where sp.profile_id = p.id and sp.completed),
  (select min(ds.started_at) from public.ai_dpe_sessions ds
     where ds.profile_id = p.id)
)
where p.activated_at is null
  and coalesce(
    (select min(qp.first_viewed_at) from public.portal_question_progress qp
       where qp.profile_id = p.id and qp.completed),
    (select min(sp.updated_at) from public.portal_scenario_progress sp
       where sp.profile_id = p.id and sp.completed),
    (select min(ds.started_at) from public.ai_dpe_sessions ds
       where ds.profile_id = p.id)
  ) is not null;
*/
