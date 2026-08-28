-- Apex Advantage — Module Workbook content: Module 6 (Airport Operations) (v92)
--
-- Same schema as v88-v91. No new tables or application code.
--
-- Note: Module 5 (Airspace Mastery) was not provided in this batch --
-- PPL-M05 has no module_companion_content row yet, so its Module
-- Workbook page still falls back to the existing lighter
-- GUIDED_NOTES_MODULES prompt list, same as every other not-yet-authored
-- module.
--
-- This package's own Section 12 (Student Workbook Contents) doesn't
-- reproduce fill-in-the-blank guided-notes text (it just references
-- "24 marking/sign/lighting cards" worked live in class) -- the
-- guidedNotes below are carried over from GUIDED_NOTES_MODULES' existing
-- PPL-M06 placeholder (site/portal-stable.js), checked against this
-- module's real content and found to already group the material
-- accurately at a level that fits a text-based guided-notes UI (naming
-- all 24 individual markings/signs/lights as separate prompts would be
-- disproportionate to what this page renders).
--
-- The Scenario Workshop here is six short embedded scenarios rather than
-- one flagship narrative (same shape as Module 4) -- each scenario's
-- setup is folded into its own self-contained prompt, left open (no
-- revealed determination), since the Knowledge Check bank below
-- independently covers all six with real answers (Q21-26) -- consistent
-- with how Modules 4 and later handle this same pattern.
--
-- No Apex Challenge or Post-Class Email exist for this module -- both
-- flagged as such in the source, so neither is fabricated here.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v91.

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M06',
  '{
    "modulePurpose": "Teach students to think ahead of the airplane at any airport — recognizing markings, signs, and lighting instantly, and knowing exactly what action each one requires.",
    "objectives": [
      { "id": "obj-components", "label": "Explain airport components." },
      { "id": "obj-markings-signs", "label": "Identify airport markings and signs." },
      { "id": "obj-lighting", "label": "Interpret airport lighting systems." },
      { "id": "obj-towered", "label": "Operate safely at towered airports." },
      { "id": "obj-nontowered", "label": "Operate safely at non-towered airports." },
      { "id": "obj-phraseology", "label": "Use proper radio phraseology." },
      { "id": "obj-diagrams", "label": "Interpret airport diagrams." },
      { "id": "obj-incursions", "label": "Avoid runway incursions." }
    ],
    "guidedNotes": [
      { "id": "runway-markings-signs", "section": "Runway Markings & Signage", "prompt": "What do hold-short lines, an enhanced taxiway centerline, a displaced threshold, and a closed-runway X each tell you, and what''s your required action at each?" },
      { "id": "traffic-pattern", "section": "Traffic Pattern", "prompt": "What is a standard traffic pattern entry at a non-towered airport, and what are the five legs in order?" },
      { "id": "communication-procedures", "section": "Communication Procedures", "prompt": "What is the Ground/Tower communication sequence at a towered airport, and how does that compare to the CTAF self-announce sequence at a non-towered field?" },
      { "id": "runway-incursion", "section": "Runway Incursion Avoidance", "prompt": "What is a runway incursion, what usually causes one, and why does read-back discipline matter when you''re instructed to hold short?" },
      { "id": "lighting-systems", "section": "Lighting Systems", "prompt": "How do you interpret a PAPI or VASI on approach, and how does pilot-controlled lighting (PCL) work at an airport without a tower?" },
      { "id": "wake-turbulence", "section": "Position and Hold / Progressive Taxi", "prompt": "What does \"taxi into position and hold\" authorize and not authorize, and when should a pilot request progressive taxi?" }
    ],
    "scenario": {
      "narrative": "Six short scenarios testing whether you can apply tonight''s airport-operations knowledge under real conditions, not just recite it.",
      "prompts": [
        { "id": "scenario-1-taxi-clearance", "prompt": "Scenario 1 — The Taxi Clearance: You are taxiing at a Class D airport. Ground says: \"Cessna 123AB, taxi to Runway 22 via Alpha, Bravo, hold short Runway 18.\" Draw the route, determine the required readback, and explain the hold-short requirement." },
        { "id": "scenario-2-busy-nontowered", "prompt": "Scenario 2 — A Busy Non-Towered Pattern: You arrive at a non-towered airport with multiple aircraft making position reports at once. How do you determine pattern entry, your radio calls, and your conflict-avoidance strategy?" },
        { "id": "scenario-3-runway-crossing", "prompt": "Scenario 3 — Runway Crossing Conflict: You are cleared to cross Runway 15. A departing aircraft begins moving unexpectedly. What is your very first action? Do you continue the crossing or stop where you are, and why? What do you say to ATC, and how quickly?" },
        { "id": "scenario-4-enhanced-centerlines", "prompt": "Scenario 4 — Enhanced Taxiway Centerlines: You are approaching a runway and notice enhanced taxiway centerlines. What information are they providing?" },
        { "id": "scenario-5-radio-failure", "prompt": "Scenario 5 — Radio Failure While Taxiing: Radio failure occurs while taxiing at a towered airport. How should you respond?" },
        { "id": "scenario-6-position-hold", "prompt": "Scenario 6 — Position and Hold: Tower instructs, \"Taxi into position and hold.\" Explain the meaning, the current phraseology update, and the required action." }
      ]
    },
    "checkrideCorner": [
      { "id": "cc-1", "question": "What are the four main components of an airport, and what does each provide?" },
      { "id": "cc-2", "question": "How is a runway numbered, and why?" },
      { "id": "cc-3", "question": "What''s the difference between a displaced threshold and a closed runway marking?" },
      { "id": "cc-4", "question": "What''s the difference between a taxiway centerline and an enhanced taxiway centerline?" },
      { "id": "cc-5", "question": "Walk me through the four sign families and what each background color means." },
      { "id": "cc-6", "question": "What does a runway distance remaining sign tell you, and when would you use it?" },
      { "id": "cc-7", "question": "Explain the difference between PAPI and VASI." },
      { "id": "cc-8", "question": "How does pilot-controlled lighting work, and why does it exist?" },
      { "id": "cc-9", "question": "What is CTAF, and what are the standard position reports at a non-towered airport?" },
      { "id": "cc-10", "question": "Describe a standard traffic pattern entry and all five legs." },
      { "id": "cc-11", "question": "What''s the difference between Ground Control and Tower Control?" },
      { "id": "cc-12", "question": "What must always be read back to ATC, and why does that matter?" },
      { "id": "cc-13", "question": "What is progressive taxi, and when should a pilot request it?" },
      { "id": "cc-14", "question": "What is a runway incursion, and what usually causes one?" },
      { "id": "cc-15", "question": "Explain sterile cockpit procedures and how they apply during taxi." },
      { "id": "cc-16", "question": "What is a hot spot, and where would you find one listed?" },
      { "id": "cc-17", "question": "You''re cleared to cross a runway and see another aircraft begin moving. What do you do?" },
      { "id": "cc-18", "question": "Explain ''taxi into position and hold'' and what it does and doesn''t authorize." },
      { "id": "cc-19", "question": "Your radio fails while taxiing at a towered field. Walk me through your response." },
      { "id": "cc-20", "question": "Why does Apex teach signs and markings by ''what to do,'' not just ''what it looks like''?" }
    ]
  }'::jsonb
)
on conflict (course_id, module_id) do update set content = excluded.content, updated_at = now();

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M06-Q01', 'PPL', 'PPL-M06', 1, 'multiple_choice', 'A runway numbered 22 corresponds to a magnetic heading closest to:',
  '[{"key":"A","label":"022°"},{"key":"B","label":"220°"},{"key":"C","label":"22°"},{"key":"D","label":"202°"}]'::jsonb, 'B',
  'Runway numbers are rounded to the nearest 10 degrees of magnetic heading, so Runway 22 is oriented roughly 220° magnetic.'),
