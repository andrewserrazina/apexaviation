-- Apex Advantage — Digital Workbook: per-question quiz results (v124)
--
-- module_quiz_attempts (v88.sql) has always stored raw answers jsonb but
-- discarded the per-question correctness the client already computes at
-- submit time (wireModuleQuizSection(), site/portal-stable.js) -- only the
-- aggregate score/total survived. This closes that gap with the same shape
-- the client already has in memory: {question_id: boolean}. Written
-- alongside the existing answers column at the same insert, not a new
-- write path -- grading stays entirely client-side, matching the accepted
-- precedent documented at that function's own header comment.
--
-- Nullable and additive only -- every pre-existing row keeps working with
-- results defaulting to null; no backfill needed (no client code has ever
-- read this column before now, so there is nothing to backfill against).

alter table public.module_quiz_attempts
  add column if not exists results jsonb;
