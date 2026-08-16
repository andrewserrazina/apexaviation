-- Apex Advantage — Office Manager role (v67)
--
-- New profiles.role value: 'office_manager'. Scope (confirmed with the
-- business owner before writing this): CRM (leads/pipeline), Scheduling
-- (the Class Scheduler + the Operations calendar), and Student records.
-- Explicitly NOT in scope for this pass: Payroll, Reports/Analytics,
-- Broadcast/marketing tools, the ops Simulator/Settings pages, and
-- Ground School instructor bidding. There is no HR module in this app
-- at all yet (confirmed by full-codebase audit) -- that's intentionally
-- left as a future follow-up, not built here.
--
-- Pattern used throughout: ADDITIVE new policies (new names, using a new
-- public.is_office_manager() helper), never replacing an existing
-- policy whose current definition isn't visible in this repo. Several of
-- the tables this role needs (leads, lead_notes, student_syllabi) have
-- no CREATE TABLE/CREATE POLICY in any committed migration -- like
-- ground_sessions/lessons before them, they were created directly in
-- the Supabase dashboard, so their current policies are unknown here.
-- Postgres combines multiple permissive policies on the same table with
-- OR, so adding a new one is always safe regardless of what already
-- exists; replacing one you can't see is not.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v66.

-- ─────────────────────────────────────────────────────────────────
-- 1. New role value.
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'instructor', 'student', 'office_manager'));

-- ─────────────────────────────────────────────────────────────────
-- 2. Helper, mirroring public.is_admin()'s exact shape (v8) and
-- public.is_operations_staff()'s exact shape (v19) -- security definer
-- so it can be used inside profiles' own policies without the
-- self-referential-RLS recursion problem is_admin() was created to fix.
-- Deliberately its own helper rather than folding office_manager into
-- is_operations_staff() (admin+instructor) -- that helper also gates
-- Ground School instructor bidding (v59), which is explicitly out of
-- scope for this role; broadening it would leak access there.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.is_office_manager(p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = p_uid and role = 'office_manager')
$$;

-- ─────────────────────────────────────────────────────────────────
-- 3. profiles -- read all + update, needed for Students.jsx (student
-- list, syllabus assignment editing, student_type toggle). The update
-- policy's WITH CHECK blocks the one real privilege-escalation risk of
-- granting a lesser-trust role broad profile-update access: it cannot
-- ever result in a row with role = 'admin', so an office manager can't
-- self-promote (or promote anyone else) to full admin by editing a
-- profile row. Other role transitions are left unrestricted, matching
-- how "Admins can update profiles" (supabase-schema.sql) has never had
-- any column/value restriction either.
-- ─────────────────────────────────────────────────────────────────
create policy "Office managers can view all profiles"
  on public.profiles for select
  using (public.is_office_manager(auth.uid()));

create policy "Office managers can update profiles"
  on public.profiles for update
  using (public.is_office_manager(auth.uid()))
  with check (public.is_office_manager(auth.uid()) and role <> 'admin');

-- ─────────────────────────────────────────────────────────────────
-- 4. logbook_entries -- SELECT only. Students.jsx's student list embeds
-- logbook_entries!student_id(duration_hours) for flight-hour totals;
-- without this an office manager would see the student list but every
-- row's hours would silently render empty (Postgrest embedded selects
-- return no rows for a relation the caller's RLS can't see, not an
-- error). No INSERT policy -- logging flight time isn't office-manager
-- work.
-- ─────────────────────────────────────────────────────────────────
create policy "Office managers can view logbook entries"
  on public.logbook_entries for select
  using (public.is_office_manager(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 5. student_syllabi -- insert/delete, for Students.jsx's syllabus
-- assignment UI (assign/remove a syllabus from a student). Table has no
-- committed migration (dashboard-created); additive only, per the
-- pattern note above.
-- ─────────────────────────────────────────────────────────────────
create policy "Office managers can assign student syllabi"
  on public.student_syllabi for insert
  with check (public.is_office_manager(auth.uid()));

create policy "Office managers can remove student syllabi"
  on public.student_syllabi for delete
  using (public.is_office_manager(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 6. leads / lead_notes -- full CRM management. Both dashboard-created,
-- no committed migration; additive only.
-- ─────────────────────────────────────────────────────────────────
create policy "Office managers can manage leads"
  on public.leads for all
  using (public.is_office_manager(auth.uid()))
  with check (public.is_office_manager(auth.uid()));

create policy "Office managers can manage lead notes"
  on public.lead_notes for all
  using (public.is_office_manager(auth.uid()))
  with check (public.is_office_manager(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 7. scheduled_ground_classes / scheduled_ground_class_enrollments --
-- full Class Scheduler management, mirroring "Admins manage scheduled
-- ground classes" (v15) and "Admins manage scheduled ground class
-- enrollments" (v17) exactly, just scoped to is_office_manager().
-- ─────────────────────────────────────────────────────────────────
create policy "Office managers manage scheduled ground classes"
  on public.scheduled_ground_classes for all
  using (public.is_office_manager(auth.uid()))
  with check (public.is_office_manager(auth.uid()));

create policy "Office managers manage scheduled ground class enrollments"
  on public.scheduled_ground_class_enrollments for all
  using (public.is_office_manager(auth.uid()))
  with check (public.is_office_manager(auth.uid()));

-- cancel_scheduled_ground_class_enrollment (v27) hard-checks is_admin()
-- internally rather than relying on a table grant -- broaden that one
-- check rather than re-grant (already granted to `authenticated`; the
-- real gate has always been inside the function body).
create or replace function public.cancel_scheduled_ground_class_enrollment(p_enrollment_id uuid)
returns public.scheduled_ground_class_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.scheduled_ground_class_enrollments%rowtype;
begin
  if not (public.is_admin(auth.uid()) or public.is_office_manager(auth.uid())) then
    raise exception 'Admin access required.';
  end if;

  select * into v_enrollment
  from public.scheduled_ground_class_enrollments
  where id = p_enrollment_id
  for update;

  if not found then
    raise exception 'Enrollment not found.';
  end if;

  if v_enrollment.payment_status = 'canceled' then
    return v_enrollment;
  end if;

  update public.scheduled_ground_class_enrollments
  set payment_status = 'canceled', attendance_status = 'canceled', updated_at = now()
  where id = p_enrollment_id
  returning * into v_enrollment;

  update public.scheduled_ground_classes
  set enrolled_count = greatest(enrolled_count - 1, 0)
  where id = v_enrollment.scheduled_ground_class_id;

  return v_enrollment;
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 8. operations_events -- full Ops calendar management. Deliberately
-- its own is_office_manager()-scoped policies rather than broadening
-- is_operations_staff() (see note in section 2) -- this table is also
-- used for flight/simulator/maintenance events beyond the "Ops
-- calendar" scheduling this role is meant for, but access here is
-- table-wide (no event_type-level restriction exists for any role
-- today, admin/instructor included), matching existing precedent.
-- ─────────────────────────────────────────────────────────────────
create policy "Office managers can view operations events"
  on public.operations_events for select
  using (public.is_office_manager(auth.uid()));

create policy "Office managers can create operations events"
  on public.operations_events for insert
  with check (public.is_office_manager(auth.uid()));

create policy "Office managers can update operations events"
  on public.operations_events for update
  using (public.is_office_manager(auth.uid()))
  with check (public.is_office_manager(auth.uid()));