('PPL-M06-Q02', 'PPL', 'PPL-M06', 2, 'multiple_choice', 'What does a displaced threshold arrow bar indicate?',
  '[{"key":"A","label":"Runway is closed"},{"key":"B","label":"Landing may not occur before the bar, but the area may be usable for takeoff/taxi"},{"key":"C","label":"No taxiing permitted"},{"key":"D","label":"Runway is one-way only"}]'::jsonb, 'B',
  'A displaced threshold means landing can''t occur before the bar, but the pavement may still be usable for takeoff or taxi.'),
('PPL-M06-Q03', 'PPL', 'PPL-M06', 3, 'multiple_choice', 'A large yellow X on a runway means:',
  '[{"key":"A","label":"Displaced threshold"},{"key":"B","label":"Closed runway, unsafe/unauthorized"},{"key":"C","label":"Taxiway crossing"},{"key":"D","label":"Aim point marking"}]'::jsonb, 'B',
  'A yellow X marks a closed runway that is entirely unsafe or unauthorized for use.'),
('PPL-M06-Q04', 'PPL', 'PPL-M06', 4, 'scenario', 'A dashed yellow line runs alongside a continuous yellow line at a taxiway edge. What does this indicate?',
  null, null,
  'The continuous line marks a defined taxiway edge (do not cross); the dashed line marks shared pavement whose surface continues but may serve another purpose.'),
