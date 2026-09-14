-- Apex Advantage — Sprint 4 Part 4: Ground School ACS evidence expansion
--
-- Sprint 3 (v126) mapped exactly 5 rows, all from PPL-M01. 16 of Apex's
-- 20 Ground School modules have real, substantial authored content
-- (module_companion_content) producing course-progress state today but
-- zero ACS knowledge evidence. This migration extends
-- content_acs_mappings across 12 of those modules (PPL-M03, M04, M07,
-- M08, M09, M10, M11, M12, M13, M14, M15, M17) -- the ones whose
-- content genuinely tests one of the 19 tasks
-- get_readiness_scoped_acs_tasks() already treats as digitally
-- assessable. No task is newly flipped to assessable; no scoring
-- formula changes.
--
-- Methodology (matching v126's own precedent exactly): every row below
-- was selected by reading the actual question/prompt text from
-- module_quiz_questions and module_companion_content.checkrideCorner,
-- not guessed from ids or module titles. Two structural rules kept this
-- conservative and defensible:
--
-- 1. record_ground_school_evidence() for module_quiz_question is only
--    ever CALLED by the client (wireModuleQuizSection(),
--    site/portal-stable.js) for question_type = 'multiple_choice' --
--    short_answer/scenario quiz questions never produce an objective
--    isCorrect and are never submitted to the evidence RPC at all, so
--    mapping them would create rows that can never carry evidence.
--    Every module_quiz_question row below is therefore a
--    multiple_choice question, verified against module_quiz_questions
--    directly.
-- 2. Checkride Corner (content_type 'checkride_corner') and Scenario
--    Workshop (content_type 'scenario_workshop', content_id = the bare
--    module id -- one shared module-level self-rating, not a per-item
--    rating) both run on the CONFIDENT/NEEDS_REVIEW/NOT_YET self-rating
--    pathway (record_ground_school_evidence with p_is_correct = null),
--    so any genuinely on-task item is mappable regardless of question
--    "type". Administrative/exam-process items, generic ADM-framework
--    recall (SHELL, Swiss Cheese, PAVE, 5P, DECIDE, CARE, Apex's own
--    Silent Six -- named MODELS, not the physiological/regulatory facts
--    a specific ACS task actually tests), pure right-of-way/minimum-
--    safe-altitude general-operating-rules items with no clean task fit
--    among the 19 scoped tasks, and open-ended "defend a decision you'd
--    make differently" items (no single correct answer to grade
--    against) are all intentionally left unmapped rather than
--    force-fit -- see GROUND_SCHOOL_ACS_MAPPING_GAP_REPORT.md for the
--    complete per-module accounting, including every unmapped item and
--    why.
--
-- Weight/mapping_source match v126 exactly (default weight 1.0,
-- mapping_source 'human_curated'). mapping_type carries 'knowledge' for
-- plain factual/procedural content and 'knowledge, risk management' for
-- content that genuinely tests a risk-judgment element of the task
-- (PPL-M12 Weather Decision Making's core subject, plus the small
-- number of PPL-M13/M14/M15 items that are explicitly a loading/
-- performance/planning judgment call rather than a fact lookup) -- this
-- activates compute_readiness_snapshot()'s existing but previously-
-- dormant `mapping_type ilike '%risk_management%'` risk_management_score
-- path for the weather and performance tasks for the first time, on
-- tasks that were already digitally assessable, not a scope change.
-- All inserts are idempotent via the existing
-- (content_type, content_id, acs_task_id) unique constraint.

