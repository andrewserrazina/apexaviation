-- Apex Advantage — Instructor payroll/hours tracking (v26)
--
-- Adds a pay rate to instructor profiles and a payroll_adjustments table
-- for one-off items (bonuses, flat ground-school session pay,
-- deductions) that don't come from a flight-hour calculation. Flight
-- instruction hours are read directly from the existing logbook_entries
-- table (instructor_id, duration_hours, date) -- no new table needed
-- there. Ground school hours are read from the existing
-- scheduled_ground_classes (instructor_id, class_date, start_time,
-- end_time) and legacy ground_sessions (instructor_id, scheduled_at,
-- duration_minutes) tables, paid per class at ground_school_rate rather
-- than a derived hourly amount, since that's how ground sessions are
-- actually staffed (a flat per-class rate, not hourly).
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v25.

alter table public.profiles
  add column if not exists hourly_rate numeric,
  add column if not exists ground_school_rate numeric;

create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.profiles(id) on delete cascade,
  description text not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create index if not exists payroll_adjustments_instructor_idx
  on public.payroll_adjustments (instructor_id, created_at);

alter table public.payroll_adjustments enable row level security;

drop policy if exists "Admins manage payroll adjustments" on public.payroll_adjustments;
create policy "Admins manage payroll adjustments"
  on public.payroll_adjustments for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "Instructors view own payroll adjustments" on public.payroll_adjustments;
create policy "Instructors view own payroll adjustments"
  on public.payroll_adjustments for select
  using (instructor_id = auth.uid());
