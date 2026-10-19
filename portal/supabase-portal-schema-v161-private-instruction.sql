-- Apex Advantage — Private Instruction: data model (v161)
--
-- Replaces the discontinued $25/class live virtual group Ground School
-- (scheduled_ground_classes et al. — left untouched, just no longer
-- advertised anywhere; see the site-side changes in this same commit)
-- with a single, flexible 1-on-1 offering: $55/hour with Andrew, open to
-- every certificate level, covering ground school content, checkride
-- prep, oral prep, or whatever the student actually needs that hour.
--
-- Deliberately mirrors mock_oral_availability/mock_oral_bookings
-- (supabase-portal-schema-v97.sql) almost exactly — same proven
-- "explicit bookable slot rows, webhook is the only place that flips
-- open -> booked via a single conditional UPDATE ... WHERE status =
-- 'open', refund-and-alert on fulfillment failure" pattern already used
-- for Mock Orals and every other paid product in stripe-webhook/
-- index.ts. Differences from Mock Oral, both deliberate:
--   - No certificate_type column anywhere (this product isn't
--     certificate-scoped) and no products table — a single flat-rate
--     constant (PRIVATE_INSTRUCTION_RATE_CENTS in create-checkout-
--     session/index.ts) is the whole pricing model, not an admin-
--     togglable catalog. A student wanting more than an hour books
--     multiple separate 1-hour slots rather than this system growing a
--     multi-hour cart.
--   - The v144 instructor-eligibility RLS hardening (lock_profile_
--     privileged_columns() extended to cover the new instructor-
--     eligibility columns, and "instructor manages own availability"
--     requiring that eligibility flag in both USING and WITH CHECK, not
--     just instructor_id = auth.uid()) is applied here from the start,
--     not discovered after the fact — see v144's own header for why this
--     matters: without it, any authenticated member could self-declare
--     eligibility and insert their own real, paid, bookable slot.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v160.

-- ─────────────────────────────────────────────────────────────────
-- 1. Instructor eligibility (extends profiles)
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists private_instruction_instructor boolean not null default false;

comment on column public.profiles.private_instruction_instructor is
  'True for a profile approved to hold Private Instruction availability slots. Mirrors mock_oral_instructor -- see v144 for why this must be admin-only, enforced below via lock_profile_privileged_columns() and the availability RLS policy.';

-- ─────────────────────────────────────────────────────────────────
-- 2. Availability -- fixed 1-hour bookable slots, same shape as
--    mock_oral_availability minus certificate_type.
-- ─────────────────────────────────────────────────────────────────
create table public.private_instruction_availability (
  id                 uuid primary key default gen_random_uuid(),
  instructor_id      uuid not null references public.profiles(id) on delete cascade,
  class_date         date not null,
  start_time         time not null,
  end_time           time not null,
  timezone           text not null default 'America/Chicago',
  status             text not null default 'open' check (status in ('open', 'booked', 'blocked')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (end_time > start_time)
);

create index private_instruction_availability_lookup_idx
  on public.private_instruction_availability (status, class_date, start_time);
create index private_instruction_availability_instructor_idx
  on public.private_instruction_availability (instructor_id, class_date, start_time);

alter table public.private_instruction_availability enable row level security;

create policy "Admins manage private instruction availability"
  on public.private_instruction_availability for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- v144 lesson applied from the start: instructor_id = auth.uid() alone
-- is not enough -- the caller's own profile must actually carry the
-- eligibility flag, checked in both USING and WITH CHECK.
create policy "Instructors manage their own private instruction availability"
  on public.private_instruction_availability for all
  using (
    instructor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.private_instruction_instructor = true
    )
  )
  with check (
    instructor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.private_instruction_instructor = true
    )
  );

-- Students need to see OPEN future slots to book one, but never which
-- instructor holds a given slot before it's booked -- same "book a
-- time, not an instructor" principle as Mock Oral. get_private_
-- instruction_availability() below is the actual read path; this
-- policy is defense in depth for a direct client-side query against
-- the bare table.
create policy "Authenticated users view open future private instruction slots"
  on public.private_instruction_availability for select
  using (
    auth.role() = 'authenticated'
    and status = 'open'
    and class_date >= current_date
  );