-- ═══════════════════════════════════════════════════════════════════
-- aircraft-systems (Area I, Task G — Operation of Systems)
-- PPL-M03 Aircraft Systems: a direct, whole-module match.
-- ═══════════════════════════════════════════════════════════════════
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M03-Q01'), ('PPL-M03-Q02'), ('PPL-M03-Q03'), ('PPL-M03-Q04'), ('PPL-M03-Q05'),
  ('PPL-M03-Q06'), ('PPL-M03-Q07'), ('PPL-M03-Q08'), ('PPL-M03-Q09'), ('PPL-M03-Q10')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'G' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M03:cc-1'), ('PPL-M03:cc-2'), ('PPL-M03:cc-3'), ('PPL-M03:cc-4'), ('PPL-M03:cc-5'),
  ('PPL-M03:cc-6'), ('PPL-M03:cc-7'), ('PPL-M03:cc-8'), ('PPL-M03:cc-9'), ('PPL-M03:cc-10'),
  ('PPL-M03:cc-11'), ('PPL-M03:cc-12'), ('PPL-M03:cc-13'), ('PPL-M03:cc-14'), ('PPL-M03:cc-15'),
  ('PPL-M03:cc-16'), ('PPL-M03:cc-17'), ('PPL-M03:cc-18'), ('PPL-M03:cc-19'), ('PPL-M03:cc-20')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'G' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

-- Scenario Workshop is module-level (one shared rating per module) --
-- PPL-M03's is a single coherent alternator/ammeter-failure scenario.
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'scenario_workshop', 'PPL-M03', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'I' and t.task_code = 'G' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- PPL-M04 FARs Simplified — splits across four tasks by actual subject.
-- Right-of-way/minimum-safe-altitude items (Q11-14, cc-13/14/15) and
-- generic PIC-authority items (cc-2, cc-3) have no clean fit among the
-- 19 scoped tasks and are intentionally left unmapped. Scenario
-- Workshop is intentionally unmapped (5 independent mini-scenarios
-- spanning currency/right-of-way/emergency-authority under one shared
-- rating -- not granular enough to attribute to one task).
-- ═══════════════════════════════════════════════════════════════════

-- airworthiness (Area I, Task B) — inspections, documents, equipment
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M04-Q03'),  -- ARROW
  ('PPL-M04-Q04'),  -- annual inspection expiry
  ('PPL-M04-Q05'),  -- 100-hour inspection
  ('PPL-M04-Q06'),  -- VOR check interval
  ('PPL-M04-Q07'),  -- altimeter/static test interval
  ('PPL-M04-Q08'),  -- Service Bulletin vs. AD
  ('PPL-M04-Q09'),  -- 91.205 / A TOMATO FLAMES
  ('PPL-M04-Q10')   -- inoperative equipment, no MEL
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'B' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M04:cc-7'), ('PPL-M04:cc-8'), ('PPL-M04:cc-9'), ('PPL-M04:cc-10'), ('PPL-M04:cc-11'), ('PPL-M04:cc-12')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'B' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

-- eligibility (Area I, Task A) — pilot currency/qualifications
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M04-Q01'),  -- flight review interval
  ('PPL-M04-Q02')   -- day passenger currency
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'A' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M04:cc-1'), ('PPL-M04:cc-4'), ('PPL-M04:cc-5'), ('PPL-M04:cc-6')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'A' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

-- crosscountry (Area I, Task D — Cross-Country Flight Planning): fuel reserves
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M04-Q15'), ('PPL-M04-Q16')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'D' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', 'PPL-M04:cc-16', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'I' and t.task_code = 'D' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- airspace (Area I, Task E) — ADS-B/transponder airspace requirement
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', 'PPL-M04-Q19', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'I' and t.task_code = 'E' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- aeromedical (Area I, Task H) — alcohol rule, IMSAFE
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M04-Q17'), ('PPL-M04-Q18'), ('PPL-M04-Q20')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'H' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M04:cc-17'), ('PPL-M04:cc-18'), ('PPL-M04:cc-19')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'H' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- PPL-M07 Sectional Charts — splits between airspace (classification)
-- and crosscountry (chart-reading/pilotage and navaid-symbol items).
-- Scenario Workshop intentionally unmapped (6 independent mixed-theme
-- mini-scenarios under one shared rating).
-- ═══════════════════════════════════════════════════════════════════

