-- Apex Advantage — Acquisition/conversion-system foundation (v58)
--
-- Three independent additions for the acquisition-funnel work
-- (Visitor -> Free Member -> Engaged Member -> $25 Ground School ->
-- $400 Full Pack / Checkride Prep):
--
-- 1. UTM attribution, split first-touch vs latest-touch, using the two
--    natural one-time-write points that already exist rather than a new
--    tracking table: profiles (written once at signup) captures
--    first-touch ("which ad generated this member"), and
--    checkout_session_attempts (written fresh per purchase attempt,
--    supabase-portal-schema-v31.sql) captures latest-touch as of that
--    specific purchase ("which campaign generated this purchase").
--
-- 2. Two read-only RPCs so the portal can show a Full Ground School
--    student's real progress ("6 of 20 modules") and mark classes the
--    member already registered for -- without loosening
--    scheduled_ground_classes' existing "Students view published
--    upcoming ground classes" RLS policy (supabase-portal-schema-v15.sql),
--    which deliberately excludes past classes. A security-definer RPC
--    reads what it needs directly rather than widening that policy.
--
-- 3. Extends portal_events' client-insert RLS whitelist
--    (supabase-portal-schema-v44.sql) with two new one-time view events
--    the new getMemberConversionState() logic (portal-stable.js) needs
--    to persist across logins.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v57.

-- ─────────────────────────────────────────────────────────────────
-- 1a. First-touch UTM, captured once at signup (create-free-account /
-- signup-and-unlock-checkride-prep / signup-and-unlock-ground-school-pack).
-- Nullable, never updated after the row is created -- if a signup path
-- doesn't pass utm data, these just stay null, same as any other
-- optional signup field.
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists signup_utm_source text;
alter table public.profiles add column if not exists signup_utm_medium text;
alter table public.profiles add column if not exists signup_utm_campaign text;
alter table public.profiles add column if not exists signup_utm_content text;
alter table public.profiles add column if not exists signup_utm_term text;

-- ─────────────────────────────────────────────────────────────────
-- 1b. Latest-touch UTM as of a specific purchase attempt. One row per
-- checkout attempt already exists (checkout_session_attempts), so this
-- is naturally per-purchase, not per-member -- no risk of one purchase's
-- attribution overwriting another's.
-- ─────────────────────────────────────────────────────────────────
alter table public.checkout_session_attempts add column if not exists utm_source text;
alter table public.checkout_session_attempts add column if not exists utm_medium text;
alter table public.checkout_session_attempts add column if not exists utm_campaign text;
alter table public.checkout_session_attempts add column if not exists utm_content text;
alter table public.checkout_session_attempts add column if not exists utm_term text;

-- ─────────────────────────────────────────────────────────────────
-- 2a. Total Private Pilot modules currently published -- the denominator
-- for "X of N Modules". language sql (not plpgsql), so this is exempt
-- from the returns-table implicit-variable-shadowing bug class that hit
-- get_checkride_prep_pricing (supabase-portal-schema-v54.sql): no
-- procedural variables are declared here at all.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.get_ground_school_module_count(p_course_id text default 'PPL')
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct lesson_id)::integer
  from public.scheduled_ground_classes
  where course_id = p_course_id
    and status = 'published';
$$;

grant execute on function public.get_ground_school_module_count(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2b. The calling member's own scheduled-class enrollments, joined with
-- class/lesson info. Scoped to auth.uid() server-side (never trusts a
-- client-supplied profile id) -- same pattern as
-- enroll_in_ground_school_via_pack (v57). Used for both the Ground
-- School Progress card (completed = attendance_status = 'attended') and
-- marking a class card "Already Registered" instead of offering
-- Register again.
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
    e.attendance_status,
    e.payment_status
  from public.scheduled_ground_class_enrollments e
  join public.scheduled_ground_classes c on c.id = e.scheduled_ground_class_id
  where e.profile_id = auth.uid()
    and e.payment_status in ('paid', 'ground_school_pack')
  order by c.class_date, c.start_time;
$$;

grant execute on function public.get_my_ground_school_enrollments() to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. getMemberConversionState()'s "ground_school_interested" state reads
-- portal_events for ground_school_calendar_viewed/ground_school_class_
-- viewed (logged client-side via logEventOnce, same one-time-per-member
-- pattern as first_login/first_question_completed etc). Those two event
-- types aren't in the client-insert whitelist from
-- supabase-portal-schema-v44.sql, so without this the insert would
-- silently fail RLS every time -- the in-memory loggedEventTypes flag
-- would still flip true for the rest of that page load, but nothing
-- would persist, and the very next login would look un-viewed again.
-- ─────────────────────────────────────────────────────────────────
drop policy if exists "Users can log their own client-side events" on public.portal_events;

create policy "Users can log their own client-side events"
  on public.portal_events for insert
  with check (
    auth.uid() = profile_id
    and (
      event_type in (
        'first_login', 'first_question_completed', 'checkride_mode_completed_email', 'checkride_passed',
        'readiness_25', 'readiness_50', 'readiness_75', 'readiness_90',
        'ground_school_calendar_viewed', 'ground_school_class_viewed', 'checkride_prep_viewed'
      )
      or event_type like 'mock_oral_requested_%'
    )
  );
