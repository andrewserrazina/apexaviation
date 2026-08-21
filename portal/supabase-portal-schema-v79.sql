-- Bug fix (v79): client-insert allowlists on portal_events and
-- portal_email_log (supabase-portal-schema-v44.sql, v58.sql) never kept
-- pace with every event/email type portal-stable.js actually generates --
-- each is a strict allowlist with no default-allow, so a value missing
-- from it doesn't get silently downgraded, it gets silently DROPPED (a
-- 403/RLS violation the client already treats as non-fatal and never
-- surfaces to the member or to Sentry/console).
--
-- Confirmed currently blocked in production (Supabase Edge/Postgres
-- logs, 2026-08-20): repeated 403s inserting into portal_email_log for
-- a 'weak_area_<category>' email_type -- meaning the Growth Sprint
-- Tier 1 weak-area follow-up email (sendThrottledEmail(), portal-
-- stable.js) has never actually been sent to any member since it
-- shipped: the insert-then-send guard (`if (res.error) return;`) means
-- every attempt fails before sendPortalEmail() is ever reached, and the
-- failed insert leaves no log row, so every future page load retries
-- and fails again. v20.sql's own weak_area_% partial unique index
-- predates v44 -- v44's allowlist rewrite simply dropped a pattern an
-- earlier migration already assumed would keep working.
--
-- Auditing every logEventOnce/sendThrottledEmail/logEmailSent call site
-- in portal-stable.js against both allowlists turned up four more
-- portal_events values with the exact same problem, all shipped after
-- v58.sql and never added to it: gs_cross_sell_shown (Ground School
-- weak-area cross-sell card), and challenge_started/challenge_completed/
-- challenge_upgrade_cta_clicked/challenge_day_<n>_completed (7-Day
-- Checkride Challenge). Concretely: every admin funnel metric reading
-- portal_events for these has been undercounting or reading zero rows,
-- not "no one did this yet."
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v78.

drop policy if exists "Users can log their own client-side events" on public.portal_events;

create policy "Users can log their own client-side events"
  on public.portal_events for insert
  with check (
    auth.uid() = profile_id
    and (
      event_type in (
        'first_login', 'first_question_completed', 'checkride_mode_completed_email', 'checkride_passed',
        'readiness_25', 'readiness_50', 'readiness_75', 'readiness_90',
        'ground_school_calendar_viewed', 'ground_school_class_viewed', 'checkride_prep_viewed',
        'gs_cross_sell_shown', 'challenge_started', 'challenge_completed', 'challenge_upgrade_cta_clicked'
      )
      or event_type like 'mock_oral_requested_%'
      or event_type like 'challenge_day_%_completed'
    )
  );

drop policy if exists "Users can log their own client-side emails" on public.portal_email_log;

create policy "Users can log their own client-side emails"
  on public.portal_email_log for insert
  with check (
    auth.uid() = profile_id
    and (
      email_type in ('first_question_completed', 'checkride_mode_completed_email', 'readiness_25', 'readiness_50', 'readiness_75', 'readiness_90')
      or email_type like 'weak_area_%'
    )
  );
