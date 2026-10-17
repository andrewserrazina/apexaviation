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
-- gateway requires `Authorization` to carry a credential it accepts --
-- checked BEFORE the function's own LIFECYCLE_CRON_SECRET check ever
-- runs. An earlier version of this script put the cron secret directly
-- in `Authorization`, which the gateway always rejected (confirmed live:
-- `sb-error-code: UNAUTHORIZED_INVALID_JWT_FORMAT`) regardless of
-- whether the secret's value matched the function's env var -- the
-- app-level check never executed. This version keeps `verify_jwt` ON
-- (do not disable it as a shortcut) and sends the project's LEGACY anon
-- key in `Authorization`.
--
-- This project has two kinds of public API key, and only one of them is
-- confirmed to satisfy `verify_jwt` via its documented mechanism:
--   - the legacy anon key genuinely IS a JWT (HS256-signed, starts with
--     `eyJ...`, found at Project Settings -> API under "Legacy anon
--     key" or similar). A live, non-destructive probe against this
--     project confirmed the gateway verifies it as a JWT -- the
--     response carries `sb-jwt-alg`/`sb-jwt-iss` headers proving real
--     JWT verification occurred, and this is the path Supabase
--     documents verify_jwt as checking.
--   - the newer `sb_publishable_...` key (Project Settings -> API,
--     "Publishable key") is NOT a JWT -- it's an opaque token in a
--     different, newer key format. The same live probe showed it also
--     got past the gateway, but with neither of those JWT-verification
--     headers present, meaning it went through some other, undocumented
--     (for this purpose) acceptance path rather than being verified as
--     a JWT. Do not substitute it here on the assumption that "it also
--     worked once" -- use the legacy anon key specifically, because
--     it's the one provably doing what verify_jwt is documented to
--     require.
-- Both keys are equally non-sensitive either way (both are meant to be
-- public and are already shipped client-side) -- this isn't a secrecy
-- distinction, and this function always builds its own service-role
-- client internally regardless of which one is sent. The actual cron
-- secret moves to its own `X-Lifecycle-Cron-Secret` header, matching
-- send-lifecycle-emails/index.ts's own auth check.
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
-- <legacy-anon-key> with the project's LEGACY anon key specifically --
-- NOT the newer `sb_publishable_...` key (see the note above for why).
-- Both are public/safe to put in this file; the legacy one is just the
-- one confirmed to satisfy verify_jwt's actual JWT check.
select cron.schedule(
  'send-lifecycle-emails-daily',
  '0 13 * * *', -- 13:00 UTC / 8am Central, per RETENTION_SYSTEM.md's recommended time
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-lifecycle-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <legacy-anon-key>',
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
