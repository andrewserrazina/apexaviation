-- Apex Advantage — Analytics Reliability + Marketing Funnel Dashboard (v83)
--
-- Four things, per the analytics reliability audit:
--
-- 1. portal_first_login fix. Root cause (confirmed by reading
--    site/portal-stable.js): checkLifecycleMilestones() decides
--    isFirstLogin from an in-memory flag (loggedEventTypes['first_login'])
--    that's seeded once per page load from a SELECT against
--    portal_events, then optimistically set true BEFORE the matching
--    INSERT is confirmed (logEventOnce has no error handling at all). Two
--    real browser tabs/devices loading the portal for the same profile at
--    nearly the same moment both run that SELECT before either INSERT
--    lands, both see "no first_login row yet", and both fire. Nothing in
--    that path is atomic. first_portal_login_at + claim_first_portal_login()
--    below replace it with a single conditional UPDATE, which Postgres
--    guarantees only one concurrent caller can ever win (row-level
--    locking + MVCC serializes the two UPDATEs; the second always sees
--    the column already non-null and affects zero rows).
--
-- 2. Attribution persistence gap. profiles.signup_utm_* (v58) already
--    captures FIRST-touch UTM at signup, and checkout_session_attempts
--    (also v58) already captures LATEST-touch UTM at each checkout
--    attempt. What's missing: (a) first_touch_landing_page/first_touch_at
--    to go with the existing signup_utm_* columns, and (b) any mechanism
--    to update attribution on a LATER tagged visit for someone who
--    doesn't check out that same session (e.g. a TikTok LIVE viewer who
--    signs up Tuesday, comes back Thursday via a different tagged link,
--    then buys next week -- today that Thursday touch only ever lives in
--    localStorage). last_touch_* + update_last_touch_attribution() close
--    that gap without duplicating the existing first-touch system.
--
-- 3. Marketing & Funnel dashboard aggregation. All of it reads
--    analytics_events, which already carries traffic_source/campaign on
--    every apexTrack() event (see site/analytics-events.js's utmProps())
--    plus (as of this same release) traffic_medium. Every RPC below does
--    its grouping/counting server-side in one round trip rather than
--    pulling raw rows into the browser -- see the three new expression
--    indexes for why that stays fast as the table grows.
--
-- 4. classify_marketing_channel() turns (source, medium) into the
--    higher-level channel buckets (Paid Social, Organic Video, Email,
--    Direct, etc.) the dashboard groups by. Rule-based on the UTM
--    convention (medium=live, medium=cpc, etc.), never on a specific
--    campaign name -- a new TikTok LIVE campaign works without touching
--    this function, per the "don't hardcode specific campaigns" brief.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v82.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. portal_first_login: atomic once-per-profile claim
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists first_portal_login_at timestamptz;

comment on column public.profiles.first_portal_login_at is
  'Set exactly once, the first time this profile successfully claims its first authenticated portal load. NULL = never claimed yet. Written only via claim_first_portal_login() so the claim stays atomic under concurrent tabs/devices.';

create or replace function public.claim_first_portal_login(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  if auth.uid() is null or auth.uid() <> p_profile_id then
    raise exception 'Not authorized to claim first-login for this profile';
  end if;

  -- The whole point: one UPDATE, one WHERE clause that only matches when
  -- nobody has claimed it yet. Postgres serializes concurrent UPDATEs to
  -- the same row, so at most one caller ever sees this affect a row.
  update public.profiles
    set first_portal_login_at = now()
    where id = p_profile_id
      and first_portal_login_at is null;

  get diagnostics v_claimed = row_count;
  return v_claimed > 0;
end;
$$;

grant execute on function public.claim_first_portal_login(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Attribution persistence: fill the gap around existing signup_utm_*
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists first_touch_landing_page text,
  add column if not exists first_touch_at timestamptz,
  add column if not exists last_touch_source text,
  add column if not exists last_touch_medium text,
  add column if not exists last_touch_campaign text,
  add column if not exists last_touch_content text,
  add column if not exists last_touch_term text,
  add column if not exists last_touch_landing_page text,
  add column if not exists last_touch_at timestamptz;

comment on column public.profiles.first_touch_landing_page is
  'Landing page URL of this profile''s first-ever tagged visit, alongside the existing signup_utm_* columns (which already hold that visit''s source/medium/campaign/content/term). Set once at signup, never overwritten.';
comment on column public.profiles.last_touch_source is
  'Most recent tagged (utm_source present) visit''s source, updated any time the member arrives on a URL carrying fresh UTM params -- including well after signup. Distinct from signup_utm_source, which is frozen at first touch.';

create or replace function public.update_last_touch_attribution(
  p_source text,
  p_medium text,
  p_campaign text,
  p_content text,
  p_term text,
  p_landing_page text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Callers are trusted to invoke this only when the current page load's
  -- URL actually carried a utm_ param (see analytics-events.js's
  -- captureAndPersistLastTouch()) -- an internal in-app navigation never
  -- calls this, so it can't relabel an existing member as a "new touch"
  -- just for clicking around the portal.
  update public.profiles
    set last_touch_source = left(p_source, 200),
        last_touch_medium = left(p_medium, 200),
        last_touch_campaign = left(p_campaign, 200),
        last_touch_content = left(p_content, 200),
        last_touch_term = left(p_term, 200),
        last_touch_landing_page = left(p_landing_page, 500),
        last_touch_at = now()
    where id = auth.uid();
end;
$$;

grant execute on function public.update_last_touch_attribution(text, text, text, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Performance: expression indexes for the dashboard's grouping columns
-- ═══════════════════════════════════════════════════════════════════════

create index if not exists analytics_events_traffic_source_idx on public.analytics_events ((properties->>'traffic_source'));
create index if not exists analytics_events_traffic_medium_idx on public.analytics_events ((properties->>'traffic_medium'));
create index if not exists analytics_events_campaign_idx on public.analytics_events ((properties->>'campaign'));
create index if not exists analytics_events_product_idx on public.analytics_events ((properties->>'product'));

-- ═══════════════════════════════════════════════════════════════════════
-- 4. classify_marketing_channel — rule-based, never keyed on campaign name
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.classify_marketing_channel(p_source text, p_medium text)
returns text
language sql
immutable
as $$
  select case
    when p_source is null and p_medium is null then 'Direct'
    when lower(coalesce(p_medium, '')) in ('cpc', 'ppc', 'paid', 'paidsocial', 'paid_social')
      and lower(coalesce(p_source, '')) in ('facebook', 'meta', 'instagram', 'tiktok', 'snapchat', 'linkedin')
      then 'Paid Social'
    when lower(coalesce(p_medium, '')) in ('cpc', 'ppc', 'paid')
      and lower(coalesce(p_source, '')) in ('google', 'bing', 'adwords')
      then 'Paid Search'
    when lower(coalesce(p_medium, '')) in ('cpc', 'ppc', 'paid')
      then 'Paid Other'
    when lower(coalesce(p_medium, '')) = 'live'
      then 'Organic Video'
    when lower(coalesce(p_medium, '')) = 'organic' and lower(coalesce(p_source, '')) in ('google', 'bing')
      then 'Organic Search'
    when lower(coalesce(p_medium, '')) = 'social'
      or (coalesce(p_medium, '') = '' and lower(coalesce(p_source, '')) in ('facebook', 'instagram', 'tiktok', 'twitter', 'x', 'linkedin', 'youtube'))
      then 'Organic Social'
    when lower(coalesce(p_medium, '')) = 'email'
      then 'Email'
    when lower(coalesce(p_medium, '')) = 'referral'
      then 'Referral'
    when p_source is null and p_medium is null
      then 'Direct'
    else 'Unknown / Unattributed'
  end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Marketing & Funnel dashboard RPCs
-- ═══════════════════════════════════════════════════════════════════════

-- Every "funnel" RPC below uses the same methodology: the cohort is
-- whoever hit the FIRST step within [p_start, p_end); every later step is
-- then "did this same person (coalesce(anon_id, profile_id::text)) ever
-- reach it", not bounded to the same date range. That's the standard way
-- to read an open/top-of-funnel-scoped conversion funnel (matches how
-- GA4's own funnel exploration works) and avoids undercounting real
-- conversions that land a few days after the visit that started them.

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
    select distinct coalesce(anon_id, profile_id::text) as uid
    from public.analytics_events
    where event_name = 'landing_page_viewed'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select coalesce(anon_id, profile_id::text) as uid, event_name
    from public.analytics_events
    where event_name in ('registration_started', 'registration_completed', 'checkout_started', 'purchase_completed', 'portal_first_login', 'first_lesson_started')
      and coalesce(anon_id, profile_id::text) in (select uid from cohort)
  )
  select jsonb_build_object(
    'landing_visitors', (select count(*) from cohort),
    'registration_started', (select count(distinct uid) from ev where event_name = 'registration_started'),
    'registration_completed', (select count(distinct uid) from ev where event_name = 'registration_completed'),
    'checkout_started', (select count(distinct uid) from ev where event_name = 'checkout_started'),
    'purchase_completed', (select count(distinct uid) from ev where event_name = 'purchase_completed'),
    'portal_activated', (select count(distinct uid) from ev where event_name = 'portal_first_login'),
    'first_training_started', (select count(distinct uid) from ev where event_name = 'first_lesson_started')
  ) into v_result;

  return v_result;
end;
$$;

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
    select distinct coalesce(anon_id, profile_id::text) as uid
    from public.analytics_events
    where event_name = 'readiness_assessment_viewed'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select coalesce(anon_id, profile_id::text) as uid, event_name
    from public.analytics_events
    where event_name in ('readiness_assessment_started', 'readiness_assessment_completed', 'readiness_score_viewed', 'readiness_signup_started', 'readiness_signup_completed', 'readiness_checkride_prep_clicked')
      and coalesce(anon_id, profile_id::text) in (select uid from cohort)
  ),
  prep_purchase as (
    select distinct e.uid
    from ev e
    where e.event_name = 'readiness_checkride_prep_clicked'
      and exists (
        select 1 from public.analytics_events pc
        where pc.event_name = 'purchase_completed'
          and pc.properties->>'product' = 'checkride_prep'
          and coalesce(pc.anon_id, pc.profile_id::text) = e.uid
      )
  )
  select jsonb_build_object(
    'viewed', (select count(*) from cohort),
    'started', (select count(distinct uid) from ev where event_name = 'readiness_assessment_started'),
    'completed', (select count(distinct uid) from ev where event_name = 'readiness_assessment_completed'),
    'score_viewed', (select count(distinct uid) from ev where event_name = 'readiness_score_viewed'),
    'signup_started', (select count(distinct uid) from ev where event_name = 'readiness_signup_started'),
    'signup_completed', (select count(distinct uid) from ev where event_name = 'readiness_signup_completed'),
    'checkride_prep_clicked', (select count(distinct uid) from ev where event_name = 'readiness_checkride_prep_clicked'),
    'checkride_prep_purchased', (select count(*) from prep_purchase)
  ) into v_result;

  return v_result;
end;
$$;

-- checkride_prep_page_view and checkride_prep_cta_click are legacy
-- GA4-only events (site/checkride-prep.html fires them via a raw gtag()
-- call, never through apexTrack) -- there is no first-party row for
-- either one. landing_page_viewed(product=checkride_prep) and
-- checkout_started(product=checkride_prep, checkout_step='cta_click')
-- fire on the exact same page loads/clicks via apexTrack, so they're used
-- here as the honest first-party stand-ins rather than inventing data
-- that was never recorded.
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
    select distinct coalesce(anon_id, profile_id::text) as uid
    from public.analytics_events
    where event_name = 'landing_page_viewed'
      and properties->>'product' = 'checkride_prep'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select coalesce(anon_id, profile_id::text) as uid, event_name, (properties->>'price')::numeric as price
    from public.analytics_events
    where event_name in ('pricing_viewed', 'checkout_started', 'purchase_completed')
      and properties->>'product' = 'checkride_prep'
      and coalesce(anon_id, profile_id::text) in (select uid from cohort)
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
    select distinct coalesce(anon_id, profile_id::text) as uid
    from public.analytics_events
    where event_name = 'ground_school_schedule_viewed'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select coalesce(anon_id, profile_id::text) as uid, event_name, properties->>'product' as product, (properties->>'price')::numeric as price
    from public.analytics_events
    where event_name in ('ground_school_class_selected', 'ground_school_reserve_form_opened', 'checkout_started', 'purchase_completed')
      and coalesce(anon_id, profile_id::text) in (select uid from cohort)
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

-- First-touch campaign performance. Each user (coalesce(anon_id,
-- profile_id::text)) is credited to the source/medium/campaign recorded
-- on their EARLIEST tagged event in range -- the touch that actually
-- brought them in, not whichever campaign happened to be most recent in
-- localStorage by the time they checked out days later. Revenue comes
-- straight from purchase_completed's own price property, which is
-- already the real charged amount (see site/portal-stable.js's purchase
-- handlers) -- the same source of truth the success redirects use, not a
-- raw GA4 total.
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
      coalesce(anon_id, profile_id::text) as uid,
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

-- Same first-touch attribution, aggregated up to channel level (see
-- classify_marketing_channel above for the source/medium -> channel
-- rules).
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
      coalesce(anon_id, profile_id::text) as uid,
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

-- Activation quality, independent of acquisition -- keyed by profile_id
-- only (unlike the funnels above, an anonymous visitor has no onboarding/
-- activation state to measure). Same "cohort at step 1, did they ever
-- reach step N" methodology.
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
    select distinct profile_id
    from public.analytics_events
    where event_name = 'registration_completed'
      and profile_id is not null
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select profile_id, event_name
    from public.analytics_events
    where event_name in ('portal_first_login', 'onboarding_training_goal_saved', 'onboarding_focus_area_saved', 'onboarding_first_training_started', 'first_lesson_started', 'first_lesson_completed')
      and profile_id in (select profile_id from cohort)
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
    'onboarding_goal_saved', (select count(distinct profile_id) from ev where event_name = 'onboarding_training_goal_saved'),
    'onboarding_focus_saved', (select count(distinct profile_id) from ev where event_name = 'onboarding_focus_area_saved'),
    'onboarding_first_training', (select count(distinct profile_id) from ev where event_name = 'onboarding_first_training_started'),
    'first_lesson_started', (select count(distinct profile_id) from ev where event_name = 'first_lesson_started'),
    'first_lesson_completed', (select count(distinct profile_id) from ev where event_name = 'first_lesson_completed'),
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

-- Data-quality panel. dedupe_status/first_login_status only reflect
-- events recorded AFTER this release's fixes ship -- they can't detect or
-- correct historical duplicates from before session_id/transaction_id
-- were added to these events.
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
    select coalesce(anon_id, profile_id::text) as uid, nullif(properties->>'traffic_source','') as traffic_source, nullif(properties->>'traffic_medium','') as traffic_medium, created_at
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
    'last_event_at', (select max(created_at) from public.analytics_events)
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

-- Every RPC above starts with `if not public.is_admin(auth.uid())` --
-- grant execute to authenticated (not restricted further) is safe because
-- that check runs first and raises before any query executes for a
-- non-admin caller. Same pattern as get_retention_kpis()/
-- get_activation_email_kpis() (v69/v81).
