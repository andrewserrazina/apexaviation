-- Apex Advantage — Retention Sprint Tier 3: onboarding capture (v70)
--
-- The old first-session welcome card was 3 static buttons and asked
-- nothing -- no training-stage or focus-area signal was ever captured.
-- This adds the two columns the redesigned onboarding flow
-- (site/portal-stable.js's showWelcomeOnboarding(), site/portal.html's
-- #welcomeOnboardingCard) writes to. Both nullable/free-text-enum-ish
-- (checked, not a foreign key) rather than a new lookup table -- this is
-- a fixed, small set of values owned entirely by the client, matching
-- the existing checkride_timing column's pattern (also a plain checked
-- text column, supabase-portal-schema-v?? / portal-login.html signup
-- form) rather than every other lookup-table-backed field in this schema.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v69.

alter table public.profiles
  add column if not exists training_stage text
    check (training_stage is null or training_stage in (
      'just_starting', 'pre_solo', 'cross_country',
      'preparing_for_written', 'written_passed', 'checkride_preparation'
    )),
  add column if not exists primary_focus_area text
    check (primary_focus_area is null or primary_focus_area in (
      'airspace', 'weather', 'aircraft_systems', 'regulations', 'performance',
      'weight_balance', 'navigation', 'adm', 'not_sure'
    ));
