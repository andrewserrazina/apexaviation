-- Apex Advantage Member Portal — Stripe payments schema (v3)
--
-- Run this in the Supabase SQL editor, same project as the other
-- supabase-portal-schema*.sql files and apexadvantage/supabase-schema.sql.
--
-- Both tables here are only ever touched by the Stripe Edge Functions
-- (create-checkout-session, stripe-webhook) using the service_role key,
-- which bypasses RLS entirely — so these policies exist only to make
-- sure no anon/authenticated client can read or write them directly.

-- ─────────────────────────────────────────────────────────────────
-- 1. Portal access purchases — the $29/$49 founder-pricing counter
-- First 25 paid rows = $29 tier; everything after = $49 tier.
-- ─────────────────────────────────────────────────────────────────
create table public.portal_access_purchases (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid references public.profiles(id),
  email              text not null,
  full_name          text,
  stripe_session_id  text not null unique,
  amount_cents       integer not null,
  tier               text not null check (tier in ('founding', 'standard')),
  created_at         timestamptz not null default now()
);

alter table public.portal_access_purchases enable row level security;

create policy "Admins can view all portal access purchases"
  on public.portal_access_purchases for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 2. Stripe webhook event log — idempotency guard against retries
-- ─────────────────────────────────────────────────────────────────
create table public.stripe_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

create policy "Admins can view all webhook events"
  on public.stripe_webhook_events for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
