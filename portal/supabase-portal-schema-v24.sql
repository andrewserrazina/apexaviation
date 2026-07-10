-- Apex Advantage — Referral Program Reward Redemption (v24)
--
-- Closes the loop on the referral program that already existed
-- (portal_referral_codes, portal_referrals, the pending -> signed_up ->
-- rewarded status flow, and the admin "Mark Rewarded" button in
-- portal-stable.js). Until now, "rewarded" was just a label an admin set
-- by hand -- nothing actually granted the referrer anything. This adds
-- the free ground school session redemption on top of that same
-- referral row, per the requirement: refer a friend, get a free
-- Apex Advantage ground school session once that referral is marked
-- rewarded.
--
-- Design: no new ledger table. Each portal_referrals row that reaches
-- status = 'rewarded' *is* one credit. redeemed_at (added below) marks
-- whether that specific credit has already been spent on a free
-- registration, so "credits available" is just:
--   count(*) from portal_referrals
--   where referrer_id = <member> and status = 'rewarded' and redeemed_at is null
--
-- NOTE like v5's caveat for ground_sessions/ground_registrations:
-- portal_referrals itself has no CREATE TABLE in any committed SQL
-- file (created directly in the Supabase dashboard). This migration
-- only adds a column and a function on top of it -- if the inferred
-- column names below (referrer_id, status, created_at) don't match
-- the live table, adjust redeem_referral_reward() accordingly before
-- running.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v23.

alter table public.portal_referrals
  add column if not exists redeemed_at timestamptz;

-- ─────────────────────────────────────────────────────────────────
-- Atomic redemption RPC -- mirrors register_for_ground_school (v6):
-- security definer so it can insert into ground_registrations (whose
-- direct-insert policy is scoped to the public self-registration path,
-- not "spend a referral credit"), computes waitlist placement the same
-- way, and returns the same shape so the client can reuse its existing
-- success/waitlist handling. Picks the oldest unredeemed reward so
-- credits are spent in the order they were earned.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.redeem_referral_reward(p_session_id uuid)
returns table (
  id uuid,
  full_name text,
  email text,
  is_waitlisted boolean,
  waitlist_position integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward_id uuid;
  v_full_name text;
  v_email text;
  v_max_students integer;
  v_confirmed_count integer;
  v_waitlist_count integer;
  v_go_waitlist boolean;
  v_id uuid;
begin
  select r.id into v_reward_id
  from public.portal_referrals r
  where r.referrer_id = auth.uid() and r.status = 'rewarded' and r.redeemed_at is null
  order by r.created_at asc
  limit 1;

  if v_reward_id is null then
    raise exception 'No available referral reward on this account.';
  end if;

  select p.full_name, p.email into v_full_name, v_email
  from public.profiles p where p.id = auth.uid();

  select s.max_students into v_max_students
  from public.ground_sessions s where s.id = p_session_id;

  if v_max_students is null then
    raise exception 'session not found';
  end if;

  select count(*) into v_confirmed_count
  from public.ground_registrations r
  where r.session_id = p_session_id and r.is_waitlisted = false;

  v_go_waitlist := v_confirmed_count >= v_max_students;

  if v_go_waitlist then
    select count(*) into v_waitlist_count
    from public.ground_registrations r
    where r.session_id = p_session_id and r.is_waitlisted = true;
  end if;

  -- Both writes happen in the same transaction as this function call --
  -- if the registration insert fails (e.g. already registered), the
  -- reward is left unredeemed rather than silently burned.
  update public.portal_referrals set redeemed_at = now() where id = v_reward_id;

  begin
    insert into public.ground_registrations (
      session_id, full_name, email, is_waitlisted, waitlist_position,
      profile_id, amount_cents, payment_status
    )
    values (
      p_session_id, coalesce(v_full_name, 'Student'), v_email, v_go_waitlist,
      case when v_go_waitlist then v_waitlist_count + 1 else null end,
      auth.uid(), 0, 'free_referral'
    )
    returning ground_registrations.id into v_id;
  exception
    when unique_violation then
      raise exception 'You are already registered for this session.';
  end;

  insert into public.portal_events (profile_id, event_type, metadata)
  values (auth.uid(), 'ground_school_free_referral_redeemed', jsonb_build_object('session_id', p_session_id, 'referral_id', v_reward_id, 'is_waitlisted', v_go_waitlist));

  return query
    select r.id, r.full_name, r.email, r.is_waitlisted, r.waitlist_position
    from public.ground_registrations r
    where r.id = v_id;
end;
$$;

grant execute on function public.redeem_referral_reward(uuid) to authenticated;
