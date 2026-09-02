-- Apex Advantage Mock Orals — data model (v97)
--
-- A separate, more sophisticated product from the existing $99/60-minute
-- "book-mock-oral" flow (mock_oral_requests, v28.sql): that system is a
-- pure request queue (pay, then admin manually coordinates a time by
-- phone/email) with no real scheduling, intake, or assessment engine.
-- This is the new $129/2-hour structured, ACS-based Mock Oral: real
-- slot-based scheduling, a full intake questionnaire, a standardized
-- instructor assessment interface, and a persisted student report.
--
-- mock_oral_requests and handleMockOralBooking are left completely
-- untouched -- any legacy pending requests remain manageable exactly as
-- before via /mock-oral-requests. Only the customer-facing "Book a Mock
-- Oral" entry points are being redirected to the new flow (a product
-- decision, not a data change -- see the implementation report).
--
-- Design decisions worth calling out:
--   - Extends profiles for instructor eligibility/rate rather than a
--     separate mock_oral_instructors table (mirrors the existing
--     ground_school_rate precedent, v60.sql) -- an instructor is already
--     a profiles row with role='instructor'.
--   - Availability is explicit bookable slot rows (class_date/start_time/
--     end_time/timezone), mirroring scheduled_ground_classes' proven
--     shape exactly, rather than a recurring-availability-plus-runtime-
--     slot-generation model. Same timezone convention, same client-side
--     zonedWallClockToUtc() rendering approach.
--   - Order of operations: student selects an open slot -> Stripe
--     Checkout -> webhook is the ONLY place that flips a slot from
--     'open' to 'booked', via a single conditional UPDATE ... WHERE
--     status = 'open'. This is the same "payment captured, webhook is
--     the sole source of truth, refund-and-alert on fulfillment failure"
--     pattern already used for every other product in stripe-webhook/
--     index.ts (Checkride Prep, Ground School capacity). No separate
--     temporary-hold table is needed: the UPDATE's row-level lock makes
--     two simultaneous webhook deliveries for the same slot resolve
--     safely -- exactly one wins, the other's booking insert is skipped
--     and that payment is refunded (see stripe-webhook/index.ts).
--   - Recheck is a self-referencing FK (mock_oral_bookings.
--     original_booking_id) rather than a separate mock_oral_rechecks
--     table -- a recheck is just another booking + assessment pair,
--     linked to the one it follows up on.
--   - Known limitation, not solved here: this does NOT stop an admin/
--     instructor from manually creating two overlapping availability
--     slots for the same instructor (no exclusion constraint). It DOES
--     fully prevent two students from ever both landing a CONFIRMED
--     booking against the same single slot, which is the actual
--     double-sale risk. Flagged in the implementation report.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v96.

-- ─────────────────────────────────────────────────────────────────
-- 1. Instructor eligibility + compensation (extends profiles)
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists mock_oral_instructor boolean not null default false,
  add column if not exists mock_oral_certificate_types text[] not null default '{}',
  add column if not exists mock_oral_rate_cents integer;

comment on column public.profiles.mock_oral_certificate_types is
  'Subset of {private_pilot, instrument, commercial, cfi} this instructor is approved to conduct Mock Orals for. Only private_pilot is exposed publicly today.';

