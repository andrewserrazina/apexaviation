-- Apex Advantage — XP Engine foundation (v47)
--
-- Phase 0 of the habit-layer expansion (see product strategy memo).
-- Adds a server-authoritative XP ledger, a Pilot Rank reference table,
-- and the triggers/RPCs that award XP off EXISTING engagement tables
-- (portal_practice_attempts, portal_achievements) rather than inventing
-- a parallel study-tracking system -- Apex already has one (see
-- site/supabase-portal-schema.sql: portal_question_progress,
-- portal_study_activity, portal_practice_attempts, portal_achievements,
-- and the client-side computeStreaks()/computeReadiness() in
-- site/portal-stable.js). This migration hooks into that system instead
-- of duplicating it.
--
-- Client never awards XP directly: xp_ledger has no insert/update/delete
-- policy for authenticated/anon at all. Every row is written by
-- award_xp(), a security-definer function, either from a trigger (fully
-- automatic) or from a security-definer RPC that reads auth.uid()
-- itself rather than trusting a client-supplied profile_id.
--
-- Deferred to a later pass (explicitly NOT built here): the nightly
-- freeze-consumption job, Recovery Sortie, and the Daily Dispatch UI --
-- this migration only lays the columns/functions those will need.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v46.

-- ─────────────────────────────────────────────────────────────────
-- 1. Pilot Rank reference table
-- ─────────────────────────────────────────────────────────────────
create table public.pilot_ranks (
  rank_key    text primary key,
  label       text not null,
  min_xp      integer not null,
  sort_order  integer not null,
  -- Ranks must never imply a real FAA certificate or rating was earned.
  -- Populated for any rank whose label could plausibly be misread that
  -- way; rendered as a small disclaimer wherever the rank is shown.
  disclaimer  text
);

alter table public.pilot_ranks enable row level security;

create policy "Anyone can read rank definitions"
  on public.pilot_ranks for select using (true);

insert into public.pilot_ranks (rank_key, label, min_xp, sort_order, disclaimer) values
  ('student_pilot',       'Student Pilot',       0,     1, null),
  ('pre_solo',             'Pre-Solo',             250,   2, null),
  ('cross_country_pilot',  'Cross-Country Pilot',  750,   3, null),
  ('night_rated',          'Night Rated',          1500,  4, 'Portal rank only — does not represent FAA night currency or an endorsement.'),
  ('instrument_ready',     'Instrument Ready',     2750,  5, 'Portal rank only — does not represent an FAA Instrument Rating.'),
  ('commercial_candidate', 'Commercial Candidate', 4500,  6, 'Portal rank only — does not represent a Commercial Pilot Certificate.'),
  ('checkride_ace',        'Checkride Ace',        7000,  7, null),
  ('apex_captain',         'Apex Captain',         10000, 8, 'Portal rank only — does not represent a Private Pilot Certificate. Real certification requires passing an FAA practical test with a Designated Pilot Examiner.'),
  ('legend',               'Legend',               15000, 9, 'Portal rank only — does not represent any FAA certificate or rating.')
on conflict (rank_key) do nothing;

-- ─────────────────────────────────────────────────────────────────
-- 2. profiles additions
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists total_xp integer not null default 0,
  add column if not exists current_rank text not null default 'student_pilot' references public.pilot_ranks(rank_key),
  add column if not exists timezone text,
  -- Streak-protection columns for the Phase 1 freeze/Recovery Sortie
  -- system -- not wired to any cron job yet, added now so that work is
  -- additive rather than another migration touching this same table.
  add column if not exists streak_freezes_banked integer not null default 0,
  add column if not exists last_qualifying_study_date date;

-- ─────────────────────────────────────────────────────────────────
-- 3. XP ledger — immutable, server-only
-- ─────────────────────────────────────────────────────────────────
create table public.xp_ledger (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  event_type   text not null,
  xp_amount    integer not null,
  source_table text,
  source_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  -- The idempotency guarantee: a given (profile, event type, source row)
  -- can only ever be awarded once. Automatic triggers rely on this to
  -- make duplicate awards structurally impossible, not just unlikely --
  -- re-toggling a practice attempt or achievement can never re-earn XP.
  unique (profile_id, event_type, source_id)
);

