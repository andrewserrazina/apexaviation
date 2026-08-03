-- Apex Advantage — Public class discovery for the Ground School landing
-- page (v61)
--
-- apex-advantage-private-pilot.html is a pre-signup marketing page, but
-- scheduled_ground_classes' only SELECT policy requires
-- auth.role() = 'authenticated' (supabase-portal-schema-v15.sql,
-- deliberately -- it also excludes past classes). An anonymous ad visitor
-- can't read it directly, yet the $25 registration purchase itself is
-- already anonymous-friendly (create-checkout-session's
-- 'ground-school-registration' purpose needs no login). This RPC closes
-- that gap: a public, read-only, minimal-fields view so the landing page
-- can show real upcoming classes (and let a visitor buy one) before they
-- ever create an account -- without loosening the real RLS policy or
-- exposing anything not needed for that decision (no meeting_url, no
-- enrollee PII).
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v60.

create or replace function public.get_upcoming_ground_school_classes(
  p_course_id text default 'PPL',
  p_limit integer default 12
)
returns table (
  id uuid,
  title text,
  module_id text,
  module_title text,
  class_date date,
  start_time time,
  end_time time,
  timezone text,
  instructor_name text,
  capacity integer,
  enrolled_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  select
    id, title, module_id, module_title, class_date, start_time, end_time,
    timezone, instructor_name, capacity, enrolled_count
  from public.scheduled_ground_classes
  where course_id = p_course_id
    and status = 'published'
    and class_date >= current_date
  order by class_date, start_time
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_upcoming_ground_school_classes(text, integer) to anon, authenticated;