-- ─────────────────────────────────────────────────────────────────
-- 2. Products -- admin-togglable so Product 2/3 can be enabled without
--    a deploy. Price is duplicated into Stripe's inline price_data at
--    checkout time (this codebase never pre-creates Stripe Price
--    objects), so this table is the actual, single source of truth for
--    pricing -- change it here and the checkout price changes with it.
-- ─────────────────────────────────────────────────────────────────
create table public.mock_oral_products (
  id                 text primary key,
  certificate_type   text not null default 'private_pilot',
  name               text not null,
  short_description  text not null,
  price_cents        integer not null check (price_cents > 0),
  duration_minutes   integer not null default 120,
  includes_recheck   boolean not null default false,
  badge              text,
  active             boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

insert into public.mock_oral_products (id, certificate_type, name, short_description, price_cents, duration_minutes, includes_recheck, badge, active, sort_order) values
  ('pp_mock_oral',         'private_pilot', 'Private Pilot Mock Oral',            'Up to 2-hour live ACS-based Mock Oral with a written Performance Report.', 12900, 120, false, null,             true,  1),
  ('pp_mock_oral_recheck', 'private_pilot', 'Private Pilot Mock Oral + Recheck',  'Everything in the Mock Oral, plus one 30-minute targeted recheck.',        17900, 120, true,  'MOST POPULAR',  true,  2),
  ('pp_checkride_ready',   'private_pilot', 'Checkride Ready Bundle',             'Mock Oral, Readiness Report, Checkride Prep System access, and a recheck.', 22900, 120, true,  null,             false, 3)
on conflict (id) do nothing;

alter table public.mock_oral_products enable row level security;

create policy "Anyone can view active mock oral products"
  on public.mock_oral_products for select
  using (active = true);

create policy "Admins manage mock oral products"
  on public.mock_oral_products for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 3. Availability -- explicit slots, same shape as scheduled_ground_
--    classes (class_date/start_time/end_time/timezone) for convention
--    consistency and so the client can reuse the exact same
--    zonedWallClockToUtc() rendering helper already proven there.
-- ─────────────────────────────────────────────────────────────────
create table public.mock_oral_availability (
  id                 uuid primary key default gen_random_uuid(),
  instructor_id      uuid not null references public.profiles(id) on delete cascade,
  certificate_type   text not null default 'private_pilot',
  class_date         date not null,
  start_time         time not null,
  end_time           time not null,
  timezone           text not null default 'America/Chicago',
  -- Informational only today (not enforced by a constraint -- see the
  -- header note on overlapping slots): how much buffer the instructor
  -- wants held after this slot before their next one, surfaced in the
  -- admin/instructor slot-creation UI.
  buffer_minutes     integer not null default 15,
  status             text not null default 'open' check (status in ('open', 'booked', 'blocked')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (end_time > start_time)
);

create index mock_oral_availability_lookup_idx
  on public.mock_oral_availability (certificate_type, status, class_date, start_time);
create index mock_oral_availability_instructor_idx
  on public.mock_oral_availability (instructor_id, class_date, start_time);

alter table public.mock_oral_availability enable row level security;

create policy "Admins manage mock oral availability"
  on public.mock_oral_availability for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Instructors manage their own mock oral availability"
  on public.mock_oral_availability for all
  using (instructor_id = auth.uid())
  with check (instructor_id = auth.uid());

-- Authenticated students need to see OPEN future slots to book one, but
-- never which instructor holds a given slot before it's booked (the
-- product is "book a time," not "pick an instructor"). get_mock_oral_
-- availability() below is the actual read path for that; this policy
-- exists only so the service-role webhook and RPCs can operate normally
-- and so an authenticated client-side query against the bare table
-- (defense in depth, not the primary path) can't see anything beyond
-- open slots.
create policy "Authenticated users view open future mock oral slots"
  on public.mock_oral_availability for select
  using (
    auth.role() = 'authenticated'
    and status = 'open'
    and class_date >= current_date
  );

-- ─────────────────────────────────────────────────────────────────
-- 4. Bookings
-- ─────────────────────────────────────────────────────────────────
create table public.mock_oral_bookings (
  id                   uuid primary key default gen_random_uuid(),
  product_id           text not null references public.mock_oral_products(id),
  profile_id           uuid not null references public.profiles(id) on delete cascade,
  instructor_id        uuid references public.profiles(id) on delete set null,
  availability_id      uuid not null unique references public.mock_oral_availability(id),
  original_booking_id  uuid references public.mock_oral_bookings(id) on delete set null,
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
  -- Dedup marker for the 24-hour reminder email (send-lifecycle-
  -- emails/index.ts's processMockOralReminders) -- same on-the-row
  -- dedupe pattern as checkout_session_attempts.recovery_email_sent_at.
  reminder_sent_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index mock_oral_bookings_profile_idx on public.mock_oral_bookings (profile_id, created_at desc);
create index mock_oral_bookings_instructor_idx on public.mock_oral_bookings (instructor_id, status);
create index mock_oral_bookings_status_idx on public.mock_oral_bookings (status, created_at desc);

alter table public.mock_oral_bookings enable row level security;

create policy "Admins manage mock oral bookings"
  on public.mock_oral_bookings for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Instructors view their assigned mock oral bookings"
  on public.mock_oral_bookings for select
  using (instructor_id = auth.uid());

create policy "Instructors update their assigned mock oral bookings"
  on public.mock_oral_bookings for update
  using (instructor_id = auth.uid())
  with check (instructor_id = auth.uid());

create policy "Students view their own mock oral bookings"
  on public.mock_oral_bookings for select
  using (profile_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────
-- 5. Intake
-- ─────────────────────────────────────────────────────────────────
create table public.mock_oral_intakes (
  id                        uuid primary key default gen_random_uuid(),
  booking_id                uuid not null unique references public.mock_oral_bookings(id) on delete cascade,
  certificate_sought        text not null default 'private_pilot',
  checkride_date            date,
  dpe_name                  text,
  dpe_location              text,
  flight_school             text,
  primary_instructor_name   text,
  aircraft_make             text,
  aircraft_model            text,
  aircraft_year             text,
  tail_number               text,
  avionics_type             text,
  avionics_notes            text,
  flight_hours              numeric,
  knowledge_test_score      numeric,
  strongest_areas           text,
  weakest_areas             text,
  special_requests          text,
  -- Path within the 'mock-oral-uploads' storage bucket, same shape as
  -- Documents.jsx's student_documents.file_path convention.
  knowledge_test_report_path text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.mock_oral_intakes enable row level security;

create policy "Admins manage mock oral intakes"
  on public.mock_oral_intakes for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Students manage their own mock oral intake"
  on public.mock_oral_intakes for all
  using (exists (select 1 from public.mock_oral_bookings b where b.id = booking_id and b.profile_id = auth.uid()))
  with check (exists (select 1 from public.mock_oral_bookings b where b.id = booking_id and b.profile_id = auth.uid()));

create policy "Assigned instructors view intake"
  on public.mock_oral_intakes for select
  using (exists (select 1 from public.mock_oral_bookings b where b.id = booking_id and b.instructor_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 6. Assessments + category scores
-- ─────────────────────────────────────────────────────────────────
create table public.mock_oral_assessments (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null unique references public.mock_oral_bookings(id) on delete cascade,
  instructor_id            uuid not null references public.profiles(id),
  status                   text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  overall_readiness        text check (overall_readiness in ('checkride_ready', 'nearly_ready', 'needs_targeted_review', 'not_yet_ready')),
  strongest_areas          text,
  priority_review_areas    text,
  -- Array of { label, url } -- e.g. { label: "Module 5 — Airspace
  -- Mastery", url: "/portal.html#curriculum" }. Instructor-picked, not
  -- auto-derived in V1 (see report: future Readiness Score integration).
  recommended_next_steps   jsonb not null default '[]'::jsonb,
  instructor_summary       text,
  started_at               timestamptz,
  completed_at             timestamptz,
  elapsed_seconds          integer not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.mock_oral_assessments enable row level security;

create policy "Admins manage mock oral assessments"
  on public.mock_oral_assessments for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Assigned instructors manage their assessments"
  on public.mock_oral_assessments for all
  using (instructor_id = auth.uid())
  with check (instructor_id = auth.uid());

-- Deliberately NO student-facing select policy here -- the assessment
-- table holds instructor-facing working notes, not the polished report.
-- Students read their results only through get_my_mock_oral_report()
-- below, a SECURITY DEFINER RPC that returns a curated shape.

create table public.mock_oral_category_scores (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references public.mock_oral_assessments(id) on delete cascade,
  category        text not null check (category in (
    'pilot_qualifications', 'airworthiness', 'weather', 'cross_country_planning',
    'national_airspace_system', 'aircraft_systems', 'performance_limitations',
    'aerodynamics', 'airport_operations', 'regulations',
    'aeronautical_decision_making', 'emergency_abnormal'
  )),
  -- Nullable ACS mapping, populated later as the question bank/reporting
  -- gets mapped to real ACS Areas of Operation/Tasks (see header note).
  acs_area        text,
  acs_task        text,
  rating          text not null default 'not_evaluated' check (rating in ('strong', 'satisfactory', 'needs_review', 'unsatisfactory', 'not_evaluated')),
  notes           text,
  weakness_tags   text[] not null default '{}',
  updated_at      timestamptz not null default now(),
  unique (assessment_id, category)
);

alter table public.mock_oral_category_scores enable row level security;

create policy "Admins manage mock oral category scores"
  on public.mock_oral_category_scores for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Assigned instructors manage their category scores"
  on public.mock_oral_category_scores for all
  using (exists (select 1 from public.mock_oral_assessments a where a.id = assessment_id and a.instructor_id = auth.uid()))
  with check (exists (select 1 from public.mock_oral_assessments a where a.id = assessment_id and a.instructor_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 7. Question bank -- instructor prompts, not a script. Seeded with a
--    representative sample (not a complete FAA question bank) purely to
--    exercise the system end to end, per the brief's explicit
--    instruction not to fabricate full coverage.
-- ─────────────────────────────────────────────────────────────────
create table public.mock_oral_questions (
  id                 uuid primary key default gen_random_uuid(),
  category           text not null check (category in (
    'pilot_qualifications', 'airworthiness', 'weather', 'cross_country_planning',
    'national_airspace_system', 'aircraft_systems', 'performance_limitations',
    'aerodynamics', 'airport_operations', 'regulations',
    'aeronautical_decision_making', 'emergency_abnormal'
  )),
  acs_area           text,
  acs_task           text,
  acs_code           text,
  difficulty         integer not null check (difficulty between 1 and 4),
  certificate_type   text not null default 'private_pilot',
  -- Nullable: a scenario-only prompt (the difficulty-4 "scenario /
  -- judgment" rows) carries its full prompt in `scenario` and leaves
  -- `question` blank -- the check below just guarantees every row has
  -- *some* prompt text, in either column.
  question           text,
  follow_ups         text[] not null default '{}',
  scenario           text,
  instructor_notes   text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  check (question is not null or scenario is not null)
);

create index mock_oral_questions_lookup_idx on public.mock_oral_questions (certificate_type, category, active);

alter table public.mock_oral_questions enable row level security;

create policy "Admins manage mock oral questions"
  on public.mock_oral_questions for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Instructors view active mock oral questions"
  on public.mock_oral_questions for select
  using (
    active = true
    and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'instructor' or p.role = 'admin'))
  );

insert into public.mock_oral_questions (category, acs_area, difficulty, certificate_type, question, follow_ups, scenario) values
  ('airworthiness', 'Area I, Task C', 1, 'private_pilot', 'What documents are required aboard the aircraft?', '{}', null),
  ('airworthiness', 'Area I, Task C', 2, 'private_pilot', 'How do you determine whether the aircraft is currently airworthy?', '{"What inspections have a specific calendar interval vs. an hour interval?"}', null),
  ('airworthiness', 'Area I, Task C', 3, 'private_pilot', 'You discover that the landing light is inoperative. Walk me through how you determine whether the aircraft can legally and safely fly.', '{"Does your answer change if this were a night flight?"}', null),
  ('airworthiness', 'Area I, Task C', 4, 'private_pilot', null, '{}', 'You are away from your home airport and discover an inoperative piece of equipment during preflight. Show me how you would make the decision whether to depart.'),
  ('aerodynamics', 'Area VI', 1, 'private_pilot', 'What causes an airplane to stall?', '{}', null),
  ('aerodynamics', 'Area VI', 2, 'private_pilot', 'What is the difference between pitch attitude and angle of attack?', '{}', null),
  ('aerodynamics', 'Area VI', 3, 'private_pilot', 'Why does stall speed increase during a steep level turn?', '{"How would that change in an unloaded turn?"}', null),
  ('aerodynamics', 'Area VI', 4, 'private_pilot', null, '{"What is happening aerodynamically?"}', 'You overshoot final and increase bank while pulling back to tighten the turn. What is happening aerodynamically?'),
  ('weather', 'Area I, Task E', 1, 'private_pilot', 'What weather products do you check before a cross-country flight?', '{}', null),
  ('weather', 'Area I, Task E', 2, 'private_pilot', 'What is the difference between a METAR and a TAF?', '{}', null),
  ('weather', 'Area I, Task E', 3, 'private_pilot', 'Given this METAR, would you make this flight as planned?', '{"What specifically concerns you about these conditions?"}', null),
  ('weather', 'Area I, Task E', 4, 'private_pilot', null, '{}', 'You depart into forecast VFR conditions, but 30 minutes in, visibility starts dropping. Walk me through your decision-making.'),
  ('national_airspace_system', 'Area I, Task D', 1, 'private_pilot', 'What are the basic VFR weather minimums for Class E airspace?', '{}', null),
  ('national_airspace_system', 'Area I, Task D', 2, 'private_pilot', 'How do you identify the different classes of airspace on a sectional chart?', '{}', null),
  ('national_airspace_system', 'Area I, Task D', 3, 'private_pilot', 'What do you need to do before entering Class C airspace?', '{}', null),
  ('aircraft_systems', 'Area I, Task C', 2, 'private_pilot', 'Explain how your aircraft''s fuel system delivers fuel to the engine.', '{"What would indicate a problem with this system in flight?"}', null),
  ('aircraft_systems', 'Area I, Task C', 3, 'private_pilot', 'How would you recognize an alternator failure in flight, and what would you do?', '{"What is load shedding, and when would you use it?"}', null),
  ('aeronautical_decision_making', 'Area I, Task J', 3, 'private_pilot', 'Walk me through the PAVE checklist and how you''d use it before this flight.', '{}', null),
  ('aeronautical_decision_making', 'Area I, Task J', 4, 'private_pilot', null, '{}', 'You''re 20 minutes into a cross-country and start feeling nauseous and fatigued. What do you do?'),
  ('emergency_abnormal', 'Area IX', 3, 'private_pilot', 'What is your immediate response to an engine failure after takeoff?', '{"How does your decision change with sufficient runway remaining?"}', null),
  ('emergency_abnormal', 'Area IX', 4, 'private_pilot', null, '{}', 'You lose your primary attitude indicator in cruise flight in marginal VFR. Show me how you''d handle this.')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────
-- 8. Read RPCs
-- ─────────────────────────────────────────────────────────────────

-- Public-safe availability list: no instructor identity, no PII. Used
-- by the booking calendar before checkout.
create or replace function public.get_mock_oral_availability(
  p_certificate_type text default 'private_pilot',
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
  from public.mock_oral_availability a
  where a.certificate_type = p_certificate_type
    and a.status = 'open'
    and a.class_date >= current_date
    and a.class_date <= current_date + (greatest(p_days_ahead, 1) || ' days')::interval
  order by a.class_date, a.start_time;
$$;

grant execute on function public.get_mock_oral_availability(text, integer) to anon, authenticated;

-- Student's own bookings, with the fields the dashboard card needs.
create or replace function public.get_my_mock_oral_bookings()
returns table (
  id uuid,
  product_id text,
  product_name text,
  status text,
  class_date date,
  start_time time,
  end_time time,
  timezone text,
  instructor_name text,
  meeting_url text,
  has_intake boolean,
  has_report boolean,
  original_booking_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.id, b.product_id, p.name, b.status,
    a.class_date, a.start_time, a.end_time, a.timezone,
    ins.full_name, b.meeting_url,
    exists (select 1 from public.mock_oral_intakes i where i.booking_id = b.id),
    exists (select 1 from public.mock_oral_assessments asmt where asmt.booking_id = b.id and asmt.status = 'completed'),
    b.original_booking_id
  from public.mock_oral_bookings b
  join public.mock_oral_products p on p.id = b.product_id
  join public.mock_oral_availability a on a.id = b.availability_id
  left join public.profiles ins on ins.id = b.instructor_id
  where b.profile_id = auth.uid()
  order by a.class_date desc, a.start_time desc;
$$;

grant execute on function public.get_my_mock_oral_bookings() to authenticated;

-- Curated, student-safe report shape -- deliberately excludes raw
-- instructor notes/weakness tags (those stay instructor/admin-only on
-- the underlying tables). Returns null if the assessment isn't
-- completed or doesn't belong to the caller, rather than erroring, so
-- the client can render a simple "not ready yet" state.
create or replace function public.get_my_mock_oral_report(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'booking_id', b.id,
    'student_name', b.full_name,
    'assessment_date', a.completed_at,
    'instructor_name', ins.full_name,
    'certificate_sought', coalesce(i.certificate_sought, 'private_pilot'),
    'checkride_date', i.checkride_date,
    'aircraft', trim(both ' ' from coalesce(i.aircraft_make, '') || ' ' || coalesce(i.aircraft_model, '')),
    'overall_readiness', a.overall_readiness,
    'strongest_areas', a.strongest_areas,
    'priority_review_areas', a.priority_review_areas,
    'recommended_next_steps', a.recommended_next_steps,
    'instructor_summary', a.instructor_summary,
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'category', cs.category, 'rating', cs.rating, 'notes', cs.notes
      ) order by cs.category), '[]'::jsonb)
      from public.mock_oral_category_scores cs
      where cs.assessment_id = a.id and cs.rating <> 'not_evaluated'
    )
  ) into v_result
  from public.mock_oral_bookings b
  join public.mock_oral_assessments a on a.booking_id = b.id
  left join public.mock_oral_intakes i on i.booking_id = b.id
  left join public.profiles ins on ins.id = b.instructor_id
  where b.id = p_booking_id
    and b.profile_id = auth.uid()
    and a.status = 'completed';

  return v_result;
end;
$$;

grant execute on function public.get_my_mock_oral_report(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 9. Reschedule -- atomically releases the old slot and claims a new
--    one. Callable by the booking's own student or an admin. Fails
--    cleanly (returns false) if the target slot isn't open, rather than
--    leaving the booking half-moved.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.reschedule_mock_oral_booking(
  p_booking_id uuid,
  p_new_availability_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_claimed uuid;
begin
  select * into v_booking from public.mock_oral_bookings where id = p_booking_id for update;
  if v_booking is null then return false; end if;
  if v_booking.profile_id <> auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Not authorized to reschedule this booking';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'Only a confirmed booking can be rescheduled';
  end if;

  update public.mock_oral_availability
  set status = 'booked', updated_at = now()
  where id = p_new_availability_id and status = 'open'
  returning id into v_claimed;

  if v_claimed is null then
    return false;
  end if;

  update public.mock_oral_availability
  set status = 'open', updated_at = now()
  where id = v_booking.availability_id;

  update public.mock_oral_bookings
  set availability_id = v_claimed, updated_at = now()
  where id = p_booking_id;

  return true;
end;
$$;

grant execute on function public.reschedule_mock_oral_booking(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 10. Cancellation -- student self-cancel or admin cancel. Releases the
--     slot back to 'open'. Does NOT touch Stripe/issue a refund -- no
--     cancellation/refund policy exists yet in this repository (see the
--     implementation report's business-decision flag); this only
--     updates booking/availability state.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.cancel_mock_oral_booking(
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
  select * into v_booking from public.mock_oral_bookings where id = p_booking_id for update;
  if v_booking is null then return false; end if;
  if v_booking.profile_id <> auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Not authorized to cancel this booking';
  end if;
  if v_booking.status <> 'confirmed' then
    return false;
  end if;

  update public.mock_oral_bookings
  set status = 'canceled', canceled_at = now(), canceled_by = auth.uid(), cancellation_reason = p_reason, updated_at = now()
  where id = p_booking_id;

  update public.mock_oral_availability
  set status = 'open', updated_at = now()
  where id = v_booking.availability_id;

  return true;
end;
$$;

grant execute on function public.cancel_mock_oral_booking(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 10b. Recheck booking -- a recheck is already paid for as part of an
-- includes_recheck product, so this is a direct slot claim, not a new
-- Stripe checkout. Reuses the same atomic-claim safety as the paid
-- flow. stripe_session_id has no real Stripe session behind a free
-- recheck, so a synthetic, still-unique placeholder satisfies the
-- column's NOT NULL/UNIQUE constraint without weakening it for every
-- other (real, paid) booking.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.book_mock_oral_recheck(
  p_original_booking_id uuid,
  p_availability_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original record;
  v_product record;
  v_claimed record;
  v_new_booking_id uuid;
begin
  select * into v_original from public.mock_oral_bookings where id = p_original_booking_id;
  if v_original is null or v_original.profile_id <> auth.uid() then
    raise exception 'Not authorized to book a recheck for this Mock Oral';
  end if;

  select * into v_product from public.mock_oral_products where id = v_original.product_id;
  if v_product is null or not v_product.includes_recheck then
    raise exception 'This Mock Oral does not include a recheck';
  end if;

  if exists (select 1 from public.mock_oral_bookings where original_booking_id = p_original_booking_id and status <> 'canceled') then
    raise exception 'A recheck has already been booked for this Mock Oral';
  end if;

  update public.mock_oral_availability
  set status = 'booked', updated_at = now()
  where id = p_availability_id and status = 'open'
  returning * into v_claimed;

  if v_claimed is null then
    return null;
  end if;

  insert into public.mock_oral_bookings (
    product_id, profile_id, instructor_id, availability_id, original_booking_id,
    full_name, email, stripe_session_id, amount_cents, status
  ) values (
    v_original.product_id, v_original.profile_id, v_claimed.instructor_id, v_claimed.id, p_original_booking_id,
    v_original.full_name, v_original.email, 'recheck-' || gen_random_uuid()::text, 0, 'confirmed'
  ) returning id into v_new_booking_id;

  return v_new_booking_id;
end;
$$;

grant execute on function public.book_mock_oral_recheck(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 11. Storage — Knowledge Test Report uploads.
--
-- MANUAL STEP REQUIRED (cannot be done from SQL): create a bucket named
-- 'mock-oral-uploads' in the Supabase Dashboard (Storage -> New bucket),
-- set to Private (not public). student-docs (Documents.jsx's bucket)
-- was itself set up this same way -- no SQL trace of its own creation
-- either. Once the bucket exists, these policies govern access to it,
-- mirroring student-docs' path convention: files are stored at
-- "<booking_id>/<filename>", so ownership is checked by resolving the
-- first path segment back to a booking the caller actually owns.
-- ─────────────────────────────────────────────────────────────────
create policy "Students upload their own mock oral reports"
  on storage.objects for insert
  with check (
    bucket_id = 'mock-oral-uploads'
    and exists (
      select 1 from public.mock_oral_bookings b
      where b.id::text = (storage.foldername(name))[1]
        and b.profile_id = auth.uid()
    )
  );

create policy "Students view their own mock oral reports"
  on storage.objects for select
  using (
    bucket_id = 'mock-oral-uploads'
    and exists (
      select 1 from public.mock_oral_bookings b
      where b.id::text = (storage.foldername(name))[1]
        and b.profile_id = auth.uid()
    )
  );

create policy "Assigned instructors view mock oral reports"
  on storage.objects for select
  using (
    bucket_id = 'mock-oral-uploads'
    and exists (
      select 1 from public.mock_oral_bookings b
      where b.id::text = (storage.foldername(name))[1]
        and b.instructor_id = auth.uid()
    )
  );

create policy "Admins manage mock oral report storage"
  on storage.objects for all
  using (bucket_id = 'mock-oral-uploads' and public.is_admin(auth.uid()))
  with check (bucket_id = 'mock-oral-uploads' and public.is_admin(auth.uid()));
