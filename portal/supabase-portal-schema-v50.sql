-- Apex Advantage — Weekly/Monthly Missions (v50)
--
-- Phase 2 of the habit-layer expansion. Genuinely new infrastructure --
-- unlike XP/streaks/achievements, there is no existing missions concept
-- to extend. Mission requirements are data-driven (a jsonb blob with a
-- `type` + `target`), not hardcoded per-mission frontend logic, so new
-- missions can be authored by an admin without a code change -- but
-- only the requirement types this migration's refresh function
-- actually implements will compute real progress; an unrecognized
-- `type` is skipped rather than guessed at.
--
-- Progress is computed and written only by refresh_mission_progress(),
-- called once per send-lifecycle-emails cron run -- same reasoning as
-- xp_ledger: the client proposes nothing here, it only ever reads.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v49.

create table public.missions (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  cadence         text not null check (cadence in ('weekly', 'monthly', 'seasonal')),
  -- e.g. {"type": "study_days", "target": 5} or {"type": "score_threshold", "target": 90}
  -- Recognized types (see refresh_mission_progress): study_days,
  -- questions_answered, practice_sets_completed, score_threshold.
  requirement     jsonb not null,
  xp_reward       integer not null default 0,
  premium_reward  text,
  starts_on       date not null,
  ends_on         date not null,
  is_premium_only boolean not null default false,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index missions_active_idx on public.missions (starts_on, ends_on);

alter table public.missions enable row level security;

create policy "Anyone can read missions"
  on public.missions for select using (true);

create policy "Admins can manage missions"
  on public.missions for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create table public.member_mission_progress (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  mission_id   uuid not null references public.missions(id) on delete cascade,
  progress     integer not null default 0,
  target       integer not null,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  unique (profile_id, mission_id)
);

alter table public.member_mission_progress enable row level security;

create policy "Members view their own mission progress"
  on public.member_mission_progress for select
  using (auth.uid() = profile_id);

create policy "Admins can view all mission progress"
  on public.member_mission_progress for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- No client insert/update policy — every row is written by
-- refresh_mission_progress() below, which bypasses RLS as a
-- security-definer function.

create or replace function public.refresh_mission_progress()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_profile record;
  v_progress integer;
  v_target integer;
  v_met boolean;
  v_row_id uuid;
  v_was_completed boolean;
begin
  for v_mission in
    select * from public.missions where current_date between starts_on and ends_on
  loop
    for v_profile in
      select id from public.profiles where checkride_prep_unlocked = true
    loop
      v_progress := 0;
      v_target := coalesce((v_mission.requirement->>'target')::integer, 1);

      if v_mission.requirement->>'type' = 'study_days' then
        -- Excludes zero-second frozen/Recovery-Sortie sentinel rows
        -- (v48) -- those preserve a streak but aren't a real study day
        -- for mission-completion purposes.
        select count(distinct activity_date) into v_progress
        from public.portal_study_activity
        where profile_id = v_profile.id
          and activity_date between v_mission.starts_on and v_mission.ends_on
          and seconds > 0;

      elsif v_mission.requirement->>'type' = 'questions_answered' then
        select count(*) into v_progress
        from public.portal_question_progress
        where profile_id = v_profile.id
          and completed = true
          and updated_at::date between v_mission.starts_on and v_mission.ends_on;

      elsif v_mission.requirement->>'type' = 'practice_sets_completed' then
        select count(*) into v_progress
        from public.portal_practice_attempts
        where profile_id = v_profile.id
          and completed_at is not null
          and completed_at::date between v_mission.starts_on and v_mission.ends_on;

      elsif v_mission.requirement->>'type' = 'score_threshold' then
        select exists (
          select 1 from public.portal_practice_attempts
          where profile_id = v_profile.id
            and completed_at is not null
            and completed_at::date between v_mission.starts_on and v_mission.ends_on
            and total > 0
            and (score::float / total) * 100 >= v_target
        ) into v_met;
        v_progress := case when v_met then 1 else 0 end;
        v_target := 1;

      else
        continue; -- unrecognized requirement type — skip, never guess
      end if;

      insert into public.member_mission_progress (profile_id, mission_id, progress, target, updated_at)
      values (v_profile.id, v_mission.id, v_progress, v_target, now())
      on conflict (profile_id, mission_id) do update
        set progress = excluded.progress, target = excluded.target, updated_at = now()
      returning id, (completed_at is not null) into v_row_id, v_was_completed;

      if not v_was_completed and v_progress >= v_target then
        update public.member_mission_progress set completed_at = now() where id = v_row_id;
        perform public.award_xp(v_profile.id, 'mission_completed', v_mission.xp_reward, 'missions', v_mission.id::text);
      end if;
    end loop;
  end loop;
end;
$$;
