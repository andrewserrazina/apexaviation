-- Apex Advantage — add exam_type to DPE content tables (v37)
--
-- Preparatory schema change for the upcoming Instrument Rating Checkride
-- Prep Pack. Adds an exam_type column to all four DPE content tables so
-- private-pilot and instrument content can share the same tables while
-- staying strictly separable by query.
--
-- This migration alone changes nothing member-facing: every existing row
-- backfills to 'private_pilot', and get-premium-content (v38) is what
-- actually filters on this column. Run v37 before v38.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v36.sql.

alter table public.dpe_categories
  add column if not exists exam_type text not null default 'private_pilot';

alter table public.dpe_questions
  add column if not exists exam_type text not null default 'private_pilot';

alter table public.quick_reference_sheets
  add column if not exists exam_type text not null default 'private_pilot';

alter table public.portal_lessons
  add column if not exists exam_type text not null default 'private_pilot';