create index xp_ledger_profile_id_idx on public.xp_ledger (profile_id, created_at);

alter table public.xp_ledger enable row level security;

create policy "Members view their own XP ledger"
  on public.xp_ledger for select
  using (auth.uid() = profile_id);

create policy "Admins can view all XP ledger entries"
  on public.xp_ledger for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Deliberately no insert/update/delete policy for authenticated or anon.
-- Every row is written by award_xp() below, a security-definer function
-- that bypasses RLS entirely -- the client has no path to award, edit,
-- or erase its own XP.

-- ─────────────────────────────────────────────────────────────────
-- 4. Admin audit log — generic, reusable for any manual admin action
-- ─────────────────────────────────────────────────────────────────
create table public.admin_audit_log (
  id                uuid primary key default gen_random_uuid(),
  admin_id          uuid references public.profiles(id),
  action            text not null,
  target_profile_id uuid references public.profiles(id),
  previous_value    text,
  new_value         text,
  reason            text,
  created_at        timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

create policy "Admins can view the audit log"
  on public.admin_audit_log for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- No client insert policy — rows are written only by security-definer
-- admin RPCs (e.g. admin_award_xp below), which independently verify
-- admin role before writing, so this table can't be forged or tampered
-- with via direct client access either.

-- ─────────────────────────────────────────────────────────────────
-- 5. member_local_date() — timezone-aware "what day is it for them"
-- Falls back to UTC if the member hasn't set a timezone yet (nothing
-- collects one today; profiles.timezone is new in this migration).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.member_local_date(p_profile_id uuid)
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone coalesce(
    (select timezone from public.profiles where id = p_profile_id), 'UTC'
  ))::date
$$;

-- ─────────────────────────────────────────────────────────────────
-- 6. get_member_streak() — current/longest streak from
-- portal_study_activity, same algorithm as the client's
-- computeStreaks() in site/portal-stable.js, but timezone-aware via
-- member_local_date() instead of the browser's local clock.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.get_member_streak(p_profile_id uuid)
returns table (current_streak integer, longest_streak integer, days_studied integer)
language plpgsql
stable
set search_path = public
as $$
declare
  v_today date := public.member_local_date(p_profile_id);
  v_dates date[];
  v_cursor date;
  v_prev date;
  v_run integer := 0;
  v_longest integer := 0;
  v_current integer := 0;
begin
  select array_agg(activity_date order by activity_date) into v_dates
  from public.portal_study_activity
  where profile_id = p_profile_id;

  if v_dates is null then
    return query select 0, 0, 0;
    return;
  end if;

  v_prev := null;
  foreach v_cursor in array v_dates loop
    if v_prev is not null and v_cursor = v_prev + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    if v_run > v_longest then v_longest := v_run; end if;
    v_prev := v_cursor;
  end loop;

  v_cursor := v_today;
  if not (v_cursor = any(v_dates)) then
    v_cursor := v_cursor - 1;
  end if;
  while v_cursor = any(v_dates) loop
    v_current := v_current + 1;
    v_cursor := v_cursor - 1;
  end loop;

  return query select v_current, v_longest, array_length(v_dates, 1);
end;
$$;