-- airspace (Area I, Task E) — airspace classification symbology
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M07-Q05'), ('PPL-M07-Q06'), ('PPL-M07-Q07'), ('PPL-M07-Q08'), ('PPL-M07-Q09'),
  ('PPL-M07-Q17'), ('PPL-M07-Q18'), ('PPL-M07-Q19')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'E' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M07:cc-5'), ('PPL-M07:cc-6'), ('PPL-M07:cc-7'), ('PPL-M07:cc-14'), ('PPL-M07:cc-15'), ('PPL-M07:cc-18')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'E' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

-- crosscountry (Area VI, Task A — Pilotage and Dead Reckoning): airport
-- symbols, obstacles, terrain/MEF chart-reading
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M07-Q01'), ('PPL-M07-Q02'), ('PPL-M07-Q03'), ('PPL-M07-Q10'), ('PPL-M07-Q12'), ('PPL-M07-Q13')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'VI' and task_code = 'A' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M07:cc-1'), ('PPL-M07:cc-2'), ('PPL-M07:cc-3'), ('PPL-M07:cc-4'),
  ('PPL-M07:cc-8'), ('PPL-M07:cc-9'), ('PPL-M07:cc-10'), ('PPL-M07:cc-11')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'VI' and task_code = 'A' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

-- crosscountry (Area VI, Task B — Navigation Systems and Radar
-- Services): navaid symbol identification
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values ('PPL-M07-Q15'), ('PPL-M07-Q16')) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'VI' and task_code = 'B' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values ('PPL-M07:cc-12'), ('PPL-M07:cc-13')) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'VI' and task_code = 'B' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- crosscountry (Area VI, Task A — Pilotage and Dead Reckoning)
-- PPL-M08 Pilotage & Dead Reckoning: a direct, whole-module match.
-- ═══════════════════════════════════════════════════════════════════
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M08-Q01'), ('PPL-M08-Q02'), ('PPL-M08-Q03'), ('PPL-M08-Q04'), ('PPL-M08-Q05'), ('PPL-M08-Q06'),
  ('PPL-M08-Q07'), ('PPL-M08-Q08'), ('PPL-M08-Q11'), ('PPL-M08-Q12'), ('PPL-M08-Q13'), ('PPL-M08-Q14'),
  ('PPL-M08-Q16'), ('PPL-M08-Q17'), ('PPL-M08-Q18'), ('PPL-M08-Q20'), ('PPL-M08-Q22'), ('PPL-M08-Q23')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'VI' and task_code = 'A' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M08:cc-1'), ('PPL-M08:cc-2'), ('PPL-M08:cc-3'), ('PPL-M08:cc-4'), ('PPL-M08:cc-5'),
  ('PPL-M08:cc-6'), ('PPL-M08:cc-7'), ('PPL-M08:cc-8'), ('PPL-M08:cc-9'), ('PPL-M08:cc-10'),
  ('PPL-M08:cc-11'), ('PPL-M08:cc-12'), ('PPL-M08:cc-13'), ('PPL-M08:cc-14'), ('PPL-M08:cc-15'),
  ('PPL-M08:cc-16'), ('PPL-M08:cc-17'), ('PPL-M08:cc-18'), ('PPL-M08:cc-19'), ('PPL-M08:cc-20')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'VI' and task_code = 'A' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'scenario_workshop', 'PPL-M08', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'VI' and t.task_code = 'A' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- crosscountry (Area VI, Task B — Navigation Systems and Radar Services)
