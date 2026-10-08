-- Minimal, self-contained local harness for validating v156's SQL in
-- isolation -- stubs only the pre-existing objects v156 assumes already
-- exist (profiles w/ existing signup_utm_*/first_touch_*/last_touch_*
-- columns, analytics_events, analytics_identity_map,
-- readiness_assessment_leads, checkout_session_attempts, invoices,
-- ground_registrations, is_admin(), auth.uid(),
-- classify_marketing_channel(), normalize_marketing_source()), with
-- column names/types verified against the live production schema via
-- mcp__Supabase__execute_sql during this migration's audit -- matches
-- the same convention as test/sql/v146_revenue_funnel_harness.sql and
-- test/sql/v149_checkride_binder_harness.sql. Not the full migration
-- history, given v156's scope (additive columns/tables layered on top of
-- a handful of pre-existing ones).
drop schema if exists public cascade;
create schema public;
create extension if not exists pgcrypto;

drop schema if exists auth cascade;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select current_setting('app.current_uid', true)::uuid $$;

-- Real Supabase projects always have these 3 roles; a bare local
-- Postgres doesn't, and v156.sql's `revoke ... from public, anon,
-- authenticated` statements error without them ("role anon does not
-- exist"). Created here only so the migration applies cleanly end to
-- end -- v146/v149's harnesses predate this migration having any
-- anon-targeting revoke, so they never needed this.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end $$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  role text not null default 'student',
  signup_utm_source text,
  signup_utm_medium text,
  signup_utm_campaign text,
  signup_utm_content text,
  signup_utm_term text,
  last_touch_source text,
  last_touch_medium text,
  last_touch_campaign text,
  last_touch_content text,
  last_touch_term text,
  last_touch_at timestamptz,
  last_touch_landing_page text,
  first_touch_landing_page text,
  first_touch_at timestamptz
);

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  anon_id text,
  profile_id uuid,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.analytics_identity_map (
  anon_id text primary key,
  profile_id uuid not null,
  linked_at timestamptz not null default now()
);

create table public.readiness_assessment_leads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  email text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now()
);

create table public.checkout_session_attempts (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  purpose text not null,
  email text,
  profile_id uuid,
  amount_cents integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid,
  product text,
  amount_cents integer,
  status text,
  issued_at timestamptz not null default now(),
  stripe_session_id text
);

create table public.ground_registrations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  amount_cents integer,
  payment_status text,
  registered_at timestamptz not null default now(),
  stripe_session_id text
);

create or replace function public.is_admin(p_uid uuid default null)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.current_is_admin', true), 'false') = 'true';
$$;

-- Real shape (supabase-portal-schema-v146.sql) -- only the pieces this
-- migration's view actually calls through to matter for validation.
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
    when lower(coalesce(p_medium, '')) = 'email' then 'Email'
    else 'Unknown / Unattributed'
  end;
$$;

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
    else initcap(p_source)
  end;
$$;

\echo '--- applying v156 migration ---'
\i portal/supabase-portal-schema-v156-acquisition-attribution-repair.sql

\echo '--- assertion 1: new profiles columns exist with expected types ---'
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in (
    'first_touch_referrer', 'first_touch_click_ids', 'first_touch_anon_id',
    'signup_touch_source', 'signup_touch_medium', 'signup_touch_campaign',
    'signup_touch_content', 'signup_touch_term', 'signup_touch_referrer',
    'signup_touch_click_ids', 'signup_touch_landing_page', 'signup_touch_at'
  )
order by column_name;

\echo '--- assertion 2: new checkout_session_attempts columns exist ---'
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'checkout_session_attempts'
  and column_name in ('referrer', 'click_ids')
order by column_name;

\echo '--- assertion 3: verified_purchases now exposes stripe_session_id ---'
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'verified_purchases' and column_name = 'stripe_session_id';

