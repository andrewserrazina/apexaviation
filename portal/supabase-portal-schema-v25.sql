-- Apex Advantage — Correct the Private Pilot Ground School curriculum (v25)
--
-- The live "Apex Advantage Ground" > "Private Pilot" syllabus in
-- syllabi/syllabus_lessons did not match the real curriculum at all --
-- 14 flat, generically-titled rows with no relation to Apex's actual
-- 21-module, 7-phase Ground School Framework. This replaces that
-- content with the real one, one row per module (matching the
-- framework's own "2 hours per session, one module per session" class
-- structure, and the same per-module granularity
-- AdminGroundSchoolSchedule.jsx already schedules individual classes
-- around).
--
-- NOTE like v5's caveat for ground_sessions/ground_registrations:
-- syllabi/syllabus_lessons have no CREATE TABLE in any committed SQL
-- file (created directly in the Supabase dashboard). This migration
-- only touches rows -- if the inferred column names below (name,
-- description, category, type on syllabi; syllabus_id, title,
-- description, duration_hours, sort_order on syllabus_lessons) don't
-- match the live tables, adjust before running.
--
-- This is a content replacement, not additive -- any existing
-- lesson_completions rows tied to the old (wrong) syllabus_lessons
-- rows are deleted along with them via the FK cascade. Given the old
-- content was clearly placeholder/incorrect to begin with, this is the
-- intended outcome; if real student progress had already accumulated
-- against those wrong lessons, back it up first.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v24.

do $$
declare
  v_syllabus_id uuid;
begin
  select id into v_syllabus_id
  from public.syllabi
  where type = 'ground' and category = 'Private Pilot'
  limit 1;

  if v_syllabus_id is null then
    insert into public.syllabi (name, description, category, type)
    values (
      'Apex Advantage Ground School',
      'The complete 21-module, 7-phase Apex Advantage Private Pilot Ground School curriculum — live, instructor-led, never prerecorded.',
      'Private Pilot',
      'ground'
    )
    returning id into v_syllabus_id;
  else
    update public.syllabi
    set name = 'Apex Advantage Ground School',
        description = 'The complete 21-module, 7-phase Apex Advantage Private Pilot Ground School curriculum — live, instructor-led, never prerecorded.'
    where id = v_syllabus_id;
  end if;

  delete from public.syllabus_lessons where syllabus_id = v_syllabus_id;

  insert into public.syllabus_lessons (syllabus_id, title, description, duration_hours, sort_order)
  values
    (v_syllabus_id, 'Module 1: Becoming a Pilot', 'Orient the student to the certification path, the learning model they''re entering, and the mindset of professional pilots — before a single regulation or system is taught.', 2, 0),
    (v_syllabus_id, 'Module 2: Aerodynamics', 'Build an intuitive, physically-grounded understanding of why an airplane flies and how pilot inputs change its behavior — the foundation for every maneuver discussed later.', 2, 1),
    (v_syllabus_id, 'Module 3: Aircraft Systems', 'Give students a working, troubleshooting-level understanding of the systems in their training aircraft, with emphasis on the PA-28 family and glass-panel variants.', 2, 2),
    (v_syllabus_id, 'Module 4: FARs Simplified', 'Translate the regulations a private pilot actually uses day-to-day into plain language and operational habits, rather than rote rule memorization.', 2, 3),
    (v_syllabus_id, 'Module 5: Airspace Mastery', 'Build fluent, chart-independent recall of the U.S. airspace system so students can identify requirements and make go/no-go decisions instantly.', 2, 4),
    (v_syllabus_id, 'Module 6: Airport Operations', 'Develop safe, professional airport operating habits — from taxi to pattern entry to radio communication — at both towered and non-towered fields.', 2, 5),
    (v_syllabus_id, 'Module 7: Sectional Charts', 'Build fluency reading and interpreting sectional charts as a primary situational awareness tool, independent of GPS.', 2, 6),
    (v_syllabus_id, 'Module 8: Pilotage & Dead Reckoning', 'Teach the foundational, no-technology navigation skills every pilot needs as a backup when electronics fail.', 2, 7),
    (v_syllabus_id, 'Module 9: Navigation Systems', 'Build proficient, real-world use of modern avionics for navigation, building on the manual skills from Module 8.', 2, 8),
    (v_syllabus_id, 'Module 10: Weather Theory', 'Build a physical, intuitive understanding of atmospheric behavior so weather products become predictable instead of memorized symbols.', 2, 9),
    (v_syllabus_id, 'Module 11: Weather Products', 'Build fast, confident interpretation of the weather briefing products a private pilot uses for every go/no-go decision.', 2, 10),
    (v_syllabus_id, 'Module 12: Weather Decision Making', 'Convert weather knowledge into real go/no-go and in-flight diversion judgment — the single highest-stakes decision category for private pilots.', 2, 11),
    (v_syllabus_id, 'Module 13: Weight & Balance', 'Build precise, error-checked weight and balance calculation skills and an understanding of why CG location matters aerodynamically.', 2, 12),
    (v_syllabus_id, 'Module 14: Aircraft Performance', 'Build the ability to predict and verify real aircraft performance for takeoff, landing, and cruise — and to recognize when performance is marginal.', 2, 13),
    (v_syllabus_id, 'Module 15: Cross-Country Planning', 'Integrate navigation, weather, performance, and regulatory knowledge into a single complete cross-country flight plan, mirroring the checkride planning task.', 2, 14),
    (v_syllabus_id, 'Module 16: Aeronautical Decision Making', 'Teach structured decision-making frameworks that hold up under time pressure, building the judgment the checkride oral is specifically designed to probe.', 2, 15),
    (v_syllabus_id, 'Module 17: Human Factors', 'Build awareness of the physiological and psychological factors that degrade pilot performance, many of which are invisible without training.', 2, 16),
    (v_syllabus_id, 'Module 18: Emergency Procedures', 'Build calm, checklist-driven emergency response habits through repetition, so reaction under real stress defaults to trained procedure rather than panic.', 2, 17),
    (v_syllabus_id, 'Module 19: ACS Mastery', 'Make the ACS itself a working tool the student can navigate confidently, understanding exactly how they''ll be evaluated on both knowledge and skill.', 2, 18),
    (v_syllabus_id, 'Module 20: Mock Oral Exam', 'Simulate the real pressure, pacing, and unpredictability of a DPE oral exam in a low-stakes setting, with direct feedback on both content and communication style.', 2, 19),
    (v_syllabus_id, 'Module 21: Practical Test Success', 'Finalize logistical, procedural, and psychological readiness for checkride day itself, closing the loop on "Train Beyond the Checkride."', 2, 20);
end $$;
