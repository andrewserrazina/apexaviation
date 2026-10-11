-- Apex Advantage — Checkride Prep permanent $29 pricing (v158)
--
-- Replaces get_checkride_prep_pricing() (last touched in v122) with a
-- flat, permanent $29 -- no more founding-seat cap, no more 48-hour
-- launch window, no more early-access deadline that needs restarting
-- every few weeks (this is the third time that deadline constant has
-- had to be pushed out: v66, then v122, now this). There is no more
-- "standard $49" tier to fall back to once a promo window ends --
-- $29 simply IS the permanent price now.
--
-- Deliberately keeps the exact same function signature/return shape
-- (tier text, amount_cents integer, founding_seats_remaining integer,
-- launch_expires_at timestamptz) so every existing caller --
-- create-checkout-session/index.ts, site/portal-stable.js,
-- site/checkride-prep.html, site/portal-login.html,
-- site/apex-advantage.html, site/apex-advantage-checkride-binder.html --
-- keeps working with zero caller-side schema changes. `tier` always
-- returns 'standard' (already a valid value under
-- portal_access_purchases_tier_check, v43) so no CHECK-constraint
-- migration is needed either. founding_seats_remaining/
-- launch_expires_at always come back as 0/null -- callers that still
-- branch on an "Early Access" countdown should stop doing so (see this
-- session's companion changes to the site's own urgency copy), but
-- returning honest "there is no countdown" values here means a caller
-- that hasn't been updated yet fails safe (shows a flat price, not a
-- stale countdown) rather than erroring.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v157.

create or replace function public.get_checkride_prep_pricing(p_profile_id uuid default null)
returns table (
  tier text,
  amount_cents integer,
  founding_seats_remaining integer,
  launch_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price constant integer := 2900;
begin
  return query select 'standard'::text, v_price, 0, null::timestamptz;
end;
$$;