-- ============================================================
-- Fixtures for canonical_paid_transaction_attribution + backfill
-- proposal tiers.
-- ============================================================

-- Profile A: has signup_utm_source already (control -- no proposal
-- should ever be generated for a profile that already has a value).
insert into public.profiles (id, signup_utm_source) values
  ('00000000-0000-0000-0000-00000000000a', 'google');

-- Profile B: signup_utm_source null, but linked via analytics_identity_map
-- to an anon_id whose earliest tagged event carried traffic_source
-- (tier 1 evidence -- high confidence).
insert into public.profiles (id) values ('00000000-0000-0000-0000-00000000000b');
insert into public.analytics_identity_map (anon_id, profile_id) values ('anon-b', '00000000-0000-0000-0000-00000000000b');
insert into public.analytics_events (event_name, anon_id, properties, created_at) values
  ('page_viewed', 'anon-b', '{"traffic_source": "facebook"}'::jsonb, now() - interval '10 days'),
  ('page_viewed', 'anon-b', '{"traffic_source": "google"}'::jsonb, now() - interval '2 days'); -- later touch, must NOT win (earliest wins)

-- Profile C: signup_utm_source null, readiness_assessment_leads evidence
-- only (tier 2 -- high confidence).
insert into public.profiles (id) values ('00000000-0000-0000-0000-00000000000c');
insert into public.readiness_assessment_leads (profile_id, utm_source, created_at) values
  ('00000000-0000-0000-0000-00000000000c', 'instagram', now() - interval '5 days');

-- Profile D: signup_utm_source null, ONLY checkout_session_attempts
-- evidence (tier 3 -- medium confidence, purchase-touch proxy).
insert into public.profiles (id) values ('00000000-0000-0000-0000-00000000000d');
insert into public.checkout_session_attempts (stripe_session_id, purpose, profile_id, amount_cents, utm_source, created_at) values
  ('cs_test_d', 'unlock-checkride-prep', '00000000-0000-0000-0000-00000000000d', 2900, 'email', now() - interval '1 day');

-- Profile E: has BOTH analytics_identity_map evidence (tier 1) AND
-- checkout_session_attempts evidence -- tier 3 must be suppressed by the
-- not-exists guard since tier 1 already covers this profile/field.
insert into public.profiles (id) values ('00000000-0000-0000-0000-00000000000e');
insert into public.analytics_identity_map (anon_id, profile_id) values ('anon-e', '00000000-0000-0000-0000-00000000000e');
insert into public.analytics_events (event_name, anon_id, properties, created_at) values
  ('page_viewed', 'anon-e', '{"utm_source": "fb"}'::jsonb, now() - interval '20 days');
insert into public.checkout_session_attempts (stripe_session_id, purpose, profile_id, amount_cents, utm_source, created_at) values
  ('cs_test_e', 'unlock-checkride-prep', '00000000-0000-0000-0000-00000000000e', 2900, 'email', now() - interval '1 day');

-- Profile F: a real paid transaction with a matching checkout attempt
-- (purchase-touch) AND profile-level first/signup touch -- exercises
-- canonical_paid_transaction_attribution's 3-way join + no double count.
insert into public.profiles (
  id, signup_utm_source, signup_utm_medium, first_touch_landing_page, first_touch_at,
  signup_touch_source, signup_touch_medium, signup_touch_referrer, signup_touch_at
) values (
  '00000000-0000-0000-0000-00000000000f', 'google', 'organic', 'https://apexaviationtx.com/landing', now() - interval '30 days',
  'facebook', 'paid_social', 'https://facebook.com/ads/123', now() - interval '1 day'
);
insert into public.invoices (student_id, product, amount_cents, status, issued_at, stripe_session_id) values
  ('00000000-0000-0000-0000-00000000000f', 'checkride_prep', 2900, 'paid', now() - interval '1 day', 'cs_test_f');
