-- =============================================================================
-- andrewos-metrics: daily pg_cron schedule
-- =============================================================================
-- FOR MANUAL REVIEW BEFORE RUNNING. This is a reference script, not an
-- auto-applied migration -- there is no live Supabase project in this
-- sandbox to run it against. Read it, fill in the two placeholders below,
-- and run it yourself in the Supabase SQL editor (or `supabase db
-- execute`) against your actual project.
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
--      value substituted, directly in the SQL editor:
--        select vault.create_secret('<your real ANDREWOS_CRON_SECRET value>', 'andrewos_cron_secret');
--
-- =============================================================================

-- Replace <project-ref> with your actual Supabase project ref before running.
select cron.schedule(
  'andrewos-metrics-daily',
  '0 7 * * *', -- 07:00 UTC daily; adjust to whatever cadence AndrewOS wants
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/andrewos-metrics',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'andrewos_cron_secret'
      )
    ),
    body := jsonb_build_object('trigger', 'pg_cron')
  ) as request_id;
  $$
);

-- -----------------------------------------------------------------------------
-- To remove the schedule later:
-- -----------------------------------------------------------------------------
-- select cron.unschedule('andrewos-metrics-daily');

-- -----------------------------------------------------------------------------
-- To inspect scheduled runs / troubleshoot:
-- -----------------------------------------------------------------------------
-- select * from cron.job where jobname = 'andrewos-metrics-daily';
-- select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'andrewos-metrics-daily')
--   order by start_time desc
--   limit 20;
