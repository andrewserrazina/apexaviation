-- v146 -- Revenue Funnel + Attribution Integrity Sprint
--
-- Four independent, additive fixes, none of which touch existing
-- financial/entitlement records:
--
-- 1. stripe_webhook_events gets a real lifecycle (received/processing/
--    processed/failed) instead of "insert row -> always return 200" --
--    see the header comment above the ALTER TABLE below for the exact
--    failure mode this closes. Existing 24 rows are backfilled to
--    'processed': every one of them corresponds to a purchase that is
--    already verified present in its target table (portal_access_
--    purchases, study_pack_entitlements, scheduled_ground_class_
--    enrollments, member_subscriptions all reconcile 1:1 against Stripe
--    for the current data), so this is a safe default, not a guess --
--    there is no evidence any historical event silently failed.
--
-- 2. checkout_session_attempts gets fulfillment_status/fulfillment_error/
--    fulfillment_at, written by stripe-webhook after it actually runs
--    the purpose-specific handler (success or failure) -- distinct from
--    completed_at, which only ever meant "Stripe said this session
--    completed," not "we successfully fulfilled it." This is what lets
--    Section 7's reconciliation question ("created / completed /
--    fulfillment successful / fulfillment failed") actually be answered
--    per session. Existing rows are backfilled conservatively:
--    completed_at is not null -> fulfillment_status = 'succeeded' (best
--    effort -- no historical per-session fulfillment record exists
--    before this migration, so this assumes what completed_at has always
--    implicitly assumed); completed_at is null -> left NULL (never
--    reached completion, nothing to backfill).
--
-- 3. classify_marketing_channel() is fixed to recognize 'fb' and 'ig' as
--    the same platforms as 'facebook'/'instagram' (real production data:
--    79 assessment views tagged utm_source=fb, 15 tagged ig, both
--    currently falling through to 'Unknown / Unattributed' purely
--    because the abbreviation wasn't in the source list -- not because
--    the traffic is actually unattributed). normalize_marketing_source()
--    is new: a raw-value -> canonical-brand mapping (facebook/fb/meta ->
--    "Meta / Facebook", instagram/ig -> "Meta / Instagram", etc.) for
--    reporting only -- every raw utm_source value on every row is
--    untouched.
--
-- 4. A partial unique index makes purchase_completed analytics rows
--    idempotent server-side, keyed on the Stripe Checkout Session id
--    already present in every purchase_completed event's properties --
--    closing the gap in the existing client-side (localStorage-only)
--    dedupe guard, which does not survive a different browser/device/
--    private window replaying the same success_url.
--
-- 5. get_revenue_funnel_by_campaign(): the maintainable "for every 100
--    visitors from campaign X, what happened" reporting RPC (Section 10),
--    built on the same resolve_analytics_identity()-based first-touch-
--    per-visitor attribution already proven in get_channel_performance()
--    -- not a new attribution mechanism, an extension of the one that
--    already exists. Revenue comes from portal_access_purchases
--    (authoritative), joined through checkout_session_attempts, never
--    from analytics_events.

-- ── 1. stripe_webhook_events lifecycle ──────────────────────────────
alter table public.stripe_webhook_events
  add column if not exists status text not null default 'received',
  add column if not exists attempt_count integer not null default 1,
  add column if not exists last_error text,
  add column if not exists processed_at timestamptz;

alter table public.stripe_webhook_events
  drop constraint if exists stripe_webhook_events_status_check;
alter table public.stripe_webhook_events
  add constraint stripe_webhook_events_status_check
  check (status in ('received', 'processing', 'processed', 'failed'));

-- Backfill: see header comment above for why 'processed' is the safe
-- default for every pre-existing row (all reconcile against their target
-- tables already).
update public.stripe_webhook_events
  set status = 'processed', processed_at = processed_at
  where status = 'received';
update public.stripe_webhook_events
  set processed_at = coalesce(processed_at, now())
  where status = 'processed' and processed_at is null;

