-- Apex Advantage — fix get_activation_email_kpis() undercounting welcome
-- sends (v81)
--
-- get_activation_email_kpis() (v72.sql) counted "welcome_email_sent" from
-- analytics_events.activation_email_1_sent -- but create-free-account/
-- index.ts only ever wrote that row for the generic (dest-less) signup
-- copy, deliberately skipping it for the lead-magnet variant (the "Welcome
-- to Apex Advantage — set your password" subject, sent when a signup
-- arrives with a ?dest= from checkride-prep.html, the Ground School
-- landing page, etc.). Since most real signups arrive via a lead-magnet
-- dest, this meant the dashboard's "Welcome Email Sent" number reflected
-- only a small minority of actual sends next to a "New Signups" count that
-- includes everyone -- e.g. 1 of 80 in a real 30-day window, looking like
-- a near-total delivery failure when the emails were in fact going out
-- fine.
--
-- create-free-account/index.ts has been fixed (this same change) to log
-- activation_email_1_sent unconditionally going forward. But portal_
-- email_log(email_type = 'activation_email_1') was ALREADY being written
-- unconditionally for both signup paths the whole time (see that file's
-- own portal_email_log insert, outside the old analytics_events gate) --
-- so re-pointing this function's "sent" side at portal_email_log instead
-- fixes the count immediately and retroactively, with no need to wait for
-- new signups to accumulate under the corrected event-logging code.
--
-- "Clicked" stays sourced from analytics_events.activation_email_1_clicked
-- -- there's no service-side equivalent for a client-side link click, and
-- there never will be. One real, unavoidable limitation this leaves: any
-- signup whose welcome email went out before the create-free-account fix
-- shipped had no tracking UTMs on its lead-magnet-path action link at all,
-- so its click can never be attributed after the fact — click-based rates
-- only become meaningful for signups from this fix forward. Sent-based
-- rates (email_sent_before_activation_rate_pct) are unaffected by that
-- limitation, since they're driven entirely by the now-complete portal_
-- email_log data.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v80.

