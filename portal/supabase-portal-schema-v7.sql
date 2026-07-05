-- Billing & Account Consistency (v7) — Phase 2
--
-- Closes the two real gaps found in the audit (see IMPLEMENTATION_PLAN.md
-- Phase 2): the member portal's Account page couldn't show a member's own
-- purchase/tier data (portal_access_purchases had no student-facing SELECT
-- policy at all), and the "$29" founding-price copy shown on locked
-- dashboard widgets and the unlock modal was static HTML that never
-- reflected whether the 25 founding seats were still available -- it kept
-- advertising $29 even after every member had actually started being
-- charged $49, which is exactly the kind of billing inconsistency this
-- phase is about.

-- ─────────────────────────────────────────────────────────────────
-- 1. Let a member see their own Checkride Prep purchase (tier, amount,
-- date) -- was admin-select-only before this. Read-only; nothing here
-- lets a member insert/update their own row (that stays service_role-only,
-- written exclusively by the stripe-webhook Edge Function).
-- ─────────────────────────────────────────────────────────────────
drop policy if exists "Members can view their own portal access purchases" on public.portal_access_purchases;
create policy "Members can view their own portal access purchases"
  on public.portal_access_purchases for select
  using (auth.uid() = profile_id);

-- ─────────────────────────────────────────────────────────────────
-- 2. Live founding/standard price preview -- mirrors the exact same
-- "first 25 rows = founding, everything after = standard" rule
-- create-checkout-session already enforces server-side at actual
-- checkout time. Exposing that count directly would mean giving every
-- authenticated member a SELECT policy on portal_access_purchases rows
-- that aren't theirs (other members' names/emails/amounts) just to let
-- them count them -- this RPC returns only the derived tier/price
-- instead, nothing row-level.
--
-- NOTE: FOUNDING_SEATS/FOUNDING_PRICE_CENTS/STANDARD_PRICE_CENTS here
-- must stay in sync with the same constants in
-- portal/supabase/functions/create-checkout-session/index.ts -- this
-- function is a *display* preview only, the Edge Function remains the
-- actual source of truth charged at checkout.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.get_checkride_prep_pricing()
returns table (
  tier text,
  amount_cents integer,
  founding_seats_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_founding_seats constant integer := 25;
  v_founding_price constant integer := 2900;
  v_standard_price constant integer := 4900;
begin
  select count(*) into v_count from public.portal_access_purchases;

  if v_count < v_founding_seats then
    return query select 'founding'::text, v_founding_price, (v_founding_seats - v_count);
  else
    return query select 'standard'::text, v_standard_price, 0;
  end if;
end;
$$;

grant execute on function public.get_checkride_prep_pricing() to anon, authenticated;
