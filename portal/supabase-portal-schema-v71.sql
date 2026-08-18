-- Apex Advantage — Retention Sprint Tier 3: daily-cadence Missions (v71)
--
-- 1. Allows 'daily' as a missions.cadence value -- previously only
--    'weekly' | 'monthly' | 'seasonal' (v50.sql). Relies on Postgres's
--    default check-constraint naming for an inline column check
--    (<table>_<column>_check) -- the same assumption already used
--    successfully elsewhere in this schema (see
--    supabase-portal-schema-v43.sql's
--    portal_access_purchases_tier_check drop/recreate).
--
-- 2. Adds a new 'meaningful_activity' requirement type to
--    refresh_mission_progress() -- broader than the existing
--    'questions_answered' type (which requires the strict "Mark as
--    Studied" flag): also counts answering/revealing a question,
--    completing a scenario, a practice-set attempt, or an AI DPE
--    session. Same activity definition as get_retention_kpis()
--    (v69.sql) and the reactivation/weekly-progress emails
--    (send-lifecycle-emails/index.ts), so "meaningful activity" means
--    the same thing everywhere in this codebase, not three slightly
--    different things. Meant for a Daily-cadence mission like
--    "Complete today's DPE question" (target 1, starts_on = ends_on =
--    that day).
--
-- Deliberately NOT changed: refresh_mission_progress()'s outer loop
-- still only computes progress for checkride_prep_unlocked = true
-- profiles. Missions remain a premium-only gamification layer, same as
-- before this migration -- QOTD itself (now free for everyone, Tier 1)
-- is the free-member daily-habit mechanic; Missions is a separate,
-- deliberately premium reward system layered on top, not something this
-- pass extends to free members. A genuinely recurring daily mission
-- (auto-created fresh every day) also isn't built here -- an admin (or a
-- future scheduled job, not built) still creates each day's mission row
-- -- see Missions.jsx's admin-facing note on this.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v70.

alter table public.missions drop constraint if exists missions_cadence_check;
alter table public.missions add constraint missions_cadence_check
  check (cadence in ('daily', 'weekly', 'monthly', 'seasonal'));

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

      elsif v_mission.requirement->>'type' = 'meaningful_activity' then
        select count(*) into v_progress
        from (
          select 1 from public.portal_question_progress
            where profile_id = v_profile.id
              and (answered_count > 0 or completed)
              and updated_at::date between v_mission.starts_on and v_mission.ends_on
          union all
          select 1 from public.portal_scenario_progress
            where profile_id = v_profile.id
              and completed
              and updated_at::date between v_mission.starts_on and v_mission.ends_on
          union all
          select 1 from public.portal_practice_attempts
            where profile_id = v_profile.id
              and started_at::date between v_mission.starts_on and v_mission.ends_on
          union all
          select 1 from public.ai_dpe_sessions
            where profile_id = v_profile.id
              and started_at::date between v_mission.starts_on and v_mission.ends_on
        ) activity;

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
