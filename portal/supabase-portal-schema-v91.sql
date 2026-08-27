-- Apex Advantage — Module Workbook content: Module 4 (FARs Simplified) (v91)
--
-- Same schema as v88-v90 (module_companion_content + module_quiz_questions).
-- No new tables or application code needed.
--
-- This package is structured differently from Modules 1-3, and two real
-- gaps are flagged rather than papered over, matching this module's own
-- "[No standalone ... section existed — flagged for future authoring
-- rather than fabricated here]" convention:
--
-- - No Apex Challenge exists for this module (flagged as such in the
--   source) -- apexChallenge is simply omitted from the JSON below,
--   which the Module Workbook page already renders correctly (no
--   section shown when the key is absent).
-- - Section 12 (Student Workbook Contents) doesn''t reproduce full guided-
--   notes fill-in text the way Modules 2/3 did -- it just gives
--   production notes ("workbook pages mirror the slide sequence"). The
--   guidedNotes prompts below are carried over from GUIDED_NOTES_MODULES'
--   existing PPL-M04 placeholder (site/portal-stable.js), which was
--   checked against this module''s real Learning Objectives/Overview and
--   found to already accurately synthesize the real content -- not
--   rewritten from scratch, and not a guess.
--
-- The Scenario Workshop here is five independent short scenarios (not
-- one flagship narrative like Modules 1-3), each with its own setup and
-- discussion questions but no single flagship narrative to anchor
-- content.scenario.narrative on. Adapted by folding each scenario''s
-- setup directly into its own prompt (self-contained), rather than
-- picking one scenario arbitrarily to be "the" narrative and losing the
-- other four -- content.scenario.narrative is a one-line framing instead.
-- Deliberately left the discussion prompts open here (no revealed
-- determination) even though the Knowledge Check bank below independently
-- covers four of these same five scenarios with a real answer key --
-- students reason through the worksheet version first, same as every
-- other module''s scenario workshop.
--
-- The Knowledge Check / Assessment Bank (Part 11) is real and complete:
-- 20 multiple-choice (with answer key) + 6 scenario + 4 short-answer (all
-- with real model answers, unlike Module 3''s open scenario set) = 30
-- questions, all seeded into module_quiz_questions.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v90.

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M04',
  '{
    "modulePurpose": "Teach students to apply — not merely recite — the regulations that govern every flight they will fly, and to recognize the difference between what is legal and what is genuinely safe.",
    "objectives": [
      { "id": "obj-part61-91-pic", "label": "Differentiate Part 61 and Part 91, and explain PIC authority and emergency authority." },
      { "id": "obj-currency", "label": "Apply currency requirements: flight reviews, passenger currency, and instrument currency." },
      { "id": "obj-documents-inspections", "label": "Identify required aircraft documents (ARROW) and required inspections (AV1ATES)." },
      { "id": "obj-equipment", "label": "Apply § 91.205 required equipment and the § 91.213 inoperative-equipment decision process." },
      { "id": "obj-row-altitude-fuel", "label": "Apply right-of-way rules, minimum safe altitudes, and fuel requirements to real scenarios." },
      { "id": "obj-fitness", "label": "Explain alcohol/drug rules and use IMSAFE and 6-HITS as personal legality checks." },
      { "id": "obj-legal-vs-safe", "label": "Distinguish legal from safe, and make sound decisions when the two aren''t the same thing." }
    ],
    "guidedNotes": [
      { "id": "part-authority", "section": "Foundations", "prompt": "What is the difference between what Part 61, Part 91, and Part 43 each govern, and why is emergency authority under § 91.3(b) not a \"blank check\"?" },
      { "id": "currency-vs-proficiency", "section": "Currency & Medical", "prompt": "What is the difference between currency and proficiency, and what are the day and night passenger-currency requirements under § 61.57?" },
      { "id": "arrow-aviates", "section": "Documents & Inspections", "prompt": "What do the five ARROW documents and the AV1ATES inspections cover, and how does a Service Bulletin differ from an Airworthiness Directive?" },
      { "id": "inoperative-equipment", "section": "Required & Inoperative Equipment", "prompt": "When a piece of equipment is inoperative, how does the decision differ depending on whether the aircraft has an approved Minimum Equipment List (MEL)?" },
      { "id": "right-of-way-altitudes-fuel", "section": "Right-of-Way, Altitudes & Fuel", "prompt": "What are the right-of-way rules for head-on, converging, and overtaking traffic, and what are the minimum fuel reserves for day and night VFR?" },
      { "id": "imsafe-6hits", "section": "Personal Fitness & Airspace Equipment", "prompt": "What does 6-HITS check that IMSAFE alone does not, and in which classes of airspace — and above what altitude — is ADS-B Out required?" },
      { "id": "legal-vs-safe", "section": "Putting It Together", "prompt": "Why doesn''t meeting every regulatory minimum automatically mean a flight is a good idea — what''s the difference between legal and safe?" }
    ],
    "scenario": {
      "narrative": "Five short scenarios testing whether you can apply tonight''s regulations under real conditions, not just recite them.",
      "prompts": [
        { "id": "scenario-1-flight-review", "prompt": "Scenario 1 — Expired Flight Review: A private pilot completed a flight review 26 months ago. Medical is current. Aircraft annual is current. They want to take two friends to lunch. Is the pilot currently legal to act as PIC? Is the flight, as planned, legal? What corrective action fixes this, and how fast?" },
        { "id": "scenario-2-inoperative-equipment", "prompt": "Scenario 2 — Inoperative Equipment: A landing light has failed. Day VFR, no AD against it, POH does not require it. Walk the § 91.213 decision tree for this exact item — does this aircraft have an MEL? What has to happen before this aircraft can legally fly?" },
        { "id": "scenario-3-expired-annual", "prompt": "Scenario 3 — Airworthiness: An annual was completed July 12, 2026. Today is August 5, 2027. Is the aircraft currently airworthy? Explain the calendar-month logic — exactly when did this annual actually expire?" },
        { "id": "scenario-4-passenger-currency", "prompt": "Scenario 4 — Passenger Currency: A pilot has not completed night landings in 95 days. Can this pilot legally carry passengers at night tonight? Could this pilot fly the exact same route solo tonight? Why or why not? What''s the fastest legal fix?" },
        { "id": "scenario-5-emergency-authority", "prompt": "Scenario 5 — Emergency Authority: An engine begins running rough, and the nearest suitable airport requires entering Class B without prior clearance. Does § 91.3(b) allow this pilot to enter without a clearance? What does \"to the extent required to meet the emergency\" actually limit here?" }
      ]
    },
    "checkrideCorner": [
      { "id": "cc-1", "question": "What is the difference between Part 61 and Part 91?" },
      { "id": "cc-2", "question": "What is PIC authority, and where does it come from?" },
      { "id": "cc-3", "question": "What can a PIC do under emergency authority that they couldn''t do otherwise?" },
      { "id": "cc-4", "question": "What''s required to act as PIC after 24 months without a flight review?" },
      { "id": "cc-5", "question": "What are the passenger currency requirements for day flight?" },
      { "id": "cc-6", "question": "What''s different about night passenger currency vs. day?" },
      { "id": "cc-7", "question": "Name the five ARROW documents." },
      { "id": "cc-8", "question": "What does AV1ATES help you remember, and what''s each inspection interval?" },
      { "id": "cc-9", "question": "What''s the difference between an annual and a 100-hour inspection?" },
      { "id": "cc-10", "question": "What''s the difference between a Service Bulletin and an Airworthiness Directive?" },
      { "id": "cc-11", "question": "Walk me through the § 91.213 decision tree for an inoperative instrument." },
      { "id": "cc-12", "question": "What does A TOMATO FLAMES cover, and when does it apply?" },
      { "id": "cc-13", "question": "Two aircraft approach head-on at the same altitude — what does each pilot do?" },
      { "id": "cc-14", "question": "Explain the aircraft category priority order for right-of-way." },
      { "id": "cc-15", "question": "What are the minimum safe altitudes over a congested area vs. sparsely populated area?" },
      { "id": "cc-16", "question": "What fuel reserve is required for a night VFR flight?" },
      { "id": "cc-17", "question": "What are the alcohol rules under § 91.17?" },
      { "id": "cc-18", "question": "Walk me through IMSAFE and how you''d actually use it before a flight." },
      { "id": "cc-19", "question": "What is 6-HITS, and how does it differ from IMSAFE?" },
      { "id": "cc-20", "question": "Give an example of something that''s legal but not necessarily safe." }
    ]
  }'::jsonb
)
on conflict (course_id, module_id) do update set content = excluded.content, updated_at = now();

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M04-Q01', 'PPL', 'PPL-M04', 1, 'multiple_choice', 'Under Part 61, a flight review must be completed every:',
  '[{"key":"A","label":"12 calendar months"},{"key":"B","label":"24 calendar months"},{"key":"C","label":"100 hours"},{"key":"D","label":"90 days"}]'::jsonb, 'B',
  'A flight review is required every 24 calendar months under § 61.56.'),
