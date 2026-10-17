-- =============================================================================
-- send-lifecycle-emails: daily pg_cron schedule
-- =============================================================================
-- FOR MANUAL REVIEW BEFORE RUNNING. This is a reference script, not an
-- auto-applied migration -- there is no live Supabase project in this
-- sandbox to run it against. Read it, fill in the placeholders below,
-- and run it yourself in the Supabase SQL editor (or `supabase db
-- execute`) against your actual project.
--
-- This schedules the whole lifecycle-email system in one place,
-- including the Checkride Prep upsell drip (day 1/3/7/14 after signup)
-- -- see RETENTION_SYSTEM.md for the full list of email types this
-- triggers. RETENTION_SYSTEM.md's own SQL snippet passes the secret
-- inline in the cron.schedule() body (which then sits in plaintext in
-- cron.job); this version instead pulls it from Supabase Vault, matching
-- the andrewos-metrics/schedule.sql pattern.
--
-- Auth-repair note (readiness-funnel instrumentation audit, Oct 2026):
-- this function has `verify_jwt = true` at the project level, so the API
-- gateway requires `Authorization` to carry a validly-signed Supabase
-- JWT -- checked BEFORE the function's own LIFECYCLE_CRON_SECRET check
-- ever runs. An earlier version of this script put the cron secret
-- directly in `Authorization`, which the gateway always rejected
-- (confirmed live: `sb-error-code: UNAUTHORIZED_INVALID_JWT_FORMAT`)
-- regardless of whether the secret's value matched the function's env
-- var -- the app-level check never executed. This version keeps
-- `verify_jwt` ON (do not disable it as a shortcut) and sends a real JWT
-- in `Authorization` -- the project's anon/publishable key, which is
-- already public and carries no special privilege here (the function
-- always builds its own service-role client internally) -- while the
-- actual cron secret moves to its own `X-Lifecycle-Cron-Secret` header,
-- matching send-lifecycle-emails/index.ts's own auth check.
--
-- Prerequisites (once per project):
--   1. Enable the pg_cron and pg_net extensions:
--        Dashboard -> Database -> Extensions -> enable "pg_cron" and "pg_net"
--      (or, if you have superuser access via the SQL editor):
--        create extension if not exists pg_cron;
--        create extension if not exists pg_net;
--
--   2. Store the cron secret in Vault (do NOT hardcode the real secret in
--      this file or in git history) -- run this once, with your real
--      LIFECYCLE_CRON_SECRET value substituted, directly in the SQL editor:
--        select vault.create_secret('<your real LIFECYCLE_CRON_SECRET value>', 'lifecycle_cron_secret');
--
--   3. Before scheduling: deploy the function and set its secrets, then
--      manually trigger one run against real data and check the response
--      (see RETENTION_SYSTEM.md steps 3-6) before trusting the schedule.
--
-- =============================================================================

-- Replace <project-ref> with your actual Supabase project ref, and
-- <anon-key> with the project's anon/publishable API key (Project
-- Settings -> API -- this is the public key, safe to put in this file),
-- before running.
select cron.schedule(
  'send-lifecycle-emails-daily',
  '0 13 * * *', -- 13:00 UTC / 8am Central, per RETENTION_SYSTEM.md's recommended time
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-lifecycle-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <anon-key>',
      'X-Lifecycle-Cron-Secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'lifecycle_cron_secret'
      ),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- -----------------------------------------------------------------------------
-- To remove the schedule later:
-- -----------------------------------------------------------------------------
-- select cron.unschedule('send-lifecycle-emails-daily');

-- -----------------------------------------------------------------------------
-- To inspect scheduled runs / troubleshoot:
-- -----------------------------------------------------------------------------
-- select * from cron.job where jobname = 'send-lifecycle-emails-daily';
-- select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'send-lifecycle-emails-daily')
--   order by start_time desc
--   limit 20;