('PPL-M06-Q05', 'PPL', 'PPL-M06', 5, 'multiple_choice', 'What do two solid and two dashed yellow lines perpendicular to a taxiway indicate?',
  '[{"key":"A","label":"Taxiway centerline"},{"key":"B","label":"Hold short line"},{"key":"C","label":"Displaced threshold"},{"key":"D","label":"Apron boundary"}]'::jsonb, 'B',
  'That marking is a runway hold short line.'),
('PPL-M06-Q06', 'PPL', 'PPL-M06', 6, 'scenario', 'A red background sign with white inscription is a: identify the sign family and required action.',
  null, null,
  'A Mandatory Instruction Sign — marks a location that must not be crossed without specific ATC clearance.'),
('PPL-M06-Q07', 'PPL', 'PPL-M06', 7, 'scenario', 'A black background sign with yellow inscription and no arrow is a: identify the sign family and its purpose.',
  null, null,
  'A Location Sign — confirms the pilot''s current taxiway or runway position.'),
('PPL-M06-Q08', 'PPL', 'PPL-M06', 8, 'scenario', 'A yellow background sign with black inscription and an arrow pointing toward a runway is a: identify the sign family.',
  null, null,
  'A Direction Sign — shows an intersecting taxiway designation ahead.'),
('PPL-M06-Q09', 'PPL', 'PPL-M06', 9, 'multiple_choice', 'What does a runway distance remaining sign display?',
  '[{"key":"A","label":"Runway width"},{"key":"B","label":"Distance remaining in thousands of feet"},{"key":"C","label":"Wind direction"},{"key":"D","label":"Elevation"}]'::jsonb, 'B',
  'Runway distance remaining signs show distance remaining in thousands of feet, useful for judging stopping performance.'),
('PPL-M06-Q10', 'PPL', 'PPL-M06', 10, 'multiple_choice', 'On a PAPI, seeing 2 white and 2 red lights means:',
  '[{"key":"A","label":"Too high"},{"key":"B","label":"Too low"},{"key":"C","label":"On glidepath"},{"key":"D","label":"System malfunction"}]'::jsonb, 'C',
  '2 white and 2 red on a PAPI indicates the aircraft is on glidepath.'),
('PPL-M06-Q11', 'PPL', 'PPL-M06', 11, 'multiple_choice', 'On a VASI, all white lights indicate:',
  '[{"key":"A","label":"On glidepath"},{"key":"B","label":"Too high"},{"key":"C","label":"Too low"},{"key":"D","label":"System is off"}]'::jsonb, 'B',
  'All white on a VASI indicates the aircraft is too high.'),
('PPL-M06-Q12', 'PPL', 'PPL-M06', 12, 'multiple_choice', 'How is pilot-controlled lighting typically activated?',
  '[{"key":"A","label":"A phone call to the FBO"},{"key":"B","label":"Clicking the mic a specific number of times on the correct frequency"},{"key":"C","label":"It''s always on"},{"key":"D","label":"A key code entered in the aircraft"}]'::jsonb, 'B',
  'Pilot-controlled lighting is activated by clicking the mic a specific number of times (commonly 7) on the correct CTAF frequency.'),
