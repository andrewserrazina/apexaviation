-- Apex Advantage — cross-campaign marketing recipient cooldown (v160)
--
-- Stage 5 production incident: the first real run of send-lifecycle-
-- emails confirmed a profile received THREE separate marketing emails
-- (inactivity_7day, new_member_activation_day7, checkride_upsell_day14)
-- within about one second, and a second profile received two
-- (inactivity_7day, checkride_upsell_day30). Each campaign only dedups
-- against ITSELF (its own throttle/milestone/sent_at column) -- nothing
-- previously stopped several independently-eligible campaigns from all
-- firing for the same profile in the same run.
--
-- marketing_recipient_cooldown is a one-row-per-recipient table;
-- claim_marketing_recipient_slot() does a single atomic
-- `insert ... on conflict ... do update ... where` against it -- same
-- reservation-before-send principle as Stage 3's
-- lifecycle_test_reserve_send() (supabase-portal-schema-v159),
-- generalized from one singleton row to one row per recipient email.
-- The ON CONFLICT DO UPDATE's WHERE clause only fires the update (and
-- therefore the RETURNING row) when the existing row's last_sent_at is
-- outside the cooldown window -- Postgres's row-level lock on this one
-- statement is what actually prevents two concurrent callers (or two
-- campaigns in the same run, racing on the same recipient) from both
-- claiming the same slot, not application-level logic. send-lifecycle-
-- emails/index.ts's sendEmail() calls this BEFORE invoking the email
-- provider for every marketing-classified send, so a provider failure
-- or an ambiguous/timed-out outcome still leaves the recipient's slot
-- claimed for the rest of the window -- an immediate retry (manual or
-- from a different campaign later in the same run) is refused the same
-- way a deliberate double-send would be.
--
-- Scoped to exactly the campaigns already gated by
-- email_marketing_opt_out in serve() -- the same existing marketing-
-- vs-transactional split this file already draws (see serve()'s own
-- comment on that split) -- so this does NOT apply to: transactional/
-- relationship messages tied to something the member actually did
-- (first_question_completed, milestones, countdown), abandoned-checkout
-- recovery, Readiness Assessment follow-up, ground-school follow-up,
-- Recovery Sortie notifications, or the exempt mock-oral 24h reminder.
-- Those campaigns' own existing dedup/throttle logic is untouched.
--
-- 24-hour cooldown per Stage 5's explicit instruction ("one marketing
-- email per recipient per 24-hour period, unless a documented existing
-- business rule warrants a different interval") -- no existing
-- documented rule calls for a different interval for this specific
-- cross-campaign guard (INACTIVITY_COORDINATION_GAP_DAYS=10 is a
-- narrower, two-campaign-only, 10-day rule that stays fully intact and
-- unaffected by this addition).
--
-- Deliberately no RLS policies, and explicit revokes from anon/
-- authenticated on both the table and the function below -- the same
-- Stage 3 lesson (a fresh object in the public schema otherwise still
-- carries Supabase's default anon/authenticated grants even after
-- `revoke ... from public`) applied from the start this time instead of
-- being discovered and corrected after the fact.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v159.

create table public.marketing_recipient_cooldown (
  email_lower   text primary key,
  last_sent_at  timestamptz not null
);

alter table public.marketing_recipient_cooldown enable row level security;
revoke all on table public.marketing_recipient_cooldown from anon, authenticated;

create or replace function public.claim_marketing_recipient_slot(p_email text, p_cooldown_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  insert into public.marketing_recipient_cooldown (email_lower, last_sent_at)
  values (lower(trim(p_email)), now())
  on conflict (email_lower) do update
    set last_sent_at = now()
    where public.marketing_recipient_cooldown.last_sent_at <= now() - (p_cooldown_seconds || ' seconds')::interval
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_marketing_recipient_slot(text, integer) from public;
grant execute on function public.claim_marketing_recipient_slot(text, integer) to service_role;
revoke execute on function public.claim_marketing_recipient_slot(text, integer) from anon, authenticated;
