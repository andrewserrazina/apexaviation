-- Apex Advantage — Checkride Prep real Early Access deadline (v66)
--
-- Retargeting campaign context: the checkride-prep.html landing page is
-- being updated to advertise a genuine "$29 Early Access, then $49"
-- deadline of August 31, 2026, 11:59 PM America/New_York (see the same
-- commit's changes to site/checkride-prep.html). That deadline needs to
-- be real -- the price actually charged by Stripe must change, not just
-- the page copy -- otherwise this is fake urgency wearing a real-looking
-- countdown.
--
-- get_checkride_prep_pricing() (last touched v54) is already the single
-- source of truth create-checkout-session/index.ts uses to set the
-- Stripe price_data.unit_amount for every Checkride Prep purchase, and
-- checkride-prep.html's own live-pricing JS already calls this same RPC
-- to render the displayed price -- so gating the deadline here, and only
-- here, keeps the frontend display and the actual Stripe charge
-- automatically in sync with zero other backend/Stripe changes (no
-- separate Stripe Price object to swap, since pricing is inline
-- price_data computed fresh from this function's return on every
-- checkout call).
--
-- What's changing:
--   1. A new global v_early_access_deadline check runs FIRST. Once
--      now() >= Aug 31 2026 11:59 PM ET, every caller gets 'standard'
--      ($49) regardless of founding-seat count or a brand-new member's
--      48-hour launch window -- both of those are seat/signup-relative
--      promos that predate this deadline and must not be able to outlive
--      it. Before this change, a new signup on, say, September 15 would
--      still have qualified for the 'launch' tier's $29 for their first
--      48 hours, silently contradicting an advertised "ends August 31"
--      promise.
--   2. launch_expires_at (previously null for 'founding', since that
--      tier was seat-capped, not time-capped) now also returns the Aug
--      31 deadline for 'founding' -- the countdown on the marketing page
--      needs one consistent "when does $29 go away" timestamp regardless
--      of which tier a given visitor happens to qualify under, and this
--      column already means exactly that for 'launch'. No signature
--      change, so this is CREATE OR REPLACE, not drop+create.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v65.

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
  -- 2026-08-31 23:59:00 America/New_York. Written as its fixed UTC
  -- instant (EDT, UTC-4, is in effect on this date -- 2026 DST runs
  -- Mar 8 - Nov 1) rather than relying on Postgres session timezone
  -- handling of a zone-name literal, so this can't drift if the
  -- database's session timezone setting ever changes.
  v_early_access_deadline constant timestamptz := '2026-09-01T03:59:00Z'::timestamptz;
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
