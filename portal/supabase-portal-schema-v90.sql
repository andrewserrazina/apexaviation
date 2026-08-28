-- Apex Advantage — Module Workbook content: Module 3 (Aircraft Systems) (v90)
--
-- Same schema as v88/v89 (module_companion_content + module_quiz_questions,
-- keyed by course_id + module_id) -- no new tables or application code
-- needed, since get-module-companion-content and the Module Workbook UI
-- are already generic over whichever module has rows here.
--
-- Two adaptations worth flagging (not fabrications -- both keep the real
-- source content, just placed to fit the existing schema/UI honestly):
--
-- 1. The Knowledge Check / Assessment Bank (Part 11) has 10 multiple-
--    choice questions WITH a real answer key, plus 5 "scenario-based
--    discussion questions" that are deliberately open -- the source
--    material gives no stated correct answer for those 5 (by design,
--    per the package's own "INSTRUCTOR TIP: the scenario set tests
--    application... a student who aces the multiple-choice section but
--    struggles with the scenarios has a genuine gap"). Only the 10 MC
--    questions (real answer key + explanation) went into
--    module_quiz_questions -- inventing a "correct answer" for the 5
--    open scenario questions would be fabrication. Those 5, plus the
--    Knowledge Worksheets' short-answer/scenario-interpretation items
--    (Worksheet D + E), are folded into module_companion_content's
--    knowledgeCheckQuestions as free-text reflection prompts instead --
--    the same no-shown-answer shape Module 1's own knowledgeCheckQuestions
--    already uses.
-- 2. The Apex Challenge ("Know Your Aircraft") asks students to take six
--    photos on their real training aircraft. The portal has no photo
--    upload today, so the six items became six text fields (identify the
--    component, how you'd check/use it, what a problem would look like)
--    -- the same written-reasoning content the source rubric actually
--    grades ("Systems Reasoning... demonstrates genuine understanding,"
--    not the photos themselves), adapted to what this page can capture.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v89.

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M03',
  '{
    "modulePurpose": "Build a working, troubleshooting-level understanding of the systems in your training aircraft — how they operate normally, how they fail, how you''ll recognize that failure, and what you''ll do next.",
    "objectives": [
      { "id": "obj-explain-systems", "label": "Explain how major aircraft systems operate." },
      { "id": "obj-indications", "label": "Identify normal indications and abnormal indications." },
      { "id": "obj-failures", "label": "Recognize common system failures." },
      { "id": "obj-safety-decisions", "label": "Understand how system failures affect safety and decision making." },
      { "id": "obj-apply-scenarios", "label": "Apply aircraft systems knowledge to real-world scenarios." },
      { "id": "obj-oral-exam", "label": "Answer aircraft systems oral exam questions confidently." },
      { "id": "obj-acs-rm", "label": "Demonstrate ACS-level knowledge and risk management." }
    ],
    "guidedNotes": [
      { "id": "engine", "section": "Engine", "prompt": "What are the four strokes of the engine cycle in order, why do dual magnetos exist, and what does mixture control actually manage?" },
      { "id": "fuel", "section": "Fuel", "prompt": "Why must fuel tanks be vented, and why is fuel sumping a genuine risk-management action rather than a formality?" },
      { "id": "electrical", "section": "Electrical", "prompt": "In normal operation, what does the alternator power and recharge, and why doesn''t an alternator failure mean immediate total electrical loss?" },
      { "id": "vacuum-pitot-static", "section": "Vacuum & Pitot-Static", "prompt": "Which instruments does the vacuum system typically drive, and how do a blocked pitot tube and a blocked static port produce different indication patterns?" },
      { "id": "landing-gear-environmental", "section": "Landing Gear & Environmental", "prompt": "What''s the difference between fixed and retractable landing gear systems, and why is carbon monoxide risk easy to mistake for something else?" },
      { "id": "avionics", "section": "Avionics", "prompt": "What''s the difference between what COM and NAV radios are used for, and what does ADS-B Out actually broadcast?" },
      { "id": "putting-it-together", "section": "Putting It Together", "prompt": "For every system this module covers, the same four questions apply: how does it work, what happens if it fails, how will you recognize the failure, and what should you do? Why does this same structure work for every system, not just one?" }
    ],
    "scenario": {
      "narrative": "You''re solo on a cross-country flight, about an hour from your destination, cruising at 6,500 feet on a clear evening. The sun set about twenty minutes ago, and you''ve got your position lights and panel lights on. You glance at the panel and notice the ammeter needle has drifted into the discharge side, and a small amber annunciator light you don''t remember seeing before is now illuminated — it reads ''ALT.'' Everything else looks normal: engine instruments are in the green, you''re on course, radios are working fine. You''re not in a busy area — no towered airport nearby, terrain is unremarkable, and you have about 45 minutes of fuel beyond what you need to reach your destination. It''s now fully dark outside.",
      "prompts": [
        { "id": "scenario-initial-decision", "prompt": "My Initial Decision: what has actually failed here, and how do you know?" },
        { "id": "scenario-classmates", "prompt": "What I Heard From Classmates that I hadn''t considered:" },
        { "id": "scenario-after-discussion", "prompt": "My Decision After Discussion: walk through your load-shedding decision — what do you keep on, what do you turn off, and in what order?" },
        { "id": "scenario-pave-pilot", "prompt": "Risk Analysis — Pilot: how does this PAVE element apply to this scenario?" },
        { "id": "scenario-pave-aircraft", "prompt": "Risk Analysis — Aircraft: how does this PAVE element apply to this scenario?" },
        { "id": "scenario-pave-environment", "prompt": "Risk Analysis — enVironment: how does this PAVE element apply to this scenario?" },
        { "id": "scenario-pave-external", "prompt": "Risk Analysis — External Pressures: how does this PAVE element apply to this scenario?" },
        { "id": "scenario-change-decision", "prompt": "What would change my decision — is it a specific remaining-battery estimate, a specific time, or something else that would flip you from continuing to your destination to diverting immediately?" },
        { "id": "scenario-confidence", "prompt": "How confident do you feel applying this reasoning on a real flight, and why?" }
      ]
    },
    "checkrideCorner": [
      { "id": "cc-1", "question": "What are the four strokes of the engine cycle, in order?" },
      { "id": "cc-2", "question": "What conditions favor carburetor ice, and how would you recognize it in flight?" },
      { "id": "cc-3", "question": "Why does an aircraft engine use dual magnetos instead of a single ignition system?" },
      { "id": "cc-4", "question": "What does mixture control actually do, and why does it need adjustment with altitude?" },
      { "id": "cc-5", "question": "Why must fuel tanks be vented, and what happens if a vent becomes blocked?" },
      { "id": "cc-6", "question": "What is fuel sumping, and why is it a genuine risk-management action rather than a formality?" },
      { "id": "cc-7", "question": "How do you manage fuel tank selection during a typical flight, and what should you verify beforehand?" },
      { "id": "cc-8", "question": "Describe the relationship between the battery and the alternator in normal operation." },
      { "id": "cc-9", "question": "What indications would alert you to an alternator failure in flight?" },
      { "id": "cc-10", "question": "Walk me through your load-shedding procedure after confirming an alternator failure." },
      { "id": "cc-11", "question": "What is the difference between a circuit breaker and a fuse, and what is each protecting?" },
      { "id": "cc-12", "question": "What instruments does the vacuum system typically power, and why does that matter?" },
      { "id": "cc-13", "question": "How would you recognize a vacuum system failure in flight?" },
      { "id": "cc-14", "question": "Which flight instruments rely on the pitot-static system, and what does each depend on specifically?" },
      { "id": "cc-15", "question": "What happens to your instruments if the pitot tube becomes blocked, but the static port remains clear?" },
      { "id": "cc-16", "question": "What happens if the static port becomes blocked, and how does an alternate static source change that?" },
      { "id": "cc-17", "question": "What is the difference between fixed and retractable landing gear in terms of systems complexity?" },
      { "id": "cc-18", "question": "How does carbon monoxide enter the cabin, and why is it particularly dangerous?" },
      { "id": "cc-19", "question": "What is the relationship between cabin heat and carburetor heat systems, and why does this matter for CO risk?" },
      { "id": "cc-20", "question": "What is the purpose of a transponder with ADS-B Out, and how does it connect to airspace requirements?" }
    ],
    "knowledgeCheckQuestions": [
      { "id": "kcq-1", "prompt": "In your own words, explain why carburetor ice is a condition, not a malfunction." },
      { "id": "kcq-2", "prompt": "Why does an alternator failure give a pilot more time to respond than a total electrical failure?" },
      { "id": "kcq-3", "prompt": "Explain the difference between how a blocked pitot tube and a blocked static port affect your instruments." },
      { "id": "kcq-4", "prompt": "Why is carbon monoxide risk given the same weight as any other systems failure in this module?" },
      { "id": "kcq-5", "prompt": "During a night cross-country, a pilot notices the ammeter showing a discharge and a low-voltage annunciator illuminated, with about 45 minutes of flight remaining. What system has failed, and what is the pilot''s most important resource to manage right now?" },
      { "id": "kcq-6", "prompt": "What specific actions should that pilot take, in order?" },
      { "id": "kcq-7", "prompt": "You smell nothing unusual, but you begin to feel a mild headache and slight drowsiness on a long flight with the cabin heat on. Walk through your reasoning and immediate actions." },
      { "id": "kcq-8", "prompt": "During a preflight, you find a small amount of water in your fuel sample from the left tank sump. What do you do next, step by step?" },
      { "id": "kcq-9", "prompt": "Your attitude indicator appears to be slowly drifting while your airspeed, altimeter, and VSI all look normal. What''s your diagnosis, and what would you do?" },
      { "id": "kcq-10", "prompt": "You''re descending through moist air on a mild afternoon and notice a gradual RPM decrease with no throttle change. What''s your immediate action, and why that specific action?" },
      { "id": "kcq-11", "prompt": "You discover during preflight that your ALT FIELD circuit breaker is popped. Walk through what you''d check next and what your decision would be about the flight." }
    ],
    "reflectionQuestions": [
      { "id": "reflect-1", "prompt": "What''s the one system from tonight you feel most confident explaining to someone else?" },
      { "id": "reflect-2", "prompt": "Areas to Improve: which system do I want to review again before Module 4?" },
      { "id": "reflect-3", "prompt": "Questions Remaining: what''s still unclear or unresolved from tonight?" }
    ],
    "apexChallenge": {
      "instructions": "\"Know Your Aircraft\" — Before Module 4, go out to your actual training aircraft — on the ramp, not from memory — and physically locate and photograph six items. For each item, write two to three sentences: what it is, how you''d check or use it during a normal preflight or flight, and what you''d look for that would indicate a problem.",
      "fields": [
        { "id": "item-fuel-vents-selector", "label": "Fuel tank vents & fuel selector — identification, normal check/use, and a problem indicator", "type": "textarea" },
        { "id": "item-fuel-strainer-sump", "label": "Fuel strainer/sump drain locations — identification, normal check/use, and a problem indicator", "type": "textarea" },
        { "id": "item-alternator-battery-breakers", "label": "Alternator/battery-related circuit breakers or fuses — identification, normal check/use, and a problem indicator", "type": "textarea" },
        { "id": "item-vacuum-filter-gauge", "label": "Vacuum system air filter or gauge (if equipped) — identification, normal check/use, and a problem indicator", "type": "textarea" },
        { "id": "item-pitot-static-alternate", "label": "Pitot tube, static port(s), and alternate static source control — identification, normal check/use, and a problem indicator", "type": "textarea" },
        { "id": "item-heater-vent-controls", "label": "Heater/vent controls — identification, normal check/use, and a problem indicator", "type": "textarea" }
      ]
    }
  }'::jsonb
)
on conflict (course_id, module_id) do update set content = excluded.content, updated_at = now();

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M03-Q01', 'PPL', 'PPL-M03', 1, 'multiple_choice', 'Which stroke of the engine cycle immediately follows compression?',
  '[{"key":"A","label":"Intake"},{"key":"B","label":"Power"},{"key":"C","label":"Exhaust"},{"key":"D","label":"Idle"}]'::jsonb, 'B',
  'The order is intake, compression, power, exhaust — power immediately follows compression as ignition drives the piston down.'),
