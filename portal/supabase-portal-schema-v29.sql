-- Apex Operations — Flight students vs. Apex Advantage students (v29)
--
-- Every account with role='student' has, until now, been treated the
-- same regardless of whether they're an Apex Advantage portal member
-- (free guide / Checkride Prep / ground school) or an actual flight
-- student taking real lessons with Apex. Both got redirected straight
-- to the Apex Advantage portal on login (PortalSelector.jsx) and never
-- saw the CRM at all -- even though the CRM already has a full data
-- model for real students (lessons, syllabi, logbook_entries) that
-- nothing ever routed them into.
--
-- student_type distinguishes the two so PortalSelector.jsx can send
-- flight students to a new in-CRM dashboard instead of externally
-- redirecting them. Defaults to 'apex_advantage' (the existing,
-- unchanged behavior) so nothing changes for anyone until an admin
-- explicitly flips a student to 'flight_student'.
--
-- The backfill below auto-flips any existing student who already has
-- a lesson or logbook entry -- they're clearly a real flight student
-- already, not a guess.
--
-- lessons.debrief_notes/debrief_updated_at are new -- instructors had
-- no way to leave notes for a student after a lesson at all before
-- this. Plain ALTER TABLE since, like several other tables in this
-- app (ground_sessions, leads, etc.), `lessons` has no CREATE TABLE
-- in any committed migration -- it was created directly in the
-- Supabase dashboard. Adjust if the live table's actual columns
-- differ from what the app's queries assume.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v28.

alter table public.profiles
  add column if not exists student_type text
    check (student_type in ('apex_advantage', 'flight_student'))
    default 'apex_advantage';

update public.profiles p
set student_type = 'flight_student'
where p.role = 'student'
  and (p.student_type is null or p.student_type = 'apex_advantage')
  and (
    exists (select 1 from public.lessons l where l.student_id = p.id)
    or exists (select 1 from public.logbook_entries le where le.student_id = p.id)
  );

alter table public.lessons
  add column if not exists debrief_notes text,
  add column if not exists debrief_updated_at timestamptz;
