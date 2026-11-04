-- v164: repoint the referral PROGRAM's reward going forward at a free
-- Checkride Prep unlock ($29 value, instant digital fulfillment) --
-- the old reward (a free Group Ground School session) became
-- unredeemable once Group Ground School sales were closed (v161/v162),
-- and the dashboard promo banner has been hardcoded hidden ever since
-- with a TODO to repoint it once a real product was chosen.
--
-- Per the owner's standing instruction (see
-- portal/test/groundSchoolClosureVerification.test.js), the EXISTING
-- redeem_referral_reward(p_session_id) RPC -- the legacy Ground-School
-- redemption path -- is left completely untouched here: any
-- already-earned, already-rewarded referral under the old scheme must
-- stay redeemable exactly as it always was. (As of this migration zero
-- referrals have ever been completed, so nothing currently redeemable
-- is actually affected either way -- this is a forward-looking addition,
-- not a repoint of existing data.) This migration only ADDS a new,
-- separate function for the new reward.

alter table public.portal_access_purchases
  drop constraint portal_access_purchases_tier_check,
  add constraint portal_access_purchases_tier_check
    check (tier = any (array['founding', 'launch', 'standard', 'referral_reward']));

-- Mirrors redeem_referral_reward()'s own "find my oldest unredeemed
-- rewarded referral, redeem it, raise if none" shape, but the
-- fulfillment side is a straight entitlement flip instead of a
-- ground_registrations insert -- there's no session to book, so this
-- takes no arguments. Blocks (rather than silently burning the
-- referral) when the caller already has Checkride Prep unlocked --
-- redeeming into something they already own would waste a reward for
-- no benefit, and the earned-but-unredeemed row is left exactly as it
-- was for the caller to redeem some other way (e.g. a future reward
-- product) rather than losing it.
create or replace function public.redeem_referral_reward_checkride_prep()
returns table(checkride_prep_unlocked boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reward_id uuid;
  v_full_name text;
  v_email text;
  v_already_unlocked boolean;
begin
  -- Locks the caller's own profile row for the duration of this
  -- transaction so a double-submit (e.g. a double-click) can't read
  -- "not yet unlocked" twice and redeem two rewards for one unlock.
  select p.full_name, p.email, p.checkride_prep_unlocked
    into v_full_name, v_email, v_already_unlocked
  from public.profiles p
  where p.id = auth.uid()
  for update;

  if v_already_unlocked is null then
    raise exception 'Profile not found.';
  end if;

  if v_already_unlocked then
    raise exception 'Checkride Prep is already unlocked on this account.';
  end if;

  select r.id into v_reward_id
  from public.portal_referrals r
  where r.referrer_id = auth.uid() and r.status = 'rewarded' and r.redeemed_at is null
  order by r.created_at asc
  limit 1;

  if v_reward_id is null then
    raise exception 'No available referral reward on this account.';
  end if;

  update public.portal_referrals set redeemed_at = now() where id = v_reward_id;

  update public.profiles set checkride_prep_unlocked = true where id = auth.uid();

  -- Recorded in portal_access_purchases (amount_cents = 0, tier =
  -- 'referral_reward') -- not just a bare flag flip -- so this shows up
  -- in the same place every other Checkride Prep unlock does (revenue
  -- reporting, the admin purchases list, etc.) instead of being
  -- invisible there and only visible via portal_events.
  insert into public.portal_access_purchases (
    profile_id, email, full_name, stripe_session_id, amount_cents, tier
  ) values (
    auth.uid(), v_email, coalesce(v_full_name, 'Student'), null, 0, 'referral_reward'
  );

  insert into public.portal_events (profile_id, event_type, metadata)
  values (auth.uid(), 'checkride_prep_free_referral_redeemed', jsonb_build_object('referral_id', v_reward_id));

  return query select true;
end;
$function$;

-- Hardened grant (authenticated only) -- matches this codebase's own
-- v104-v110 privilege-hardening convention, not the looser
-- PUBLIC/anon grant the older redeem_referral_reward() happens to
-- still carry from before that hardening pass.
revoke all on function public.redeem_referral_reward_checkride_prep() from public;
grant execute on function public.redeem_referral_reward_checkride_prep() to authenticated;
