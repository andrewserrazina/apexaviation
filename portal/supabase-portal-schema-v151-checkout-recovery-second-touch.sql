-- Apex Advantage — Abandoned-checkout recovery: second touch (v151)
--
-- Backs send-lifecycle-emails' extended processAbandonedCheckouts(): the
-- existing recovery_email_sent_at (v31) only ever sent one bare "you
-- didn't finish, nothing was charged" nudge, and only 10 have gone out
-- in total against 58 real checkout_session_attempts rows -- a growth-
-- plan audit found the single email had no urgency, no reminder of
-- what's included, and no second attempt if the first didn't land.
--
-- recovery_email_2_sent_at is Checkride-Prep-only (see the function):
-- Ground School/Mock Oral abandonment keep the original single email,
-- since neither has Checkride Prep's real Early Access pricing urgency
-- to reference in a second touch. Same dedupe-on-the-row pattern as
-- recovery_email_sent_at itself.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v150.

alter table public.checkout_session_attempts
  add column if not exists recovery_email_2_sent_at timestamptz;
