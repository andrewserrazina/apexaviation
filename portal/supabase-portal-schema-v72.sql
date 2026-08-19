-- Apex Advantage — New Member Activation admin KPIs (v72)
--
-- get_retention_kpis() (v69.sql) already covers total_students,
-- active_users_7d/30d, activation_rate_24h_pct, and time_to_first_value
-- -- all still valid, general-purpose retention metrics, not touched
-- here. This adds the metrics specific to the new-member ACTIVATION
-- EMAIL sequence itself (create-free-account/index.ts's Email #1,
-- send-lifecycle-emails/index.ts's processNewMemberActivation Emails
-- #2-4): new signups in a window, how many got the welcome email, the
-- welcome CTA click rate, the email-assisted activation rate, and a 7-day
-- activation rate (v69 only has 24h) -- plus activation broken down by
-- training_stage and primary_focus_area (v70.sql), per the activation
-- brief's own explicit ask (section 20).
--
-- "Meaningful activity" is the exact same definition as get_retention_
-- kpis() and processNewMemberActivation's own stop condition -- see
-- v69.sql's header comment for the full reasoning; not repeated here.
--
-- email-assisted: a new signup is counted as "email-assisted" only if
-- their first-ever activation_email_N_clicked event (analytics_events)
-- happened BEFORE their first meaningful-activity timestamp -- i.e. the
-- click plausibly caused the activation, not just happened to occur
-- sometime during an already-active member's history. A profile with no
-- click at all is never counted here, regardless of whether they
-- activated some other way (organic portal use, a different email, etc).
-- Reported alongside a looser sibling metric, welcome_sent_before_
-- activation_rate_pct (sent, not necessarily clicked, before activation)
-- -- these are deliberately two separate numbers, not one blended one, so
-- a reader can't mistake "the email was sent before they activated" for
-- "the email caused it" (weaker claim) vs. "they actually clicked it
-- first" (stronger claim). Neither implies causation on its own; see the
-- hardening-pass audit note below.
--
-- first_activity_at is computed only from activity_events rows that
-- occurred ON OR AFTER the profile's own created_at -- guards against a
-- boundary case a hardening-pass audit specifically asked to be tested:
-- old/historical activity somehow attached to a profile (a data-import
-- artifact, a re-used id, etc.) producing a negative "time to first
-- value" and a false activated_24h=true. Activity strictly before signup
-- can't be this signup's first real value, by definition.
--
-- p_days controls how far back "new signups" looks (default 30) --
-- doesn't affect training_stage/focus_area breakdowns below, which
-- deliberately cover the same window for consistency.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v71.

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
  -- created_at" can never count as first_activity_at -- see the header
  -- comment above.
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
  first_welcome_sent as (
    select profile_id, min(created_at) as first_sent_at
    from public.analytics_events
    where event_name = 'activation_email_1_sent'
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
  welcome_sent as (
    select count(distinct profile_id) as n
    from public.analytics_events
    where event_name = 'activation_email_1_sent' and created_at >= v_window_start
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
    -- activated (no click required) -- most new signups will satisfy
    -- this by default, since Email #1 sends immediately at signup, so a
    -- high number here is expected and does NOT by itself mean the email
    -- drove activation. Kept separate from the click-based rate above
    -- rather than blended into one number, per the hardening-pass audit's
    -- explicit instruction not to imply causation from a send alone.
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
