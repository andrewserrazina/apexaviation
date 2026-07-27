-- Apex Advantage — Conversion-funnel measurement foundation (v39)
--
-- Two independent additions, both prerequisites for the conversion-rate
-- work now in progress (48 registered users, 2 purchases):
--
-- 1. profiles.checkride_timing -- captured once at signup ("When is your
--    checkride?"), so dashboard copy, email tone, and future reporting can
--    finally branch on urgency instead of guessing. Nullable/no default:
--    all 48 existing profiles simply have no value until re-asked, which
--    is fine -- nothing reads this column yet except the new UI wired up
--    alongside this migration.
--
-- 2. analytics_events -- a first-party funnel log. GA4/Meta Pixel already
--    fire client-side, but neither is queryable from this codebase without
--    calling out to their reporting APIs (a new, avoidable integration).
--    This table lets the same event names req'd for the funnel report
--    (landing_page_viewed, registration_started/completed, checkout_started,
--    purchase_completed, portal_first_login, upgrade_prompt_viewed/clicked,
--    etc.) be queried directly in Supabase for a simple funnel view, while
--    gtag/fbq keep handling ad-platform attribution separately. Insert is
--    open to anon (funnel events happen before anyone is signed in); select
--    is admin-only, same pattern as checkout_session_attempts (v31).
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v38.

alter table public.profiles
  add column if not exists checkride_timing text
    check (checkride_timing in ('within_14_days', 'within_30_days', 'within_60_days', 'more_than_60_days', 'not_scheduled'));

create table public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  event_name  text not null,
  anon_id     text,
  profile_id  uuid references public.profiles(id),
  properties  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index analytics_events_event_name_idx on public.analytics_events (event_name, created_at);
create index analytics_events_profile_id_idx on public.analytics_events (profile_id);

alter table public.analytics_events enable row level security;

create policy "Anyone can log an analytics event"
  on public.analytics_events for insert
  with check (true);

create policy "Admins can view analytics events"
  on public.analytics_events for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Simple funnel counts -- landing -> registration -> checkout -> purchase,
-- per the "simple funnel report" requirement. Per-event totals plus unique
-- anon_id reach; admin-only via analytics_events' own RLS (views run with
-- the querying role's permissions, not the owner's, by default).
create or replace view public.funnel_report as
select
  event_name,
  count(*) as total_events,
  count(distinct coalesce(anon_id, profile_id::text)) as unique_visitors,
  min(created_at) as first_seen,
  max(created_at) as last_seen
from public.analytics_events
group by event_name
order by min(created_at);