grant execute on function public.get_member_streak(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 7. award_xp() — the single source of truth for every XP change.
-- Idempotent via the xp_ledger unique constraint; updates
-- profiles.total_xp and current_rank in the same transaction.
-- Returns true if XP was actually awarded, false if this exact event
-- had already been awarded (safe to call unconditionally from triggers).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.award_xp(
  p_profile_id uuid,
  p_event_type text,
  p_xp_amount integer,
  p_source_table text,
  p_source_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_id uuid;
  v_new_total integer;
  v_new_rank text;
begin
  insert into public.xp_ledger (profile_id, event_type, xp_amount, source_table, source_id, metadata)
  values (p_profile_id, p_event_type, p_xp_amount, p_source_table, p_source_id, p_metadata)
  on conflict (profile_id, event_type, source_id) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return false;
  end if;

  update public.profiles
  set total_xp = total_xp + p_xp_amount
  where id = p_profile_id
  returning total_xp into v_new_total;

  select rank_key into v_new_rank
  from public.pilot_ranks
  where min_xp <= v_new_total
  order by min_xp desc
  limit 1;

  if v_new_rank is not null then
    update public.profiles set current_rank = v_new_rank where id = p_profile_id;
  end if;

  return true;
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 8. Triggers: award XP off existing engagement tables
-- ─────────────────────────────────────────────────────────────────

-- Practice set completed (+25), perfect score (+15 bonus). Fires once
-- per attempt row (insert-already-completed or transition-to-completed
-- both covered), keyed on the attempt's own id so re-saving the same
-- attempt can never double-award.
create or replace function public.trg_award_xp_practice_attempt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
    perform public.award_xp(new.profile_id, 'practice_set_completed', 25, 'portal_practice_attempts', new.id::text);
    if new.total > 0 and new.score = new.total then
      perform public.award_xp(new.profile_id, 'perfect_score_bonus', 15, 'portal_practice_attempts', new.id::text || ':perfect');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists award_xp_on_practice_attempt on public.portal_practice_attempts;
create trigger award_xp_on_practice_attempt
  after insert or update on public.portal_practice_attempts
  for each row execute function public.trg_award_xp_practice_attempt();

-- Achievement earned (+20 flat). Keyed on achievement_key, which is
-- already the table's own uniqueness guarantee (profile_id,
-- achievement_key primary key), so this can only ever fire once per
-- achievement per member regardless.
create or replace function public.trg_award_xp_achievement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_xp(new.profile_id, 'achievement_earned', 20, 'portal_achievements', new.achievement_key);
  return new;
end;
$$;

drop trigger if exists award_xp_on_achievement on public.portal_achievements;
create trigger award_xp_on_achievement
  after insert on public.portal_achievements
  for each row execute function public.trg_award_xp_achievement();

-- ─────────────────────────────────────────────────────────────────
-- 9. log_daily_dispatch_open() — the one XP event with no underlying
-- table write to hook a trigger onto ("opening a screen" isn't a
-- database row). Reads auth.uid() itself rather than accepting a
-- profile_id parameter, so a member can only ever award this to
-- themselves. Idempotent per member-local calendar day.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.log_daily_dispatch_open()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  v_today := to_char(public.member_local_date(auth.uid()), 'YYYY-MM-DD');
  return public.award_xp(auth.uid(), 'daily_login', 5, 'dispatch', v_today);
end;
$$;

grant execute on function public.log_daily_dispatch_open() to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 10. admin_award_xp() — manual award with a required reason, fully
-- auditable. Every call inserts both an xp_ledger row (via award_xp,
-- with a fresh random source_id so repeat manual awards are never
-- deduped against each other -- unlike the automatic triggers, an
-- admin choosing to award twice is intentional) and an admin_audit_log
-- row recording who/what/why.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.admin_award_xp(p_profile_id uuid, p_xp_amount integer, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_awarded boolean;
begin
  if not exists (select 1 from public.profiles where id = v_admin and role = 'admin') then
    raise exception 'Admin access required.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required for manual XP awards.';
  end if;

  v_awarded := public.award_xp(
    p_profile_id, 'admin_manual_award', p_xp_amount, 'admin_audit_log', gen_random_uuid()::text,
    jsonb_build_object('reason', p_reason, 'awarded_by', v_admin)
  );

  insert into public.admin_audit_log (admin_id, action, target_profile_id, previous_value, new_value, reason)
  values (v_admin, 'award_xp', p_profile_id, null, jsonb_build_object('xp_amount', p_xp_amount)::text, p_reason);

  return v_awarded;
end;
$$;

grant execute on function public.admin_award_xp(uuid, integer, text) to authenticated;
