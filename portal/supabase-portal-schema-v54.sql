-- Bug fix (v54): get_checkride_prep_pricing() has thrown
-- "column reference \"amount_cents\" is ambiguous" (Postgres error 42702)
-- since it was first written in v30 -- the function's own
-- `returns table (..., amount_cents integer, ...)` declares amount_cents
-- as an implicit PL/pgSQL variable in scope for the whole function body,
-- which collides with checkout_session_attempts.amount_cents in the
-- pending-founding-seat query added in v45. Every call to this function
-- has been erroring, completely unnoticed, because
-- create-checkout-session (the only caller) discarded the RPC error and
-- silently defaulted to the $49 standard price -- see that Edge
-- Function's companion fix, same commit as this file. Confirmed live:
-- only 5 real Checkride Prep purchases exist, nowhere near the 25-seat
-- founding cap, yet Stripe was quoting every new member $49.
--
-- Fix: qualify the ambiguous reference with the table name so Postgres
-- resolves it to the real column, not the function's return-table
-- variable. No other logic changes from v45.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v53.

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
  v_created_at timestamptz;
begin
  select count(*) into v_count from public.portal_access_purchases;

  select count(*) into v_pending_founding
  from public.checkout_session_attempts
  where purpose in ('unlock-checkride-prep', 'signup-and-unlock-checkride-prep')
    and checkout_session_attempts.amount_cents = v_founding_price
    and completed_at is null
    and created_at > now() - interval '30 minutes';

  v_count := v_count + v_pending_founding;

  if v_count < v_founding_seats then
    return query select 'founding'::text, v_founding_price, (v_founding_seats - v_count), null::timestamptz;
    return;
  end if;

  if p_profile_id is not null then
    select created_at into v_created_at from public.profiles where id = p_profile_id;
    if v_created_at is not null and now() < v_created_at + v_launch_window then
      return query select 'launch'::text, v_launch_price, 0, (v_created_at + v_launch_window);
      return;
    end if;
  end if;

  return query select 'standard'::text, v_standard_price, 0, null::timestamptz;
end;
$$;
