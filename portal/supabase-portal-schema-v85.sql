-- Apex Advantage — Funnel Coherence Audit + Fixes (v85)
--
-- Fixes three confirmed, code-traced problems in the v83 Marketing &
-- Funnel dashboard. None of these are optimization-for-better-numbers --
-- see the comment on each fix for exactly what was wrong and why.
--
-- 1. EXECUTIVE FUNNEL >100% CONVERSION. get_marketing_executive_funnel()
--    treated Purchase Completed -> Portal Activated -> First Training
--    Started as one linear continuation of Landing -> Registration ->
--    Checkout -> Purchase. That's wrong: Apex Advantage is free to join,
--    activate, and train in without ever purchasing anything, so
--    "Portal Activated" is NOT downstream of "Purchase Completed" --
--    most activated members never purchased at all, which is exactly
--    why a 1-purchase / 5-activated cohort produced "500% conversion."
--    Split into two independent funnels below: ACQUISITION/ACTIVATION
--    (landing -> registration -> activation -> first training, no
--    purchase step) and MONETIZATION (landing -> checkout -> purchase).
--    Both share the same landing_visitors cohort as their entry point
--    (matching the "Landing Visitors or Registered Users" framing) but
--    are computed and reported as separate sequences, never chained.
--
-- 2. IDENTITY STITCHING. analytics_events rows use coalesce(anon_id,
--    profile_id::text) for "who is this." anon_id is written by
--    anonId() (site/analytics-events.js) on every single event,
--    including fully-authenticated ones -- so in practice anon_id ALWAYS
--    wins that coalesce, and profile_id was never actually reachable
--    through it. That was survivable as long as anon_id itself stayed
--    consistent across a visitor's whole journey -- but readiness-
--    assessment.html/checkride-prep.html/etc. are served from
--    apexaviationtx.com while the portal is on
--    advantage.apexaviationtx.com, a DIFFERENT origin for localStorage
--    (where anon_id used to live exclusively). Every visitor whose
--    journey crossed that boundary got a brand-new, disconnected anon_id
--    the moment they reached the portal -- explaining why, e.g., the
--    Readiness funnel and Executive funnel disagreed on the same
--    people. Fixed client-side (analytics-events.js) by moving anon_id
--    to a cookie scoped to the shared .apexaviationtx.com parent domain.
--    analytics_identity_map + link_analytics_identity() below handle the
--    authenticated side: the first time a profile is ever seen with a
--    given anon_id, that pairing is recorded durably, so funnel RPCs can
--    resolve a visitor's earlier anonymous activity to their eventual
--    profile even for events that predate this cookie fix (as long as
--    they're on the SAME anon_id the member's browser already had).
--    This does NOT retroactively fix identities for anon_ids that were
--    already disconnected across the origin boundary before this
--    shipped -- that history is genuinely unrecoverable, not fabricated.
--
-- 3. READINESS -> CHECKRIDE PREP CLICKED = 0. Traced to
--    site/readiness-assessment.html: the tracked CTA (raCheckridePrepCta)
--    only ever renders inside renderFullResults(), which is reached
--    from the LOGIN path (an existing member re-authenticating) but NOT
--    from the SIGNUP path (a brand-new visitor creating an account) --
--    that path calls renderSignupPending() instead ("check your email"),
--    and the CTA is never shown to them at all. Since new signups are
--    the overwhelmingly dominant path for a cold lead-magnet funnel, 0
--    real clicks from that population is genuine, not a tracking bug --
--    see the code-side fix in readiness-assessment.html/portal-reset-
--    password.html (dest=checkride-prep now routes through the real,
--    already-instrumented ?upgrade=checkride-prep deep link instead of a
--    bare, untracked #hash). get_readiness_funnel_stats() below counts
--    EITHER readiness_checkride_prep_clicked (login path) OR
--    checkride_prep_upgrade_modal_opened (signup path, once resolved
--    through the same identity) as "reached the Checkride Prep CTA," so
--    the funnel reflects both real paths honestly rather than only the
--    one that happened to have direct instrumentation before this pass.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v84.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Identity stitching: durable anon_id -> profile_id mapping
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.analytics_identity_map (
  anon_id text primary key,
  profile_id uuid not null references public.profiles(id),
  linked_at timestamptz not null default now()
);

create index if not exists analytics_identity_map_profile_id_idx on public.analytics_identity_map (profile_id);

alter table public.analytics_identity_map enable row level security;

create policy "Admins can view identity map"
  on public.analytics_identity_map for select
  using (public.is_admin(auth.uid()));

comment on table public.analytics_identity_map is
  'Records the first time each anon_id (site/analytics-events.js) is ever seen from an authenticated session, so funnel RPCs can resolve that visitor''s earlier anonymous analytics_events rows to their real profile. Written only via link_analytics_identity(). If a given anon_id was already linked to a different profile (e.g. a shared device), the first link wins and later attempts are silently ignored -- see that function.';

create or replace function public.link_analytics_identity(p_anon_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_anon_id is null or length(p_anon_id) = 0 or length(p_anon_id) > 200 then
    return;
  end if;

  insert into public.analytics_identity_map (anon_id, profile_id)
  values (p_anon_id, auth.uid())
  on conflict (anon_id) do nothing;
end;
$$;

grant execute on function public.link_analytics_identity(text) to authenticated;

-- Single source of truth for "who is this" from here on -- every funnel
-- RPC below uses this instead of a raw coalesce(anon_id, profile_id::text).
-- Priority: the row's own profile_id (already fully authenticated) wins
-- outright; otherwise, if this anon_id has ever been linked to a profile
-- (analytics_identity_map), resolve to that profile; otherwise stay
-- anonymous (the raw anon_id). This is the opposite priority from the
-- old raw coalesce(anon_id, profile_id::text), which -- because anon_id
-- is populated on every event, authenticated or not -- meant anon_id
-- ALWAYS won and profile_id was never actually reachable through it.
create or replace function public.resolve_analytics_identity(p_anon_id text, p_profile_id uuid)
returns text
language sql
stable
as $$
  select coalesce(
    p_profile_id::text,
    (select m.profile_id::text from public.analytics_identity_map m where m.anon_id = p_anon_id),
    p_anon_id
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Executive Funnel: split into two independent, valid sequences
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.get_marketing_executive_funnel(p_start timestamptz default null, p_end timestamptz default null)
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
    where event_name = 'landing_page_viewed'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select public.resolve_analytics_identity(anon_id, profile_id) as uid, event_name
    from public.analytics_events
    where event_name in ('registration_started', 'registration_completed', 'portal_first_login', 'first_lesson_started', 'checkout_started', 'purchase_completed')
      and public.resolve_analytics_identity(anon_id, profile_id) in (select uid from cohort)
  )
  select jsonb_build_object(
    'acquisition_activation', jsonb_build_object(
      'landing_visitors', (select count(*) from cohort),
      'registration_started', (select count(distinct uid) from ev where event_name = 'registration_started'),
      'registration_completed', (select count(distinct uid) from ev where event_name = 'registration_completed'),
      'portal_activated', (select count(distinct uid) from ev where event_name = 'portal_first_login'),
      'first_training_started', (select count(distinct uid) from ev where event_name = 'first_lesson_started')
    ),
    'monetization', jsonb_build_object(
      'landing_visitors', (select count(*) from cohort),
      'checkout_started', (select count(distinct uid) from ev where event_name = 'checkout_started'),
      'purchase_completed', (select count(distinct uid) from ev where event_name = 'purchase_completed')
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Readiness funnel: accurate labels + real Checkride Prep CTA coverage
-- ═══════════════════════════════════════════════════════════════════════

-- "signup_completed" (mode:'signup' only) now specifically means a real
-- Apex account was created via create-free-account -- mode:'login' (an
-- existing member re-authenticating to retake the assessment) is
-- reported separately as gate_login_completed, since it is NOT a new
-- registration and conflating the two overstated new-account growth from
-- this funnel. "checkride_prep_clicked" now counts EITHER
-- readiness_checkride_prep_clicked (the login path's own CTA, which
-- still exists and still works) OR checkride_prep_upgrade_modal_opened
-- (the new-signup path's real equivalent moment, once the visitor's
-- identity resolves through analytics_identity_map) -- seeing this
-- return to a real positive number after the code fix confirms B/D from
-- the original audit (missing UX bridge for new signups), not a
-- continued tracking failure.
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
    'checkride_prep_purchased', (select count(*) from prep_purchase)
  ) into v_result;

  return v_result;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Checkride Prep funnel + Ground School funnel + activation/UTM/
--    channel/revenue RPCs: re-declared unchanged except for the identity
--    resolution swap (coalesce(anon_id, profile_id::text) ->
--    resolve_analytics_identity(anon_id, profile_id)). Product/event
--    scoping was already audited and found correct in v83 (both filter
--    on properties->>'product' already) -- no logic change needed there.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.get_checkride_prep_funnel_stats(p_start timestamptz default null, p_end timestamptz default null)
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
    where event_name = 'landing_page_viewed'
      and properties->>'product' = 'checkride_prep'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select public.resolve_analytics_identity(anon_id, profile_id) as uid, event_name, (properties->>'price')::numeric as price
    from public.analytics_events
    where event_name in ('pricing_viewed', 'checkout_started', 'purchase_completed')
      and properties->>'product' = 'checkride_prep'
      and public.resolve_analytics_identity(anon_id, profile_id) in (select uid from cohort)
  )
  select jsonb_build_object(
    'landing_users', (select count(*) from cohort),
    'pricing_viewed', (select count(distinct uid) from ev where event_name = 'pricing_viewed'),
    'checkout_started', (select count(distinct uid) from ev where event_name = 'checkout_started'),
    'purchases', (select count(distinct uid) from ev where event_name = 'purchase_completed'),
    'revenue', (select coalesce(sum(price), 0) from ev where event_name = 'purchase_completed')
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_ground_school_funnel_stats(p_start timestamptz default null, p_end timestamptz default null)
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
    where event_name = 'ground_school_schedule_viewed'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select public.resolve_analytics_identity(anon_id, profile_id) as uid, event_name, properties->>'product' as product, (properties->>'price')::numeric as price
    from public.analytics_events
    where event_name in ('ground_school_class_selected', 'ground_school_reserve_form_opened', 'checkout_started', 'purchase_completed')
      and public.resolve_analytics_identity(anon_id, profile_id) in (select uid from cohort)
  ),
  purchases as (
    select uid, product, price
    from ev
    where event_name = 'purchase_completed' and product in ('ground_school_class', 'ground_school_pack')
  )
  select jsonb_build_object(
    'schedule_viewers', (select count(*) from cohort),
    'class_selected', (select count(distinct uid) from ev where event_name = 'ground_school_class_selected'),
    'reserve_form_opened', (select count(distinct uid) from ev where event_name = 'ground_school_reserve_form_opened'),
    'checkout_started', (select count(distinct uid) from ev where event_name = 'checkout_started' and product in ('ground_school_class', 'ground_school_pack')),
    'purchases', (select count(*) from purchases),
    'single_class_purchases', (select count(*) from purchases where product = 'ground_school_class'),
    'full_course_purchases', (select count(*) from purchases where product = 'ground_school_pack'),
    'revenue', (select coalesce(sum(price), 0) from purchases),
    'avg_purchase_value', (select case when count(*) > 0 then round(avg(price), 2) else null end from purchases)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_utm_campaign_performance(p_start timestamptz default null, p_end timestamptz default null)
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

  with scoped as (
    select
      public.resolve_analytics_identity(anon_id, profile_id) as uid,
      event_name,
      nullif(properties->>'traffic_source', '') as traffic_source,
      nullif(properties->>'traffic_medium', '') as traffic_medium,
      nullif(properties->>'campaign', '') as campaign,
      (properties->>'price')::numeric as price,
      created_at
    from public.analytics_events
    where (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  first_touch as (
    select distinct on (uid)
      uid,
      coalesce(traffic_source, 'direct') as source,
      coalesce(traffic_medium, 'none') as medium,
      coalesce(campaign, '(none)') as campaign
    from scoped
    order by uid, created_at asc
  ),
  attributed as (
    select s.uid, s.event_name, s.price, ft.source, ft.medium, ft.campaign
    from scoped s
    join first_touch ft on ft.uid = s.uid
  )
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result
  from (
    select
      source, medium, campaign,
      public.classify_marketing_channel(nullif(source, 'direct'), nullif(medium, 'none')) as channel,
      count(distinct uid) filter (where event_name = 'landing_page_viewed') as landing_users,
      count(distinct uid) filter (where event_name = 'registration_completed') as registrations,
      count(distinct uid) filter (where event_name = 'readiness_assessment_started') as readiness_starts,
      count(distinct uid) filter (where event_name = 'readiness_assessment_completed') as readiness_completes,
      count(distinct uid) filter (where event_name = 'checkout_started') as checkout_starts,
      count(distinct uid) filter (where event_name = 'purchase_completed') as purchases,
      coalesce(sum(price) filter (where event_name = 'purchase_completed'), 0) as revenue
    from attributed
    group by source, medium, campaign
  ) t;

  return v_result;
end;
$$;

create or replace function public.get_channel_performance(p_start timestamptz default null, p_end timestamptz default null)
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

  with scoped as (
    select
      public.resolve_analytics_identity(anon_id, profile_id) as uid,
      event_name,
      nullif(properties->>'traffic_source', '') as traffic_source,
      nullif(properties->>'traffic_medium', '') as traffic_medium,
      (properties->>'price')::numeric as price,
      created_at
    from public.analytics_events
    where (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  first_touch as (
    select distinct on (uid)
      uid,
      public.classify_marketing_channel(traffic_source, traffic_medium) as channel
    from scoped
    order by uid, created_at asc
  ),
  attributed as (
    select s.uid, s.event_name, s.price, ft.channel
    from scoped s
    join first_touch ft on ft.uid = s.uid
  )
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result
  from (
    select
      channel,
      count(distinct uid) filter (where event_name = 'landing_page_viewed') as landing_users,
      count(distinct uid) filter (where event_name = 'registration_completed') as registrations,
      count(distinct uid) filter (where event_name = 'checkout_started') as checkout_starts,
      count(distinct uid) filter (where event_name = 'purchase_completed') as purchases,
      coalesce(sum(price) filter (where event_name = 'purchase_completed'), 0) as revenue
    from attributed
    group by channel
  ) t;

  return v_result;
end;
$$;

create or replace function public.get_portal_activation_funnel(p_start timestamptz default null, p_end timestamptz default null)
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
    select distinct ae.profile_id, p.created_at as signed_up_at
    from public.analytics_events ae
    join public.profiles p on p.id = ae.profile_id
    where ae.event_name = 'registration_completed'
      and ae.profile_id is not null
      and (p_start is null or ae.created_at >= p_start)
      and (p_end is null or ae.created_at < p_end)
  ),
  ev as (
    select profile_id, event_name
    from public.analytics_events
    where event_name in ('portal_first_login', 'onboarding_viewed', 'onboarding_training_goal_saved', 'onboarding_focus_area_saved', 'onboarding_completed', 'onboarding_first_training_started', 'first_lesson_started', 'first_lesson_completed')
      and profile_id in (select profile_id from cohort)
  ),
  returned as (
    select c.profile_id,
      exists (select 1 from public.analytics_events ae2 where ae2.profile_id = c.profile_id and ae2.created_at >= c.signed_up_at + interval '1 day') as returned_d1,
      exists (select 1 from public.analytics_events ae3 where ae3.profile_id = c.profile_id and ae3.created_at >= c.signed_up_at + interval '7 days') as returned_d7
    from cohort c
  ),
  purchase_cohort as (
    select distinct profile_id
    from public.analytics_events
    where event_name = 'purchase_completed'
      and profile_id is not null
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  purchase_ev as (
    select profile_id, event_name
    from public.analytics_events
    where event_name in ('portal_first_login', 'first_lesson_started')
      and profile_id in (select profile_id from purchase_cohort)
  )
  select jsonb_build_object(
    'signups', (select count(*) from cohort),
    'first_login', (select count(distinct profile_id) from ev where event_name = 'portal_first_login'),
    'onboarding_started', (select count(distinct profile_id) from ev where event_name = 'onboarding_viewed'),
    'onboarding_goal_saved', (select count(distinct profile_id) from ev where event_name = 'onboarding_training_goal_saved'),
    'onboarding_focus_saved', (select count(distinct profile_id) from ev where event_name = 'onboarding_focus_area_saved'),
    'onboarding_completed', (select count(distinct profile_id) from ev where event_name = 'onboarding_completed'),
    'onboarding_first_training', (select count(distinct profile_id) from ev where event_name = 'onboarding_first_training_started'),
    'first_lesson_started', (select count(distinct profile_id) from ev where event_name = 'first_lesson_started'),
    'first_lesson_completed', (select count(distinct profile_id) from ev where event_name = 'first_lesson_completed'),
    'activated', (select count(*) from cohort c join public.profiles p on p.id = c.profile_id where p.activated_at is not null),
    'returned_d1', (select count(*) from returned where returned_d1),
    'returned_d7', (select count(*) from returned where returned_d7),
    'purchasers', (select count(*) from purchase_cohort),
    'purchasers_activated', (select count(distinct profile_id) from purchase_ev where event_name = 'portal_first_login'),
    'purchasers_first_training', (select count(distinct profile_id) from purchase_ev where event_name = 'first_lesson_started')
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_marketing_revenue_summary(p_start timestamptz default null, p_end timestamptz default null)
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

  with purchases as (
    select
      coalesce(properties->>'product', 'unknown') as product,
      (properties->>'price')::numeric as price
    from public.analytics_events
    where event_name = 'purchase_completed'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  )
  select jsonb_build_object(
    'total_revenue', (select coalesce(sum(price), 0) from purchases),
    'total_purchases', (select count(*) from purchases),
    'average_order_value', (select case when count(*) > 0 then round(avg(price), 2) else null end from purchases),
    'by_product', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select product, count(*) as purchases, coalesce(sum(price), 0) as revenue
        from purchases
        group by product
        order by sum(price) desc
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Funnel invariant checks (Data Quality panel)
-- ═══════════════════════════════════════════════════════════════════════

-- A step conversion above 100%, or a later step with more users than an
-- earlier one in the SAME valid sequence, means the funnel's own
-- definition is broken somewhere (wrong event, wrong cohort, wrong
-- identity) -- never a real >100% conversion rate. This flags exactly
-- that, on the current 30-day window, so a broken definition surfaces
-- immediately instead of silently producing nonsense numbers again.
create or replace function public.get_analytics_data_quality(p_documented_event_count integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
  v_purchase_total integer;
  v_purchase_with_session integer;
  v_purchase_distinct_sessions integer;
  v_first_login_total integer;
  v_first_login_distinct_profiles integer;
  v_observed_events text[];
  v_unattributed_pct numeric;
  v_exec jsonb;
  v_readiness jsonb;
  v_cp jsonb;
  v_warnings text[] := array[]::text[];
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  select count(*) into v_purchase_total from public.analytics_events where event_name = 'purchase_completed';
  select count(*) into v_purchase_with_session from public.analytics_events where event_name = 'purchase_completed' and properties ? 'session_id';
  select count(distinct properties->>'session_id') into v_purchase_distinct_sessions from public.analytics_events where event_name = 'purchase_completed' and properties ? 'session_id';

  select count(*) into v_first_login_total from public.analytics_events where event_name = 'portal_first_login';
  select count(distinct profile_id) into v_first_login_distinct_profiles from public.analytics_events where event_name = 'portal_first_login' and profile_id is not null;

  select array_agg(distinct event_name) into v_observed_events
  from public.analytics_events
  where created_at >= now() - interval '90 days';

  with scoped as (
    select public.resolve_analytics_identity(anon_id, profile_id) as uid, nullif(properties->>'traffic_source','') as traffic_source, nullif(properties->>'traffic_medium','') as traffic_medium, created_at
    from public.analytics_events
    where event_name = 'landing_page_viewed'
  ),
  first_touch as (
    select distinct on (uid) uid, public.classify_marketing_channel(traffic_source, traffic_medium) as channel
    from scoped order by uid, created_at asc
  )
  select case when count(*) > 0 then round(100.0 * count(*) filter (where channel = 'Unknown / Unattributed') / count(*), 1) else null end
  into v_unattributed_pct
  from first_touch;

  -- Run the funnel invariant checks against the current 90-day window --
  -- long enough to catch a real definitional break, short enough that
  -- this stays fast.
  v_exec := public.get_marketing_executive_funnel(now() - interval '90 days', now());
  v_readiness := public.get_readiness_funnel_stats(now() - interval '90 days', now());
  v_cp := public.get_checkride_prep_funnel_stats(now() - interval '90 days', now());

  if (v_exec->'acquisition_activation'->>'registration_started')::int > (v_exec->'acquisition_activation'->>'landing_visitors')::int then
    v_warnings := v_warnings || 'FUNNEL DEFINITION WARNING: Executive Acquisition funnel has a step exceeding 100% of landing visitors.';
  end if;
  if (v_exec->'monetization'->>'purchase_completed')::int > (v_exec->'monetization'->>'checkout_started')::int then
    v_warnings := v_warnings || 'FUNNEL DEFINITION WARNING: Executive Monetization funnel has more purchases than checkout starts.';
  end if;
  if (v_readiness->>'completed')::int > (v_readiness->>'started')::int then
    v_warnings := v_warnings || 'FUNNEL DEFINITION WARNING: Readiness funnel has more completions than starts.';
  end if;
  if (v_readiness->>'checkride_prep_purchased')::int > (v_readiness->>'checkride_prep_clicked')::int then
    v_warnings := v_warnings || 'FUNNEL DEFINITION WARNING: Readiness funnel has more Checkride Prep purchases than clicks.';
  end if;
  if (v_cp->>'purchases')::int > (v_cp->>'checkout_started')::int then
    v_warnings := v_warnings || 'FUNNEL DEFINITION WARNING: Checkride Prep funnel has more purchases than checkout starts.';
  end if;
  if v_first_login_distinct_profiles > 0 and v_first_login_total > v_first_login_distinct_profiles * 2 then
    v_warnings := v_warnings || 'FUNNEL DEFINITION WARNING: portal_first_login firing meaningfully more than once per profile on average.';
  end if;

  select jsonb_build_object(
    'purchase_dedupe_status', case
      when v_purchase_with_session = 0 then 'NO DATA YET'
      when v_purchase_with_session = v_purchase_distinct_sessions then 'PASS'
      else 'WARNING'
    end,
    'purchase_events_with_session_id', v_purchase_with_session,
    'purchase_events_total', v_purchase_total,
    'purchase_distinct_sessions', v_purchase_distinct_sessions,
    'first_login_status', case
      when v_first_login_total = 0 then 'NO DATA YET'
      when v_first_login_total = v_first_login_distinct_profiles then 'PASS'
      else 'WARNING'
    end,
    'first_login_events_total', v_first_login_total,
    'first_login_distinct_profiles', v_first_login_distinct_profiles,
    'unattributed_pct', v_unattributed_pct,
    'observed_event_count', coalesce(array_length(v_observed_events, 1), 0),
    'documented_event_count', p_documented_event_count,
    'observed_events', to_jsonb(coalesce(v_observed_events, array[]::text[])),
    'last_event_at', (select max(created_at) from public.analytics_events),
    'funnel_warnings', to_jsonb(v_warnings)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_marketing_executive_funnel(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_readiness_funnel_stats(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_checkride_prep_funnel_stats(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_ground_school_funnel_stats(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_utm_campaign_performance(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_channel_performance(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_portal_activation_funnel(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_marketing_revenue_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_analytics_data_quality(integer) to authenticated;