-- ── 2. checkout_session_attempts fulfillment tracking ───────────────
alter table public.checkout_session_attempts
  add column if not exists fulfillment_status text,
  add column if not exists fulfillment_error text,
  add column if not exists fulfillment_at timestamptz;

alter table public.checkout_session_attempts
  drop constraint if exists checkout_session_attempts_fulfillment_status_check;
alter table public.checkout_session_attempts
  add constraint checkout_session_attempts_fulfillment_status_check
  check (fulfillment_status is null or fulfillment_status in ('succeeded', 'failed'));

update public.checkout_session_attempts
  set fulfillment_status = 'succeeded', fulfillment_at = completed_at
  where completed_at is not null and fulfillment_status is null;

comment on column public.checkout_session_attempts.fulfillment_status is
  'Set by stripe-webhook after it actually runs the purpose-specific handler for this session -- distinct from completed_at (which only records that Stripe reported the session completed). NULL means either the session never completed, or it completed before this column existed (backfilled from completed_at, see v146).';

-- ── 3. Channel classification: recognize fb/ig abbreviations ───────
-- Same signature/behavior as before for every source value it already
-- handled correctly -- this only adds 'fb' and 'ig' to the platform
-- lists classify_marketing_channel() already checks against.
create or replace function public.classify_marketing_channel(p_source text, p_medium text)
returns text
language sql
immutable
as $$
  select case
    when p_source is null and p_medium is null then 'Direct'
    when lower(coalesce(p_medium, '')) in ('cpc', 'ppc', 'paid', 'paidsocial', 'paid_social')
      and lower(coalesce(p_source, '')) in ('facebook', 'fb', 'meta', 'instagram', 'ig', 'tiktok', 'snapchat', 'linkedin')
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
      or (coalesce(p_medium, '') = '' and lower(coalesce(p_source, '')) in ('facebook', 'fb', 'instagram', 'ig', 'tiktok', 'twitter', 'x', 'linkedin', 'youtube'))
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

-- Reporting-only brand normalization -- never overwrites a raw utm_source
-- value anywhere; every caller passes the raw value in and gets a
-- canonical grouping back out. 'manychat' as a medium/source (Instagram
-- DM-automation traffic, confirmed present in production profiles.
-- signup_utm_medium) groups under Instagram/Meta by source, same as any
-- other Instagram-originated visit -- manychat is a delivery mechanism,
-- not a distinct platform.
create or replace function public.normalize_marketing_source(p_source text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_source, ''))
    when '' then 'Direct / Unknown'
    when 'facebook' then 'Meta / Facebook'
    when 'fb' then 'Meta / Facebook'
    when 'meta' then 'Meta / Facebook'
    when 'instagram' then 'Meta / Instagram'
    when 'ig' then 'Meta / Instagram'
    when 'google' then 'Google'
    when 'adwords' then 'Google'
    when 'bing' then 'Bing'
    when 'youtube' then 'YouTube'
    when 'tiktok' then 'TikTok'
    when 'snapchat' then 'Snapchat'
    when 'linkedin' then 'LinkedIn'
    when 'twitter' then 'X / Twitter'
    when 'x' then 'X / Twitter'
    when 'email' then 'Email'
    when 'direct' then 'Direct / Unknown'
    else initcap(p_source)
  end;
$$;

grant execute on function public.classify_marketing_channel(text, text) to authenticated, anon;
grant execute on function public.normalize_marketing_source(text) to authenticated, anon;

