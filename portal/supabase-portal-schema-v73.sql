-- Apex Advantage — Growth Sprint Tier 1: close the referral attribution
-- loop (v73)
--
-- The referral program (portal_referrals/portal_referral_codes, v5/v9/
-- v24) has always had two paths to earn a referral: a member emailing a
-- friend through the in-portal "Refer a Friend" form (creates a
-- `pending` row keyed by the friend's email), or copying/sharing their
-- personal link (contact.html?ref=<code>). Neither path was ever
-- actually closed: nothing in the codebase reads `?ref=` on arrival
-- (site/analytics-events.js now captures it -- see that file's own
-- comment), and nothing auto-transitions a `pending` row to
-- `signed_up` when that referred friend actually creates an account --
-- an admin has always had to notice and click a status button by hand,
-- and the link-based path had literally no way to ever be attributed at
-- all, manually or otherwise.
--
-- record_referral_signup() below closes both paths, called once from
-- create-free-account/index.ts right after a new profile exists. Two
-- cases:
--   1. A `pending` row already names this exact email (the email-invite
--      path) -- update it to `signed_up` and attach the new profile id.
--   2. No pending row, but a valid ?ref=<code> was carried through from
--      signup -- insert a new row directly at `signed_up` (an INSERT
--      isn't subject to the status-lock trigger below at all; only
--      UPDATE is).
-- Idempotent: a profile that already has a referred_profile_id match is
-- never processed twice, and Path 2 is skipped entirely if a Path-1
-- match was found.
--
-- lock_referral_status() (v5.sql) previously blocked ALL non-admin
-- status changes, including this function's own -- auth.uid()/
-- auth.role() reflect the ORIGINAL calling connection even inside a
-- security definer function (session-level JWT claims aren't part of
-- the security-definer role switch), so a service-role edge-function
-- call was being silently reverted by the trigger exactly like a
-- regular member's would be. Fixed by explicitly trusting
-- auth.role() = 'service_role' (a real Supabase-provided check already
-- used this way throughout this project's RLS policies) in addition to
-- the existing admin check -- the client-side admin-only status-change
-- UI is completely unaffected; only trusted server-side calls gain
-- anything new.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v72.

create or replace function public.lock_referral_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create or replace function public.record_referral_signup(
  p_new_profile_id uuid,
  p_email text,
  p_ref_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_pending_id uuid;
begin
  if p_email is null or p_email = '' then
    return;
  end if;

  -- Idempotency: never record a referral twice for the same new profile
  -- (e.g. a retried/duplicate call).
  if exists (select 1 from public.portal_referrals where referred_profile_id = p_new_profile_id) then
    return;
  end if;

  -- Path 1: email-invite flow.
  select id into v_pending_id
  from public.portal_referrals
  where lower(referred_email) = lower(p_email)
    and status = 'pending'
    and referred_profile_id is null
  order by created_at asc
  limit 1;

  if v_pending_id is not null then
    update public.portal_referrals
      set status = 'signed_up', referred_profile_id = p_new_profile_id
      where id = v_pending_id;
    return;
  end if;

  -- Path 2: shareable-link flow. Guards against a null/blank code and
  -- (structurally impossible, but cheap to check) self-referral.
  if p_ref_code is not null and p_ref_code <> '' then
    select profile_id into v_referrer_id
    from public.portal_referral_codes
    where lower(code) = lower(p_ref_code)
    limit 1;

    if v_referrer_id is not null and v_referrer_id <> p_new_profile_id then
      insert into public.portal_referrals (referrer_id, referred_email, referred_profile_id, status)
      values (v_referrer_id, p_email, p_new_profile_id, 'signed_up');
    end if;
  end if;
end;
$$;

grant execute on function public.record_referral_signup(uuid, text, text) to service_role;
