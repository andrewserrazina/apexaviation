-- Apple In-App Purchase entitlements (v157)
--
-- *** THIS MIGRATION IS NOT APPLIED TO PRODUCTION. ***
-- Written for review only, per this session's explicit instruction.
-- Additive only (two new tables, nothing dropped/altered on any
-- existing table) -- applying it to the live project requires separate,
-- explicit human approval.
--
-- Context: Checkride Prep is a one-time, non-consumable purchase
-- already unlockable via Stripe on the web (profiles.checkride_prep_
-- unlocked, flipped only by stripe-webhook/index.ts). This adds the
-- Apple-IAP-side source of truth for the exact same flag, following the
-- same shape/RLS pattern as the existing Stripe audit tables
-- (portal_access_purchases / stripe_webhook_events, supabase-portal-
-- schema-v3.sql) -- RLS enabled, admin-only SELECT, no anon/
-- authenticated write policy of any kind. Both new tables are written
-- ONLY by the apple-iap-verify-purchase and apple-app-store-
-- notifications Edge Functions, using the service-role key (bypasses
-- RLS entirely, same as every Stripe handler already does) -- matching
-- this project's one existing mutation path for checkride_prep_
-- unlocked (profiles' own RLS already blocks a member from setting it
-- themselves: see the trg_lock_profile_privileged_columns trigger,
-- v8.sql).
--
-- Why a SEPARATE table rather than reusing portal_access_purchases:
-- that table's stripe_session_id is `not null unique` and the whole
-- revenue-reporting path (invoices) is Stripe-session-keyed. Apple's
-- JWSTransactionDecodedPayload explicitly warns: "Don't use the price
-- or currency values for any revenue reconciliation or recognition.
-- App Store Connect reporting is your source of record for financial
-- and accounting purposes." (verified verbatim against Apple's own
-- app-store-server-library source). So this is deliberately NOT mirrored
-- into `invoices` (which feeds the admin "Total Platform Revenue"
-- dashboard) with a dollar figure Apple itself disclaims -- Apple IAP
-- revenue should be read from App Store Connect's own sales reports,
-- not from this table. apple_iap_transactions exists to answer "does
-- this profile have a verified Apple grant, and is it still valid,"
-- not "how much Apple revenue did we make."

-- ─────────────────────────────────────────────────────────────────
-- 1. apple_iap_transactions -- one row per verified Apple transaction.
-- First successful verify-and-claim for a given transaction_id owns it
-- permanently; a different profile later presenting the same
-- transaction_id (e.g. restoring on a new account) is never silently
-- reassigned -- see apple-iap-verify-purchase/index.ts's own comment
-- for the exact "already claimed by another account" policy.
-- ─────────────────────────────────────────────────────────────────
create table public.apple_iap_transactions (
  id                       uuid primary key default gen_random_uuid(),
  profile_id               uuid not null references public.profiles(id),
  product_id               text not null,
  transaction_id           text not null unique,
  original_transaction_id  text not null,
  bundle_id                text not null,
  environment              text not null check (environment in ('Sandbox', 'Production')),
  purchase_date            timestamptz not null,
  original_purchase_date   timestamptz not null,
  -- Informational only -- see header comment on why this is never used
  -- for revenue reporting. Apple's price is in milliunits (1/1000 of
  -- the display currency's major unit); left as Apple reports it
  -- rather than converted, so a reader isn't misled into treating it
  -- as cents.
  price_milliunits         integer,
  currency                 text,
  -- NULL while the grant is active. Set (and revocation_reason
  -- recorded) when an apple_server_notifications_log-processed
  -- REFUND/REVOKE notification confirms Apple revoked this specific
  -- transaction. Never set by anything client-reported.
  revoked_at               timestamptz,
  revocation_reason        integer,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index apple_iap_transactions_profile_id_idx on public.apple_iap_transactions (profile_id);
create index apple_iap_transactions_original_transaction_id_idx on public.apple_iap_transactions (original_transaction_id);

alter table public.apple_iap_transactions enable row level security;

create policy "Admins can view all Apple IAP transactions"
  on public.apple_iap_transactions for select
  using (public.is_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 2. apple_server_notifications_log -- idempotency guard against Apple
-- retrying a Server Notifications V2 delivery, mirroring
-- stripe_webhook_events' exact role for Stripe (supabase-portal-schema-
-- v3.sql).
-- ─────────────────────────────────────────────────────────────────
create table public.apple_server_notifications_log (
  notification_uuid  text primary key,
  notification_type  text not null,
  subtype            text,
  processed_at       timestamptz not null default now()
);

alter table public.apple_server_notifications_log enable row level security;

create policy "Admins can view all Apple server notification log entries"
  on public.apple_server_notifications_log for select
  using (public.is_admin(auth.uid()));
