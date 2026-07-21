-- Apex Advantage Member Portal — fix instructor_id delete behavior (v34)
--
-- logbook_entries.instructor_id and lessons.instructor_id were both
-- defined in the original base schema (supabase-schema.sql) referencing
-- profiles(id) with no "on delete" clause at all -- unlike every later
-- migration's instructor_id column (v15, v19, v21, v22, v28), which
-- consistently uses "on delete set null". That inconsistency means
-- deleting a user who was ever assigned as an instructor on any lesson
-- or logbook entry fails with a generic "Database error deleting user"
-- in the Supabase dashboard: deleting auth.users cascades into deleting
-- their profiles row, which then hits the un-set default (blocking)
-- constraint on these two tables and aborts the whole transaction.
--
-- This brings both columns in line with the rest of the schema. Existing
-- data is untouched -- only the delete behavior changes going forward.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v33.sql.

alter table public.logbook_entries drop constraint if exists logbook_entries_instructor_id_fkey;
alter table public.logbook_entries
  add constraint logbook_entries_instructor_id_fkey
  foreign key (instructor_id) references public.profiles(id) on delete set null;

alter table public.lessons drop constraint if exists lessons_instructor_id_fkey;
alter table public.lessons
  add constraint lessons_instructor_id_fkey
  foreign key (instructor_id) references public.profiles(id) on delete set null;
