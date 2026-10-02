-- Abandoned Checkout Recovery Repair (v152)
--
-- Root cause (see ABANDONED_CHECKOUT_RECOVERY_REPAIR_REPORT.md for the
-- full writeup): processAbandonedCheckouts() has exactly one conditional
-- skip in its loop -- `if (profile?.email_marketing_opt_out) continue` --
-- and that skip leaves ZERO trace anywhere: not in the function's own
-- `results` counters, not in any table. A checkout_session_attempts row
-- behind that skip is rediscovered by the SQL eligibility query on every
-- single cron run forever, silently passed over every time, with nothing
-- to distinguish "about to be sent next run" from "permanently stuck."
-- That is the exact shape of the Sep 27/28/30 production defect: the SQL
-- window matched those rows on every run since the day after they were
-- created, the cron itself ran successfully every single day (confirmed
-- via cron.job_run_details), yet recovery_email_sent_at never got set.
--
-- These two columns turn that silent, repeating no-op into a one-time,
-- auditable terminal state -- the same "mark before you decide you're
-- done with this row" philosophy recovery_email_sent_at itself already
-- uses, just extended to the "we looked at this and chose not to send"
-- case the original design never accounted for.
alter table public.checkout_session_attempts
  add column if not exists recovery_suppressed_at timestamptz,
  add column if not exists recovery_suppressed_reason text;

-- Documents the closed set of reasons the repaired processAbandonedCheckouts/
-- processAbandonedCheckoutsFollowup can write here -- not a DB-enforced
-- CHECK constraint, since this list may grow as new suppression signals
-- are added, and a hard constraint would require a migration for every
-- addition. Kept in sync with ABANDONED_CHECKOUT_SUPPRESSION_REASONS in
-- send-lifecycle-emails/index.ts.
comment on column public.checkout_session_attempts.recovery_suppressed_reason is
  'One of: marketing_opt_out, already_entitled, already_entitled_at_send_time, unsupported_purpose, missing_email. Set exactly once, alongside recovery_suppressed_at, the first time a recovery pass decides this attempt should never be emailed -- prevents the same row from being silently re-evaluated (and silently re-skipped) on every future cron run.';

-- Lets the eligibility query and any admin/dry-run report filter out rows
-- already resolved one way or the other in a single index, same as the
-- existing partial pattern this table already uses for recovery_email_sent_at.
create index if not exists idx_checkout_session_attempts_recovery_suppressed
  on public.checkout_session_attempts (recovery_suppressed_at)
  where recovery_suppressed_at is not null;
