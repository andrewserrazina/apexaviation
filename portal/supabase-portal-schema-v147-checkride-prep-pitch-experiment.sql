-- Apex Advantage — Checkride Prep Personalized Pitch A/B Test
-- Follow-up to the Revenue Funnel + Attribution Integrity sprint (v146),
-- which recommended testing whether showing the existing weak-area
-- personalized pitch more consistently (previously: shown to 100% of
-- eligible members, every time) actually improves modal-open ->
-- checkout-started conversion versus today's generic pitch.
--
-- No schema changes. The experiment rides entirely on the existing
-- analytics_events.properties jsonb column -- site/portal-stable.js now
-- optionally attaches { experiment: 'checkride_prep_personalized_pitch_v1',
-- variant: 'control' | 'personalized' } to checkride_prep_offer_viewed,
-- readiness_checkride_prep_offer_viewed, checkout_started,
-- checkout_session_create_failed, and purchase_completed, for members who
-- are actually part of the experiment population (see that file's
-- experimentVariant()/openUnlockModal() for the exact eligibility rule).
-- This migration adds exactly one new, read-only, admin-gated reporting
-- RPC on top of that -- nothing here can affect checkout, entitlement, or
-- pricing in any way.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v146.

-- get_checkride_prep_pitch_experiment_stats(): per-variant funnel for the
-- experiment population only (rows tagged with this exact experiment
-- key) -- offer views, checkout starts, purchases, revenue, and the two
-- conversion rates the experiment brief asks about (primary: offer ->
-- checkout; secondary: offer -> purchase). Same
-- resolve_analytics_identity()-based anon/authenticated stitching every
-- other funnel RPC in this codebase already uses, and the same
-- is_admin()-gated, SECURITY DEFINER, search_path-pinned shape as
-- get_checkride_prep_funnel_stats()/get_revenue_funnel_by_campaign().
create or replace function public.get_checkride_prep_pitch_experiment_stats(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table (
  variant text,
  offer_views bigint,
  checkout_started bigint,
  purchases bigint,
  revenue numeric,
  offer_to_checkout_rate_pct numeric,
  offer_to_purchase_rate_pct numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  return query
  with ev as (
    select
      public.resolve_analytics_identity(ae.anon_id, ae.profile_id) as uid,
      ae.event_name,
      ae.properties->>'variant' as variant,
      (ae.properties->>'price')::numeric as price
    from public.analytics_events ae
    where ae.properties->>'experiment' = 'checkride_prep_personalized_pitch_v1'
      and ae.event_name in ('checkride_prep_offer_viewed', 'checkout_started', 'purchase_completed')
      and (p_start is null or ae.created_at >= p_start)
      and (p_end is null or ae.created_at < p_end)
  )
  select
    e.variant,
    count(distinct e.uid) filter (where e.event_name = 'checkride_prep_offer_viewed') as offer_views,
    count(distinct e.uid) filter (where e.event_name = 'checkout_started') as checkout_started,
    count(distinct e.uid) filter (where e.event_name = 'purchase_completed') as purchases,
    coalesce(sum(e.price) filter (where e.event_name = 'purchase_completed'), 0) as revenue,
    case when count(distinct e.uid) filter (where e.event_name = 'checkride_prep_offer_viewed') > 0
      then round(100.0 * count(distinct e.uid) filter (where e.event_name = 'checkout_started')
        / count(distinct e.uid) filter (where e.event_name = 'checkride_prep_offer_viewed'), 2)
      else null end as offer_to_checkout_rate_pct,
    case when count(distinct e.uid) filter (where e.event_name = 'checkride_prep_offer_viewed') > 0
      then round(100.0 * count(distinct e.uid) filter (where e.event_name = 'purchase_completed')
        / count(distinct e.uid) filter (where e.event_name = 'checkride_prep_offer_viewed'), 2)
      else null end as offer_to_purchase_rate_pct
  from ev e
  group by e.variant
  order by e.variant;
end;
$$;

grant execute on function public.get_checkride_prep_pitch_experiment_stats(timestamptz, timestamptz) to authenticated;
