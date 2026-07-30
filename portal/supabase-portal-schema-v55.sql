-- Stripe Promotion Codes for Checkride Prep Pack checkout (v55)
--
-- Companion to the allow_promotion_codes: true change in
-- create-checkout-session/index.ts (unlock-checkride-prep and
-- signup-and-unlock-checkride-prep). Once a promo code can change the
-- amount actually charged, nothing computed at checkout-session-creation
-- time (get_checkride_prep_pricing()'s quoted price, baked into the
-- success_url as ?amount_cents=...) can be trusted for analytics --
-- only stripe-webhook's session.amount_total (the real post-discount
-- total) is authoritative, and that only exists once
-- portal_access_purchases has been written.
--
-- get_checkout_session_amount() exposes just that real amount for a
-- given Stripe checkout session id, safe for anonymous callers: a
-- session id is a long, cryptographically random Stripe-generated
-- token, and it only ever reaches a browser via Stripe's own
-- success_url redirect after a completed checkout -- this returns
-- nothing beyond the dollar amount already implied by that redirect
-- having happened, no PII. Needed specifically because the
-- signup-and-unlock-checkride-prep flow's confirmation page
-- (portal-login.html) fires its Meta Pixel Purchase event before the
-- brand-new account has ever signed in client-side, so there is no
-- authenticated session to query portal_access_purchases directly
-- under its existing "Members can view their own" RLS policy (v7).
-- Used by both Checkride Prep success paths for consistency (see
-- site/portal-stable.js and site/portal-login.html).
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v54.

create or replace function public.get_checkout_session_amount(p_stripe_session_id text)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select amount_cents from public.portal_access_purchases where stripe_session_id = p_stripe_session_id limit 1;
$$;

grant execute on function public.get_checkout_session_amount(text) to anon, authenticated;
