-- Bug fix (v43): portal_access_purchases.tier still only allowed
-- 'founding'/'standard' from v3, but v30 introduced a third tier,
-- 'launch', that stripe-webhook has been inserting ever since. Every
-- launch-tier purchase has been silently failing this CHECK constraint --
-- the member still gets unlocked and emailed (those happen first), but
-- the purchase itself never lands in this table, which also feeds the
-- founding-seat counter in get_checkride_prep_pricing().
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v42.

alter table public.portal_access_purchases drop constraint if exists portal_access_purchases_tier_check;

alter table public.portal_access_purchases
  add constraint portal_access_purchases_tier_check
  check (tier in ('founding', 'launch', 'standard'));
