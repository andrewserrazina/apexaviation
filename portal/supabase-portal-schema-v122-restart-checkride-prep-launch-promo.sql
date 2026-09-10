-- Apex Advantage — Restart Checkride Prep launch pricing promo (v122)
--
-- get_checkride_prep_pricing() (v66) hardcoded its early-access deadline
-- to 2026-08-31 23:59 ET. Once that passed, the function's very first
-- check (`if now() >= v_early_access_deadline`) unconditionally returns
-- 'standard' ($49) for every purchase, regardless of founding seats
-- remaining or a new member's launch window -- which is why Checkride
-- Prep has been $49 instead of $29 since Sept 1.
--
-- This restarts the same promo by pushing the deadline out to a new
-- date (2026-10-10 23:59 ET / 2026-10-11T03:59:00Z) -- everything else
-- (25 founding seats, 48-hour launch window per new signup, then $49
-- standard) is unchanged from v66. Only 14 of the 25 founding seats have
-- been used in production as of this migration, so founding pricing
-- ($29) applies again immediately for the next 11 purchases; anyone
-- else still gets $29 via the 48-hour launch window on their own
-- account, until the new deadline passes.
--
-- The deadline date itself is a placeholder for "restart the promo for
-- about a month" -- it's a single constant (v_early_access_deadline
-- below), trivially changed again later without touching any other
-- logic.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v121.

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
  v_count integer;
  v_pending_founding integer;
  v_founding_seats constant integer := 25;
  v_founding_price constant integer := 2900;
  v_launch_price constant integer := 2900;
  v_standard_price constant integer := 4900;
  v_launch_window constant interval := interval '48 hours';
  -- 2026-10-10 23:59:00 America/New_York. Written as its fixed UTC
  -- instant (EDT, UTC-4, is in effect on this date -- 2026 DST runs
  -- Mar 8 - Nov 1) rather than relying on Postgres session timezone
  -- handling of a zone-name literal, so this can't drift if the
  -- database's session timezone setting ever changes.
  v_early_access_deadline constant timestamptz := '2026-10-11T03:59:00Z'::timestamptz;
  v_created_at timestamptz;
begin
  if now() >= v_early_access_deadline then
    return query select 'standard'::text, v_standard_price, 0, null::timestamptz;
    return;
  end if;

  select count(*) into v_count from public.portal_access_purchases;

  select count(*) into v_pending_founding
  from public.checkout_session_attempts
  where purpose in ('unlock-checkride-prep', 'signup-and-unlock-checkride-prep')
    and checkout_session_attempts.amount_cents = v_founding_price
    and completed_at is null
    and created_at > now() - interval '30 minutes';

  v_count := v_count + v_pending_founding;

  if v_count < v_founding_seats then
    return query select 'founding'::text, v_founding_price, (v_founding_seats - v_count), v_early_access_deadline;
    return;
  end if;

  if p_profile_id is not null then
    select created_at into v_created_at from public.profiles where id = p_profile_id;
    if v_created_at is not null and now() < v_created_at + v_launch_window then
      return query select 'launch'::text, v_launch_price, 0, least(v_created_at + v_launch_window, v_early_access_deadline);
      return;
    end if;
  end if;

  return query select 'standard'::text, v_standard_price, 0, null::timestamptz;
end;
$$;
