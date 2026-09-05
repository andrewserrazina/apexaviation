-- Sprint 0 Phase 2A test fixtures. Run once (as superuser, bypasses RLS)
-- after the harness schema and all six migrations have been applied.
-- Fixed UUIDs so the test runner script can reference them by name.

insert into public.profiles (id, email, full_name, role, private_pilot_ground_school_pack_unlocked) values
  ('00000000-0000-0000-0000-000000000001', 'admin@test.local', 'Admin One', 'admin', false),
  ('00000000-0000-0000-0000-000000000002', 'instructor@test.local', 'Instructor One', 'instructor', false),
  ('00000000-0000-0000-0000-000000000003', 'office@test.local', 'Office Manager One', 'office_manager', false),
  ('00000000-0000-0000-0000-000000000010', 'membera@test.local', 'Member A', 'student', false),
  ('00000000-0000-0000-0000-000000000011', 'memberb@test.local', 'Member B', 'student', false),
  ('00000000-0000-0000-0000-000000000012', 'packmember@test.local', 'Pack Member', 'student', true)
on conflict (id) do nothing;

insert into public.scheduled_ground_classes (id, course_id, status, class_date, capacity, enrolled_count) values
  ('00000000-0000-0000-0000-0000000000c1', 'PPL', 'published', current_date + 7, 20, 0),
  ('00000000-0000-0000-0000-0000000000c2', 'PPL', 'published', current_date + 7, 1, 1)
on conflict (id) do nothing;

insert into public.ground_sessions (id, title, max_students) values
  ('00000000-0000-0000-0000-00000000000a', 'Legacy Session', 20)
on conflict (id) do nothing;

insert into public.readiness_assessment_leads (id, email, score) values
  ('00000000-0000-0000-0000-00000000000b', 'membera@test.local', 72)
on conflict (id) do nothing;

insert into public.notifications (id, user_id, title, body, type) values
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000010', 'Existing', 'Existing notif', 'info')
on conflict (id) do nothing;

insert into public.study_pack_entitlements (profile_id, pack_id, source) values
  ('00000000-0000-0000-0000-000000000010', 'airspace-mastery', 'stripe_purchase')
on conflict (profile_id, pack_id) do nothing;

insert into public.ai_dpe_sessions (id, profile_id) values
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000010')
on conflict (id) do nothing;

-- Phase B (v111) mission/streak fixtures -- dedicated profiles, never
-- reused by earlier tests, so their flags can be set up front without
-- disturbing any prior test's before/after assertions.
insert into public.profiles (id, email, full_name, role, checkride_prep_unlocked, last_qualifying_study_date, timezone, streak_freezes_banked) values
  ('00000000-0000-0000-0000-000000000020', 'missionmember@test.local', 'Mission Member', 'student', true, current_date, 'UTC', 0),
  ('00000000-0000-0000-0000-000000000021', 'streakmember@test.local', 'Streak Member', 'student', false, current_date, 'UTC', 0)
on conflict (id) do nothing;

insert into public.missions (id, starts_on, ends_on, is_premium_only, requirement, xp_reward) values
  ('00000000-0000-0000-0000-0000000000e1', current_date - 3, current_date + 3, false, '{"type":"study_days","target":1}'::jsonb, 50)
on conflict (id) do nothing;

-- Mission Member studied today -> refresh_mission_progress() should mark
-- the study_days mission complete and award XP.
insert into public.portal_study_activity (profile_id, activity_date, seconds) values
  ('00000000-0000-0000-0000-000000000020', current_date, 600)
on conflict (profile_id, activity_date) do nothing;

-- Streak Member studied the day before yesterday but not yesterday, with
-- zero freezes banked -> run_streak_maintenance() should offer a Recovery
-- Sortie for the missed day rather than silently doing nothing or erroring.
insert into public.portal_study_activity (profile_id, activity_date, seconds) values
  ('00000000-0000-0000-0000-000000000021', current_date - 2, 600)
on conflict (profile_id, activity_date) do nothing;
