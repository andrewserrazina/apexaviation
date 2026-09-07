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
-- Phase 0/1 of the Readiness Conversion Bridge found the real root cause
-- of "analytics shows real portal activity but profiles.first_portal_
-- login_at / activated_at / training_stage / primary_focus_area stay
-- unset": both claim_first_portal_login()/claim_activation_completed()
-- (v83/v84) calls and the onboarding-answer profile updates were
-- fire-and-forget with no error handling, so a transient failure (most
-- likely a session-hydration race right after the post-signup magic-
-- link/password-reset redirect every Readiness signup goes through)
-- silently discarded the write while the paired analytics event still
-- fired from the client before or independent of that write's outcome.
-- site/portal-stable.js's claimFirstPortalLoginOnce()/
-- claimActivationCompletedOnce()/showWelcomeOnboarding() are fixed (this
-- branch) to log real errors and retry on the next dashboard render
-- instead of silently giving up -- that stops the bug for every future
-- session. It does nothing for the ~157 profiles already stuck with a
-- null first_portal_login_at/activated_at from before the fix shipped.
--
-- This migration backfills ONLY those two timestamp columns, and ONLY
-- from signals that already exist and already prove the real event
-- happened -- it never fabricates a value:
--
--   first_portal_login_at <- the EARLIEST of:
--     1. analytics_events.created_at where event_name = 'portal_first_login'
--        (the exact same event the broken claim call was supposed to
--        gate -- direct proof the login happened)
--     2. else analytics_events.created_at where event_name in
--        ('onboarding_viewed', 'first_action_presented') (still direct
--        proof of an authenticated portal session, just from a
--        different milestone in the same session)
--     3. else portal_study_activity.activity_date (proves a study
--        session happened that day, so a portal login necessarily
--        preceded it -- least precise of the three, used only when
--        neither analytics signal exists)
--
--   activated_at <- the EARLIEST of:
--     1. portal_question_progress.first_viewed_at where completed = true
--     2. portal_scenario_progress.updated_at where completed = true
--     3. ai_dpe_sessions.started_at (any status -- matches
--        hasMeaningfulActivity()'s own definition in
--        site/portal-stable.js, which counts running an AI DPE session
--        at all, not just a completed one)
--
-- training_stage / primary_focus_area are DELIBERATELY NOT backfilled.
-- Unlike the two timestamps above, there is no reliable existing signal
-- for what a member would have actually answered on the onboarding
-- survey -- inventing an answer from indirect signals (e.g. guessing
-- "just_starting" from low readiness/study-activity) would fabricate
-- self-reported data the member never gave, which the task brief
-- explicitly prohibits. Members whose onboarding answer was lost to
-- this bug will simply be re-asked -- showWelcomeOnboarding() already
-- shows the onboarding card again for anyone with training_stage IS
-- NULL, so this resolves itself the next time they log in, with no
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
-- from which signal tier?
/*
with signal as (
  select
    p.id,
    (select min(ae.created_at) from public.analytics_events ae
       where ae.profile_id = p.id and ae.event_name = 'portal_first_login') as tier1,
    (select min(ae.created_at) from public.analytics_events ae
       where ae.profile_id = p.id and ae.event_name in ('onboarding_viewed', 'first_action_presented')) as tier2,
    (select min(psa.activity_date)::timestamptz from public.portal_study_activity psa
       where psa.profile_id = p.id) as tier3
  from public.profiles p
  where p.first_portal_login_at is null
)
select
  count(*) filter (where tier1 is not null) as would_backfill_from_event,
  count(*) filter (where tier1 is null and tier2 is not null) as would_backfill_from_onboarding_event,
  count(*) filter (where tier1 is null and tier2 is null and tier3 is not null) as would_backfill_from_study_activity,
  count(*) filter (where tier1 is null and tier2 is null and tier3 is null) as no_signal_stays_null
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
     where ae.profile_id = p.id and ae.event_name in ('onboarding_viewed', 'first_action_presented')),
  (select min(psa.activity_date)::timestamptz from public.portal_study_activity psa
     where psa.profile_id = p.id)
)
where p.first_portal_login_at is null
  and coalesce(
    (select min(ae.created_at) from public.analytics_events ae
       where ae.profile_id = p.id and ae.event_name = 'portal_first_login'),
    (select min(ae.created_at) from public.analytics_events ae
       where ae.profile_id = p.id and ae.event_name in ('onboarding_viewed', 'first_action_presented')),
    (select min(psa.activity_date)::timestamptz from public.portal_study_activity psa
       where psa.profile_id = p.id)
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
