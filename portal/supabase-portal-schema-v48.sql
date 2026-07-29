-- Apex Advantage — Streak protection: freezes + Recovery Sortie (v48)
--
-- Phase 1 of the habit-layer expansion. Extends the existing streak
-- engine (computeStreaks()/get_member_streak(), portal_study_activity,
-- v47's member_local_date()) rather than replacing it. The trick this
-- migration relies on: a "frozen" or "recovered" day is represented as
-- an ordinary portal_study_activity row with seconds = 0 -- the exact
-- same table the client's computeStreaks() and the server's
-- get_member_streak() already read from -- so both algorithms bridge
-- the gap and keep counting continuously with zero changes to either
-- one. streak_freeze_events is the audit trail that distinguishes a
-- genuinely-studied day from a frozen/recovered one.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v47.

-- ─────────────────────────────────────────────────────────────────
-- 1. Freeze / recovery audit trail
-- ─────────────────────────────────────────────────────────────────
create table public.streak_freeze_events (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  event_type  text not null check (event_type in ('earned', 'consumed', 'recovery_offered', 'recovery_used')),
  event_date  date not null,
  created_at  timestamptz not null default now()
);

create index streak_freeze_events_profile_id_idx on public.streak_freeze_events (profile_id, created_at);

alter table public.streak_freeze_events enable row level security;

create policy "Members view their own streak freeze events"
  on public.streak_freeze_events for select
  using (auth.uid() = profile_id);

create policy "Admins can view all streak freeze events"
  on public.streak_freeze_events for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- No client insert/update/delete policy -- every row is written by
-- run_streak_maintenance() or the Recovery Sortie trigger below, both
-- security-definer and both bypassing RLS entirely.

-- ─────────────────────────────────────────────────────────────────
-- 2. Recovery Sortie offers
-- One-time-per-break: offered when a streak breaks with no freeze
-- available, consumed by completing 3 questions the same
-- (member-local) day it was offered, expiring at the end of that day.
-- ─────────────────────────────────────────────────────────────────
create table public.recovery_sorties (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  missed_date date not null,
  offered_at  timestamptz not null default now(),
  used_at     timestamptz,
  expires_at  timestamptz not null,
  unique (profile_id, missed_date)
);

alter table public.recovery_sorties enable row level security;

create policy "Members view their own recovery sorties"
  on public.recovery_sorties for select
  using (auth.uid() = profile_id);

create policy "Admins can view all recovery sorties"
  on public.recovery_sorties for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 3. run_streak_maintenance() — called once per send-lifecycle-emails
-- cron run (service role only; not exposed to authenticated/anon).
-- For every profile with any study history: banks a freeze every 14
-- unbroken streak days (max 2 banked), then checks whether yesterday
-- (member-local) was missed after a real streak was in progress --
-- if so, auto-consumes a banked freeze, or offers a same-day Recovery
-- Sortie if none is available.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.run_streak_maintenance()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_today date;
  v_yesterday date;
  v_day_before date;
  v_streak record;
  v_studied_yesterday boolean;
  v_studied_day_before boolean;
  v_already_handled boolean;
begin
  for v_profile in
    select id, streak_freezes_banked from public.profiles where last_qualifying_study_date is not null
  loop
    v_today := public.member_local_date(v_profile.id);
    v_yesterday := v_today - 1;
    v_day_before := v_today - 2;

    -- Freeze earning: every 14 days of an unbroken streak, capped at 2
    -- banked, at most one earned event per day so a single cron run
    -- (however it's scheduled) can't double-bank.
    select * into v_streak from public.get_member_streak(v_profile.id);
    if v_streak.current_streak > 0 and v_streak.current_streak % 14 = 0 and v_profile.streak_freezes_banked < 2 then
      if not exists (
        select 1 from public.streak_freeze_events
        where profile_id = v_profile.id and event_type = 'earned' and event_date = v_today
      ) then
        update public.profiles set streak_freezes_banked = streak_freezes_banked + 1 where id = v_profile.id;
        insert into public.streak_freeze_events (profile_id, event_type, event_date) values (v_profile.id, 'earned', v_today);
      end if;
    end if;

    -- Missed-day detection: yesterday has no activity, but the day
    -- before did -- i.e. a real streak just broke on the boundary
    -- between those two days. Skip entirely if this exact gap has
    -- already been handled (freeze consumed, recovery already offered).
    select exists (select 1 from public.portal_study_activity where profile_id = v_profile.id and activity_date = v_yesterday) into v_studied_yesterday;
    select exists (select 1 from public.portal_study_activity where profile_id = v_profile.id and activity_date = v_day_before) into v_studied_day_before;

    if v_studied_day_before and not v_studied_yesterday then
      select exists (
        select 1 from public.streak_freeze_events
        where profile_id = v_profile.id and event_date = v_yesterday and event_type in ('consumed', 'recovery_offered')
      ) into v_already_handled;

      if not v_already_handled then
        if v_profile.streak_freezes_banked > 0 then
          insert into public.portal_study_activity (profile_id, activity_date, seconds)
          values (v_profile.id, v_yesterday, 0)
          on conflict (profile_id, activity_date) do nothing;
          update public.profiles set streak_freezes_banked = streak_freezes_banked - 1 where id = v_profile.id;
          insert into public.streak_freeze_events (profile_id, event_type, event_date) values (v_profile.id, 'consumed', v_yesterday);
        else
          insert into public.recovery_sorties (profile_id, missed_date, expires_at)
          values (v_profile.id, v_yesterday, (v_today + 1)::timestamptz - interval '1 second')
          on conflict (profile_id, missed_date) do nothing;
          insert into public.streak_freeze_events (profile_id, event_type, event_date) values (v_profile.id, 'recovery_offered', v_yesterday);
        end if;
      end if;
    end if;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 4. Recovery Sortie completion — 3 questions completed the same
-- (member-local) day a Recovery Sortie was offered restores the
-- streak by bridging the missed day, same sentinel-row trick as an
-- auto-consumed freeze.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.trg_check_recovery_sortie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sortie record;
  v_today date;
  v_completed_today integer;
begin
  if new.completed is not true or (tg_op = 'UPDATE' and old.completed is true) then
    return new;
  end if;

  select * into v_sortie
  from public.recovery_sorties
  where profile_id = new.profile_id and used_at is null and expires_at > now()
  order by offered_at desc
  limit 1;

  if v_sortie.id is null then
    return new;
  end if;

  v_today := public.member_local_date(new.profile_id);
  select count(*) into v_completed_today
  from public.portal_question_progress
  where profile_id = new.profile_id
    and completed = true
    and updated_at::date = v_today;

  if v_completed_today >= 3 then
    update public.recovery_sorties set used_at = now() where id = v_sortie.id;
    insert into public.portal_study_activity (profile_id, activity_date, seconds)
    values (new.profile_id, v_sortie.missed_date, 0)
    on conflict (profile_id, activity_date) do nothing;
    insert into public.streak_freeze_events (profile_id, event_type, event_date)
    values (new.profile_id, 'recovery_used', v_sortie.missed_date);
  end if;

  return new;
end;
$$;

drop trigger if exists check_recovery_sortie_on_question_progress on public.portal_question_progress;
create trigger check_recovery_sortie_on_question_progress
  after insert or update on public.portal_question_progress
  for each row execute function public.trg_check_recovery_sortie();
