-- Apex Advantage — Fix duplicate one-time milestone emails (v87)
--
-- Root cause: portal-stable.js's checkLifecycleMilestones() gates every
-- one-time milestone email (first_question_completed, readiness_25/50/
-- 75/90, checkride_mode_completed_email, checkride_passed) on an
-- in-memory flag (loggedEventTypes) hydrated once per page load from a
-- SELECT against portal_events, then "claims" it with a fire-and-forget
-- INSERT into the same table that's never awaited or checked for
-- success. If that INSERT doesn't survive -- a dropped connection, the
-- tab/app backgrounded mid-request, anything -- the row never lands, so
-- the next page load's SELECT sees nothing and fires the same
-- congratulatory email again. A member who opens the portal a few times
-- in an evening can end up with several copies of "You completed your
-- first question" within the hour. This is the exact class of bug
-- already fixed for portal_first_login via an atomic server-side claim
-- (v83) -- extended here to the milestone emails, which never got the
-- same treatment. send-lifecycle-emails' daily reconciliation job
-- (processMilestones) has the equivalent non-atomic gap on its own
-- hasMilestoneFired/markMilestoneSent check-then-write.
--
-- portal_events itself can't take a blanket unique constraint -- several
-- event types logged there (ground_school_calendar_viewed,
-- mock_oral_requested_%, etc.) are legitimately written every time they
-- happen, not once ever. This is a narrow, dedicated table just for the
-- "have we already sent this one-time email" question, backed by a
-- primary key so the claim is atomic regardless of who's asking (the
-- client via the RPC below, or the cron via a direct insert using its
-- service-role connection, which bypasses RLS entirely).

create table if not exists public.portal_milestone_emails (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  milestone_key text not null,
  sent_at timestamptz not null default now(),
  primary key (profile_id, milestone_key)
);

alter table public.portal_milestone_emails enable row level security;

drop policy if exists "Users can view their own milestone email claims" on public.portal_milestone_emails;
create policy "Users can view their own milestone email claims"
  on public.portal_milestone_emails for select
  using (auth.uid() = profile_id);

-- Backfill from whatever portal_events history already exists for these
-- exact milestones, so a member who was already sent one of these
-- doesn't get one more duplicate the first time they reload after this
-- ships. Collapses any existing duplicate rows (the very bug this
-- migration fixes) down to one claim per profile/milestone via
-- min(created_at).
insert into public.portal_milestone_emails (profile_id, milestone_key, sent_at)
select profile_id, event_type, min(created_at)
from public.portal_events
where event_type in (
  'first_question_completed', 'readiness_25', 'readiness_50', 'readiness_75', 'readiness_90',
  'checkride_mode_completed_email', 'checkride_passed'
)
and profile_id is not null
group by profile_id, event_type
on conflict (profile_id, milestone_key) do nothing;

create or replace function public.claim_milestone_email(p_profile_id uuid, p_milestone_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if auth.uid() is null or auth.uid() <> p_profile_id then
    raise exception 'Not authorized to claim a milestone email for this profile';
  end if;

  -- The whole point: one INSERT ... ON CONFLICT, gated by the primary
  -- key above, so Postgres guarantees at most one caller ever sees this
  -- return true for a given (profile_id, milestone_key) -- across every
  -- tab, device, and page load, forever.
  insert into public.portal_milestone_emails (profile_id, milestone_key)
  values (p_profile_id, p_milestone_key)
  on conflict (profile_id, milestone_key) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function public.claim_milestone_email(uuid, text) to authenticated;
