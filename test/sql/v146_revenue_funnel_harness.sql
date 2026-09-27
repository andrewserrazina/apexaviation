-- Minimal, self-contained local harness for validating v146's SQL in
-- isolation -- stubs only the pre-existing objects v146 assumes already
-- exist (profiles, analytics_events, analytics_identity_map,
-- checkout_session_attempts, stripe_webhook_events,
-- portal_access_purchases, is_admin(), resolve_analytics_identity(),
-- classify_marketing_channel()'s pre-v146 shape), with column
-- names/types/constraints verified against the live production schema
-- via mcp__Supabase__execute_sql during the Revenue Funnel + Attribution
-- Integrity sprint audit -- not the full 145-migration history, given
-- this sprint's scope. See REVENUE_FUNNEL_ATTRIBUTION_SPRINT_REPORT.md's
-- Tests section for why this harness, not test/run_security_regression_
-- tests.sh's full rebuild, was used for this migration.
drop schema if exists public cascade;
create schema public;
create extension if not exists pgcrypto;

-- Real Supabase provides auth.uid() (reads the request JWT); the harness
-- only needs it to exist so is_admin(auth.uid()) call sites resolve --
-- what it returns is irrelevant since the harness's own is_admin() stub
-- (below) ignores its argument and reads a GUC instead.
drop schema if exists auth cascade;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  role text not null default 'student'
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

create table public.checkout_session_attempts (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  purpose text not null,
  email text,
  profile_id uuid,
  amount_cents integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  recovery_email_sent_at timestamptz,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text
);

create table public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create table public.portal_access_purchases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  email text not null,
  full_name text,
  stripe_session_id text not null unique,
  amount_cents integer not null,
  tier text not null,
  created_at timestamptz not null default now()
);

-- Toggleable for tests via `set app.current_is_admin = 'true';` -- real
-- production is_admin() checks profiles.role instead, irrelevant to what
-- v146's new functions actually compute.
create or replace function public.is_admin(p_uid uuid default null)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.current_is_admin', true), 'false') = 'true';
$$;

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

-- Pre-v146 shape (no 'fb'/'ig' aliases) -- proves the "before" behavior
-- this migration fixes, then v146.sql's CREATE OR REPLACE overwrites it.
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
    when lower(coalesce(p_medium, '')) = 'social'
      or (coalesce(p_medium, '') = '' and lower(coalesce(p_source, '')) in ('facebook', 'instagram', 'tiktok', 'twitter', 'x', 'linkedin', 'youtube'))
      then 'Organic Social'
    else 'Unknown / Unattributed'
  end;
$$;
