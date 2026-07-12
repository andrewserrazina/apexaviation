-- Adds a "launch window" pricing tier: any brand-new signup can unlock
-- Checkride Prep at $29 within 48 hours of creating their account, even
-- after the 25 founding seats are gone -- instead of every non-founding
-- member paying $49 regardless of how fast they act. Founding pricing
-- (first 25 unlocks ever) still takes priority when seats remain; the
-- launch tier only ever matters once founding is exhausted.
--
-- get_checkride_prep_pricing() gains an optional p_profile_id parameter
-- so it can check that profile's created_at. Existing callers that pass
-- no argument still work (falls back to founding/standard only, same
-- as before) -- but every real caller (create-checkout-session,
-- portal-stable.js, send-lifecycle-emails) is updated in this same
-- round to pass the member's profile id so they actually see the
-- launch-tier discount when it applies.
drop function if exists public.get_checkride_prep_pricing();

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
  v_founding_seats constant integer := 25;
  v_founding_price constant integer := 2900;
  v_launch_price constant integer := 2900;
  v_standard_price constant integer := 4900;
  v_launch_window constant interval := interval '48 hours';
  v_created_at timestamptz;
begin
  select count(*) into v_count from public.portal_access_purchases;

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

grant execute on function public.get_checkride_prep_pricing(uuid) to anon, authenticated;