('PPL-M06-Q13', 'PPL', 'PPL-M06', 13, 'multiple_choice', 'What frequency do pilots use to self-announce at a non-towered airport?',
  '[{"key":"A","label":"Ground control"},{"key":"B","label":"CTAF"},{"key":"C","label":"Clearance delivery"},{"key":"D","label":"ATIS"}]'::jsonb, 'B',
  'CTAF (Common Traffic Advisory Frequency) is the shared self-announce frequency at a non-towered airport.'),
('PPL-M06-Q14', 'PPL', 'PPL-M06', 14, 'multiple_choice', 'The standard recommended pattern entry is:',
  '[{"key":"A","label":"Straight-in from 10 miles"},{"key":"B","label":"Overhead break"},{"key":"C","label":"45° to the downwind leg at pattern altitude"},{"key":"D","label":"Direct base entry"}]'::jsonb, 'C',
  'Standard entry is 45° to the downwind leg at pattern altitude.'),
('PPL-M06-Q15', 'PPL', 'PPL-M06', 15, 'multiple_choice', 'At a towered airport, who manages aircraft on active runways?',
  '[{"key":"A","label":"Ground Control"},{"key":"B","label":"Tower Control"},{"key":"C","label":"Clearance Delivery"},{"key":"D","label":"CTAF"}]'::jsonb, 'B',
  'Tower Control manages active runways and the immediate airport traffic area.'),
('PPL-M06-Q16', 'PPL', 'PPL-M06', 16, 'multiple_choice', 'What must always be read back to ATC?',
  '[{"key":"A","label":"Only altitude assignments"},{"key":"B","label":"Runway assignments, hold short instructions, and taxi/runway clearances"},{"key":"C","label":"Only frequency changes"},{"key":"D","label":"Nothing, ATC assumes compliance"}]'::jsonb, 'B',
  'Runway assignments, hold short instructions, and taxi/runway clearances must always be read back, with your call sign.'),
('PPL-M06-Q17', 'PPL', 'PPL-M06', 17, 'multiple_choice', 'Requesting progressive taxi means:',
  '[{"key":"A","label":"Requesting priority handling"},{"key":"B","label":"Requesting step-by-step taxi guidance"},{"key":"C","label":"Requesting a different runway"},{"key":"D","label":"Declining a taxi clearance"}]'::jsonb, 'B',
  'Progressive taxi is a request for step-by-step taxi guidance, available at any towered airport, any time.'),
('PPL-M06-Q18', 'PPL', 'PPL-M06', 18, 'multiple_choice', 'A runway incursion is best defined as:',
  '[{"key":"A","label":"Any radio miscommunication"},{"key":"B","label":"Any unauthorized presence of an aircraft, vehicle, or person on a runway''s protected area"},{"key":"C","label":"A rejected takeoff"},{"key":"D","label":"A go-around"}]'::jsonb, 'B',
  'A runway incursion is any unauthorized presence of an aircraft, vehicle, or person on a runway''s protected area.'),
('PPL-M06-Q19', 'PPL', 'PPL-M06', 19, 'multiple_choice', 'Sterile cockpit procedures during taxi mean:',
  '[{"key":"A","label":"No checklist use"},{"key":"B","label":"No non-essential conversation during this critical phase"},{"key":"C","label":"No radio calls allowed"},{"key":"D","label":"No passengers permitted"}]'::jsonb, 'B',
  'Sterile cockpit means no non-essential conversation or distraction during critical phases of flight, including taxi.'),
('PPL-M06-Q20', 'PPL', 'PPL-M06', 20, 'multiple_choice', 'An airport hot spot is best described as:',
  '[{"key":"A","label":"A restricted area"},{"key":"B","label":"A charted location with a history of confusion or incursion risk"},{"key":"C","label":"A fuel truck parking area"},{"key":"D","label":"A preferred taxi route"}]'::jsonb, 'B',
  'A hot spot is a charted location on the airport diagram with a history of confusion or incursion risk.'),