('PPL-M04-Q02', 'PPL', 'PPL-M04', 2, 'multiple_choice', 'To carry passengers during the day, a pilot must have completed 3 takeoffs and landings within the preceding:',
  '[{"key":"A","label":"30 days"},{"key":"B","label":"60 days"},{"key":"C","label":"90 days"},{"key":"D","label":"6 calendar months"}]'::jsonb, 'C',
  'Day passenger currency requires 3 takeoffs and landings in the preceding 90 days, in the same category, class, and (if required) type of aircraft.'),
('PPL-M04-Q03', 'PPL', 'PPL-M04', 3, 'multiple_choice', 'Which document is NOT part of ARROW?',
  '[{"key":"A","label":"Airworthiness Certificate"},{"key":"B","label":"Registration"},{"key":"C","label":"Pilot Certificate"},{"key":"D","label":"Weight & Balance data"}]'::jsonb, 'C',
  'ARROW is Airworthiness Certificate, Registration, Radio license (international only), Operating limitations (POH/AFM), and Weight & Balance data — the pilot certificate isn''t part of ARROW.'),
('PPL-M04-Q04', 'PPL', 'PPL-M04', 4, 'multiple_choice', 'An annual inspection completed on March 10, 2026 expires at the end of:',
  '[{"key":"A","label":"March 10, 2027"},{"key":"B","label":"March 31, 2027"},{"key":"C","label":"March 2028"},{"key":"D","label":"April 10, 2027"}]'::jsonb, 'B',
  'Annual inspections expire at the end of the 12th calendar month after the month completed — the end of March 2027, not the exact anniversary date.'),
