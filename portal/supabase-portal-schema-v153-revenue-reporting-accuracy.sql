-- Financial & Analytics Reporting Accuracy (v153)
--
-- Investigation found two independent, compounding bugs in the ops
-- surfaces that report revenue:
--
--   1. Three real purchase types -- Study Packs, both Mock Oral products
--      (the legacy 60-minute flow and the new $129 2-hour flow), and
--      Apex Advantage Membership -- never wrote a row to `invoices`.
--      The Admin Dashboard's "Total Platform Revenue" (site/portal-
--      stable.js loadAdminDashboard()) sums paid invoices + paid
--      ground_registrations, so it silently excluded all three products
--      entirely. The matching stripe-webhook/index.ts fix (same
--      migration set) now writes an invoices row for every one of them,
--      going forward.
--
--   2. The Marketing & Funnel ops page (portal/src/pages/
--      MarketingFunnel.jsx) gets every revenue figure on the page --
--      Total Verified Revenue, Average Order Value, per-product funnel
--      revenue, per-UTM-row revenue, per-channel revenue -- from
--      analytics_events where event_name = 'purchase_completed'. That
--      event only fires from client-side JS running AFTER the Stripe
--      redirect lands back in the browser (site/portal-stable.js), the
--      exact same reliability profile as the GA4 purchase pixel this
--      page's own copy claims NOT to be built on. Measured live:
--      Checkride Prep (the single largest product) was undercounted by
--      40% -- 12 of 20 real sales ($348 of $580) -- and one
--      ground_school_class purchase_completed event ($25) has no paid
--      ground_registrations row behind it at all (a tracked "sale" that
--      never actually completed, or was later reversed with no way for
--      the event to know).
--
-- This migration:
--   a) adds `product` + `stripe_session_id` to invoices, so every
--      revenue row can be identified by product and can't be double-
--      counted on a webhook retry (the same pattern every OTHER
--      purchase-fulfillment table in this schema already uses);
--   b) backfills `product` on the 23 existing rows from their
--      description text (both values that have ever been written:
--      Checkride Prep Unlock, Ground School Full Course);
--   c) one-time-corrects the single real Mock Oral booking that already
--      happened before this fix shipped, so today's dashboards are
--      accurate for it too, not just future sales;
--   d) rewrites the 5 revenue-bearing RPCs behind the Marketing & Funnel
--      page to source every dollar figure from the real purchase tables
--      (invoices + ground_registrations) instead of purchase_completed,
--      while leaving every funnel STEP/COUNT (landing visitors, checkout
--      starts, etc.) exactly as they were -- those really are about
--      intent signal, not verified dollars, and analytics_events is the
--      only place that's ever recorded.

-- (a) --------------------------------------------------------------
alter table public.invoices
  add column if not exists product text,
  add column if not exists stripe_session_id text;

comment on column public.invoices.product is
  'One of: checkride_prep, ground_school_pack, ground_school_pack_upgrade, study_pack, mock_oral, mock_oral_v2, membership. Set by stripe-webhook/index.ts at insert time for every row going forward; backfilled once below for rows that predate this column. Not a DB-enforced CHECK constraint since the product list may grow.';
comment on column public.invoices.stripe_session_id is
  'The Stripe Checkout Session id that produced this charge. NULL for rows written before this column existed. Lets each purpose handler in stripe-webhook/index.ts avoid writing a second invoice row for the same sale on a webhook retry, same pattern as portal_access_purchases/mock_oral_bookings/study_pack_entitlements.';

-- (b) --------------------------------------------------------------
update public.invoices
set product = case
  when description ilike '%Checkride Prep%' then 'checkride_prep'
  when description ilike '%Upgrade to Full Course%' then 'ground_school_pack_upgrade'
  when description ilike '%Ground School%' then 'ground_school_pack'
  else null
end
where product is null;

-- Only enforced for rows going forward (NULL is exempt) -- a webhook
-- retry reaching an invoices.insert() a second time for the same sale is
-- exactly the bug this guards against; a NULL here only ever means "this
-- row predates the column."
create unique index if not exists idx_invoices_stripe_session_id
  on public.invoices (stripe_session_id)
  where stripe_session_id is not null;

create index if not exists idx_invoices_product on public.invoices (product);

-- (c) --------------------------------------------------------------
-- The real Mock Oral v2 charge that happened before this fix shipped --
-- Stripe actually collected this payment and mock_oral_bookings already
-- has the real row; this is a one-time correction so it shows up in
-- revenue totals too, not a new charge. Guarded by stripe_session_id so
-- re-running this migration file is harmless.
insert into public.invoices (student_id, description, amount_cents, status, product, stripe_session_id, issued_at)
select mob.profile_id, 'Apex Advantage Mock Oral (Private Pilot)', mob.amount_cents, 'paid', 'mock_oral_v2', mob.stripe_session_id, mob.created_at
from public.mock_oral_bookings mob
where not exists (
  select 1 from public.invoices i where i.stripe_session_id = mob.stripe_session_id
);