('PPL-M06-Q21', 'PPL', 'PPL-M06', 21, 'scenario', 'Ground says: "Cessna 123AB, taxi to Runway 22 via Alpha, Bravo, hold short Runway 18." What is the required readback, and why is the hold short instruction critical?',
  null, null,
  'Readback: "Taxi to Runway 22 via Alpha, Bravo, hold short Runway 18, Cessna 123AB." The hold short instruction is critical because Runway 18 is an active runway crossed by the route — the aircraft may not cross without an explicit ATC crossing clearance.'),
('PPL-M06-Q22', 'PPL', 'PPL-M06', 22, 'scenario', 'You arrive at a non-towered airport with multiple aircraft making position reports at once. What''s your approach to entering the pattern safely?',
  null, null,
  'Listen first to build a mental picture of traffic before committing to an entry. Announce your own position and intentions clearly, and be prepared to adjust (extend, go around) if a conflict develops — radio calls alone never guarantee separation.'),
('PPL-M06-Q23', 'PPL', 'PPL-M06', 23, 'scenario', 'You are cleared to cross Runway 15. A departing aircraft on that runway begins moving unexpectedly. What should you do?',
  null, null,
  'Stop immediately if not already committed past a safe point, and notify ATC right away. Do not assume the departing aircraft sees you — prioritize stopping clear of the runway over completing the crossing.'),
('PPL-M06-Q24', 'PPL', 'PPL-M06', 24, 'scenario', 'You notice enhanced taxiway centerlines as you approach a runway. What information are they providing?',
  null, null,
  'They provide an extra visual cue that a runway hold short line is approaching, prompting the pilot to slow down, verify their clearance status, and prepare to stop if not authorized to cross or enter.'),
('PPL-M06-Q25', 'PPL', 'PPL-M06', 25, 'scenario', 'Your radio fails while taxiing at a towered airport. How should you respond?',
  null, null,
  'Try basic troubleshooting first (volume, frequency, connections). Watch for ATC light-gun signals or a marshaller/follow-me vehicle, and proceed cautiously per your last clearance only if it remains safe and unambiguous.'),
('PPL-M06-Q26', 'PPL', 'PPL-M06', 26, 'scenario', 'Tower instructs: "Taxi into position and hold." Explain what this means and what action is required.',
  null, null,
  'The aircraft should taxi onto the assigned runway and stop — it is NOT a takeoff clearance. The pilot holds in position on the runway centerline until a further explicit takeoff clearance is issued.'),
('PPL-M06-Q27', 'PPL', 'PPL-M06', 27, 'short_answer', 'Explain the difference between a Mandatory Instruction Sign and a Location Sign.',
  null, null,
  'A Mandatory Instruction Sign (red background, white inscription) marks a point that must not be crossed without ATC clearance. A Location Sign (black background, yellow inscription, no border) simply confirms the pilot''s current position and requires no specific action beyond situational awareness.'),
('PPL-M06-Q28', 'PPL', 'PPL-M06', 28, 'short_answer', 'Why does Apex teach airport markings using a ''what to do'' framework instead of memorization alone?',
  null, null,
  'Because recognizing a marking is only useful if the pilot also knows the required action — a DPE tests application, not recitation, and real-time airport operations require an immediate decision, not just identification.'),
('PPL-M06-Q29', 'PPL', 'PPL-M06', 29, 'short_answer', 'What is the difference between Ground Control and Tower Control?',
  null, null,
  'Ground Control manages taxiing aircraft and vehicles on the movement area excluding active runways. Tower Control manages aircraft on active runways and in the immediate airport traffic area; a runway crossing always requires Tower, even if Ground issued the taxi route.'),
('PPL-M06-Q30', 'PPL', 'PPL-M06', 30, 'short_answer', 'Give an example of a situation where ''if you are unsure, stop and ask'' is the correct response, and explain why guessing is the wrong choice.',
  null, null,
  'Answers will vary (e.g., an ambiguous taxi clearance, an unclear hold short instruction, uncertainty about current position on an unfamiliar airport). Guessing risks a runway incursion; asking costs a few seconds and resolves the ambiguity with certainty.');
