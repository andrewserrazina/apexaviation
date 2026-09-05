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

-- ---------------------------------------------------------------------
-- Phase C (v112-v116) fixtures. Loaded here, BEFORE v112-v116 are applied
-- by the test runner, because v112's ACS backfill is a one-time
-- migration-apply-time computation over whatever dpe_questions rows
-- exist at that moment.
--
-- REV2: v112 now seeds the COMPLETE authoritative FAA-S-ACS-6C taxonomy
-- (61 real tasks) regardless of what Apex content exists, so these rows
-- only need to exercise the CONTENT-MAPPING regex/lookup, not task
-- creation. Real Area I task codes from the authoritative seed:
--   I/A = "Pilot Qualifications", I/B = "Airworthiness Requirements",
--   I/C = "Weather Information". Under Rev2, the apex-authored title text
--   inside acs_reference (e.g. "Certificates and Documents" below) is
--   intentionally DIFFERENT from the authoritative FAA title -- proving
--   that mapping now happens purely on (area_code, task_code), never on
--   title match:
--   q1, q2 -- both parse to (I, A) -> both map onto the SAME authoritative
--            I/A task ("Pilot Qualifications"), despite q1/q2's own
--            acs_reference text saying something else.
--   q6, q9 -- both parse to (I, B) -> both map onto I/B
--            ("Airworthiness Requirements").
--   q3     -- contains "/" -> multi_task_reference_needs_human_disambiguation.
--   q4     -- "Special Emphasis Area" prefix -> special_emphasis_area_no_single_task.
--   q5     -- doesn't match the shape at all -> does_not_match_known_acs_reference_shape.
--   q7     -- parses to (XX, Z), a well-formed but NON-EXISTENT area/task ->
--            area_task_not_found_in_authoritative_acs (REV2 new reason).
--   q8     -- exam_type = 'instrument', for which NO authoritative ACS is
--            seeded (REV2 deliberately stages Instrument support) ->
--            no_authoritative_acs_seeded_for_exam_type (REV2 new reason).
-- q1 additionally carries real common_mistakes/dpe_evaluating/
-- real_world_application text for the `reveal` contract test.
-- ---------------------------------------------------------------------
insert into public.profiles (id, email, full_name, role, checkride_prep_unlocked, timezone) values
  ('00000000-0000-0000-0000-000000000030', 'mobilemember@test.local', 'Mobile Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000031', 'noentitlement@test.local', 'No Entitlement Member', 'student', false, 'UTC')
on conflict (id) do nothing;

insert into public.dpe_categories (id, label) values ('test_category', 'Test Category')
on conflict (id) do nothing;

