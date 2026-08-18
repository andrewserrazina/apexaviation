-- Apex Advantage — Retention Sprint Tier 1: admin retention KPIs (v69)
--
-- Admin Analytics (portal/src/pages/Analytics.jsx) currently shows revenue,
-- flight hours, and DPE question engagement -- nothing about activation or
-- retention, the actual point of this sprint. This adds one batched RPC
-- (one round trip, matching the "prefer one batched query" performance
-- guidance in the sprint brief) computing the metrics that were missing.
--
-- ── "Meaningful activity" definition (documented per the sprint brief's
--    explicit ask, section 2/17) ──
-- A distinct (profile_id, activity_date) pair, unioned from every table
-- that records the member actually DOING something, not just viewing a
-- page: answering/completing a DPE question (portal_question_progress,
-- answered_count > 0 or completed), completing a scenario
-- (portal_scenario_progress, completed), a practice-set attempt
-- (portal_practice_attempts, any row -- started, not necessarily
-- finished), or an AI DPE Practice session (ai_dpe_sessions, any row).
-- Deliberately NOT reused from computeStreaks()/get_member_streak()'s
-- existing portal_study_activity signal, which is much more lenient
-- (upserts on a mere question view via touchLastViewed(), zero seconds
-- required -- see site/portal-stable.js) and exists for a different
-- purpose (day-to-day streak continuity, where leniency is a deliberate,
-- reasonable product choice). Retention KPIs meant to measure real usage
-- need a stricter bar, so this is a separate, new definition -- not a
-- change to the existing streak logic.
-- NOT included in this pass (documented gap, not silently dropped):
-- Ground School attendance. Attendance data is split across two
-- generations of tables (legacy ground_registrations vs. modern
-- scheduled_ground_class_enrollments -- see GROUND_SCHOOL_RLS_AUDIT.md)
-- with inconsistent attendance-status tracking between them; folding it
-- in accurately is follow-up work, not a quick addition to this query.
--
-- ── Cohort day definition ──
-- signup_date = profiles.created_at::date, in UTC (profiles has no
-- reliable per-member timezone column to convert against for every
-- member -- documented fallback per the sprint brief's guidance in
-- section 5). D1/D7/D30 retention = % of profiles old enough to have
-- reached that day who have a meaningful-activity day exactly
-- signup_date + 1 / +7 / +30. Activation rate and Time to First Value
-- use full timestamps (not day-truncated), since "within 24 hours"
-- needs real precision, not just calendar-day adjacency.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v68.