-- ── 4. Server-side purchase_completed idempotency ───────────────────
-- A page refresh, a copy-pasted success_url opened in a second browser,
-- or cleared localStorage can all replay the client-side purchase_
-- completed insert -- the existing dedupe (site/portal-stable.js,
-- localStorage-keyed on session_id) only protects the one browser that
-- fired it first. This makes the guarantee real at the database level:
-- at most one purchase_completed row per Stripe Checkout Session id,
-- full stop. A blocked duplicate insert is swallowed by the existing
-- .catch()/.then(res.error) handling in analytics-events.js's track() --
-- already a no-op-on-failure path, so no client change is required for
-- this to take effect.
create unique index if not exists analytics_events_purchase_completed_session_unique
  on public.analytics_events (((properties->>'session_id')))
  where event_name = 'purchase_completed' and properties ? 'session_id';

-- ── 5. Campaign-level funnel reporting ──────────────────────────────
-- "For every 100 visitors from campaign X, what happened" -- Section 10.
-- Attribution model: each visitor (resolve_analytics_identity(anon_id,
-- profile_id), same identity-merge helper get_channel_performance()
-- already uses) is attributed to the FIRST analytics_events row it ever
-- generated that carried real source/medium/campaign/content -- i.e. a
-- first-touch model computed at query time from the event stream itself,
-- not from a single event's own properties. This is what makes campaign
-- attribution survive the anonymous-visitor -> signup -> authenticated-
-- profile journey (Section 2C/2D) regardless of which specific event a
-- report groups by -- exactly the gap that made assessment completions
-- look "direct/unknown" when a naive per-event group-by was used instead
-- (see Section 2/3 audit notes in the sprint report).
--
-- Revenue is read ONLY from portal_access_purchases (authoritative,
-- Checkride Prep), joined through checkout_session_attempts on
-- stripe_session_id to recover that specific purchase's attribution --
-- never from analytics_events.properties.price. A purchase whose
-- checkout_session_attempts row predates utm capture (or was created by
-- a path that never logged one) simply has null source/medium/campaign
-- here rather than a fabricated one.
create or replace function public.get_revenue_funnel_by_campaign(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table (
  source text,
  medium text,
  campaign text,
  content text,
  normalized_source text,
  channel text,
  visitors bigint,
  assessment_views bigint,
  assessment_starts bigint,
  assessment_completions bigint,
  signup_starts bigint,
  signup_completions bigint,
  paid_offer_views bigint,
  paid_offer_clicks bigint,
  checkout_sessions_created bigint,
  checkouts_completed bigint,
  purchases bigint,
  revenue_cents bigint
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
  with scoped as (
    select
      public.resolve_analytics_identity(ae.anon_id, ae.profile_id) as uid,
      ae.event_name,
      nullif(ae.properties->>'traffic_source', '') as ev_source,
      nullif(ae.properties->>'traffic_medium', '') as ev_medium,
      nullif(ae.properties->>'campaign', '') as ev_campaign,
      nullif(ae.properties->>'traffic_content', '') as ev_content,
      ae.created_at
    from public.analytics_events ae
    where (p_start is null or ae.created_at >= p_start)
      and (p_end is null or ae.created_at < p_end)
  ),
  first_touch as (
    -- First row per visitor that actually carried an attributable
    -- source/medium (falls back to that visitor's very first row at all
    -- when none ever did, so a genuinely direct/organic visitor still
    -- gets one bucket instead of being dropped).
    select distinct on (uid)
      uid, ev_source as source, ev_medium as medium, ev_campaign as campaign, ev_content as content
    from scoped
    where ev_source is not null or ev_medium is not null
    order by uid, created_at asc
  ),
  fallback_touch as (
    select distinct on (uid)
      uid, ev_source as source, ev_medium as medium, ev_campaign as campaign, ev_content as content
    from scoped
    order by uid, created_at asc
  ),
  attribution as (
    select f.uid, coalesce(t.source, f.source) as source, coalesce(t.medium, f.medium) as medium,
      coalesce(t.campaign, f.campaign) as campaign, coalesce(t.content, f.content) as content
    from fallback_touch f
    left join first_touch t on t.uid = f.uid
  ),
  events_by_visitor as (
    select a.source, a.medium, a.campaign, a.content, s.uid, s.event_name
    from scoped s
    join attribution a on a.uid = s.uid
  ),
  purchase_rows as (
    -- portal_access_purchases itself carries no attribution columns --
    -- checkout_session_attempts (this specific session's own utm_* at
    -- checkout time) is the only source for it here. A purchase whose
    -- checkout_session_attempts row predates utm capture, or was created
    -- by a path that never logged one, simply groups under null/null/
    -- null/null (-> "Direct / Unknown" via normalize_marketing_source)
    -- rather than a fabricated source.
    select
      csa.utm_source as source,
      csa.utm_medium as medium,
      csa.utm_campaign as campaign,
      csa.utm_content as content,
      p.id, p.amount_cents
    from public.portal_access_purchases p
    left join public.checkout_session_attempts csa on csa.stripe_session_id = p.stripe_session_id
    where (p_start is null or p.created_at >= p_start)
      and (p_end is null or p.created_at < p_end)
  )
  select
    grp.source, grp.medium, grp.campaign, grp.content,
    public.normalize_marketing_source(grp.source) as normalized_source,
    public.classify_marketing_channel(grp.source, grp.medium) as channel,
    count(distinct grp.uid) filter (where grp.event_name = 'readiness_assessment_viewed') as visitors,
    count(distinct grp.uid) filter (where grp.event_name = 'readiness_assessment_viewed') as assessment_views,
    count(distinct grp.uid) filter (where grp.event_name = 'readiness_assessment_started') as assessment_starts,
    count(distinct grp.uid) filter (where grp.event_name = 'readiness_assessment_completed') as assessment_completions,
    count(distinct grp.uid) filter (where grp.event_name = 'readiness_signup_started') as signup_starts,
    count(distinct grp.uid) filter (where grp.event_name = 'readiness_signup_completed') as signup_completions,
    count(distinct grp.uid) filter (where grp.event_name in ('readiness_checkride_prep_offer_viewed', 'checkride_prep_upgrade_modal_opened', 'upgrade_prompt_viewed')) as paid_offer_views,
    count(distinct grp.uid) filter (where grp.event_name in ('readiness_checkride_prep_clicked', 'upgrade_prompt_clicked', 'checkride_prep_checkout_started')) as paid_offer_clicks,
    count(distinct grp.uid) filter (where grp.event_name = 'checkout_started') as checkout_sessions_created,
    0::bigint as checkouts_completed, -- filled in from purchase_rows below via the outer aggregation
    0::bigint as purchases,
    0::bigint as revenue_cents
  from events_by_visitor grp
  group by grp.source, grp.medium, grp.campaign, grp.content

  union all

  select
    pr.source, pr.medium, pr.campaign, pr.content,
    public.normalize_marketing_source(pr.source) as normalized_source,
    public.classify_marketing_channel(pr.source, pr.medium) as channel,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    count(*) as checkouts_completed,
    count(*) as purchases,
    coalesce(sum(pr.amount_cents), 0) as revenue_cents
  from purchase_rows pr
  group by pr.source, pr.medium, pr.campaign, pr.content;
end;
$$;

revoke all on function public.get_revenue_funnel_by_campaign(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_revenue_funnel_by_campaign(timestamptz, timestamptz) to authenticated;

comment on function public.get_revenue_funnel_by_campaign(timestamptz, timestamptz) is
  'Per-campaign funnel + revenue breakdown (Section 10 reporting RPC). Returns two row shapes unioned together -- funnel-step rows (visitors..checkout_sessions_created populated, checkouts_completed/purchases/revenue_cents zeroed) and revenue rows (the reverse) -- because they are aggregated over different source tables (analytics_events visitor identities vs. authoritative portal_access_purchases). Callers (admin dashboard) sum both row-sets per source/medium/campaign/content group client-side rather than this function attempting a single fully-joined row, which would either double-count visitors or silently drop purchases with no matching analytics_events identity (e.g. a purchase from a visitor whose anon_id was never linked). Admin-only.';
