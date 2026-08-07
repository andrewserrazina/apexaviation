-- Apex Advantage — Ground School bug sweep: real seat counts, duplicate-
-- registration guard for legacy sessions, and meeting_url exposure (v63)
--
-- Three independent fixes found during a member-portal Ground School
-- audit:
--
-- 1. get_legacy_ground_session_confirmed_counts() -- portal-stable.js's
--    loadGroundSchool() computed each legacy ground_sessions row's
--    confirmed-registrant count from an embedded
--    `ground_registrations(id, is_waitlisted)` select. Supabase/PostgREST
--    enforces the EMBEDDED table's own RLS on that join, and
--    ground_registrations' select policy (supabase-portal-schema-v6.sql)
--    is `using (auth.uid() = profile_id)` -- scoped to the caller's own
--    row only. So every member saw a confirmed-count of 0 or 1 per
--    session (their own registration or none), never the real headcount,
--    meaning a genuinely full class could still show "N spots left" and
--    let someone pay for a seat that doesn't exist. This is a read-side
--    bug only -- the actual capacity enforcement at registration time
--    already happens correctly server-side in
--    confirm_legacy_ground_registration (row-locked, v46).
--
-- 2. confirm_legacy_ground_registration -- had no duplicate-registration
--    guard at all, unlike confirm_scheduled_ground_class_enrollment
--    (v57), which already: (a) treats a retried call with the same
--    stripe_session_id as idempotent, and (b) returns the existing row
--    instead of inserting a second one when the same email already has a
--    paid registration for the same class. The legacy path never got
--    the same treatment, so a member re-registering for a class they'd
--    already paid for got a second registration row and a second $25
--    charge with no indication anything was wrong. This migration adds
--    the identical two-check pattern here. (create-checkout-session also
--    gets a matching pre-check in the same commit, so the charge itself
--    is prevented, not just the duplicate row -- this DB-level guard is
--    defense in depth for any path that reaches the RPC directly.)
--
-- 3. get_my_ground_school_enrollments() -- meeting_url is a required,
--    not-null-when-published column on scheduled_ground_classes
--    (supabase-portal-schema-v15.sql), but no query in the whole
--    codebase ever selects it: not this RPC, not the stripe-webhook
--    confirmation email, not any portal render function. A student who
--    registers for a live class currently has no way to find out how to
--    actually join it. This adds meeting_url to the RPC's output; the
--    stripe-webhook confirmation email and portal UI changes to use it
--    are in the same commit as this migration, not here (nothing else
--    to run server-side for those).
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v62.

-- ─────────────────────────────────────────────────────────────────
-- 1. Real confirmed-registrant counts per legacy ground_sessions row,
-- bypassing the per-row RLS that broke the embedded-join count on the
-- client. Read-only, no PII beyond a count -- safe for any authenticated
-- member to call (mirrors get_ground_school_module_count, v58, same
-- shape of problem: a denominator every member needs to see accurately,
-- not just their own rows).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.get_legacy_ground_session_confirmed_counts()
returns table (session_id uuid, confirmed_count integer)
language sql
security definer
set search_path = public
stable
as $$
  select session_id, count(*)::integer
  from public.ground_registrations
  where is_waitlisted = false
  group by session_id;
$$;

grant execute on function public.get_legacy_ground_session_confirmed_counts() to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. confirm_legacy_ground_registration (v46) -- add the same
-- idempotency + duplicate-registration checks confirm_scheduled_ground_
-- class_enrollment already has (v57). Signature is unchanged, so
-- stripe-webhook's existing call site needs zero changes.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.confirm_legacy_ground_registration(
  p_session_id uuid,
  p_full_name text,
  p_email text,
  p_profile_id uuid,
  p_stripe_session_id text,
  p_amount_cents integer
)
returns public.ground_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_students integer;
  v_confirmed_count integer;
  v_is_waitlisted boolean;
  v_existing public.ground_registrations%rowtype;
  v_registration public.ground_registrations%rowtype;
begin
  -- Idempotency: a retried webhook delivery for the same Stripe session
  -- returns the row it already created instead of inserting a second one.
  select * into v_existing
  from public.ground_registrations
  where stripe_session_id = p_stripe_session_id;
  if found then
    return v_existing;
  end if;

  select max_students into v_max_students
  from public.ground_sessions
  where id = p_session_id
  for update;

  -- Duplicate registration: this email already has a paid registration
  -- for this session (e.g. re-registering after already paying) --
  -- return the existing row rather than inserting a second one and
  -- double-counting them against capacity.
  select * into v_existing
  from public.ground_registrations
  where session_id = p_session_id
    and lower(email) = lower(p_email)
    and payment_status = 'paid';
  if found then
    return v_existing;
  end if;

  select count(*) into v_confirmed_count
  from public.ground_registrations
  where session_id = p_session_id
    and is_waitlisted = false;

  v_is_waitlisted := v_max_students is not null and v_confirmed_count >= v_max_students;

  insert into public.ground_registrations (
    session_id, full_name, email, is_waitlisted, profile_id, stripe_session_id, amount_cents, payment_status
  ) values (
    p_session_id, p_full_name, p_email, v_is_waitlisted, p_profile_id, p_stripe_session_id, p_amount_cents, 'paid'
  )
  returning * into v_registration;

  return v_registration;
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 3. Add meeting_url to the enrollments a member can see for themselves.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.get_my_ground_school_enrollments()
returns table (
  enrollment_id uuid,
  scheduled_ground_class_id uuid,
  lesson_id text,
  lesson_title text,
  class_title text,
  class_date date,
  start_time time,
  timezone text,
  meeting_url text,
  attendance_status text,
  payment_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    e.id,
    e.scheduled_ground_class_id,
    c.lesson_id,
    c.lesson_title,
    c.title,
    c.class_date,
    c.start_time,
    c.timezone,
    c.meeting_url,
    e.attendance_status,
    e.payment_status
  from public.scheduled_ground_class_enrollments e
  join public.scheduled_ground_classes c on c.id = e.scheduled_ground_class_id
  where e.profile_id = auth.uid()
    and e.payment_status in ('paid', 'ground_school_pack');
$$;

grant execute on function public.get_my_ground_school_enrollments() to authenticated;