create or replace function public.get_activation_email_kpis(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
  v_window_start timestamptz := now() - (p_days || ' days')::interval;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  with cohort as (
    select id as profile_id, created_at, training_stage, primary_focus_area
    from public.profiles
    where created_at >= v_window_start
  ),
  activity_events as (
    select profile_id, updated_at as occurred_at from public.portal_question_progress where answered_count > 0 or completed
    union all
    select profile_id, updated_at from public.portal_scenario_progress where completed
    union all
    select profile_id, started_at from public.portal_practice_attempts
    union all
    select profile_id, started_at from public.ai_dpe_sessions
  ),
  -- Joined against cohort so "activity before this profile's own
  -- created_at" can never count as first_activity_at -- guards against a
  -- boundary case a hardening-pass audit specifically asked to be tested:
  -- old/historical activity somehow attached to a profile (a data-import
  -- artifact, a re-used id, etc.) producing a negative "time to first
  -- value" and a false activated_24h=true.
  first_activity as (
    select ae.profile_id, min(ae.occurred_at) as first_activity_at
    from activity_events ae
    join cohort c on c.profile_id = ae.profile_id
    where ae.occurred_at >= c.created_at
    group by ae.profile_id
  ),
  first_click as (
    select profile_id, min(created_at) as first_click_at
    from public.analytics_events
    where event_name in ('activation_email_1_clicked', 'activation_email_2_clicked', 'activation_email_3_clicked', 'activation_email_4_clicked')
    group by profile_id
  ),
  -- Fixed: was analytics_events.activation_email_1_sent (incomplete --
  -- see header comment). portal_email_log's 'activation_email_1' row is
  -- written unconditionally by both the synchronous signup path and the
  -- cron catch-up path, for every signup regardless of dest.
  first_welcome_sent as (
    select profile_id, min(sent_at) as first_sent_at
    from public.portal_email_log
    where email_type = 'activation_email_1'
    group by profile_id
  ),
  cohort_stats as (
    select
      c.profile_id, c.created_at, c.training_stage, c.primary_focus_area,
      fa.first_activity_at,
      fc.first_click_at,
      fs.first_sent_at,
      (fa.first_activity_at is not null) as activated,
      (fa.first_activity_at is not null and fa.first_activity_at - c.created_at <= interval '24 hours') as activated_24h,
      (fa.first_activity_at is not null and fa.first_activity_at - c.created_at <= interval '7 days') as activated_7d,
      (fc.first_click_at is not null and fa.first_activity_at is not null and fc.first_click_at <= fa.first_activity_at) as email_clicked_before_activation,
      (fs.first_sent_at is not null and fa.first_activity_at is not null and fs.first_sent_at <= fa.first_activity_at) as email_sent_before_activation
    from cohort c
    left join first_activity fa on fa.profile_id = c.profile_id
    left join first_click fc on fc.profile_id = c.profile_id
    left join first_welcome_sent fs on fs.profile_id = c.profile_id
  ),
  -- Fixed: was analytics_events.activation_email_1_sent (see above).
  welcome_sent as (
    select count(distinct profile_id) as n
    from public.portal_email_log
    where email_type = 'activation_email_1' and sent_at >= v_window_start
  ),
  welcome_clicked as (
    select count(distinct profile_id) as n
    from public.analytics_events
    where event_name = 'activation_email_1_clicked' and created_at >= v_window_start
  ),
  stage_breakdown as (
    select coalesce(training_stage, 'not_set') as training_stage,
      count(*) as total,
      count(*) filter (where activated) as activated
    from cohort_stats
    group by coalesce(training_stage, 'not_set')
  ),
  focus_breakdown as (
    select coalesce(primary_focus_area, 'not_set') as focus_area,
      count(*) as total,
      count(*) filter (where activated) as activated
    from cohort_stats
    group by coalesce(primary_focus_area, 'not_set')
  )
  select jsonb_build_object(
    'computed_at', now(),
    'window_days', p_days,
    'new_signups', (select count(*) from cohort),
    'welcome_email_sent', (select n from welcome_sent),
    'welcome_cta_click_rate_pct', case when (select n from welcome_sent) > 0
      then round((select n from welcome_clicked)::numeric / (select n from welcome_sent) * 100, 1) else null end,
    'activation_rate_24h_pct', case when (select count(*) from cohort_stats) > 0
      then round((select count(*) filter (where activated_24h) from cohort_stats)::numeric / (select count(*) from cohort_stats) * 100, 1) else null end,
    'activation_rate_7d_pct', case when (select count(*) from cohort_stats) > 0
      then round((select count(*) filter (where activated_7d) from cohort_stats)::numeric / (select count(*) from cohort_stats) * 100, 1) else null end,
    -- The stronger, causally-suggestive claim: they clicked an activation
    -- email before their first meaningful activity.
    'email_clicked_before_activation_rate_pct', case when (select count(*) filter (where activated) from cohort_stats) > 0
      then round((select count(*) filter (where email_clicked_before_activation) from cohort_stats)::numeric / (select count(*) filter (where activated) from cohort_stats) * 100, 1) else null end,
    -- The weaker claim: the welcome email was merely sent before they
    -- activated (no click required) -- most activated members will satisfy
    -- this by default, since Email #1 sends immediately at signup (now
    -- reliably logged to portal_email_log regardless of signup path, see
    -- header comment), so a high number here is expected and does NOT by
    -- itself mean the email drove activation. Kept separate from the
    -- click-based rate above rather than blended into one number, so a
    -- reader can't mistake "sent before" for "caused it."
    'email_sent_before_activation_rate_pct', case when (select count(*) filter (where activated) from cohort_stats) > 0
      then round((select count(*) filter (where email_sent_before_activation) from cohort_stats)::numeric / (select count(*) filter (where activated) from cohort_stats) * 100, 1) else null end,
    'activation_by_training_stage', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'training_stage', training_stage, 'total', total, 'activated', activated,
        'activation_rate_pct', case when total > 0 then round(activated::numeric / total * 100, 1) else null end
      ) order by total desc), '[]'::jsonb)
      from stage_breakdown
    ),
    'activation_by_focus_area', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'focus_area', focus_area, 'total', total, 'activated', activated,
        'activation_rate_pct', case when total > 0 then round(activated::numeric / total * 100, 1) else null end
      ) order by total desc), '[]'::jsonb)
      from focus_breakdown
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_activation_email_kpis(integer) to authenticated;