create or replace function public.get_retention_kpis()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  with activity_events as (
    -- Every meaningful-activity occurrence, one row per event (not yet
    -- deduped to one-per-day) -- occurred_at keeps full timestamp
    -- precision for activation-rate/Time-to-First-Value; activity_date
    -- (derived below) is what D1/D7/D30 key off.
    select profile_id, updated_at as occurred_at
      from public.portal_question_progress
      where answered_count > 0 or completed
    union all
    select profile_id, updated_at
      from public.portal_scenario_progress
      where completed
    union all
    select profile_id, started_at
      from public.portal_practice_attempts
    union all
    select profile_id, started_at
      from public.ai_dpe_sessions
  ),
  activity_days as (
    select distinct profile_id, occurred_at::date as activity_date
    from activity_events
  ),
  first_activity as (
    select profile_id, min(occurred_at) as first_activity_at
    from activity_events
    group by profile_id
  ),
  cohort as (
    select
      p.id as profile_id,
      p.created_at,
      p.created_at::date as signup_date,
      fa.first_activity_at
    from public.profiles p
    left join first_activity fa on fa.profile_id = p.id
    where p.role = 'student'
  ),
  d1 as (
    select
      count(*) filter (where c.signup_date <= (current_date - 1)) as eligible,
      count(*) filter (
        where c.signup_date <= (current_date - 1)
          and exists (select 1 from activity_days ad where ad.profile_id = c.profile_id and ad.activity_date = c.signup_date + 1)
      ) as retained
    from cohort c
  ),
  d7 as (
    select
      count(*) filter (where c.signup_date <= (current_date - 7)) as eligible,
      count(*) filter (
        where c.signup_date <= (current_date - 7)
          and exists (select 1 from activity_days ad where ad.profile_id = c.profile_id and ad.activity_date = c.signup_date + 7)
      ) as retained
    from cohort c
  ),
  d30 as (
    select
      count(*) filter (where c.signup_date <= (current_date - 30)) as eligible,
      count(*) filter (
        where c.signup_date <= (current_date - 30)
          and exists (select 1 from activity_days ad where ad.profile_id = c.profile_id and ad.activity_date = c.signup_date + 30)
      ) as retained
    from cohort c
  ),
  activation as (
    select
      count(*) as total,
      count(*) filter (where c.first_activity_at is not null and c.first_activity_at - c.created_at <= interval '24 hours') as activated_24h
    from cohort c
  ),
  ttfv as (
    select percentile_cont(0.5) within group (order by extract(epoch from (c.first_activity_at - c.created_at)) / 60.0) as median_minutes
    from cohort c
    where c.first_activity_at is not null
  ),
  wau as (
    select distinct profile_id from activity_days where activity_date >= current_date - 6
  ),
  mau as (
    select distinct profile_id from activity_days where activity_date >= current_date - 29
  ),
  questions_7d as (
    select count(distinct (profile_id, question_id)) as n
    from public.portal_question_progress
    where (answered_count > 0 or completed) and updated_at::date >= current_date - 6
  ),
  scenarios_7d as (
    select count(distinct (profile_id, scenario_id)) as n
    from public.portal_scenario_progress
    where completed and updated_at::date >= current_date - 6
  ),
  ai_dpe_7d as (
    select count(*) as n from public.ai_dpe_sessions where started_at::date >= current_date - 6
  ),
  active_days_7d as (
    select count(*) as n from activity_days where activity_date >= current_date - 6
  )
  select jsonb_build_object(
    'computed_at', now(),
    'total_students', (select count(*) from public.profiles where role = 'student'),
    'active_users_7d', (select count(*) from wau),
    'active_users_30d', (select count(*) from mau),
    'activation_rate_24h_pct', case when (select total from activation) > 0
      then round((select activated_24h from activation)::numeric / (select total from activation) * 100, 1) else null end,
    'time_to_first_value_median_minutes', (select round(median_minutes::numeric, 1) from ttfv),
    'd1_retention_pct', case when (select eligible from d1) > 0
      then round((select retained from d1)::numeric / (select eligible from d1) * 100, 1) else null end,
    'd1_retention_eligible_cohort_size', (select eligible from d1),
    'd7_retention_pct', case when (select eligible from d7) > 0
      then round((select retained from d7)::numeric / (select eligible from d7) * 100, 1) else null end,
    'd7_retention_eligible_cohort_size', (select eligible from d7),
    'd30_retention_pct', case when (select eligible from d30) > 0
      then round((select retained from d30)::numeric / (select eligible from d30) * 100, 1) else null end,
    'd30_retention_eligible_cohort_size', (select eligible from d30),
    'questions_per_active_user_7d', case when (select count(*) from wau) > 0
      then round((select n from questions_7d)::numeric / (select count(*) from wau), 1) else null end,
    'scenarios_per_active_user_7d', case when (select count(*) from wau) > 0
      then round((select n from scenarios_7d)::numeric / (select count(*) from wau), 1) else null end,
    'ai_dpe_sessions_per_active_user_7d', case when (select count(*) from wau) > 0
      then round((select n from ai_dpe_7d)::numeric / (select count(*) from wau), 1) else null end,
    'avg_active_days_per_wau_7d', case when (select count(*) from wau) > 0
      then round((select n from active_days_7d)::numeric / (select count(*) from wau), 1) else null end
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_retention_kpis() to authenticated;
