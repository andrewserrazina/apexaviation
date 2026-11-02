-- One-time backlog reconciliation for abandoned Checkride Prep checkouts
-- that predate the v152 recovery repair's live window (v162)
--
-- v152 (deployed Oct 19) made the abandoned-checkout cron honest about
-- rows it chooses not to send, by writing recovery_suppressed_at/
-- recovery_suppressed_reason instead of silently skipping them forever.
-- But processAbandonedCheckouts() only ever evaluates rows between 1
-- hour and ABANDONED_CHECKOUT_MAX_DAYS (7) old. By the time v152 shipped,
-- every Checkride Prep checkout_session_attempts row created before
-- roughly Oct 12 had already aged past that 7-day window -- the cron's
-- own SELECT will never see them again, and they will sit forever with
-- recovery_email_sent_at IS NULL AND recovery_suppressed_at IS NULL: not
-- "about to be processed," genuinely unreachable, with zero audit trail
-- either way. Confirmed via direct production query (Nov 2026 audit):
-- 17 Checkride Prep rows match this exact shape, ranging 33-107 days
-- old, all with a real email on file.
--
-- Per explicit instruction, this is a one-time, read-and-decide
-- reconciliation pass over that pre-existing backlog -- it sends no
-- emails, grants no entitlement, and never touches a row the live cron
-- can still legitimately reach on its own. It applies the exact same
-- precedence decideAbandonedCheckoutAction() (send-lifecycle-emails/
-- index.ts) already uses for every future row: marketing opt-out first,
-- then already-entitled, and only once neither applies does a row get
-- the new, backfill-only reason below -- "this checkout was
-- legitimately abandoned and nobody ever evaluated it before it aged
-- out," which is simply true and auditable, not an invented excuse.
--
-- Idempotent: re-running this is a no-op, since every row it can match
-- already has recovery_suppressed_at set after the first run.
with backlog as (
  select
    csa.id,
    coalesce(p.email_marketing_opt_out, false) as opted_out,
    coalesce(p.checkride_prep_unlocked, false) as unlocked
  from public.checkout_session_attempts csa
  left join public.profiles p on p.id = csa.profile_id
  where csa.purpose in ('unlock-checkride-prep', 'signup-and-unlock-checkride-prep')
    and csa.completed_at is null
    and csa.recovery_email_sent_at is null
    and csa.recovery_suppressed_at is null
    and csa.created_at < now() - interval '7 days'
)
update public.checkout_session_attempts csa
set
  recovery_suppressed_at = now(),
  recovery_suppressed_reason = case
    when backlog.opted_out then 'marketing_opt_out'
    when backlog.unlocked then 'already_entitled'
    else 'backlog_window_expired_unprocessed'
  end
from backlog
where csa.id = backlog.id;
