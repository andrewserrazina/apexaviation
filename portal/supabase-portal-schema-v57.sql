-- Apex Advantage — Private Pilot Ground School full-course pack (v57)
--
-- New $400 one-time purchase: unlimited free registration to every
-- current and future Private Pilot ground school class
-- (scheduled_ground_classes where course_id = 'PPL'), instead of paying
-- $25 per session. A student can still pay per-session if they don't
-- want the full pack -- this is an alternative, not a replacement, of
-- the existing $25/class flow (create-checkout-session's
-- 'ground-school-registration' purpose stays completely untouched).
--
-- Deliberately mirrors the existing checkride_prep_unlocked pattern
-- (a plain boolean flag on profiles) rather than the newer capability
-- model (get_member_capabilities(), v51) -- that model exists
-- specifically for the Prep-Pack/Membership overlap problem; this is an
-- unrelated, single-purpose entitlement with nothing to overlap with.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v56.

alter table public.profiles
  add column if not exists private_pilot_ground_school_pack_unlocked boolean not null default false;

-- ─────────────────────────────────────────────────────────────────
-- Let a pack-covered enrollment exist alongside a real Stripe-paid one.
-- payment_status was check(paid|refunded|canceled); add a value for
-- "covered by the full-course pack, no per-class charge" -- mirrors the
-- legacy ground_registrations table's existing 'free_referral' status
-- (supabase-portal-schema-v24.sql) for the same kind of non-Stripe
-- registration.
-- ─────────────────────────────────────────────────────────────────
alter table public.scheduled_ground_class_enrollments
  drop constraint if exists scheduled_ground_class_enrollments_payment_status_check;

alter table public.scheduled_ground_class_enrollments
  add constraint scheduled_ground_class_enrollments_payment_status_check
  check (payment_status in ('paid', 'refunded', 'canceled', 'ground_school_pack'));

-- ─────────────────────────────────────────────────────────────────
-- confirm_scheduled_ground_class_enrollment (v17): add p_payment_status
-- so a pack-covered call can pass 'ground_school_pack' instead of the
-- hardcoded 'paid', and fix the existing "already registered" check to
-- recognize a pack-covered registration too -- as originally written it
-- only matched payment_status = 'paid', so a double-click/retry on a
-- pack-covered enrollment would have inserted a second row and
-- double-incremented enrolled_count instead of returning the existing one.
-- p_payment_status defaults to 'paid' so every existing call site
-- (stripe-webhook, service_role-only) needs zero changes.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.confirm_scheduled_ground_class_enrollment(
  p_scheduled_ground_class_id uuid,
  p_full_name text,
  p_email text,
  p_profile_id uuid,
  p_stripe_session_id text,
  p_amount_cents integer,
  p_payment_status text default 'paid'
)
returns public.scheduled_ground_class_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.scheduled_ground_classes%rowtype;
  v_existing public.scheduled_ground_class_enrollments%rowtype;
  v_enrollment public.scheduled_ground_class_enrollments%rowtype;
begin
  if p_scheduled_ground_class_id is null then
    raise exception 'Scheduled class id is required.';
  end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Full name is required.';
  end if;
  if nullif(trim(coalesce(p_email, '')), '') is null then
    raise exception 'Email is required.';
  end if;
  if p_payment_status not in ('paid', 'ground_school_pack') then
    raise exception 'Invalid payment_status for a new enrollment: %', p_payment_status;
  end if;

  select * into v_existing
  from public.scheduled_ground_class_enrollments
  where stripe_session_id = p_stripe_session_id;
  if found then
    return v_existing;
  end if;

  select * into v_class
  from public.scheduled_ground_classes
  where id = p_scheduled_ground_class_id
  for update;

  if not found then
    raise exception 'Scheduled ground school class not found.';
  end if;
  if v_class.status <> 'published' then
    raise exception 'Scheduled ground school class is not open for registration.';
  end if;
  if v_class.class_date < current_date then
    raise exception 'Scheduled ground school class is no longer upcoming.';
  end if;

  select * into v_existing
  from public.scheduled_ground_class_enrollments
  where scheduled_ground_class_id = p_scheduled_ground_class_id
    and lower(email) = lower(p_email)
    and payment_status in ('paid', 'ground_school_pack');
  if found then
    return v_existing;
  end if;

  if v_class.enrolled_count >= v_class.capacity then
    raise exception 'Scheduled ground school class is full.';
  end if;

  insert into public.scheduled_ground_class_enrollments (
    scheduled_ground_class_id,
    profile_id,
    full_name,
    email,
    stripe_session_id,
    amount_cents,
    payment_status
  ) values (
    p_scheduled_ground_class_id,
    p_profile_id,
    trim(p_full_name),
    lower(trim(p_email)),
    p_stripe_session_id,
    coalesce(p_amount_cents, 2500),
    p_payment_status
  ) returning * into v_enrollment;

  update public.scheduled_ground_classes
  set enrolled_count = enrolled_count + 1
  where id = p_scheduled_ground_class_id;

  return v_enrollment;
end;
$$;

grant execute on function public.confirm_scheduled_ground_class_enrollment(uuid, text, text, uuid, text, integer, text) to service_role;

-- ─────────────────────────────────────────────────────────────────
-- Member-facing RPC: register for a Private Pilot class using an
-- already-purchased pack, with no Stripe involved at all. Never trusts
-- a client-supplied "I have the pack" claim -- looks up the caller's own
-- profile server-side via auth.uid(). Reuses
-- confirm_scheduled_ground_class_enrollment's row-locked capacity/
-- dedup logic rather than reimplementing it, with a synthesized unique
-- token in place of a real Stripe session id (this table's
-- stripe_session_id column is not null + unique; there's no real Stripe
-- checkout for a pack-covered registration to source one from).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.enroll_in_ground_school_via_pack(p_scheduled_ground_class_id uuid)
returns public.scheduled_ground_class_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_class public.scheduled_ground_classes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found or not v_profile.private_pilot_ground_school_pack_unlocked then
    raise exception 'This account has not unlocked the Private Pilot Ground School pack.';
  end if;

  select * into v_class from public.scheduled_ground_classes where id = p_scheduled_ground_class_id;
  if not found then
    raise exception 'Scheduled ground school class not found.';
  end if;
  if v_class.course_id <> 'PPL' then
    raise exception 'The Private Pilot Ground School pack only covers Private Pilot classes.';
  end if;

  return public.confirm_scheduled_ground_class_enrollment(
    p_scheduled_ground_class_id,
    v_profile.full_name,
    v_profile.email,
    v_profile.id,
    'pack_' || gen_random_uuid()::text,
    0,
    'ground_school_pack'
  );
end;
$$;

grant execute on function public.enroll_in_ground_school_via_pack(uuid) to authenticated;
