-- Apex Advantage — Readiness Assessment email follow-up tracking (v42)
--
-- Backs send-lifecycle-emails' new processReadinessAssessmentFollowup():
-- a 3-touch sequence (day 1 / day 3 / day 6) for readiness_assessment_leads
-- rows whose email hasn't since become a real profile. One-time-per-stage
-- flags directly on the lead row, same "dedupe on the row itself" pattern
-- as checkout_session_attempts.recovery_email_sent_at (v31) rather than a
-- separate log table, since each lead only ever needs these three flags.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v41.

alter table public.readiness_assessment_leads
  add column if not exists email_day1_sent_at timestamptz,
  add column if not exists email_day3_sent_at timestamptz,
  add column if not exists email_day6_sent_at timestamptz;