('PPL-M04-Q05', 'PPL', 'PPL-M04', 5, 'multiple_choice', 'A 100-hour inspection is required only when the aircraft is:',
  '[{"key":"A","label":"Over 10 years old"},{"key":"B","label":"Used for hire or flight instruction for hire"},{"key":"C","label":"Flown IFR"},{"key":"D","label":"Registered outside the U.S."}]'::jsonb, 'B',
  'The 100-hour inspection requirement applies specifically to aircraft used for hire or flight instruction for hire.'),
('PPL-M04-Q06', 'PPL', 'PPL-M04', 6, 'multiple_choice', 'A VOR check is required every:',
  '[{"key":"A","label":"12 calendar months"},{"key":"B","label":"24 calendar months"},{"key":"C","label":"30 days"},{"key":"D","label":"100 hours"}]'::jsonb, 'C',
  'VOR accuracy checks are required every 30 days for IFR operations under VOR navigation.'),
('PPL-M04-Q07', 'PPL', 'PPL-M04', 7, 'multiple_choice', 'Altimeter and static system tests are required every:',
  '[{"key":"A","label":"12 calendar months"},{"key":"B","label":"24 calendar months"},{"key":"C","label":"30 days"},{"key":"D","label":"90 days"}]'::jsonb, 'B',
  'Altimeter/static system and transponder tests are both on a 24 calendar month cycle.'),
('PPL-M04-Q08', 'PPL', 'PPL-M04', 8, 'multiple_choice', 'Which is legally mandatory: a Service Bulletin or an Airworthiness Directive?',
  '[{"key":"A","label":"Service Bulletin"},{"key":"B","label":"Airworthiness Directive"},{"key":"C","label":"Both equally"},{"key":"D","label":"Neither"}]'::jsonb, 'B',
  'An Airworthiness Directive is FAA-issued and legally mandatory; a Service Bulletin is manufacturer guidance, generally not mandatory unless referenced by an AD.'),
('PPL-M04-Q09', 'PPL', 'PPL-M04', 9, 'multiple_choice', 'Under § 91.205, which is part of the day VFR required equipment list (A TOMATO FLAMES)?',
  '[{"key":"A","label":"Weather radar"},{"key":"B","label":"Airspeed indicator"},{"key":"C","label":"Autopilot"},{"key":"D","label":"DME"}]'::jsonb, 'B',
  'The airspeed indicator is part of A TOMATO FLAMES, the day VFR required equipment baseline under § 91.205(b).'),
('PPL-M04-Q10', 'PPL', 'PPL-M04', 10, 'multiple_choice', 'If an inoperative item has no MEL and is not required by 91.205, the KOEL, or an AD, it may be:',
  '[{"key":"A","label":"Ignored entirely, no placard needed"},{"key":"B","label":"Removed/deactivated and placarded inoperative"},{"key":"C","label":"Never legally flown with"},{"key":"D","label":"Only flown at night"}]'::jsonb, 'B',
  'Per § 91.213(d), an item not required for the flight can be removed or deactivated and placarded ''inoperative.''' ),