-- PPL-M09 Navigation Systems: a direct, whole-module match.
-- ═══════════════════════════════════════════════════════════════════
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M09-Q01'), ('PPL-M09-Q02'), ('PPL-M09-Q03'), ('PPL-M09-Q04'), ('PPL-M09-Q05'), ('PPL-M09-Q06'),
  ('PPL-M09-Q08'), ('PPL-M09-Q09'), ('PPL-M09-Q10'), ('PPL-M09-Q11'), ('PPL-M09-Q12'), ('PPL-M09-Q13'),
  ('PPL-M09-Q14'), ('PPL-M09-Q15'), ('PPL-M09-Q16'), ('PPL-M09-Q17'), ('PPL-M09-Q18'), ('PPL-M09-Q19')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'VI' and task_code = 'B' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M09:cc-1'), ('PPL-M09:cc-2'), ('PPL-M09:cc-3'), ('PPL-M09:cc-4'), ('PPL-M09:cc-5'),
  ('PPL-M09:cc-6'), ('PPL-M09:cc-7'), ('PPL-M09:cc-8'), ('PPL-M09:cc-9'), ('PPL-M09:cc-10'),
  ('PPL-M09:cc-11'), ('PPL-M09:cc-12'), ('PPL-M09:cc-13'), ('PPL-M09:cc-14'), ('PPL-M09:cc-15'),
  ('PPL-M09:cc-16'), ('PPL-M09:cc-17'), ('PPL-M09:cc-18'), ('PPL-M09:cc-19'), ('PPL-M09:cc-20')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'VI' and task_code = 'B' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'scenario_workshop', 'PPL-M09', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'VI' and t.task_code = 'B' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- weather (Area I, Task C — Weather Information)
-- PPL-M10 Weather Theory and PPL-M11 Weather Products: direct matches,
-- plain 'knowledge'. PPL-M12 Weather Decision Making: the module whose
-- core subject is genuinely weather-specific risk judgment, mapped
-- 'knowledge, risk management' -- this is the only place this sprint
-- activates the risk_management_score computation's mapping_type
-- ilike '%risk_management%' path (Task C had zero risk_management-typed
-- content before this migration, so risk_management_score has silently
-- fallen back to the knowledge_score for every member using this task
-- until now). Generic ADM-model-name recall shared with Module 16
-- (PAVE/5P/DECIDE/CARE-the-checklist) is left unmapped even within
-- M12 -- those items test remembering a mnemonic's letters, not a
-- weather-specific judgment. PPL-M12's Scenario Workshop is
-- intentionally unmapped (predominantly generic-ADM framing).
-- ═══════════════════════════════════════════════════════════════════