-- (d) --------------------------------------------------------------
-- One real-purchases view, reused by every rewritten RPC below --
-- resolves to the same identity space get_marketing_executive_funnel and
-- its siblings already use (resolve_analytics_identity collapses a
-- signed-in event's anon_id/profile_id down to profile_id::text; every
-- row here has a real profile_id, so this is just that same text cast).
create or replace view public.verified_purchases as
  select student_id::text as uid, product, amount_cents, issued_at as paid_at
  from public.invoices
  where status = 'paid' and product is not null
  union all
  select profile_id::text as uid, 'ground_school_class' as product, amount_cents, registered_at as paid_at
  from public.ground_registrations
  where payment_status = 'paid';

comment on view public.verified_purchases is
  'Revenue Reporting Accuracy (v153) -- the single source every revenue figure in the Marketing & Funnel dashboard and the Admin Dashboard should read from. Every row here is a real, Stripe-verified sale written server-side by stripe-webhook/index.ts (or, for ground_school_class, create a registration whose payment was captured), never a client-fired analytics event -- see this migration''s header comment for why that distinction matters.';

-- A plain Postgres view runs with its OWNER's privileges against the
-- tables it selects from, not the querying role's -- the Supabase
-- security advisor flags this (SECURITY DEFINER View, ERROR level) the
-- moment a view like this exists, because left alone it would let any
-- authenticated member read every other member's purchases/revenue
-- directly via PostgREST, bypassing invoices/ground_registrations'
-- normal RLS entirely. The 5 functions below don't need a grant here to
-- keep working -- they're SECURITY DEFINER functions owned by the same
-- role that owns this view, so they already have access independent of
-- what authenticated/anon hold, and each checks is_admin(auth.uid())
-- itself before returning anything.
revoke all on public.verified_purchases from public, anon, authenticated;