('PPL-M04-Q11', 'PPL', 'PPL-M04', 11, 'multiple_choice', 'Two aircraft converging at the same altitude, neither head-on nor overtaking — who has the right-of-way?',
  '[{"key":"A","label":"The faster aircraft"},{"key":"B","label":"The aircraft to the other''s right"},{"key":"C","label":"The aircraft at higher altitude"},{"key":"D","label":"The larger aircraft"}]'::jsonb, 'B',
  'In a converging situation, the aircraft to the other''s right has the right-of-way.'),
('PPL-M04-Q12', 'PPL', 'PPL-M04', 12, 'multiple_choice', 'In a head-on situation, each pilot should:',
  '[{"key":"A","label":"Climb"},{"key":"B","label":"Descend"},{"key":"C","label":"Turn right"},{"key":"D","label":"Turn left"}]'::jsonb, 'C',
  'Both aircraft alter course to the right in a head-on encounter.'),
('PPL-M04-Q13', 'PPL', 'PPL-M04', 13, 'multiple_choice', 'Which aircraft category generally has the LOWEST right-of-way priority among these?',
  '[{"key":"A","label":"Balloon"},{"key":"B","label":"Glider"},{"key":"C","label":"Airship"},{"key":"D","label":"Airplane"}]'::jsonb, 'D',
  'Priority runs from aircraft in distress, balloon, glider, airship, then airplane/rotorcraft — the least maneuverable aircraft generally has priority, so airplane is lowest among these four.'),
('PPL-M04-Q14', 'PPL', 'PPL-M04', 14, 'multiple_choice', 'Minimum safe altitude over a congested area is:',
  '[{"key":"A","label":"500 ft AGL"},{"key":"B","label":"1,000 ft above the highest obstacle within 2,000 ft"},{"key":"C","label":"2,000 ft AGL"},{"key":"D","label":"3,000 ft AGL"}]'::jsonb, 'B',
  'Over congested areas, the minimum is 1,000 feet above the highest obstacle within a 2,000-foot horizontal radius.'),
('PPL-M04-Q15', 'PPL', 'PPL-M04', 15, 'multiple_choice', 'Required fuel reserve for a day VFR flight is enough fuel to fly to the first point of intended landing plus:',
  '[{"key":"A","label":"15 minutes"},{"key":"B","label":"30 minutes"},{"key":"C","label":"45 minutes"},{"key":"D","label":"1 hour"}]'::jsonb, 'B',
  'Day VFR fuel reserve is 30 minutes at normal cruising speed beyond the first point of intended landing.'),
('PPL-M04-Q16', 'PPL', 'PPL-M04', 16, 'multiple_choice', 'Required fuel reserve for a night VFR flight is enough fuel to fly to the first point of intended landing plus:',
  '[{"key":"A","label":"15 minutes"},{"key":"B","label":"30 minutes"},{"key":"C","label":"45 minutes"},{"key":"D","label":"1 hour"}]'::jsonb, 'C',
  'Night VFR fuel reserve is 45 minutes at normal cruising speed, 15 minutes more than the day VFR reserve.'),
('PPL-M04-Q17', 'PPL', 'PPL-M04', 17, 'multiple_choice', 'The maximum blood alcohol concentration allowed for a crew member to act is:',
  '[{"key":"A","label":"0.02"},{"key":"B","label":"0.04"},{"key":"C","label":"0.08"},{"key":"D","label":"0.10"}]'::jsonb, 'B',
  '§ 91.17 sets the BAC limit at 0.04.'),
('PPL-M04-Q18', 'PPL', 'PPL-M04', 18, 'multiple_choice', 'Under § 91.17, a crew member may not act within how many hours after consuming alcohol?',
  '[{"key":"A","label":"4 hours"},{"key":"B","label":"6 hours"},{"key":"C","label":"8 hours"},{"key":"D","label":"12 hours"}]'::jsonb, 'C',
  'The rule is 8 hours from bottle to throttle, alongside the 0.04 BAC limit and the prohibition on acting while impaired.'),
('PPL-M04-Q19', 'PPL', 'PPL-M04', 19, 'multiple_choice', 'ADS-B Out is generally required above:',
  '[{"key":"A","label":"5,000 ft MSL"},{"key":"B","label":"10,000 ft MSL (with exceptions below 2,500 ft AGL)"},{"key":"C","label":"18,000 ft MSL"},{"key":"D","label":"It is never altitude-based"}]'::jsonb, 'B',
  'ADS-B Out is generally required above 10,000 ft MSL, with an exception for airspace below 2,500 ft AGL.'),