insert into public.dpe_questions (id, category, question, model_answer, common_mistakes, dpe_evaluating, real_world_application, acs_reference, is_scenario, exam_type) values
  ('q1', 'test_category', 'Q1?', 'A1', 'Common mistake text', 'DPE evaluating text', 'Real world text', 'Area of Operation I, Task A — Certificates and Documents (PA.I.A.K1, PA.I.A.K2)', false, 'private_pilot'),
  ('q2', 'test_category', 'Q2?', 'A2', null, null, null, 'Area of Operation I, Task A — Certificates and Documents (PA.I.A.K3)', false, 'private_pilot'),
  ('q6', 'test_category', 'Q6?', 'A6', null, null, null, 'Area of Operation I, Task B — Airworthiness Requirements (PA.I.B.K1)', false, 'private_pilot'),
  ('q9', 'test_category', 'Q9?', 'A9', null, null, null, 'Area of Operation I, Task B — Airworthiness Requirements (PA.I.B.K2)', false, 'private_pilot'),
  ('q3', 'test_category', 'Q3?', 'A3', null, null, null, 'Area of Operation I, Task A / Area of Operation I, Task B — Ambiguous (PA.I.A.K1)', false, 'private_pilot'),
  ('q4', 'test_category', 'Q4?', 'A4', null, null, null, 'Special Emphasis Area: Aeronautical Decision-Making', false, 'private_pilot'),
  ('q5', 'test_category', 'Q5?', 'A5', null, null, null, 'General knowledge of the airplane', false, 'private_pilot'),
  ('q7', 'test_category', 'Q7?', 'A7', null, null, null, 'Area of Operation XX, Task Z — Nonexistent Task (PA.XX.Z.K1)', false, 'private_pilot'),
  ('q8', 'test_category', 'Q8?', 'A8', null, null, null, 'Area of Operation I, Task A — Something (INST.I.A.K1)', false, 'instrument'),
  -- REV3.8/3.9: two more universal (ASEL-applicable), content-backed tasks
  -- (Area I Task C "Weather Information", Task D "Cross-Country Flight
  -- Planning") so the Daily Drill fallback/broader-pool-fill tests have
  -- real, distinct eligible tasks to expand into beyond the initial top-3.
  ('q10', 'test_category', 'Q10?', 'A10', null, null, null, 'Area of Operation I, Task C — Weather Info (PA.I.C.K1)', false, 'private_pilot'),
  ('q11', 'test_category', 'Q11?', 'A11', null, null, null, 'Area of Operation I, Task D — XC Planning (PA.I.D.K1)', false, 'private_pilot'),
  ('q12', 'test_category', 'Q12?', 'A12', null, null, null, 'Area of Operation I, Task E — NAS (PA.I.E.K1)', false, 'private_pilot')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- REV3 fixtures. profiles.primary_aircraft_class does not exist yet at
-- this point in fixture-load order (v112, which adds it, runs after
-- fixtures) -- every profile row here (and every profile fixture above)
-- picks up the column's default ('ASEL') the moment v112 applies its
-- ALTER TABLE, which is itself the exact default-rule behavior REV3.3
-- documents and this suite verifies.
-- ---------------------------------------------------------------------
insert into public.profiles (id, email, full_name, role, checkride_prep_unlocked, timezone) values
  ('00000000-0000-0000-0000-000000000050', 'unrelatedclass@test.local', 'Unrelated Class Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000051', 'unrelatedversion@test.local', 'Unrelated Version Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000052', 'fillmember@test.local', 'Fill Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000053', 'malformed@test.local', 'Malformed Payload Member', 'student', true, 'UTC')
on conflict (id) do nothing;

-- REV2.11/2.12: dedicated profiles for the checkride-proximity weighting
-- tests, isolated from MOBILE_MEMBER (which already has task_evidence and a
-- cached "today" drill from other test sections by the time these run).
insert into public.profiles (id, email, full_name, role, checkride_prep_unlocked, timezone) values
  ('00000000-0000-0000-0000-000000000040', 'proxnone@test.local', 'Proximity None Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000041', 'proxfar@test.local', 'Proximity Far Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000042', 'proxnear@test.local', 'Proximity Near Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000043', 'recency@test.local', 'Recency Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000044', 'concurrency@test.local', 'Concurrency Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000045', 'yesterdaydrill@test.local', 'Yesterday Drill Member', 'student', true, 'UTC'),
  ('00000000-0000-0000-0000-000000000046', 'counters@test.local', 'Counters Member', 'student', true, 'UTC')
on conflict (id) do nothing;

insert into public.portal_checkride_date (profile_id, checkride_date) values
  ('00000000-0000-0000-0000-000000000041', current_date + 60),
  ('00000000-0000-0000-0000-000000000042', current_date + 3),
  ('00000000-0000-0000-0000-000000000043', current_date + 3)
on conflict (profile_id) do nothing;

-- REV2.6: pre-existing progress state that a completion must correctly
-- increment/preserve rather than overwrite.
insert into public.portal_question_progress (profile_id, question_id, completed, favorited, answered_count, viewed_count, first_viewed_at, last_viewed_at, updated_at) values
  ('00000000-0000-0000-0000-000000000046', 'q1', true, true, 7, 9, now() - interval '30 days', now() - interval '1 days', now() - interval '1 days')
on conflict (profile_id, question_id) do nothing;