-- ─────────────────────────────────────────────────────────────────
-- 3. Bookings
-- ─────────────────────────────────────────────────────────────────
create table public.private_instruction_bookings (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null references public.profiles(id) on delete cascade,
  instructor_id        uuid references public.profiles(id) on delete set null,
  availability_id      uuid not null unique references public.private_instruction_availability(id),
  full_name            text not null,
  email                text not null,
  phone                text,
  stripe_session_id    text not null unique,
  amount_cents         integer not null,
  status               text not null default 'confirmed' check (status in ('confirmed', 'completed', 'canceled', 'no_show')),
  meeting_url          text,
  canceled_at          timestamptz,
  canceled_by          uuid references public.profiles(id) on delete set null,
  cancellation_reason  text,
  -- Dedup marker for a future 24-hour reminder email, same on-the-row
  -- pattern as mock_oral_bookings.reminder_sent_at.
  reminder_sent_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index private_instruction_bookings_profile_idx on public.private_instruction_bookings (profile_id, created_at desc);
create index private_instruction_bookings_instructor_idx on public.private_instruction_bookings (instructor_id, status);
create index private_instruction_bookings_status_idx on public.private_instruction_bookings (status, created_at desc);

alter table public.private_instruction_bookings enable row level security;

create policy "Admins manage private instruction bookings"
  on public.private_instruction_bookings for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Instructors view their assigned private instruction bookings"
  on public.private_instruction_bookings for select
  using (instructor_id = auth.uid());

create policy "Instructors update their assigned private instruction bookings"
  on public.private_instruction_bookings for update
  using (instructor_id = auth.uid())
  with check (instructor_id = auth.uid());

create policy "Students view their own private instruction bookings"
  on public.private_instruction_bookings for select
  using (profile_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────
-- 4. Lock the new eligibility column against self-escalation, from
--    the start (the v144 lesson, applied proactively this time rather
--    than as a follow-up fix). lock_profile_privileged_columns() is
--    shared across every privileged-column product on profiles, so
--    this extends the existing function rather than creating a new
--    trigger.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.lock_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin(auth.uid()) then
    new.role := old.role;
    new.checkride_prep_unlocked := old.checkride_prep_unlocked;
    new.email := old.email;
    new.created_at := old.created_at;
    new.mock_oral_instructor := old.mock_oral_instructor;
    new.mock_oral_certificate_types := old.mock_oral_certificate_types;
    new.mock_oral_rate_cents := old.mock_oral_rate_cents;
    new.private_instruction_instructor := old.private_instruction_instructor;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 5. Read RPCs
-- ─────────────────────────────────────────────────────────────────

-- Public-safe availability list: no instructor identity, no PII.
create or replace function public.get_private_instruction_availability(
  p_days_ahead integer default 60
)
returns table (
  id uuid,
  class_date date,
  start_time time,
  end_time time,
  timezone text
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.class_date, a.start_time, a.end_time, a.timezone
  from public.private_instruction_availability a
  where a.status = 'open'
    and a.class_date >= current_date
    and a.class_date <= current_date + (greatest(p_days_ahead, 1) || ' days')::interval
  order by a.class_date, a.start_time;
$$;

grant execute on function public.get_private_instruction_availability(integer) to anon, authenticated;

-- Student's own bookings.
create or replace function public.get_my_private_instruction_bookings()
returns table (
  id uuid,
  status text,
  class_date date,
  start_time time,
  end_time time,
  timezone text,
  instructor_name text,
  meeting_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.id, b.status,
    a.class_date, a.start_time, a.end_time, a.timezone,
    ins.full_name, b.meeting_url
  from public.private_instruction_bookings b
  join public.private_instruction_availability a on a.id = b.availability_id
  left join public.profiles ins on ins.id = b.instructor_id
  where b.profile_id = auth.uid()
  order by a.class_date desc, a.start_time desc;
$$;

grant execute on function public.get_my_private_instruction_bookings() to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 6. Cancellation -- same "reopen the slot, mark canceled" logic as
--    cancel_mock_oral_booking().
-- ─────────────────────────────────────────────────────────────────
create or replace function public.cancel_private_instruction_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
begin
  select * into v_booking from public.private_instruction_bookings where id = p_booking_id for update;
  if v_booking is null then return false; end if;
  if v_booking.profile_id <> auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Not authorized to cancel this booking';
  end if;
  if v_booking.status <> 'confirmed' then
    return false;
  end if;

  update public.private_instruction_bookings
  set status = 'canceled', canceled_at = now(), canceled_by = auth.uid(), cancellation_reason = p_reason, updated_at = now()
  where id = p_booking_id;

  update public.private_instruction_availability
  set status = 'open', updated_at = now()
  where id = v_booking.availability_id;

  return true;
end;
$$;

grant execute on function public.cancel_private_instruction_booking(uuid, text) to authenticated;