-- PPL-M10 Weather Theory
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M10-Q01'), ('PPL-M10-Q02'), ('PPL-M10-Q03'), ('PPL-M10-Q04'), ('PPL-M10-Q05'),
  ('PPL-M10-Q06'), ('PPL-M10-Q07'), ('PPL-M10-Q08'), ('PPL-M10-Q09'), ('PPL-M10-Q10'),
  ('PPL-M10-Q11'), ('PPL-M10-Q12'), ('PPL-M10-Q13'), ('PPL-M10-Q14'), ('PPL-M10-Q15'),
  ('PPL-M10-Q16'), ('PPL-M10-Q17'), ('PPL-M10-Q18'), ('PPL-M10-Q19'), ('PPL-M10-Q20'), ('PPL-M10-Q21')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'C' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M10:cc-1'), ('PPL-M10:cc-2'), ('PPL-M10:cc-3'), ('PPL-M10:cc-4'), ('PPL-M10:cc-5'),
  ('PPL-M10:cc-6'), ('PPL-M10:cc-7'), ('PPL-M10:cc-8'), ('PPL-M10:cc-9'), ('PPL-M10:cc-10'),
  ('PPL-M10:cc-11'), ('PPL-M10:cc-12'), ('PPL-M10:cc-13'), ('PPL-M10:cc-14'), ('PPL-M10:cc-15'),
  ('PPL-M10:cc-16'), ('PPL-M10:cc-17'), ('PPL-M10:cc-18'), ('PPL-M10:cc-19'), ('PPL-M10:cc-20')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'C' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'scenario_workshop', 'PPL-M10', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'I' and t.task_code = 'C' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- PPL-M11 Weather Products
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M11-Q01'), ('PPL-M11-Q02'), ('PPL-M11-Q03'), ('PPL-M11-Q04'), ('PPL-M11-Q05'),
  ('PPL-M11-Q06'), ('PPL-M11-Q07'), ('PPL-M11-Q08'), ('PPL-M11-Q09'), ('PPL-M11-Q10'),
  ('PPL-M11-Q11'), ('PPL-M11-Q12'), ('PPL-M11-Q13'), ('PPL-M11-Q14'), ('PPL-M11-Q15'),
  ('PPL-M11-Q16'), ('PPL-M11-Q17'), ('PPL-M11-Q18'), ('PPL-M11-Q19'), ('PPL-M11-Q20'),
  ('PPL-M11-Q21'), ('PPL-M11-Q22'), ('PPL-M11-Q23'), ('PPL-M11-Q24')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'C' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M11:cc-1'), ('PPL-M11:cc-2'), ('PPL-M11:cc-3'), ('PPL-M11:cc-4'), ('PPL-M11:cc-5'),
  ('PPL-M11:cc-6'), ('PPL-M11:cc-7'), ('PPL-M11:cc-8'), ('PPL-M11:cc-9'), ('PPL-M11:cc-10'),
  ('PPL-M11:cc-11'), ('PPL-M11:cc-12'), ('PPL-M11:cc-13'), ('PPL-M11:cc-14'), ('PPL-M11:cc-15'),
  ('PPL-M11:cc-16'), ('PPL-M11:cc-17'), ('PPL-M11:cc-18'), ('PPL-M11:cc-19'), ('PPL-M11:cc-20'),
  ('PPL-M11:cc-21'), ('PPL-M11:cc-22'), ('PPL-M11:cc-23'), ('PPL-M11:cc-24'), ('PPL-M11:cc-25')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'C' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'scenario_workshop', 'PPL-M11', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'I' and t.task_code = 'C' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- PPL-M12 Weather Decision Making -- weather-specific risk judgment only
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', 'PPL-M12-Q01', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'I' and t.task_code = 'C' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge, risk management', 'human_curated'
from (values
  ('PPL-M12-Q02'),  -- personal minimums should be
  ('PPL-M12-Q03'),  -- single low ceiling report vs. trend
  ('PPL-M12-Q04'),  -- get-there-itis
  ('PPL-M12-Q05'),  -- confirmation bias
  ('PPL-M12-Q06'),  -- plan continuation bias
  ('PPL-M12-Q12'),  -- turning around early
  ('PPL-M12-Q13'),  -- precautionary landing
  ('PPL-M12-Q14'),  -- scud running
  ('PPL-M12-Q16'),  -- weather decision point
  ('PPL-M12-Q17'),  -- fuel reserve for weather route changes
  ('PPL-M12-Q18'),  -- where in the chain the accident occurs
  ('PPL-M12-Q19'),  -- delay vs. cancel
  ('PPL-M12-Q20')   -- optimism bias
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'C' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge, risk management', 'human_curated'
from (values
  ('PPL-M12:cc-1'), ('PPL-M12:cc-2'), ('PPL-M12:cc-3'), ('PPL-M12:cc-5'), ('PPL-M12:cc-6'),
  ('PPL-M12:cc-7'), ('PPL-M12:cc-15'), ('PPL-M12:cc-16'), ('PPL-M12:cc-17'), ('PPL-M12:cc-18'),
  ('PPL-M12:cc-19'), ('PPL-M12:cc-22')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'C' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- performance (Area I, Task F — Performance and Limitations)
-- PPL-M13 Weight & Balance and PPL-M14 Aircraft Performance: direct
-- matches. A small set of items in each are genuine loading/performance
-- risk-judgment calls (not fact lookups) and carry
-- 'knowledge, risk management'. Open-ended "defend a decision you'd
-- make differently" items (cc-30 in each module) are intentionally
-- left unmapped -- no single correct answer to grade against.
-- ═══════════════════════════════════════════════════════════════════

-- PPL-M13 Weight & Balance
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M13-Q01'), ('PPL-M13-Q02'), ('PPL-M13-Q03'), ('PPL-M13-Q04'), ('PPL-M13-Q05'),
  ('PPL-M13-Q06'), ('PPL-M13-Q07'), ('PPL-M13-Q08'), ('PPL-M13-Q09'), ('PPL-M13-Q12'),
  ('PPL-M13-Q13'), ('PPL-M13-Q14'), ('PPL-M13-Q15')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'F' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M13:cc-1'), ('PPL-M13:cc-2'), ('PPL-M13:cc-3'), ('PPL-M13:cc-4'), ('PPL-M13:cc-5'),
  ('PPL-M13:cc-6'), ('PPL-M13:cc-7'), ('PPL-M13:cc-8'), ('PPL-M13:cc-9'), ('PPL-M13:cc-10'),
  ('PPL-M13:cc-11'), ('PPL-M13:cc-12'), ('PPL-M13:cc-13'), ('PPL-M13:cc-14'), ('PPL-M13:cc-15'),
  ('PPL-M13:cc-16'), ('PPL-M13:cc-17'), ('PPL-M13:cc-18'), ('PPL-M13:cc-19'), ('PPL-M13:cc-20'),
  ('PPL-M13:cc-22'), ('PPL-M13:cc-23'), ('PPL-M13:cc-24'), ('PPL-M13:cc-25'), ('PPL-M13:cc-27')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'F' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge, risk management', 'human_curated'
from (values
  ('PPL-M13:cc-21'),  -- legal but close to aft limit, would you fly it?
  ('PPL-M13:cc-26'),  -- unannounced passenger, process
  ('PPL-M13:cc-28'),  -- "inside the envelope" != "safe to fly"
  ('PPL-M13:cc-29')   -- used another aircraft's W&B sheet by mistake
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'F' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'scenario_workshop', 'PPL-M13', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'I' and t.task_code = 'F' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- PPL-M14 Aircraft Performance
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M14-Q01'), ('PPL-M14-Q02'), ('PPL-M14-Q03'), ('PPL-M14-Q04'), ('PPL-M14-Q05'),
  ('PPL-M14-Q06'), ('PPL-M14-Q07'), ('PPL-M14-Q08'), ('PPL-M14-Q09'), ('PPL-M14-Q12'),
  ('PPL-M14-Q13'), ('PPL-M14-Q14'), ('PPL-M14-Q15')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'F' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M14:cc-1'), ('PPL-M14:cc-2'), ('PPL-M14:cc-3'), ('PPL-M14:cc-4'), ('PPL-M14:cc-5'),
  ('PPL-M14:cc-6'), ('PPL-M14:cc-7'), ('PPL-M14:cc-8'), ('PPL-M14:cc-9'), ('PPL-M14:cc-10'),
  ('PPL-M14:cc-11'), ('PPL-M14:cc-12'), ('PPL-M14:cc-13'), ('PPL-M14:cc-14'), ('PPL-M14:cc-15'),
  ('PPL-M14:cc-16'), ('PPL-M14:cc-17'), ('PPL-M14:cc-18'), ('PPL-M14:cc-19'), ('PPL-M14:cc-20'),
  ('PPL-M14:cc-22'), ('PPL-M14:cc-23'), ('PPL-M14:cc-24'), ('PPL-M14:cc-25'), ('PPL-M14:cc-27')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'F' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge, risk management', 'human_curated'
from (values
  ('PPL-M14:cc-21'),  -- legal takeoff distance, no margin, would you go?
  ('PPL-M14:cc-26'),  -- max gross weight + tailwind runway decision
  ('PPL-M14:cc-28'),  -- "the chart says it works" != "I should go"
  ('PPL-M14:cc-29')   -- used a generic POH chart instead of specific data
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'F' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'scenario_workshop', 'PPL-M14', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'I' and t.task_code = 'F' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- crosscountry (Area I, Task D — Cross-Country Flight Planning)
-- PPL-M15 Cross-Country Planning: a direct, whole-module match. The
-- "biggest planning mistake" (cc-29) and "defend a planning decision"
-- (cc-30) items are opinion/open-ended, left unmapped.
-- ═══════════════════════════════════════════════════════════════════
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M15-Q01'), ('PPL-M15-Q02'), ('PPL-M15-Q03'), ('PPL-M15-Q04'), ('PPL-M15-Q05'),
  ('PPL-M15-Q06'), ('PPL-M15-Q07'), ('PPL-M15-Q08'), ('PPL-M15-Q09'), ('PPL-M15-Q12'),
  ('PPL-M15-Q13'), ('PPL-M15-Q14'), ('PPL-M15-Q15')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'D' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M15:cc-1'), ('PPL-M15:cc-2'), ('PPL-M15:cc-3'), ('PPL-M15:cc-4'), ('PPL-M15:cc-5'),
  ('PPL-M15:cc-6'), ('PPL-M15:cc-7'), ('PPL-M15:cc-8'), ('PPL-M15:cc-9'), ('PPL-M15:cc-10'),
  ('PPL-M15:cc-11'), ('PPL-M15:cc-12'), ('PPL-M15:cc-13'), ('PPL-M15:cc-14'), ('PPL-M15:cc-15'),
  ('PPL-M15:cc-16'), ('PPL-M15:cc-17'), ('PPL-M15:cc-18'), ('PPL-M15:cc-19'), ('PPL-M15:cc-20'),
  ('PPL-M15:cc-21'), ('PPL-M15:cc-23'), ('PPL-M15:cc-24'), ('PPL-M15:cc-26'), ('PPL-M15:cc-28')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'D' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge, risk management', 'human_curated'
from (values
  ('PPL-M15:cc-22'),  -- legal, no margin anywhere, would you go?
  ('PPL-M15:cc-25'),  -- passenger pressure, deteriorating weather
  ('PPL-M15:cc-27')   -- completed nav log != safe flight
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'D' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'scenario_workshop', 'PPL-M15', t.id, 'knowledge', 'human_curated'
from public.acs_tasks t
where t.area_code = 'I' and t.task_code = 'D' and t.acs_version_id = public.get_active_acs_version('private_pilot')
on conflict (content_type, content_id, acs_task_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- aeromedical (Area I, Task H — Human Factors)
-- PPL-M17 Human Factors: only the objectively-factual physiological/
-- regulatory items. SHELL (Q08, cc-6, cc-12, cc-23), Swiss Cheese (Q09,
-- cc-19), and Apex's own Silent Six (cc-20) are named generic
-- frameworks, not the physiological/regulatory facts Task H actually
-- tests, and are left unmapped -- same reasoning as Module 12/16's
-- ADM-model-name items. Open-ended "defend a personal minimum" (cc-24)
-- and the personal-fuel/altitude-minimums item (Q24) are ADM/personal-
-- minimums judgment, not Human Factors physiology, and are also left
-- unmapped. Scenario Workshop is intentionally unmapped.
-- ═══════════════════════════════════════════════════════════════════
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M17-Q01'), ('PPL-M17-Q02'), ('PPL-M17-Q03'), ('PPL-M17-Q04'), ('PPL-M17-Q05'),
  ('PPL-M17-Q06'), ('PPL-M17-Q07'), ('PPL-M17-Q10'), ('PPL-M17-Q14'), ('PPL-M17-Q15'),
  ('PPL-M17-Q16'), ('PPL-M17-Q21'), ('PPL-M17-Q22'), ('PPL-M17-Q23')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'H' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M17:cc-1'), ('PPL-M17:cc-2'), ('PPL-M17:cc-3'), ('PPL-M17:cc-4'), ('PPL-M17:cc-5'),
  ('PPL-M17:cc-7'), ('PPL-M17:cc-8'), ('PPL-M17:cc-9'), ('PPL-M17:cc-10'), ('PPL-M17:cc-11'),
  ('PPL-M17:cc-13'), ('PPL-M17:cc-14'), ('PPL-M17:cc-15'), ('PPL-M17:cc-16'), ('PPL-M17:cc-17'),
  ('PPL-M17:cc-18'), ('PPL-M17:cc-21'), ('PPL-M17:cc-22')
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'H' and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;
