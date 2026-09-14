-- Apex Advantage — Sprint 4.1 Phase 9: targeted ACS mapping QA
--
-- A targeted semantic pass over the cross-domain pairings the sprint
-- flagged as likely to bleed (Aircraft Systems <-> Aeromedical, Aircraft
-- Systems <-> Airspace, Weather <-> ADM, Navigation <-> Airspace,
-- Emergency <-> Aircraft Systems) found one serious, active-impact bug
-- and three genuine dual-topic items worth a second mapping. This is
-- NOT a re-audit of all 449 mappings -- only the items below were
-- touched, all identified by reading their actual question/prompt text.
--
-- ── BUG: Area IX.A ("Emergency Descent") -- Apex's ONLY currently
-- assessable Emergency Operations task -- had zero emergency-descent
-- content and 16 mismapped dpe_questions actively producing false
-- "emergency" category evidence for students who had only ever studied
-- cross-country flight planning, weather-in-planning, or navigation
-- topics (xc-1..xc-33, wx-8). This directly violated Success Criterion
-- "every readiness subscore must actually measure the thing its label
-- claims to measure" for the one Emergency task Sprint 4.1's v134
-- migration kept in scope (on the -- now proven incorrect -- belief
-- that it already had 16 real mappings). Root cause: these dpe_questions
-- were attached to whatever acs_task_id ended up seeded as IX.A,
-- unrelated to their actual content. Fixed by reattaching each question
-- to the specific task its content actually tests.
--
-- The same seeding bug separately routed all 16 "emerg-*" dpe_questions
-- (genuine Emergency Operations oral content) onto Area X.A
-- ("Maneuvering with One Engine Inoperative (AMEL, AMES)") -- a
-- multiengine-only task that does not even apply to Apex's single-engine
-- Private Pilot curriculum. Reattached the ones with a clean task match
-- to their real Emergency Operations task (IX.B/IX.C, both already
-- digital_assessment_supported = false per v134 -- this migration does
-- NOT reopen that scope decision, it only corrects which inapplicable-
-- vs-real task the content is honestly associated with). The four with
-- no clean task fit (general regulatory authority, post-accident
-- reporting, inadvertent IMC, NMAC reporting -- none of which are the
-- Skill/Knowledge/Risk-Management elements of any Area IX task) are
-- unmapped rather than forced onto a wrong task.
do $$
declare
  v_task_ic uuid; v_task_id uuid; v_task_ie uuid; v_task_ig uuid; v_task_ih uuid;
  v_task_via uuid; v_task_vib uuid; v_task_vic uuid; v_task_vid uuid;
  v_task_ixa uuid; v_task_ixb uuid; v_task_ixc uuid;
  v_active uuid := get_active_acs_version('private_pilot');