create or replace function public.get_marketing_revenue_summary(p_start timestamptz default null, p_end timestamptz default null)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  with purchases as (
    select product, amount_cents / 100.0 as price
    from public.verified_purchases
    where (p_start is null or paid_at >= p_start)
      and (p_end is null or paid_at < p_end)
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

create or replace function public.get_checkride_prep_funnel_stats(p_start timestamptz default null, p_end timestamptz default null)
returns jsonb
language plpgsql
stable security definer
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
    where event_name = 'landing_page_viewed'
      and properties->>'product' = 'checkride_prep'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select public.resolve_analytics_identity(anon_id, profile_id) as uid, event_name
    from public.analytics_events
    where event_name in ('pricing_viewed', 'checkout_started')
      and properties->>'product' = 'checkride_prep'
      and public.resolve_analytics_identity(anon_id, profile_id) in (select uid from cohort)
  ),
  -- Revenue Reporting Accuracy (v153) -- purchases/revenue now come from
  -- verified_purchases (real invoices), not purchase_completed. Cohort
  -- membership is still the gate (a purchase may land after p_start/p_end,
  -- same as every other step here), but the dollar amount and the fact
  -- that a purchase happened at all are never taken from a client-fired
  -- event again.
  real_purchases as (
    select uid, amount_cents
    from public.verified_purchases
    where product = 'checkride_prep' and uid in (select uid from cohort)
  )
  select jsonb_build_object(
    'landing_users', (select count(*) from cohort),
    'pricing_viewed', (select count(distinct uid) from ev where event_name = 'pricing_viewed'),
    'checkout_started', (select count(distinct uid) from ev where event_name = 'checkout_started'),
    'purchases', (select count(distinct uid) from real_purchases),
    'revenue', (select coalesce(sum(amount_cents), 0) / 100.0 from real_purchases)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_ground_school_funnel_stats(p_start timestamptz default null, p_end timestamptz default null)
returns jsonb
language plpgsql
stable security definer
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
    where event_name = 'ground_school_schedule_viewed'
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  ev as (
    select public.resolve_analytics_identity(anon_id, profile_id) as uid, event_name, properties->>'product' as product
    from public.analytics_events
    where event_name in ('ground_school_class_selected', 'ground_school_reserve_form_opened', 'checkout_started')
      and public.resolve_analytics_identity(anon_id, profile_id) in (select uid from cohort)
  ),
  -- Revenue Reporting Accuracy (v153) -- real purchases, not
  -- purchase_completed. ground_school_pack_upgrade is folded into the
  -- same full-course bucket as ground_school_pack -- both result in the
  -- same full-course ownership, and the upgrade path previously had no
  -- client-side purchase_completed tracking at all, so this also fixes a
  -- second, narrower undercount on top of the event-vs-table one.
  real_purchases as (
    select uid, case when product = 'ground_school_pack_upgrade' then 'ground_school_pack' else product end as product, amount_cents
    from public.verified_purchases
    where product in ('ground_school_class', 'ground_school_pack', 'ground_school_pack_upgrade')
      and uid in (select uid from cohort)
  )
  select jsonb_build_object(
    'schedule_viewers', (select count(*) from cohort),
    'class_selected', (select count(distinct uid) from ev where event_name = 'ground_school_class_selected'),
    'reserve_form_opened', (select count(distinct uid) from ev where event_name = 'ground_school_reserve_form_opened'),
    'checkout_started', (select count(distinct uid) from ev where event_name = 'checkout_started' and product in ('ground_school_class', 'ground_school_pack')),
    'purchases', (select count(*) from real_purchases),
    'single_class_purchases', (select count(*) from real_purchases where product = 'ground_school_class'),
    'full_course_purchases', (select count(*) from real_purchases where product = 'ground_school_pack'),
    'revenue', (select coalesce(sum(amount_cents), 0) / 100.0 from real_purchases),
    'avg_purchase_value', (select case when count(*) > 0 then round(avg(amount_cents) / 100.0, 2) else null end from real_purchases)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_utm_campaign_performance(p_start timestamptz default null, p_end timestamptz default null)
returns jsonb
language plpgsql
stable security definer
set search_path = public
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
    select s.uid, s.event_name, ft.source, ft.medium, ft.campaign
    from scoped s
    join first_touch ft on ft.uid = s.uid
  ),
  -- Revenue Reporting Accuracy (v153) -- real purchases attributed to the
  -- same first-touch cohort, instead of filtering `attributed` itself for
  -- event_name = 'purchase_completed'. The old event-sourced version
  -- implicitly required the purchase_completed event itself to fall
  -- inside [p_start, p_end) (it was one of the date-filtered `scoped`
  -- rows) -- preserved here with an explicit paid_at filter, unlike the
  -- per-product funnel RPCs above where a purchase deliberately counts
  -- even after its cohort's window closes. Without this, a user's entire
  -- purchase history would get pulled into whatever short date range
  -- happened to contain any one of their touches.
  purchase_attrib as (
    select vp.uid, vp.amount_cents, ft.source, ft.medium, ft.campaign
    from public.verified_purchases vp
    join first_touch ft on ft.uid = vp.uid
    where (p_start is null or vp.paid_at >= p_start)
      and (p_end is null or vp.paid_at < p_end)
  ),
  purchase_by_campaign as (
    select source, medium, campaign, count(*) as purchases, coalesce(sum(amount_cents), 0) / 100.0 as revenue
    from purchase_attrib
    group by source, medium, campaign
  )
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result
  from (
    select
      a.source, a.medium, a.campaign,
      public.classify_marketing_channel(nullif(a.source, 'direct'), nullif(a.medium, 'none')) as channel,
      count(distinct a.uid) filter (where a.event_name = 'landing_page_viewed') as landing_users,
      count(distinct a.uid) filter (where a.event_name = 'registration_completed') as registrations,
      count(distinct a.uid) filter (where a.event_name = 'readiness_assessment_started') as readiness_starts,
      count(distinct a.uid) filter (where a.event_name = 'readiness_assessment_completed') as readiness_completes,
      count(distinct a.uid) filter (where a.event_name = 'checkout_started') as checkout_starts,
      coalesce(pbc.purchases, 0) as purchases,
      coalesce(pbc.revenue, 0) as revenue
    from attributed a
    left join purchase_by_campaign pbc
      on pbc.source = a.source and pbc.medium = a.medium and pbc.campaign = a.campaign
    group by a.source, a.medium, a.campaign, pbc.purchases, pbc.revenue
  ) t;

  return v_result;
end;
$$;

create or replace function public.get_channel_performance(p_start timestamptz default null, p_end timestamptz default null)
returns jsonb
language plpgsql
stable security definer
set search_path = public
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
    select s.uid, s.event_name, ft.channel
    from scoped s
    join first_touch ft on ft.uid = s.uid
  ),
  -- Revenue Reporting Accuracy (v153) -- real purchases attributed to the
  -- same first-touch channel cohort, instead of filtering `attributed`
  -- itself for event_name = 'purchase_completed'. Same explicit paid_at
  -- range filter as get_utm_campaign_performance, for the same reason --
  -- see that function's comment.
  purchase_attrib as (
    select vp.uid, vp.amount_cents, ft.channel
    from public.verified_purchases vp
    join first_touch ft on ft.uid = vp.uid
    where (p_start is null or vp.paid_at >= p_start)
      and (p_end is null or vp.paid_at < p_end)
  ),
  purchase_by_channel as (
    select channel, count(*) as purchases, coalesce(sum(amount_cents), 0) / 100.0 as revenue
    from purchase_attrib
    group by channel
  )
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result
  from (
    select
      a.channel,
      count(distinct a.uid) filter (where a.event_name = 'landing_page_viewed') as landing_users,
      count(distinct a.uid) filter (where a.event_name = 'registration_completed') as registrations,
      count(distinct a.uid) filter (where a.event_name = 'checkout_started') as checkout_starts,
      coalesce(pbc.purchases, 0) as purchases,
      coalesce(pbc.revenue, 0) as revenue
    from attributed a
    left join purchase_by_channel pbc on pbc.channel = a.channel
    group by a.channel, pbc.purchases, pbc.revenue
  ) t;

  return v_result;
end;
$$;
