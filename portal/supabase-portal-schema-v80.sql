-- Checkride Readiness Assessment: question bank as a real table (v80)
--
-- V1 (v78.sql) shipped the 20 questions as a hardcoded JS array in
-- site/readiness-assessment.html -- deliberately, to keep V1 simple, per
-- the brief's own "questions can be seeded through a migration or
-- structured data file if no admin question editor exists" allowance.
-- That works fine for TAKING the assessment, but breaks down the moment
-- a member wants to review a PAST attempt: readiness_assessment_leads.
-- answers_json only stores { q: <index>, cat, correct, selected } -- the
-- actual question text/options/correct answer/explanation only ever
-- existed in that one page's inline script, unreachable from portal.html.
--
-- Moving the bank here (rather than duplicating the 20-question array a
-- second time into portal-stable.js, which would need to be hand-kept in
-- sync forever) gives both pages one shared source of truth. No RLS
-- change to readiness_assessment_leads and no answers_json format change
-- needed: display_order below is seeded to match the exact position each
-- question already held in the old JS array, so an existing attempt's
-- `q: <index>` still resolves correctly against `display_order = index`.
--
-- Same open-read shape as journey_milestone_types (v52.sql) -- a public,
-- unauthenticated visitor must be able to load these to take the free
-- assessment at all, so hiding correct_answer/explanation behind RLS
-- would only block real quiz-takers, not a curious visitor (who could
-- already read today's live version straight out of page source). No
-- security regression versus what's shipping today, just relocated.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v79.

create table public.checkride_readiness_questions (
  id                        text primary key,
  category                  text not null references public.dpe_categories(id),
  question_type             text not null check (question_type in ('knowledge', 'applied', 'scenario')),
  weight                    numeric not null,
  question_text             text not null,
  options                   jsonb not null,
  correct_answer            integer not null,
  explanation               text not null,
  recommended_review_topic  text not null,
  display_order             integer not null unique,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now()
);

alter table public.checkride_readiness_questions enable row level security;

create policy "Anyone can read active readiness questions"
  on public.checkride_readiness_questions for select
  using (is_active);

insert into public.checkride_readiness_questions
  (id, category, question_type, weight, question_text, options, correct_answer, explanation, recommended_review_topic, display_order) values

('elig-1', 'eligibility', 'knowledge', 1.0,
 'What is the minimum total flight time required for a Private Pilot certificate under 14 CFR Part 61?',
 '["20 hours", "35 hours", "40 hours", "50 hours"]', 2,
 'Part 61.109 sets a 40-hour minimum -- most students fly more before they''re ready. 20 hours of flight training and 10 hours of solo are part of that total, not on top of it.',
 'The Part 61.109 aeronautical experience requirements.', 0),

('elig-2', 'eligibility', 'applied', 1.5,
 'Which document lists the specific ACS codes you missed on your FAA Knowledge Test, and should shape your oral exam review?',
 '["Your student pilot certificate", "The Knowledge Test Report", "Your logbook endorsement page", "The IACRA confirmation email"]', 1,
 'The Knowledge Test Report maps directly to specific ACS Tasks. A DPE will often ask about any codes you missed -- have a genuine, prepared answer, not a vague one.',
 'How to read your own Knowledge Test Report and connect its codes to ACS Tasks.', 1),

('airworthy-1', 'airworthiness', 'knowledge', 1.0,
 'How often must an aircraft operated under Part 91 receive an annual inspection?',
 '["Every 6 calendar months", "Every 100 hours", "Every 12 calendar months", "Every 24 calendar months"]', 2,
 '14 CFR 91.409(a) requires an annual inspection within the preceding 12 calendar months, regardless of how many hours were flown.',
 'Required inspection intervals: annual, 100-hour, transponder/altimeter, and ELT.', 2),

('airworthy-2', 'airworthiness', 'scenario', 2.0,
 'In cruise on a humid 55°F day, flying a carbureted engine, you notice a gradual RPM decrease with no other symptom. What should you suspect first, and what''s your first action?',
 '["A failing alternator -- check the ammeter", "Carburetor icing -- apply carb heat", "Spark plug fouling -- lean the mixture", "Low oil pressure -- reduce power immediately"]', 1,
 'Carb ice can form at outside air temperatures up to around 70°F with enough humidity, since the fuel/air mixture cools sharply passing through the carburetor. A gradual, unexplained RPM loss is the classic symptom, and carb heat is the standard first response.',
 'Carburetor icing conditions and the 91.213 inoperative-equipment decision process.', 3),

('priv-1', 'privileges', 'knowledge', 1.0,
 'How often must you complete a flight review (or equivalent) to continue acting as pilot in command?',
 '["Every 12 calendar months", "Every 24 calendar months", "Every 100 hours", "Only once, after certification"]', 1,
 'A flight review is a minimum 1 hour of ground and 1 hour of flight training with an authorized instructor, required within the preceding 24 calendar months to act as PIC.',
 'Flight review requirements and what can substitute for one.', 4),

('priv-2', 'privileges', 'applied', 1.5,
 'You and three friends want to split the cost of a weekend cross-country trip you were already planning to take yourself. As a private pilot, is this legal?',
 '["No -- any cost-sharing with passengers requires a commercial certificate", "Yes, as long as you pay at least an equal, pro rata share and have your own reason for the flight", "Yes, but only if the passengers pay the entire cost", "No -- private pilots can never accept money from passengers"]', 1,
 '14 CFR 61.113 allows a private pilot to share operating expenses pro rata with passengers, as long as the pilot pays at least an equal share and has a genuine reason for the flight beyond just carrying passengers.',
 'The pro rata cost-sharing rule and other narrow compensation exceptions.', 5),

('airspace-1', 'airspace', 'applied', 1.5,
 'Before entering which class of airspace must a VFR pilot receive an explicit ATC clearance -- not just establish two-way radio contact?',
 '["Class C", "Class D", "Class B", "Class E"]', 2,
 'Class B is the only one requiring an actual "cleared into Class B airspace" from ATC. Class C and D only require establishing two-way radio communication.',
 'Entry requirements for each class of airspace.', 6),

('airspace-2', 'airspace', 'knowledge', 1.0,
 'What are the basic VFR weather minimums for visibility and cloud clearance in Class D airspace?',
 '["1 SM, clear of clouds", "3 SM, 500 below / 1,000 above / 2,000 horizontal", "5 SM, 1,000/1,000/1 mile", "3 SM, clear of clouds"]', 1,
 '14 CFR 91.155: Class D (like Class C and most of Class E below 10,000 ft) requires 3 statute miles visibility and those specific cloud clearance distances.',
 'VFR weather minimums by airspace class, from memory.', 7),

('airspace-3', 'airspace', 'scenario', 2.0,
 'You''re flying VFR at 4,500 ft MSL, approaching a Class B shelf that begins at 4,000 ft. ATC has not cleared you into Class B. What must you do?',
 '["Continue -- established radio contact is enough", "Descend or divert to remain clear of the Class B shelf", "Climb above the shelf to avoid it", "Contact ATC after entering to request clearance retroactively"]', 1,
 'Without an explicit Class B clearance, you must remain clear of it entirely -- in this case, staying below the 4,000 ft shelf (or diverting around it) until cleared in.',
 'How to read sectional Class B shelf altitudes and plan around them.', 8),

('weather-1', 'weather', 'knowledge', 1.0,
 'A METAR includes the group "BKN008". What does this tell you about sky condition?',
 '["Broken clouds at 8,000 feet AGL", "Broken clouds at 800 feet AGL", "Scattered clouds at 8,000 feet MSL", "Overcast at 800 feet MSL"]', 1,
 'Cloud height in a METAR is reported in hundreds of feet AGL, and "BKN" is broken (5/8 to 7/8 sky coverage) -- so BKN008 is broken clouds at 800 feet AGL.',
 'Decoding METAR sky condition, visibility, and remarks.', 9),

('weather-2', 'weather', 'applied', 1.5,
 'A TAF includes a "TEMPO" group forecasting 3 SM visibility and mist for a two-hour window that overlaps your planned departure. What does TEMPO actually tell you?',
 '["Those conditions are guaranteed for the full two hours", "Those conditions are expected temporarily, for less than an hour at a time, over less than half the period", "TEMPO conditions can be ignored for VFR planning", "The forecast is unreliable and should be disregarded entirely"]', 1,
 'TEMPO indicates temporary, fluctuating conditions expected for less than an hour at a time, affecting less than 50% of the period -- real, but not continuous, and still worth factoring into a go/no-go decision.',
 'TAF forecast group definitions: TEMPO, BECMG, PROB.', 10),

('weather-3', 'weather', 'scenario', 2.0,
 '20 minutes into a planned VFR cross-country, you notice cumulus clouds building and the sky darkening ahead, worse than the forecast suggested. What''s the correct decision-making response?',
 '["Continue as planned -- the forecast already accounted for this", "Reassess in real time and turn back or divert if conditions are worse than forecast", "Climb above the weather to stay VFR on top", "Descend and continue at a lower altitude until conditions clear"]', 1,
 'Forecasts are a planning tool, not a guarantee -- real-time conditions take priority. Deteriorating weather worse than forecast calls for an early decision to turn back or divert, not pressing on and hoping.',
 'In-flight weather decision making and personal minimums.', 11),

('perf-1', 'performance', 'knowledge', 1.0,
 'As density altitude increases, aircraft takeoff performance generally:',
 '["Improves", "Is unaffected", "Degrades", "Improves only in cold weather"]', 2,
 'Higher density altitude means thinner air -- less lift, less propeller efficiency, and less engine power, all of which lengthen the takeoff roll and reduce climb performance.',
 'How density altitude affects lift, power, and takeoff/climb performance.', 12),

('perf-2', 'performance', 'applied', 1.5,
 'Your aircraft''s maximum gross weight is 2,550 lbs, and today''s calculated takeoff weight comes to 2,610 lbs. Are you legal to depart?',
 '["Yes, as long as the CG is within limits", "Yes, if performance charts show adequate runway available", "No -- exceeding max gross weight is not legal regardless of performance numbers", "Yes, up to 5% over gross is an accepted margin"]', 2,
 'Maximum gross weight is a hard legal limit, not a performance recommendation -- exceeding it isn''t legal no matter how much runway or climb margin the charts show.',
 'Weight and balance calculations and the difference between a legal limit and a performance margin.', 13),

('aeromed-1', 'aeromedical', 'knowledge', 1.0,
 'Per 14 CFR 91.17, how many hours must pass between consuming alcohol and acting as pilot in command, at minimum?',
 '["4 hours", "8 hours", "12 hours", "24 hours"]', 1,
 '91.17 sets an 8-hour "bottle to throttle" minimum -- though many instructors and operators recommend a longer margin depending on how much was consumed.',
 '91.17 alcohol/drug rules and the blood alcohol concentration limit.', 14),

('aeromed-2', 'aeromedical', 'applied', 1.5,
 'You wake up the morning of a planned flight with mild congestion from a cold. Using IMSAFE, what''s the correct way to think about this?',
 '["Congestion is never disqualifying -- fly as planned", "Assess it honestly under \"Illness,\" considering effects like sinus block at altitude, and decide accordingly -- it''s a judgment call, not automatic grounding", "Any illness automatically means the flight must be canceled", "Only a fever is relevant to fitness to fly"]', 1,
 'IMSAFE''s "Illness" pillar is about honest self-assessment, not a hard rule. Congestion specifically raises real concern about sinus and ear blocks at altitude -- worth genuinely weighing, not dismissing or overreacting to.',
 'The IMSAFE checklist and how to apply it honestly, not just recite it.', 15),

('xc-1', 'crosscountry', 'knowledge', 1.0,
 'For a daytime VFR flight, what minimum fuel reserve is required beyond what''s needed to reach the first point of intended landing?',
 '["15 minutes", "30 minutes", "45 minutes", "60 minutes"]', 1,
 '14 CFR 91.151 requires enough fuel to fly to the first point of intended landing, plus 30 minutes at normal cruise for a daytime VFR flight (45 minutes at night).',
 'VFR fuel reserve requirements, day and night.', 16),

('xc-2', 'crosscountry', 'scenario', 2.0,
 '20 minutes into a planned 90-minute VFR cross-country, an unforecast 25-knot headwind is cutting your groundspeed well below plan. What should you do?',
 '["Continue and recheck fuel only after landing", "Recompute fuel and ETA in flight now, and consider diverting if reserves are threatened", "Increase altitude to escape the headwind without recalculating anything", "Ignore it -- forecasts already account for normal wind variation"]', 1,
 'Cross-country planning doesn''t stop at the preflight briefing. A real, unforecast deviation like this calls for recalculating fuel and ETA in flight, and being willing to divert if your reserve is genuinely at risk.',
 'In-flight fuel and time recalculation, and when to divert.', 17),

('emerg-1', 'emergency', 'applied', 1.5,
 'Following an engine failure shortly after takeoff, with insufficient altitude to turn back to the runway, the standard guidance is to:',
 '["Attempt a 180° turn back to the runway", "Land straight ahead, with only minor turns to avoid obstacles", "Extend full flaps immediately and glide as far as possible", "Shut down all electrical systems before landing"]', 1,
 'The "impossible turn" back to the runway at low altitude is a leading cause of stall/spin accidents. Landing generally straight ahead, even off-airport, is the standard low-altitude engine-failure response.',
 'Engine-failure-after-takeoff decision altitude and the risks of the "impossible turn."', 18),

('emerg-2', 'emergency', 'scenario', 2.0,
 'You smell smoke in the cabin during cruise flight. What is the correct general priority order for your response?',
 '["Land immediately at the nearest airport, skip all other steps", "Fly the airplane first, then work to identify and eliminate the source, then land as soon as practical", "Shut off all electrical power immediately, then figure out where to land", "Open a window immediately to clear the smoke before doing anything else"]', 1,
 'Aviate first -- keep the airplane under control. Then work the problem: try to identify and isolate the source (electrical vs. other). Then land as soon as practical or immediately, depending on severity. Examiners are listening for this structured order, not just "land right away."',
 'In-flight fire/smoke emergency procedures and the aviate-navigate-communicate priority order.', 19);
