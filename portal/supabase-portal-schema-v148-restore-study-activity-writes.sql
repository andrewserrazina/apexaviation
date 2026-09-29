-- V148: restore two legitimate client write paths that v143 (Practice
-- Attempt Forgery Lockdown, 2026-09-20) accidentally revoked, breaking
-- retention/streak tracking platform-wide since that date.
--
-- ROOT CAUSE (confirmed against production data during this audit):
--   v143's own comment claimed "portal_study_activity and portal_
--   question_progress have zero direct client writes anywhere in site/
--   or portal/src/ (grepped) -- every write to either table already goes
--   through complete_mobile_practice_session()'s own inserts/upserts" --
--   and revoked insert/update/delete on both tables from `authenticated`
--   on that basis. That claim was WRONG:
--
--   - site/portal-stable.js's bumpStudyDay() (the 30-second visibility
--     heartbeat that feeds Admin Analytics' Retention/Streak panel, and
--     student-facing streak/readiness UI) does a direct client upsert:
--       apexSupabase.from('portal_study_activity').upsert({profile_id,
--         activity_date, seconds}, {onConflict: 'profile_id,activity_date'})
--     completely independent of complete_mobile_practice_session().
--
--   - site/portal-stable.js's upsertRow() (used by toggleStudied()/
--     toggleFavorite()/touchLastViewed() on the DPE question bank)
--     similarly does a direct client upsert into portal_question_progress
--     for the default (non-lesson) case.
--
--   Since v143 revoked the table-level grant with no column-scoped
--   replacement (unlike portal_practice_attempts, which correctly got
--   one), both upserts have been failing with a permission-denied error
--   on every call since 2026-09-20 -- silently, because neither call site
--   checks the Supabase response for an error or attaches a .catch().
--   Confirmed against production: portal_study_activity's most recent
--   activity_date is 2026-09-20 (the day v143 was applied) despite live
--   traffic (analytics_events, new signups) continuing every day since.
--   This is why Admin Analytics now shows a 0-day streak for literally
--   every member and near-zero D7/D30 retention -- the underlying rows
--   simply stopped being written, not a dashboard/query bug.
--
-- WHY RESTORING THIS IS SAFE (does not reopen v143's actual finding):
--   v143's real vulnerability was a forgeable, XP/evidence-bearing
--   completed_at/score on portal_practice_attempts, enforced by an
--   AFTER INSERT/UPDATE trigger (award_xp_on_practice_attempt). Neither
--   table here has any such trigger (verified: zero triggers on
--   portal_study_activity; portal_question_progress has only
--   check_recovery_sortie_on_question_progress, which reacts to
--   completion state, not a scorable/reward-bearing field) and neither
--   has a score/XP column at all. The existing RLS policies on both
--   tables ("Users manage their own study activity" / equivalent on
--   portal_question_progress, auth.uid() = profile_id, verified still in
--   place -- v143 never touched RLS, only the table-level grant) already
--   fully scope every restored column to the caller's own row. Granting
--   these specific, non-gameable columns back is the same column-scoped
--   pattern v143 itself established for portal_practice_attempts, just
--   correctly applied here instead of a blanket revoke based on an
--   incomplete audit.

grant insert (profile_id, activity_date, seconds), update (seconds)
  on public.portal_study_activity to authenticated;

grant insert (profile_id, question_id, viewed_count, answered_count, completed, favorited, first_viewed_at, last_viewed_at, updated_at),
  update (viewed_count, answered_count, completed, favorited, first_viewed_at, last_viewed_at, updated_at)
  on public.portal_question_progress to authenticated;
