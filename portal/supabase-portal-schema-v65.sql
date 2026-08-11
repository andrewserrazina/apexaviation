-- Ground School landing page conversion pass: expose amount_cents on a
-- member's own enrollments (v65)
--
-- The post-purchase $400-pack upgrade offer (site/portal-stable.js,
-- renderGroundSchoolRegistrationSuccess) needs to show the real credited
-- amount ("You already paid $25 / Upgrade remaining access: $375")
-- BEFORE the member clicks through to checkout -- create-checkout-
-- session's new 'upgrade-ground-school-pack' purpose already computes
-- this correctly server-side at checkout time, but the client has no way
-- to display it up front because get_my_ground_school_enrollments()
-- (v63.sql) never selected amount_cents. This adds it.
--
-- Postgres won't let CREATE OR REPLACE change a function's OUT-parameter
-- shape (same issue v63 hit against v58's version of this function), so
-- the existing signature has to be dropped first.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v64.

drop function if exists public.get_my_ground_school_enrollments();

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
  payment_status text,
  amount_cents integer
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
    e.payment_status,
    e.amount_cents
  from public.scheduled_ground_class_enrollments e
  join public.scheduled_ground_classes c on c.id = e.scheduled_ground_class_id
  where e.profile_id = auth.uid()
    and e.payment_status in ('paid', 'ground_school_pack');
$$;

grant execute on function public.get_my_ground_school_enrollments() to authenticated;
