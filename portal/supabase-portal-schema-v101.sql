-- Apex Advantage — Module 9 (Navigation Systems) companion content (v101)
--
-- Ships real, authored Module Companion content + a 30-question scored
-- assessment for PPL-M09, sourced from the real Apex Advantage Module 9
-- Production Package (Navigation Systems) -- same schema/shape as
-- PPL-M01..M04/M06..M08 (supabase-portal-schema-v88.sql through v94.sql).
--
-- The production package is written for the LIVE instructor-led class
-- (87-slide deck, timing notes, instructor prep, per-slide script) --
-- only the subset that belongs in the async student companion workbook
-- is imported here: module purpose, the 12 learning objectives, guided-
-- notes prompts (one per major topic), the six-scenario Scenario
-- Workshop (condensed into single write-in prompts, matching the
-- existing modules' pattern), the 20-question Checkride Corner bank
-- (question text only -- this workbook is a write-your-own-answer/
-- self-rate tool, not a reveal-the-answer one, same as every other
-- module), and a new Apex Challenge section (this module's real
-- assignment: a two-VOR/one-GPS cross-country plan) -- the first module
-- to populate that optional field, since it's the first of M01-M09 whose
-- source material actually described a standalone assignment.
--
-- Also corrects site/portal-stable.js's GUIDED_NOTES_MODULES fallback
-- prompts for PPL-M09: the prompts already live there (VOR accuracy
-- checks, autopilot modes) describe a different curriculum framing than
-- this real production package (no autopilot content at all; built
-- instead around the Apex Navigation Pyramid, ADS-B, and RAIM) -- a
-- pre-existing mismatch, fixed in the same application-code change that
-- introduces this content, same precedent as v88's own PPL-M01 module_id
-- fix.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v100.

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M09',
  '{
    "modulePurpose": "Teach students to operate VOR, DME, GPS, WAAS, and ADS-B confidently and correctly, while building the layered redundancy and cross-checking discipline to remain fully capable if any single system fails.",
    "objectives": [
      {"id": "obj-vor-operation", "label": "Explain VOR operation."},
      {"id": "obj-vor-indications", "label": "Interpret VOR indications."},
      {"id": "obj-vor-service-volumes", "label": "Identify VOR service volumes."},
      {"id": "obj-vor-position", "label": "Determine aircraft position using VORs."},
      {"id": "obj-dme", "label": "Explain DME."},
      {"id": "obj-gps-fundamentals", "label": "Explain GPS fundamentals."},
      {"id": "obj-waas", "label": "Explain WAAS."},
      {"id": "obj-adsb", "label": "Explain ADS-B navigation capabilities."},
      {"id": "obj-compare-systems", "label": "Compare navigation systems."},
      {"id": "obj-system-limitations", "label": "Identify navigation system limitations."},
      {"id": "obj-redundancy", "label": "Build navigation redundancy."},
      {"id": "obj-defend-checkride", "label": "Defend navigation decisions during a checkride."}
    ],
    "guidedNotes": [
      {"id": "apex-navigation-pyramid", "section": "The Apex Navigation Pyramid", "prompt": "What are the four levels of the Apex Navigation Pyramid, from base to apex, and why does the order matter -- what''s the real goal of understanding it?"},
      {"id": "vor-fundamentals", "section": "VOR Fundamentals", "prompt": "What is a radial, how is it measured, and what''s the difference between what TO and FROM actually tell you about your position relative to the station?"},
      {"id": "obs-cdi-tracking", "section": "Using the OBS and Tracking a Course", "prompt": "What does the OBS actually do (and not do), and how do you track a VOR course using small, continuous corrections?"},
      {"id": "vor-limitations", "section": "VOR Limitations & Service Volumes", "prompt": "Why can a fully functional VOR station still be unreceivable, and what does a published service volume actually guarantee?"},
      {"id": "dme-fundamentals", "section": "DME Fundamentals", "prompt": "What does DME actually measure, and when is slant-range error the largest?"},
      {"id": "gps-waas", "section": "GPS & WAAS", "prompt": "How does GPS determine your position conceptually, and what does WAAS specifically improve?"},
      {"id": "gps-limitations-raim", "section": "GPS Limitations & RAIM", "prompt": "What is RAIM, what should you do if you get a RAIM warning, and what''s the single most common cause of GPS-related navigation errors?"},
      {"id": "adsb-redundancy", "section": "ADS-B & Navigation Redundancy", "prompt": "Why is ADS-B not considered a primary navigation source, and what should a complete navigation redundancy plan include before departure?"}
    ],
    "scenario": {
      "narrative": "Six scenarios testing whether you can drop to the next layer of the Apex Navigation Pyramid under real conditions -- not just recite it.",
      "prompts": [
        {"id": "scenario-1-failed-gps", "prompt": "Scenario 1 -- The Failed GPS: GPS suddenly fails, mid-flight. How do you continue the flight? Which layer of the Pyramid do you drop to first, and what''s your very next action?"},
        {"id": "scenario-2-confused-vor", "prompt": "Scenario 2 -- The Confused VOR: The CDI indicates something unexpected given your assumed position. What happened -- is this equipment or interpretation, and how do you confirm which?"},
        {"id": "scenario-3-reverse-sensing", "prompt": "Scenario 3 -- The Reverse Sensing Trap: A student follows an incorrect indication because the OBS is set to the reciprocal course. Identify the error, and explain how you''d catch this before it became a real problem."},
        {"id": "scenario-4-mountain-shadow", "prompt": "Scenario 4 -- The Mountain Shadow: VOR reception disappears entirely, with no equipment malfunction indicated. Why did this happen, what should you have anticipated, and what''s your immediate fallback?"},
        {"id": "scenario-5-overconfident-pilot", "prompt": "Scenario 5 -- The Overconfident Pilot: A pilot brought only an iPad for navigation, and its battery dies in flight. Now what -- and what should the redundancy plan have included?"},
        {"id": "scenario-6-dpe-navigation-review", "prompt": "Scenario 6 -- The DPE Navigation Review: An examiner points at a VOR and asks you to explain position, radial, course, and plan -- cold. Walk through exactly what you''d say."}
      ]
    },
    "checkrideCorner": [
      {"id": "cc-1", "question": "What is a radial, and how is it measured?"},
      {"id": "cc-2", "question": "Explain the difference between TO and FROM."},
      {"id": "cc-3", "question": "What does the OBS actually do?"},
      {"id": "cc-4", "question": "How do you track a VOR course once established?"},
      {"id": "cc-5", "question": "What is reverse sensing, and how do you avoid it?"},
      {"id": "cc-6", "question": "What is a VOR service volume, and why does it matter?"},
      {"id": "cc-7", "question": "Why can a fully functional VOR station still be unreceivable?"},
      {"id": "cc-8", "question": "What does DME actually measure?"},
      {"id": "cc-9", "question": "Explain slant-range error and when it matters most."},
      {"id": "cc-10", "question": "How does GPS determine your position, conceptually?"},
      {"id": "cc-11", "question": "What is WAAS, and what does it improve?"},
      {"id": "cc-12", "question": "What is RAIM, and what should you do if you get a RAIM warning?"},
      {"id": "cc-13", "question": "What are the most common causes of GPS-related navigation errors?"},
      {"id": "cc-14", "question": "What''s the difference between ADS-B In and ADS-B Out?"},
      {"id": "cc-15", "question": "Why is ADS-B not considered a primary navigation source?"},
      {"id": "cc-16", "question": "What is the Apex Navigation Pyramid, and why does layer order matter?"},
      {"id": "cc-17", "question": "Your GPS fails, then your VOR reception disappears too. Walk me through your plan."},
      {"id": "cc-18", "question": "Which navigation system would you trust most, and why?"},
      {"id": "cc-19", "question": "How do you build navigation redundancy into a single cross-country flight?"},
      {"id": "cc-20", "question": "Why does Apex say the pilot is usually the weakest link in the navigation system?"}
    ],
    "apexChallenge": {
      "instructions": "Plan a complete cross-country leg using two VOR fixes and one GPS-based route, with three identified checkpoints and a full navigation backup plan. Check with your instructor for this cohort''s due date.",
      "fields": [
        {"id": "ac-vor-1", "label": "First VOR fix (station, radial, and how you determined position)", "type": "textarea"},
        {"id": "ac-vor-2", "label": "Second VOR fix (station, radial, and how you determined position)", "type": "textarea"},
        {"id": "ac-gps-route", "label": "GPS-based route (waypoints and legs)", "type": "textarea"},
        {"id": "ac-checkpoints", "label": "Three checkpoints along the route (expected time and fuel remaining at each)", "type": "textarea"},
        {"id": "ac-backup-plan", "label": "Complete navigation backup plan if your primary system fails", "type": "textarea"}
      ]
    }
  }'::jsonb
);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M09-Q01', 'PPL', 'PPL-M09', 1, 'multiple_choice', 'VOR stands for:', '[{"key":"A","label":"Very Odd Radial"},{"key":"B","label":"VHF Omnidirectional Range"},{"key":"C","label":"Vertical Orientation Reading"},{"key":"D","label":"Visual Omni Reference"}]', 'B', 'VOR is VHF Omnidirectional Range -- a ground station broadcasting usable signal in every direction.'),
('PPL-M09-Q02', 'PPL', 'PPL-M09', 2, 'multiple_choice', 'A radial is:', '[{"key":"A","label":"A heading you fly"},{"key":"B","label":"A magnetic course measured FROM the VOR station"},{"key":"C","label":"A distance measurement"},{"key":"D","label":"A frequency"}]', 'B', 'A radial is a magnetic course measured outward FROM a VOR station, like a spoke on a wheel -- it describes position relative to the station, not a heading to fly.'),
('PPL-M09-Q03', 'PPL', 'PPL-M09', 3, 'multiple_choice', 'A TO indication means:', '[{"key":"A","label":"You are at the station"},{"key":"B","label":"The selected course will take you toward the station"},{"key":"C","label":"The station is out of range"},{"key":"D","label":"You are on the reciprocal radial"}]', 'B', 'TO means the selected course will take you toward the station -- it describes the relationship between the selected course and the station, not your actual direction of flight.'),
('PPL-M09-Q04', 'PPL', 'PPL-M09', 4, 'multiple_choice', 'A FROM indication means:', '[{"key":"A","label":"The selected course would take you away from the station"},{"key":"B","label":"The equipment has failed"},{"key":"C","label":"You must climb"},{"key":"D","label":"You are directly over the station"}]', 'A', 'FROM means the selected course would take you away from the station.'),
('PPL-M09-Q05', 'PPL', 'PPL-M09', 5, 'multiple_choice', 'The OBS is used to:', '[{"key":"A","label":"Change your actual position"},{"key":"B","label":"Dial in a course to test against the needle and flag"},{"key":"C","label":"Tune the frequency"},{"key":"D","label":"Identify the station by Morse code"}]', 'B', 'The OBS lets a pilot dial in and test any course against the needle and flag -- rotating it doesn''t change the aircraft''s actual position, only which course is being evaluated.'),
('PPL-M09-Q06', 'PPL', 'PPL-M09', 6, 'multiple_choice', 'A deflected CDI needle indicates:', '[{"key":"A","label":"Equipment failure"},{"key":"B","label":"How far off the selected course you currently are"},{"key":"C","label":"Distance to the station"},{"key":"D","label":"Station outage"}]', 'B', 'A deflected CDI needle is quantified information about how far off course you are -- turn toward the needle to intercept.'),
('PPL-M09-Q07', 'PPL', 'PPL-M09', 7, 'scenario', 'The needle has been steadily drifting left for two minutes while tracking a course. What does this mean, and what do you do? Explain your reasoning.', null, null, 'Wind is pushing you off course; turn left (toward the needle) to intercept, using a correction greater than your original estimate, then reduce once re-centered.'),
('PPL-M09-Q08', 'PPL', 'PPL-M09', 8, 'multiple_choice', 'VOR signal reception is best described as:', '[{"key":"A","label":"Unlimited range regardless of terrain"},{"key":"B","label":"Line-of-sight, affected by distance, altitude, and terrain"},{"key":"C","label":"Only usable within 5 NM"},{"key":"D","label":"Unaffected by altitude"}]', 'B', 'VOR signal is line-of-sight, behaving similarly to visible light -- terrain, distance, and altitude all affect reception.'),
('PPL-M09-Q09', 'PPL', 'PPL-M09', 9, 'multiple_choice', 'A VOR station can be fully functional and still be unreceivable because of:', '[{"key":"A","label":"Magnetic variation"},{"key":"B","label":"Terrain blocking line-of-sight signal"},{"key":"C","label":"GPS interference"},{"key":"D","label":"Daylight savings time"}]', 'B', 'Terrain can block or degrade line-of-sight VOR signal at a specific aircraft position even when the station itself operates normally.'),
('PPL-M09-Q10', 'PPL', 'PPL-M09', 10, 'multiple_choice', 'DME measures:', '[{"key":"A","label":"Ground distance only"},{"key":"B","label":"Slant range -- straight-line distance to the station"},{"key":"C","label":"Magnetic bearing"},{"key":"D","label":"Altitude"}]', 'B', 'DME measures slant range -- the straight-line distance to the station -- not ground distance directly.'),
('PPL-M09-Q11', 'PPL', 'PPL-M09', 11, 'multiple_choice', 'Slant-range error is most significant when:', '[{"key":"A","label":"Far from the station"},{"key":"B","label":"Close to the station and at altitude"},{"key":"C","label":"At the same altitude as the station"},{"key":"D","label":"It is never significant"}]', 'B', 'Slant-range error is largest close to and/or well above the station, and becomes negligible at greater distances.'),
('PPL-M09-Q12', 'PPL', 'PPL-M09', 12, 'multiple_choice', 'GPS position is determined by:', '[{"key":"A","label":"A single satellite signal"},{"key":"B","label":"Comparing timed signals from multiple satellites simultaneously"},{"key":"C","label":"Ground radar only"},{"key":"D","label":"Magnetic compass correction"}]', 'B', 'GPS calculates position by comparing precisely timed signals received from multiple satellites simultaneously.'),
('PPL-M09-Q13', 'PPL', 'PPL-M09', 13, 'multiple_choice', 'WAAS improves GPS accuracy by:', '[{"key":"A","label":"Adding more satellites to orbit"},{"key":"B","label":"Using ground reference stations to correct signal errors in real time"},{"key":"C","label":"Increasing broadcast power"},{"key":"D","label":"Eliminating the need for a database"}]', 'B', 'WAAS uses ground reference stations to correct GPS errors in real time, improving both horizontal and vertical accuracy.'),
('PPL-M09-Q14', 'PPL', 'PPL-M09', 14, 'multiple_choice', 'RAIM stands for:', '[{"key":"A","label":"Radio Antenna Interference Monitor"},{"key":"B","label":"Receiver Autonomous Integrity Monitoring"},{"key":"C","label":"Radial Angle Indication Method"},{"key":"D","label":"Range and Altitude Integrity Measure"}]', 'B', 'RAIM is Receiver Autonomous Integrity Monitoring -- the GPS system''s internal self-check on its own accuracy.'),
('PPL-M09-Q15', 'PPL', 'PPL-M09', 15, 'multiple_choice', 'A RAIM warning should be treated as:', '[{"key":"A","label":"A minor cosmetic alert"},{"key":"B","label":"An instruction to immediately cross-check with another navigation source"},{"key":"C","label":"A sign to shut off the GPS entirely"},{"key":"D","label":"Irrelevant if the display still shows a position"}]', 'B', 'A RAIM warning should trigger an immediate cross-check with another navigation source.'),
('PPL-M09-Q16', 'PPL', 'PPL-M09', 16, 'multiple_choice', 'The most common source of GPS-related navigation error is:', '[{"key":"A","label":"Satellite malfunction"},{"key":"B","label":"The pilot -- data entry, misreading, or overreliance"},{"key":"C","label":"Government signal shutdown"},{"key":"D","label":"Weather interference"}]', 'B', 'Pilot data entry mistakes, misread displays, and overreliance are far more common than actual satellite or receiver hardware failure.'),
('PPL-M09-Q17', 'PPL', 'PPL-M09', 17, 'multiple_choice', 'ADS-B Out primarily:', '[{"key":"A","label":"Displays traffic to the pilot"},{"key":"B","label":"Broadcasts the aircraft''s position to ATC and other aircraft"},{"key":"C","label":"Provides GPS position correction"},{"key":"D","label":"Measures distance to a VOR"}]', 'B', 'ADS-B Out broadcasts the aircraft''s own position to ATC and other aircraft; ADS-B In receives traffic and weather data.'),
('PPL-M09-Q18', 'PPL', 'PPL-M09', 18, 'multiple_choice', 'ADS-B is best described as:', '[{"key":"A","label":"A primary navigation source"},{"key":"B","label":"A situational awareness tool, not a navigation source"},{"key":"C","label":"A replacement for VOR"},{"key":"D","label":"Required for all VFR flight"}]', 'B', 'ADS-B provides situational awareness (traffic, weather) rather than determining the aircraft''s own position or guiding its course.'),
('PPL-M09-Q19', 'PPL', 'PPL-M09', 19, 'multiple_choice', 'In-cockpit weather display via ADS-B should be used for:', '[{"key":"A","label":"Threading between cells at close range"},{"key":"B","label":"Strategic awareness, not tactical maneuvering"},{"key":"C","label":"Real-time storm penetration decisions"},{"key":"D","label":"Replacing a preflight weather briefing"}]', 'B', 'ADS-B weather display should be used for strategic awareness, not tactical maneuvering -- never thread cells with it.'),
('PPL-M09-Q20', 'PPL', 'PPL-M09', 20, 'scenario', 'Your GPS fails, and twenty minutes later your VOR reception also disappears. What''s your plan? Explain using the Apex Navigation Pyramid.', null, null, 'Drop to dead reckoning using your last confirmed position, time, heading, and groundspeed; confirm with pilotage against visible landmarks as soon as possible; then re-enter the Apex Navigation Loop (PLAN/FLY/VERIFY/CORRECT) from Module 8.'),
('PPL-M09-Q21', 'PPL', 'PPL-M09', 21, 'scenario', 'A student follows an incorrect VOR indication because the OBS was set to the reciprocal course. What error occurred, and how is it prevented?', null, null, 'This is reverse sensing -- following the needle in the wrong direction because the selected course is 180 degrees off the intended course. It''s prevented by cross-checking the TO/FROM flag and confirming the OBS setting matches the intended course before trusting the needle.'),
('PPL-M09-Q22', 'PPL', 'PPL-M09', 22, 'short_answer', 'Explain the Apex Navigation Pyramid and why the layer order matters.', null, null, 'The Pyramid has four levels: Pilotage (base), Dead Reckoning, Radio Navigation, and GPS (apex). The order matters because each higher layer depends on more technology and precision but is also more failure-prone; a professional pilot can drop down a layer at any point and remain fully capable of navigating.'),
('PPL-M09-Q23', 'PPL', 'PPL-M09', 23, 'short_answer', 'Why does Apex say ''the pilot is usually the weakest link in the navigation system''?', null, null, 'Because most real-world navigation errors -- data entry mistakes, misread indications, and overreliance on a single source -- originate with the pilot, not equipment failure; the equipment is rarely wrong, but pilot interpretation and habits often are.'),
('PPL-M09-Q24', 'PPL', 'PPL-M09', 24, 'short_answer', 'What''s the difference between what DME can tell you and what it cannot?', null, null, 'DME can tell you precise slant-range distance to a station. It cannot tell you ground distance directly (especially close to or above the station), and it cannot tell you bearing or direction on its own -- that requires pairing with VOR.'),
('PPL-M09-Q25', 'PPL', 'PPL-M09', 25, 'short_answer', 'Explain why a VOR station can be functioning perfectly and still be unreceivable.', null, null, 'VOR signals are line-of-sight; distance, low altitude, and terrain (mountains, ridgelines) can all block or degrade the signal at a given aircraft position, even though the station itself is broadcasting normally.'),
('PPL-M09-Q26', 'PPL', 'PPL-M09', 26, 'short_answer', 'What should a pilot do immediately upon receiving a GPS RAIM or integrity warning?', null, null, 'Cross-check position immediately using another navigation source (VOR, dead reckoning, or pilotage) rather than continuing to trust the GPS position solution, since the system itself has flagged reduced confidence in its own accuracy.'),
('PPL-M09-Q27', 'PPL', 'PPL-M09', 27, 'short_answer', 'Why is ADS-B never considered a primary navigation source, even though it displays useful position-related information?', null, null, 'Because ADS-B is built for situational awareness (traffic and weather), not for determining or guiding the aircraft''s own course -- it shows what''s around the aircraft, not where the aircraft is or where it needs to go.'),
('PPL-M09-Q28', 'PPL', 'PPL-M09', 28, 'short_answer', 'Describe a complete navigation redundancy plan for a single cross-country flight.', null, null, 'Answers will vary, but should include a primary system (typically GPS), at least one radio navigation backup (VOR/DME), pilotage checkpoints identified in advance, and a dead reckoning plan (course, heading, time, groundspeed) calculated before departure -- consistent with using every layer of the Apex Navigation Pyramid.'),
('PPL-M09-Q29', 'PPL', 'PPL-M09', 29, 'short_answer', 'A pilot brought only a single iPad for navigation and its battery died in flight. What should this pilot''s plan have included, and what''s the immediate recovery action?', null, null, 'The plan should have included a charged backup power source and at least one non-electronic backup (paper chart, VOR). The immediate recovery action is to revert to dead reckoning and pilotage using any remaining paper resources or memory of the planned route.'),
('PPL-M09-Q30', 'PPL', 'PPL-M09', 30, 'short_answer', 'Give an example of something that''s technically ''legal'' in navigation planning but not necessarily smart, and explain why.', null, null, 'Answers will vary (e.g., relying on a single GPS device with no paper backup, or flying a route with no identified VOR or visual checkpoints as backup). The core point: minimum equipment requirements don''t guarantee a safe or resilient navigation plan.');
