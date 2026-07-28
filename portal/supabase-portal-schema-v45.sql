-- Bug fix (v45): get_checkride_prep_pricing() decided founding-seat
-- eligibility from a count of *completed* portal_access_purchases rows
-- at checkout-session-creation time. That count only increments once a
-- prior purchase's webhook has landed -- a fully async, human-paced
-- event -- so several members starting checkout concurrently near the
-- 25th founding seat could all be quoted founding pricing, since none of
-- their in-flight purchases have decremented the count yet.
--
-- Mitigation: also count checkout_session_attempts (v31) that were
-- quoted founding pricing, are still uncompleted, and were created
-- within the last 30 minutes -- a normal checkout-abandonment window.
-- This doesn't make the check fully atomic (a true fix needs a locked
-- reservation table), but it closes the realistic gap for a business
-- this size: sequential customers minutes apart while the cap is close,
-- not literally simultaneous clicks.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v44.

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
    and amount_cents = v_founding_price
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
