-- Readiness funnel: surface recovery-assisted conversions (v163)
--
-- get_readiness_funnel_stats() (v85) already gives a dedup-aware,
-- distinct-person funnel for the Readiness Assessment -> Checkride Prep
-- path, using resolve_analytics_identity() the same way every other
-- funnel RPC in this codebase does. The one gap: it has no visibility
-- into checkout_recovered (added by the abandoned-checkout recovery
-- repair, v152/stripe-webhook) -- a real, already-instrumented signal
-- for "this specific purchase happened because a recovery email worked,"
-- not just "a purchase happened." Without it, nobody reviewing this
-- funnel can tell a genuinely-recovered sale apart from an ordinary one.
--
-- Purely additive: same signature, same existing keys unchanged, one new
-- key (recovery_assisted_purchased) computed from data that was already
-- being written, not a new event or a new table. checkout_recovered only
-- ever fires for a completed charge whose own checkout_session_attempts
-- row carries utm_campaign=abandoned_checkout (stripe-webhook/index.ts),
-- so this can never over-count an ordinary purchase as recovery-assisted.
create or replace function public.get_readiness_funnel_stats(p_start timestamptz default null, p_end timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
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
    where event_name in ('readiness_assessment_started', 'readiness_assessment_completed', 'readiness_score_viewed', 'readiness_signup_started', 'readiness_signup_completed', 'readiness_checkride_prep_clicked', 'checkride_prep_upgrade_modal_opened')
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
  ),
  -- New: of this cohort's Checkride Prep purchasers, how many have a
  -- checkout_recovered event for a Checkride Prep purpose attributable
  -- to the same resolved person. A purchaser can appear in prep_purchase
  -- without ever being in recovery_assisted (the ordinary, non-recovery
  -- path) -- recovery_assisted is always a subset of prep_purchase, by
  -- construction, never a separate/overlapping count.
  recovery_assisted as (
    select distinct pp.uid
    from prep_purchase pp
    where exists (
      select 1 from public.analytics_events cr
      where cr.event_name = 'checkout_recovered'
        and cr.properties->>'purpose' in ('unlock-checkride-prep', 'signup-and-unlock-checkride-prep')
        and public.resolve_analytics_identity(cr.anon_id, cr.profile_id) = pp.uid
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
    'recovery_assisted_purchased', (select count(*) from recovery_assisted)
  ) into v_result;

  return v_result;
end;
$$;