('PPL-M04-Q20', 'PPL', 'PPL-M04', 20, 'multiple_choice', 'The ''E'' in IMSAFE stands for:',
  '[{"key":"A","label":"Endurance"},{"key":"B","label":"Emotion / Eating"},{"key":"C","label":"Experience"},{"key":"D","label":"Equipment"}]'::jsonb, 'B',
  'IMSAFE: Illness, Medication, Stress, Alcohol, Fatigue, Emotion/Eating.'),
('PPL-M04-Q21', 'PPL', 'PPL-M04', 21, 'scenario', 'A pilot''s most recent flight review was 25 months ago. Medical and aircraft are both current. Is this pilot legal to act as PIC today?',
  null, null,
  'No — the flight review lapsed at 24 months. The pilot needs a new flight review before acting as PIC again (or another qualifying event under § 61.56).'),
('PPL-M04-Q22', 'PPL', 'PPL-M04', 22, 'scenario', 'An aircraft''s annual was completed on May 20, 2026. On June 3, 2027, is the aircraft airworthy for the annual-inspection requirement?',
  null, null,
  'No — the annual was valid only through May 31, 2027 (the end of the 12th calendar month after the month it was completed). As of June 3, 2027, it has expired and the aircraft is not airworthy for this requirement.'),
('PPL-M04-Q23', 'PPL', 'PPL-M04', 23, 'scenario', 'A pilot wants to carry passengers at night. Their last night landings were 100 days ago. Is this legal, and what''s the fix?',
  null, null,
  'No — night passenger currency requires 3 full-stop landings at night within the preceding 90 days. The pilot must fly 3 more qualifying landings before carrying passengers at night.'),
('PPL-M04-Q24', 'PPL', 'PPL-M04', 24, 'scenario', 'A VFR aircraft''s transponder check expired 3 months ago, but the pilot only flies in airspace where a transponder isn''t required. Is the flight legal?',
  null, null,
  'Generally yes for that specific flight, since the transponder isn''t required equipment for that operation — but the transponder itself may not legally be used until retested, and equipment must be placarded/deactivated if inoperative-equipment rules apply.'),
('PPL-M04-Q25', 'PPL', 'PPL-M04', 25, 'scenario', 'An engine begins running rough in flight and the nearest suitable airport is inside Class B airspace with no time to get a clearance. What authority allows the pilot to enter without clearance, and what limits that authority?',
  null, null,
  '§ 91.3(b) emergency authority — the PIC may deviate from any rule to the extent required to meet the emergency. It''s limited to what''s actually required to resolve the emergency, and a written report may be requested by the FAA.'),
('PPL-M04-Q26', 'PPL', 'PPL-M04', 26, 'scenario', 'A landing light is inoperative before a planned day VFR flight. There''s no MEL, no AD against it, and the POH doesn''t require it. Is the aircraft legal to fly, and what''s the logic?',
  null, null,
  'Yes, once the item is determined not to be required by 91.205/KOEL/ADs for this operation and is removed or deactivated and placarded ''inoperative'' (per 91.213(d)) — a landing light generally isn''t required equipment for day VFR.'),
('PPL-M04-Q27', 'PPL', 'PPL-M04', 27, 'short_answer', 'What is the difference between currency and proficiency?',
  null, null,
  'Currency is the legal minimum to act as PIC or carry passengers; proficiency is a pilot''s actual, honest skill level. A pilot can be legally current while not being genuinely safe/proficient for a given flight.'),
('PPL-M04-Q28', 'PPL', 'PPL-M04', 28, 'short_answer', 'What does the PIC''s emergency authority under § 91.3(b) actually allow, and what limits it?',
  null, null,
  'It allows deviation from any rule in Part 91 to the extent required to meet an in-flight emergency requiring immediate action. It is limited to what''s actually necessary to resolve the emergency, and the FAA may require a written report.'),
('PPL-M04-Q29', 'PPL', 'PPL-M04', 29, 'short_answer', 'Explain the difference between a Service Bulletin and an Airworthiness Directive.',
  null, null,
  'A Service Bulletin is manufacturer-issued guidance that is generally not legally mandatory unless referenced by an AD. An Airworthiness Directive is FAA-issued and legally mandatory, tied to a specific identified safety issue.'),
('PPL-M04-Q30', 'PPL', 'PPL-M04', 30, 'short_answer', 'Give an example of something that is legal but not necessarily safe, and explain why the distinction matters.',
  null, null,
  'Answers will vary (e.g., flying at the 24-month flight-review limit with no recent practice, or flying with a bare legal fuel reserve into deteriorating weather). The core point: legal is a floor set by regulation; safe accounts for real conditions, proficiency, and margin.');
