-- Apex Advantage — Reconcile Private Pilot Ground School curriculum to 20
-- modules (v62)
--
-- The Apex Advantage Private Pilot Ground School curriculum was audited
-- against its three source-of-truth documents (PrivateCurriculum.md,
-- portal/src/data/privatePilotCurriculum.js, and the legacy syllabi rows
-- seeded by supabase-portal-schema-v25.sql). All three consistently
-- described 21 real, developed modules, including a fully-written
-- "Module 21: Practical Test Success" cross-referenced from Module 20.
-- The business decision made after this audit is to cut Module 21 for
-- real -- the curriculum is now 20 modules, 7 phases. This migration
-- reconciles the legacy syllabi/syllabus_lessons rows (v25) to match;
-- PrivateCurriculum.md and privatePilotCurriculum.js were edited directly
-- in the same change since they are source documents/code, not applied
-- migrations.
--
-- v25 itself is left untouched (it's an already-applied migration --
-- rewriting its history would misrepresent what was actually deployed).
-- This migration only removes/updates rows going forward.
--
-- IMPORTANT -- MANUAL FOLLOW-UP REQUIRED, NOT RESOLVABLE FROM THIS
-- MIGRATION: the real, live scheduling table is scheduled_ground_classes
-- (not syllabus_lessons, which is informational/legacy). If any
-- scheduled_ground_classes row references lesson_id = 'PPL-M21' --
-- published, draft, or already-completed -- it needs a manual admin
-- decision (cancel + refund, relabel to different content, or otherwise
-- resolve) before or alongside running this migration. This cannot be
-- checked or resolved from a sandbox with no live database connection.
-- Uncomment and run the query below in the Supabase SQL editor first:
--
-- select id, title, module_id, module_title, class_date, status
-- from public.scheduled_ground_classes
-- where module_id = 'PPL-M21'
-- order by class_date;
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v61.

do $$
declare
  v_syllabus_id uuid;
begin
  select id into v_syllabus_id
  from public.syllabi
  where type = 'ground' and category = 'Private Pilot'
  limit 1;

  if v_syllabus_id is not null then
    delete from public.syllabus_lessons
    where syllabus_id = v_syllabus_id
      and title = 'Module 21: Practical Test Success';

    update public.syllabi
    set description = 'The complete 20-module, 7-phase Apex Advantage Private Pilot Ground School curriculum — live, instructor-led, never prerecorded.'
    where id = v_syllabus_id;
  end if;
end $$;
