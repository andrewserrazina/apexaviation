-- Bug fix (v46): the legacy ground_registrations path in stripe-webhook
-- (no scheduled_class_id) read confirmedCount, then inserted a new
-- registration, with no lock in between -- a plain check-then-act race.
-- The newer scheduled_ground_classes path was already given an atomic,
-- row-locked RPC (confirm_scheduled_ground_class_enrollment, v17) plus a
-- refund-and-email fallback for exactly this scenario; the legacy path
-- never got the same treatment. Two customers paying near the last
-- legacy seat could both read confirmedCount < max_students and both
-- get inserted as confirmed (not waitlisted), oversubscribing the
-- session with paid customers and no refund safety net.
--
-- This mirrors confirm_scheduled_ground_class_enrollment's locking
-- pattern: lock the ground_sessions row first (`for update`), so a
-- second concurrent call blocks until the first transaction commits and
-- sees the up-to-date count.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v45.

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
  v_registration public.ground_registrations%rowtype;
begin
  select max_students into v_max_students
  from public.ground_sessions
  where id = p_session_id
  for update;

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
