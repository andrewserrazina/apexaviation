-- Apex Advantage — Generic once-per-day UI view claim (v123)
--
-- Root cause (Sprint 1 dashboard audit): onboarding_viewed
-- (maybeShowWelcomeOnboarding(), site/portal-stable.js) fires with no
-- server-side dedup at all -- only an in-memory onboardingShownThisLoad
-- flag that resets on every page load/tab/reload. This is deliberate for
-- the UI itself (the onboarding card must keep re-prompting a member who
-- hasn't set training_stage yet, across sessions, until they actually
-- answer -- see that function's own header comment), but it means the
-- analytics event has no upper bound per profile, which is the "noisy"
-- behavior this migration fixes -- capping the EVENT to at most once per
-- calendar day per profile, without touching the onboarding UI's own
-- re-prompt behavior at all.
--
-- Deliberately NOT reusing claim_milestone_email()/portal_milestone_emails
-- (v87) for this: that table is genuinely email-delivery-specific (its
-- backfill reads real email-send event types, and send-lifecycle-emails'
-- own daily reconciliation job reads/writes it directly) -- overloading
-- it with a non-email UI-analytics key would pollute a real "have we
-- sent this email" audit ledger. This is a new, narrow, dedicated
-- primitive instead, following the exact same proven shape as
-- claim_first_portal_login (v83) and claim_milestone_email (v87): one
-- small table, one SECURITY DEFINER function doing a single
-- INSERT ... ON CONFLICT DO NOTHING, auth.uid() checked against the
-- profile being claimed for. Generic enough (profile_id + claim_key +
-- claim_date) to be reused for any future "show this at most once per
-- day" UI event without another migration.

create table if not exists public.portal_daily_view_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  claim_key text not null,
  claim_date date not null,
  claimed_at timestamptz not null default now(),
  primary key (profile_id, claim_key, claim_date)
);

alter table public.portal_daily_view_claims enable row level security;

drop policy if exists "Users can view their own daily view claims" on public.portal_daily_view_claims;
create policy "Users can view their own daily view claims"
  on public.portal_daily_view_claims for select
  using (auth.uid() = profile_id);

create or replace function public.claim_daily_view(p_profile_id uuid, p_claim_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if auth.uid() is null or auth.uid() <> p_profile_id then
    raise exception 'Not authorized to claim a daily view for this profile';
  end if;

  insert into public.portal_daily_view_claims (profile_id, claim_key, claim_date)
  values (p_profile_id, p_claim_key, (now() at time zone 'utc')::date)
  on conflict (profile_id, claim_key, claim_date) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function public.claim_daily_view(uuid, text) to authenticated;
