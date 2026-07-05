-- Apex Advantage Member Portal — freemium model migration (v4)
--
-- Changes the portal from "pay $29 to sign up" to "free signup, pay $29 to
-- unlock the Checkride Prep content." Ground school registration also moves
-- from cash-at-door to Stripe checkout.
--
-- Run this in the Supabase SQL editor, same project as the other
-- supabase-portal-schema*.sql files and portal/supabase-schema.sql.

-- ─────────────────────────────────────────────────────────────────
-- 1. Checkride Prep unlock flag — the new paywall gate.
-- Signup no longer implies purchase, so this defaults to false and is
-- flipped to true by the stripe-webhook function when the $29/$49
-- unlock purchase completes.
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists checkride_prep_unlocked boolean not null default false;

-- ─────────────────────────────────────────────────────────────────
-- 2. Ground school registration — add Stripe payment tracking.
-- ground_sessions / ground_registrations already exist (created by the
-- CRM's GroundSchedule.jsx flow); these columns add online payment on
-- top of the existing cash-at-door path, which still works for manual
-- admin-added registrants (payment_status stays 'unpaid' until the
-- webhook marks it 'paid', or an admin/instructor can mark cash payments
-- paid manually from the CRM).
-- ─────────────────────────────────────────────────────────────────
alter table public.ground_registrations
  add column if not exists profile_id uuid references public.profiles(id),
  add column if not exists stripe_session_id text,
  add column if not exists amount_cents integer,
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded'));

create unique index if not exists ground_registrations_stripe_session_id_key
  on public.ground_registrations(stripe_session_id)
  where stripe_session_id is not null;