('PPL-M03-Q02', 'PPL', 'PPL-M03', 2, 'multiple_choice', 'Carburetor ice is most accurately described as:',
  '[{"key":"A","label":"A malfunction requiring maintenance before further flight"},{"key":"B","label":"A condition that can occur across a range of temperatures given sufficient humidity"},{"key":"C","label":"A risk only below freezing temperature"},{"key":"D","label":"A risk only at high altitude"}]'::jsonb, 'B',
  'Carb ice depends on the combination of temperature and humidity, not cold temperature alone — it can occur well above freezing.'),
('PPL-M03-Q03', 'PPL', 'PPL-M03', 3, 'multiple_choice', 'In normal operation, the alternator:',
  '[{"key":"A","label":"Only powers the starter"},{"key":"B","label":"Powers the bus and recharges the battery"},{"key":"C","label":"Is powered by the battery"},{"key":"D","label":"Has no connection to the battery"}]'::jsonb, 'B',
  'The alternator is the primary source in normal operation: it powers the bus and recharges the battery simultaneously.'),
('PPL-M03-Q04', 'PPL', 'PPL-M03', 4, 'multiple_choice', 'An illuminated ALT annunciator combined with an ammeter showing discharge most likely indicates:',
  '[{"key":"A","label":"A fully charged battery"},{"key":"B","label":"Normal cruise flight electrical operation"},{"key":"C","label":"An alternator failure"},{"key":"D","label":"A vacuum system failure"}]'::jsonb, 'C',
  'This is the specific evidence pattern for an alternator failure, distinct from a total electrical failure or normal operation.'),
