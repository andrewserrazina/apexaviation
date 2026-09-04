-- Onboarding/Activation fix + Readiness -> Checkride Prep bridge (v98)
--
-- Two independent fixes, delivered together because both came out of the
-- same audit:
--
-- 1. ROOT CAUSE of "Onboarding Completed" / "First Action Started" always
--    reading 0 in the Marketing & Funnel dashboard's Portal Activation
--    section (get_portal_activation_funnel, v84/v85): five apexTrack()
--    calls inside showWelcomeOnboarding() (site/portal-stable.js) never
--    passed profile_id in their event properties --
--    onboarding_training_goal_saved, onboarding_focus_area_saved,
--    onboarding_completed, first_action_presented, and
--    onboarding_first_training_started. apexTrack() only writes
--    profile_id when the caller explicitly passes it (site/analytics-
--    events.js: `profile_id: props.profile_id || null`) -- it does not
--    look up any signed-in session on its own. get_portal_activation_
--    funnel's `ev` CTE joins strictly on analytics_events.profile_id
--    (no resolve_analytics_identity() fallback, unlike the Readiness/
--    Checkride Prep/Ground School funnels in this same file), so every
--    one of those five events was 100% invisible to it for every member,
--    always -- not a sample-size artifact. onboarding_viewed,
--    first_action_completed, and activation_completed already passed
--    profile_id correctly and were unaffected. Fixed client-side only
--    (site/portal-stable.js) -- no schema change needed for that half;
--    noted here for the record since both fixes shipped in the same pass.
--
-- 2. Readiness Assessment -> Checkride Prep bridge: a brand-new signup
--    from readiness-assessment.html never saw that page's own
--    "Checkride Prep" CTA (renderFullResults() is never shown to a new
--    signup -- they go straight from the gated teaser to account
--    creation, then "check your email"). The only place they'd ever
--    reach the Checkride Prep pitch was via the ?upgrade=checkride-prep
--    deep link on their first real portal login, and until this pass
--    that pitch was the fully generic unlock modal with zero reference
--    to the assessment they'd just taken -- a plausible cause of Account
--    Created (10) -> Prep Clicked (1) being ~10% instead of a real
--    continuation of their diagnosis. enforceUpgradeDeepLink() now looks
--    up that member's own readiness_assessment_leads row and, when one
--    exists, opens the unlock modal with their real score and weakest
--    categories filled in, a single re-labeled CTA ("Train My Weak
--    Areas"), and one free, no-purchase-required action (today's oral
--    exam question) offered before the paid ask. Two new analytics
--    events for this (site/analytics-events.js, ANALYTICS_EVENT_
--    DICTIONARY.md): readiness_checkride_prep_offer_viewed and
--    readiness_free_action_clicked. This migration adds both as
--    supplementary counts on get_readiness_funnel_stats() so their
--    effect on the existing Checkride Prep Clicked -> Purchased
--    conversion is directly observable, without renumbering or adding a
--    step to the existing funnel chart (mirrors how gate_login_completed
--    is already a supplementary stat rather than a numbered funnel row).
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v97.

create or replace function public.get_readiness_funnel_stats(p_start timestamptz default null, p_end timestamptz default null)
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

  with cohort as (
    select distinct public.resolve_analytics_identity(anon_id, profile_id) as uid
    from public.analytics_events
    where event_name = 'readiness_assessment_viewed'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select public.resolve_analytics_identity(anon_id, profile_id) as uid, event_name, properties
    from public.analytics_events
    where event_name in ('readiness_assessment_started', 'readiness_assessment_completed', 'readiness_score_viewed', 'readiness_signup_started', 'readiness_signup_completed', 'readiness_checkride_prep_clicked', 'checkride_prep_upgrade_modal_opened', 'readiness_checkride_prep_offer_viewed', 'readiness_free_action_clicked')
      and public.resolve_analytics_identity(anon_id, profile_id) in (select uid from cohort)
  ),
  prep_purchase as (
    select distinct e.uid
    from ev e
    where e.event_name in ('readiness_checkride_prep_clicked', 'checkride_prep_upgrade_modal_opened')
      and exists (
        select 1 from public.analytics_events pc
        where pc.event_name = 'purchase_completed'
          and pc.properties->>'product' = 'checkride_prep'
          and public.resolve_analytics_identity(pc.anon_id, pc.profile_id) = e.uid
      )
  )
  select jsonb_build_object(
    'viewed', (select count(*) from cohort),
    'started', (select count(distinct uid) from ev where event_name = 'readiness_assessment_started'),
    'completed', (select count(distinct uid) from ev where event_name = 'readiness_assessment_completed'),
    'score_viewed', (select count(distinct uid) from ev where event_name = 'readiness_score_viewed'),
    'signup_started', (select count(distinct uid) from ev where event_name = 'readiness_signup_started'),
    'account_created', (select count(distinct uid) from ev where event_name = 'readiness_signup_completed' and properties->>'mode' = 'signup'),
    'gate_login_completed', (select count(distinct uid) from ev where event_name = 'readiness_signup_completed' and properties->>'mode' = 'login'),
    'checkride_prep_clicked', (select count(distinct uid) from ev where event_name in ('readiness_checkride_prep_clicked', 'checkride_prep_upgrade_modal_opened')),
    'checkride_prep_purchased', (select count(*) from prep_purchase),
    'prep_offer_personalized', (select count(distinct uid) from ev where event_name = 'readiness_checkride_prep_offer_viewed'),
    'prep_free_action_clicked', (select count(distinct uid) from ev where event_name = 'readiness_free_action_clicked')
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_readiness_funnel_stats(timestamptz, timestamptz) to authenticated;