insert into public.checkout_session_attempts (stripe_session_id, purpose, profile_id, amount_cents, utm_source, utm_medium, referrer, created_at) values
  ('cs_test_f', 'unlock-checkride-prep', '00000000-0000-0000-0000-00000000000f', 2900, 'facebook', 'paid_social', 'https://facebook.com/ads/123', now() - interval '1 day');

\echo '--- assertion 4: canonical_paid_transaction_attribution row count matches verified_purchases exactly (no double-counting) ---'
select
  (select count(*) from public.verified_purchases) as verified_purchases_rows,
  (select count(*) from public.canonical_paid_transaction_attribution) as canonical_view_rows,
  (select count(*) from public.verified_purchases) = (select count(*) from public.canonical_paid_transaction_attribution) as row_counts_match;

\echo '--- assertion 5: canonical view correctly separates first-touch / signup-touch / purchase-touch for profile F (all three differ) ---'
select
  profile_id, product,
  first_touch_source, first_touch_medium,
  signup_touch_source, signup_touch_medium, signup_touch_referrer,
  purchase_touch_source, purchase_touch_medium, purchase_touch_referrer,
  purchase_touch_source_normalized, purchase_touch_channel
from public.canonical_paid_transaction_attribution
where profile_id = '00000000-0000-0000-0000-00000000000f';

\echo '--- assertion 6: generate_attribution_backfill_proposals() rejects non-admin ---'
set app.current_is_admin = 'false';
do $$
begin
  perform public.generate_attribution_backfill_proposals();
  raise exception 'SHOULD NOT REACH HERE -- non-admin call should have raised';
exception
  when others then
    if sqlerrm = 'Admin access required' then
      raise notice 'PASS: non-admin call correctly rejected';
    else
      raise exception 'FAIL: unexpected error: %', sqlerrm;
    end if;
end $$;

\echo '--- assertion 7: generate_attribution_backfill_proposals() as admin -- tier counts ---'
set app.current_is_admin = 'true';
select public.generate_attribution_backfill_proposals() as proposals_inserted_first_run;

select profile_id, field_name, proposed_value, evidence_source, confidence
from public.attribution_backfill_proposals
order by profile_id;

\echo '--- assertion 8: profile A (already has signup_utm_source) got NO proposal ---'
select count(*) as should_be_zero from public.attribution_backfill_proposals
where profile_id = '00000000-0000-0000-0000-00000000000a';

\echo '--- assertion 9: profile B proposal used the EARLIEST tagged event (facebook, not the later google one) ---'
select proposed_value from public.attribution_backfill_proposals
where profile_id = '00000000-0000-0000-0000-00000000000b';

\echo '--- assertion 10: profile E has a tier-1 (analytics_identity_map) proposal and NO tier-3 (checkout_session_attempts) proposal -- the not-exists guard suppressed it ---'
select evidence_source, confidence from public.attribution_backfill_proposals
where profile_id = '00000000-0000-0000-0000-00000000000e';

\echo '--- assertion 11: profile D (checkout-only evidence) got a medium-confidence tier-3 proposal ---'
select evidence_source, confidence, proposed_value from public.attribution_backfill_proposals
where profile_id = '00000000-0000-0000-0000-00000000000d';

\echo '--- assertion 12: re-running the generator is idempotent -- zero NEW rows, no duplicates/overwrites ---'
select public.generate_attribution_backfill_proposals() as proposals_inserted_second_run;
select count(*) as total_proposal_rows from public.attribution_backfill_proposals;

\echo '--- assertion 13: RLS is enabled on attribution_backfill_proposals with admin-only select/update policies (matches test/sql harness convention -- role-based RLS enforcement is covered by test/run_security_regression_tests.sh''s full-DB harness, not this minimal one) ---'
select relrowsecurity from pg_class where oid = 'public.attribution_backfill_proposals'::regclass;
select policyname, cmd from pg_policies where tablename = 'attribution_backfill_proposals' order by policyname;

\echo '--- harness complete ---'