('PPL-M03-Q05', 'PPL', 'PPL-M03', 5, 'multiple_choice', 'In most steam-gauge trainers, the vacuum system typically powers:',
  '[{"key":"A","label":"The airspeed indicator and altimeter"},{"key":"B","label":"The attitude and heading indicators"},{"key":"C","label":"The VSI only"},{"key":"D","label":"The entire electrical bus"}]'::jsonb, 'B',
  'Attitude and heading indicators are the classic vacuum-driven gyroscopic instruments in most steam-gauge trainers.'),
('PPL-M03-Q06', 'PPL', 'PPL-M03', 6, 'multiple_choice', 'If the pitot tube is blocked but the static port remains clear, which instrument is primarily affected?',
  '[{"key":"A","label":"Altimeter"},{"key":"B","label":"VSI"},{"key":"C","label":"Airspeed indicator"},{"key":"D","label":"Attitude indicator"}]'::jsonb, 'C',
  'A blocked pitot tube specifically affects the airspeed indicator, since it depends on pitot (ram air) pressure; the altimeter and VSI are static-only instruments.'),
('PPL-M03-Q07', 'PPL', 'PPL-M03', 7, 'multiple_choice', 'With the static port blocked and no alternate static source, the altimeter will most likely:',
  '[{"key":"A","label":"Read zero"},{"key":"B","label":"Freeze at or near its last accurate reading"},{"key":"C","label":"Immediately show a large error in the opposite direction"},{"key":"D","label":"Continue reading with no error at all"}]'::jsonb, 'B',
  'Without an alternate static source, affected instruments generally freeze at or near their last accurate reading rather than reading zero or reversing.'),