begin
  select id into v_task_ic from acs_tasks where acs_version_id = v_active and area_code = 'I' and task_code = 'C';
  select id into v_task_id from acs_tasks where acs_version_id = v_active and area_code = 'I' and task_code = 'D';
  select id into v_task_ie from acs_tasks where acs_version_id = v_active and area_code = 'I' and task_code = 'E';
  select id into v_task_ig from acs_tasks where acs_version_id = v_active and area_code = 'I' and task_code = 'G';
  select id into v_task_ih from acs_tasks where acs_version_id = v_active and area_code = 'I' and task_code = 'H';
  select id into v_task_via from acs_tasks where acs_version_id = v_active and area_code = 'VI' and task_code = 'A';
  select id into v_task_vib from acs_tasks where acs_version_id = v_active and area_code = 'VI' and task_code = 'B';
  select id into v_task_vic from acs_tasks where acs_version_id = v_active and area_code = 'VI' and task_code = 'C';
  select id into v_task_vid from acs_tasks where acs_version_id = v_active and area_code = 'VI' and task_code = 'D';
  select id into v_task_ixa from acs_tasks where acs_version_id = v_active and area_code = 'IX' and task_code = 'A';
  select id into v_task_ixb from acs_tasks where acs_version_id = v_active and area_code = 'IX' and task_code = 'B';
  select id into v_task_ixc from acs_tasks where acs_version_id = v_active and area_code = 'IX' and task_code = 'C';

  -- Cross-country / weather-planning / navigation content wrongly on
  -- IX.A (Emergency Descent) -> reattached to the task it actually tests.
  update content_acs_mappings set acs_task_id = v_task_ic where content_type = 'dpe_question' and content_id = 'wx-8';
  update content_acs_mappings set acs_task_id = v_task_id where content_type = 'dpe_question' and content_id in ('xc-1','xc-2','xc-27','xc-32','xc-33','xc-7','xc-8');
  update content_acs_mappings set acs_task_id = v_task_via where content_type = 'dpe_question' and content_id in ('xc-5','xc-28','xc-29','xc-30');
  update content_acs_mappings set acs_task_id = v_task_vib where content_type = 'dpe_question' and content_id = 'xc-6';
  update content_acs_mappings set acs_task_id = v_task_vic where content_type = 'dpe_question' and content_id = 'xc-3';
  update content_acs_mappings set acs_task_id = v_task_vid where content_type = 'dpe_question' and content_id = 'xc-4';
  update content_acs_mappings set acs_task_id = v_task_ie where content_type = 'dpe_question' and content_id = 'xc-31';

  -- Real Emergency Descent content, finally attached to IX.A.
  update content_acs_mappings set acs_task_id = v_task_ixa where content_type = 'dpe_question' and content_id = 'emerg-6';

  -- Genuine Emergency Operations oral content, moved off the
  -- inapplicable multiengine-only X.A onto its real task. IX.B/IX.C stay
  -- digital_assessment_supported = false (v134's decision, unchanged) --
  -- this only corrects a false area/task association, it does not add
  -- new assessable scope.
  update content_acs_mappings set acs_task_id = v_task_ixb where content_type = 'dpe_question' and content_id in ('emerg-1','emerg-2');
  update content_acs_mappings set acs_task_id = v_task_ixc where content_type = 'dpe_question' and content_id in ('emerg-3','emerg-5','emerg-7','emerg-9','emerg-10','emerg-11','emerg-12','emerg-13','emerg-14');

  -- No Area IX task's Knowledge/Risk-Management element genuinely covers
  -- these (general 91.3(b) authority, post-accident reporting, an
  -- inadvertent-IMC encounter, or NMAC reporting) -- left unmapped
  -- rather than forced onto a task that doesn't actually test them.
  delete from content_acs_mappings where content_type = 'dpe_question' and content_id in ('emerg-4','emerg-8','emerg-15','emerg-16');

  -- ── Genuine dual-topic content (Aircraft Systems <-> Aeromedical /
  -- Airspace): a content item that actually tests two tasks' Knowledge
  -- elements gets a second mapping, not a forced single choice, per the
  -- sprint's own "may map to more than one task if genuinely
  -- appropriate" guidance.
  --
  -- PPL-M03-Q08 / PPL-M03:cc-18 both ask specifically why CO is
  -- dangerous / what makes it dangerous -- that's physiological
  -- knowledge (Human Factors), not just the systems pathway (how it
  -- enters the cabin) M03 already covers. PPL-M03:cc-19 stays
  -- aircraft-systems only -- it's about the cabin-heat/carb-heat system
  -- relationship, not physiological effect.
  insert into content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
  values
    ('module_quiz_question', 'PPL-M03-Q08', v_task_ih, 'knowledge', 'human_curated'),
    ('checkride_corner', 'PPL-M03:cc-18', v_task_ih, 'knowledge', 'human_curated')
  on conflict (content_type, content_id, acs_task_id) do nothing;

  -- PPL-M03:cc-20 explicitly asks how ADS-B Out "connects to airspace
  -- requirements" -- genuinely tests National Airspace System knowledge,
  -- not just what the equipment does. (PPL-M03-Q10, the module_quiz
  -- equivalent, only asks what ADS-B Out broadcasts -- no airspace-
  -- requirement content -- so it correctly stays aircraft-systems only.)
  insert into content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
  values ('checkride_corner', 'PPL-M03:cc-20', v_task_ie, 'knowledge', 'human_curated')
  on conflict (content_type, content_id, acs_task_id) do nothing;
end $$;