('PPL-M03-Q08', 'PPL', 'PPL-M03', 8, 'multiple_choice', 'Carbon monoxide is dangerous partly because:',
  '[{"key":"A","label":"It has a strong, easily identifiable odor"},{"key":"B","label":"It is colorless and odorless, with symptoms that mimic fatigue"},{"key":"C","label":"It only affects turbocharged engines"},{"key":"D","label":"It is only a risk on the ground"}]'::jsonb, 'B',
  'CO''s colorless, odorless nature combined with fatigue-like symptoms is exactly what makes it dangerous — it''s easy to miss or misattribute.'),
('PPL-M03-Q09', 'PPL', 'PPL-M03', 9, 'multiple_choice', 'A circuit breaker differs from a fuse primarily in that:',
  '[{"key":"A","label":"A circuit breaker protects the whole aircraft, a fuse protects one circuit"},{"key":"B","label":"A circuit breaker can be reset once if the fault clears; a fuse must be replaced"},{"key":"C","label":"A fuse can be reset; a circuit breaker cannot"},{"key":"D","label":"There is no meaningful difference"}]'::jsonb, 'B',
  'A circuit breaker can be reset once if the fault has cleared; a fuse is a one-time protective device that must be physically replaced.'),
('PPL-M03-Q10', 'PPL', 'PPL-M03', 10, 'multiple_choice', 'ADS-B Out primarily provides:',
  '[{"key":"A","label":"Weather radar imagery only"},{"key":"B","label":"A GPS-derived broadcast of the aircraft''s position, altitude, and velocity"},{"key":"C","label":"Two-way voice communication"},{"key":"D","label":"Fuel quantity data to ATC"}]'::jsonb, 'B',
  'ADS-B Out broadcasts a GPS-derived position/altitude/velocity picture, distinct from a transponder''s radar-reply function and from weather or voice services.');
