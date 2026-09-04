-- Apex Advantage -- Modules 14-17 companion content (v103)
--
-- Ships real, authored Module Companion content + scored assessments for
-- PPL-M14 (Aircraft Performance), PPL-M15 (Cross-Country Planning),
-- PPL-M16 (Aeronautical Decision Making), and PPL-M17 (Human Factors) --
-- same schema/shape as PPL-M01..M13 (supabase-portal-schema-v88.sql
-- through v102.sql).
--
-- Each production package is written for the LIVE instructor-led class
-- (slide deck, timing notes, instructor prep, per-slide script) -- only
-- the subset that belongs in the async student companion workbook is
-- imported here: module purpose, the real learning objectives, guided-
-- notes prompts (one per major topic/framework, following each module's
-- own Content Summary / Instructor Quick Reference sections), the
-- Scenario Workshop (condensed into single write-in prompts per required
-- scenario, matching the existing modules' pattern), the full Checkride
-- Corner question bank (question text only -- this workbook is a
-- write-your-own-answer/self-rate tool, not a reveal-the-answer one, same
-- as every other module), and each module's real standalone Apex
-- Challenge (all four of these packages have one, unlike M10-M12).
--
-- Knowledge Check banks in M16/M17 include several non-MC/non-scenario
-- item types (Hazard ID, Risk Ranking, Personal Minimums, Hazardous
-- Attitude ID, Framework Application) not covered by the
-- module_quiz_questions.question_type CHECK constraint
-- ('multiple_choice','short_answer','scenario'). These are all mapped to
-- 'short_answer' (free-response, model-answer-graded) -- the same
-- resolution used for M13/M14/M15's "Calc" items -- while items
-- explicitly typed "Scenario" in the source map to 'scenario'.
--
-- Also corrects site/portal-stable.js's GUIDED_NOTES_MODULES fallback
-- prompts for PPL-M14 through PPL-M17: the prompts already there
-- described a generic curriculum framing and omitted every module's real
-- named framework (Apex Performance Pyramid, Apex Flight Planning Cycle,
-- Apex Decision Loop, Apex Silent Six) -- a pre-existing mismatch, fixed
-- in the same application-code change that introduces this content, same
-- precedent as v101/v102's own module fixes.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v102.

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M14',
  '{
    "modulePurpose": "Build the ability to read and interpolate aircraft performance charts precisely and, more importantly, to translate every calculated result into a real, defensible go/no-go decision as Pilot in Command.",
    "objectives": [
      {"id": "obj-aircraft-performance", "label": "Explain aircraft performance."},
      {"id": "obj-performance-changes", "label": "Explain why aircraft performance changes."},
      {"id": "obj-performance-limitations", "label": "Define performance limitations."},
      {"id": "obj-power-available", "label": "Explain power available."},
      {"id": "obj-power-required", "label": "Explain power required."},
      {"id": "obj-thrust-drag", "label": "Explain thrust and drag relationships."},
      {"id": "obj-climb-performance", "label": "Explain climb performance."},
      {"id": "obj-glide-performance", "label": "Explain glide performance."},
      {"id": "obj-vx", "label": "Explain best angle of climb (Vx)."},
      {"id": "obj-vy", "label": "Explain best rate of climb (Vy)."},
      {"id": "obj-service-ceiling", "label": "Explain service ceiling."},
      {"id": "obj-absolute-ceiling", "label": "Explain absolute ceiling."},
      {"id": "obj-pressure-altitude", "label": "Explain pressure altitude."},
      {"id": "obj-density-altitude", "label": "Explain density altitude."},
      {"id": "obj-temperature-effects", "label": "Explain temperature effects."},
      {"id": "obj-humidity-effects", "label": "Explain humidity effects."},
      {"id": "obj-runway-slope-effects", "label": "Explain runway slope effects."},
      {"id": "obj-runway-surface-effects", "label": "Explain runway surface effects."},
      {"id": "obj-headwind-tailwind", "label": "Explain headwind and tailwind corrections."},
      {"id": "obj-obstacle-clearance", "label": "Explain obstacle clearance."},
      {"id": "obj-takeoff-charts", "label": "Use takeoff distance charts."},
      {"id": "obj-landing-charts", "label": "Use landing distance charts."},
      {"id": "obj-climb-charts", "label": "Use climb charts."},
      {"id": "obj-cruise-charts", "label": "Use cruise performance charts."},
      {"id": "obj-fuel-burn-charts", "label": "Use fuel burn charts."},
      {"id": "obj-go-no-go-performance", "label": "Apply aircraft performance information to real-world go/no-go decisions."}
    ],
    "guidedNotes": [
      {"id": "apex-performance-pyramid", "section": "The Apex Performance Pyramid", "prompt": "What are the five levels of the Apex Performance Pyramid, bottom to top, and why is it evaluated in that order for every flight?"},
      {"id": "performance-fundamentals", "section": "Performance Fundamentals", "prompt": "How do power available and power required each change with altitude and airspeed, and why does the gap between them determine climb capability?"},
      {"id": "takeoff-landing-performance", "section": "Takeoff & Landing Performance", "prompt": "What is the difference between ground roll and total distance to clear a 50-ft obstacle, and what does landing distance depend on beyond the POH''s idealized figures?"},
      {"id": "density-altitude", "section": "Density Altitude", "prompt": "How do you calculate density altitude from pressure altitude and OAT, and why is it the connective tissue behind nearly every other performance calculation in this module?"},
      {"id": "performance-charts-interpolation", "section": "Aircraft Performance Charts", "prompt": "How do you correctly interpolate between two listed values on a takeoff, landing, or climb performance chart instead of rounding to the nearest one?"},
      {"id": "environmental-factors", "section": "Environmental Factors", "prompt": "How do headwind versus tailwind, runway slope, runway surface, and elevation each modify the POH''s idealized baseline distance and climb figures?"},
      {"id": "performance-planning-risk-management", "section": "Performance Planning & Risk Management", "prompt": "Why is a technically legal performance calculation not automatically a safe one, and what specifically builds real margin beyond the legal floor?"}
    ],
    "scenario": {
      "narrative": "Eight scenarios built around the Apex Performance Pyramid -- practice calculating real performance numbers, then defending whether you''d actually fly it, not just whether it technically clears every requirement.",
      "prompts": [
        {"id": "scenario-1-grass-runway-hot-afternoon", "prompt": "Scenario 1 -- Departing a 2,200-Foot Grass Runway on a 98 degF Afternoon: Aircraft near max gross weight, no obstacles beyond the runway. Calculate density altitude for this departure, factor in the grass surface, and decide whether you''d make this flight."},
        {"id": "scenario-2-mountain-airport-density-altitude", "prompt": "Scenario 2 -- Flying From a Mountain Airport With High Density Altitude: Departure from a 7,500-ft field elevation mountain airport on a warm afternoon, with rising terrain beyond the runway. Calculate density altitude and the required climb gradient to clear the terrain."},
        {"id": "scenario-3-tailwind-temptation", "prompt": "Scenario 3 -- The Tailwind Temptation (\"It''s Only Five Knots\"): Wind favors a shorter taxi to a runway with a 5-knot tailwind component instead of backtaxiing into the wind. How does that 5-knot tailwind actually affect your distance calculation, and what would you do?"},
        {"id": "scenario-4-wet-runway-after-thunderstorms", "prompt": "Scenario 4 -- Wet Runway After Thunderstorms: The runway is wet with standing water in a few low spots. How does this change your landing distance calculation, and at what point does \"wet\" become \"contaminated\"?"},
        {"id": "scenario-5-trees-at-departure-end", "prompt": "Scenario 5 -- Trees at the Departure End: A 60-foot tree line sits 1,800 feet beyond the departure end of the runway. Calculate the required climb gradient to clear it with margin, and check whether your aircraft''s published rate of climb actually clears it."},
        {"id": "scenario-6-soft-field-after-heavy-rain", "prompt": "Scenario 6 -- Soft-Field Departure After Heavy Rain: Heavy rain overnight has left the grass departure runway soft and saturated. How does a soft field change your ground roll expectations versus the POH chart, and would you delay departure?"},
        {"id": "scenario-7-full-fuel-vs-reduced-fuel", "prompt": "Scenario 7 -- Full Fuel vs. Reduced Fuel Decision: Topping off to full fuel would push the aircraft to max gross weight on an already-marginal performance day. Compare takeoff distance and climb performance at max gross weight versus a reduced-fuel weight, and defend a decision."},
        {"id": "scenario-8-legal-but-almost-no-margin", "prompt": "Scenario 8 -- Aircraft Performs Legally, But With Almost No Safety Margin: Every calculation checks out, with almost nothing left over. Is \"it technically works\" the same as \"I should go\"? What would you change to build real margin into this flight?"}
      ]
    },
    "checkrideCorner": [
      {"id": "cc-1", "question": "What is density altitude, and why does it matter?"},
      {"id": "cc-2", "question": "What''s the difference between power available and power required?"},
      {"id": "cc-3", "question": "What''s the difference between Vx and Vy?"},
      {"id": "cc-4", "question": "What is service ceiling?"},
      {"id": "cc-5", "question": "What is absolute ceiling?"},
      {"id": "cc-6", "question": "What is pressure altitude?"},
      {"id": "cc-7", "question": "What''s the difference between ground roll and total distance over a 50-ft obstacle?"},
      {"id": "cc-8", "question": "What does a headwind do to takeoff distance?"},
      {"id": "cc-9", "question": "What does a tailwind do to landing distance?"},
      {"id": "cc-10", "question": "What is glide performance, conceptually?"},
      {"id": "cc-11", "question": "Walk me through how you''d calculate density altitude for this airport."},
      {"id": "cc-12", "question": "How does a tailwind affect your takeoff distance, and why more than it seems?"},
      {"id": "cc-13", "question": "How do you interpolate between two values on a performance chart?"},
      {"id": "cc-14", "question": "What''s the difference between ground roll and total distance to clear a 50-ft obstacle?"},
      {"id": "cc-15", "question": "How does runway slope affect your takeoff and landing planning?"},
      {"id": "cc-16", "question": "How does high humidity affect density altitude?"},
      {"id": "cc-17", "question": "Why does weight affect both takeoff distance and climb performance?"},
      {"id": "cc-18", "question": "What''s the difference between a wet runway and a contaminated runway?"},
      {"id": "cc-19", "question": "How do you determine required climb gradient to clear a known obstacle?"},
      {"id": "cc-20", "question": "What''s the relationship between range, groundspeed, and endurance?"},
      {"id": "cc-21", "question": "This takeoff distance is legal but leaves almost no margin. Would you go? Why or why not?"},
      {"id": "cc-22", "question": "Explain why high density altitude reduces both lift and thrust at the same time."},
      {"id": "cc-23", "question": "A 60-foot obstacle sits beyond the runway. Walk me through how you''d determine if you can clear it."},
      {"id": "cc-24", "question": "Walk me through the Apex Performance Pyramid using this exact scenario."},
      {"id": "cc-25", "question": "Why can a cool morning at a high-elevation airport still produce a dangerous density altitude?"},
      {"id": "cc-26", "question": "You''re at max gross weight and the only usable runway has a tailwind component. Walk me through your decision."},
      {"id": "cc-27", "question": "Explain the relationship between excess power and climb performance."},
      {"id": "cc-28", "question": "Why is \"the chart says it works\" not the same as \"I should go\"?"},
      {"id": "cc-29", "question": "You''ve used a generic POH chart instead of your specific aircraft''s data. What''s the risk?"},
      {"id": "cc-30", "question": "Defend a performance decision you would make differently than what the numbers alone technically allow."}
    ],
    "apexChallenge": {
      "instructions": "You''ll receive a complete PA-28 performance planning scenario (airport, weather, runway, weight, temperature, wind, and fuel data). Determine pressure altitude and density altitude, calculate takeoff and landing distance (including obstacle clearance if applicable), calculate climb performance and required climb gradient if a relevant obstacle exists, calculate fuel burn/endurance/range, determine cruise performance, and make a complete go/no-go recommendation. Check with your instructor for this cohort''s due date.",
      "fields": [
        {"id": "ac-pressure-density-altitude", "label": "Determine pressure altitude and density altitude (show your work).", "type": "textarea"},
        {"id": "ac-takeoff-landing-distance", "label": "Calculate takeoff distance and landing distance, including obstacle clearance if applicable.", "type": "textarea"},
        {"id": "ac-climb-performance", "label": "Calculate climb performance and, if a relevant obstacle exists, required climb gradient.", "type": "textarea"},
        {"id": "ac-fuel-cruise", "label": "Calculate fuel burn, endurance, and range, and determine cruise performance for the planned altitude and power setting.", "type": "textarea"},
        {"id": "ac-go-no-go", "label": "Make a complete go/no-go recommendation, justified using the Apex Performance Pyramid.", "type": "textarea"}
      ]
    }
  }'::jsonb
);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M14-Q01', 'PPL', 'PPL-M14', 1, 'multiple_choice', 'Density altitude is:', '[{"key":"A","label":"Field elevation alone"},{"key":"B","label":"Pressure altitude corrected for non-standard temperature"},{"key":"C","label":"The altimeter setting"},{"key":"D","label":"Runway length adjusted for wind"}]', 'B', 'Density altitude is pressure altitude corrected for non-standard temperature -- the altitude the aircraft and engine actually perform at.'),
('PPL-M14-Q02', 'PPL', 'PPL-M14', 2, 'multiple_choice', 'Power available minus power required equals:', '[{"key":"A","label":"Drag"},{"key":"B","label":"Excess power, which produces climb capability"},{"key":"C","label":"Thrust"},{"key":"D","label":"Stall speed"}]', 'B', 'Excess power (power available minus power required) is what produces climb capability.'),
('PPL-M14-Q03', 'PPL', 'PPL-M14', 3, 'multiple_choice', 'Vx is used primarily for:', '[{"key":"A","label":"Best rate of climb to altitude"},{"key":"B","label":"Best angle of climb to clear obstacles"},{"key":"C","label":"Maximum cruise speed"},{"key":"D","label":"Minimum sink glide"}]', 'B', 'Vx (best angle of climb) gains the most altitude per unit of horizontal distance, best for clearing obstacles.'),
('PPL-M14-Q04', 'PPL', 'PPL-M14', 4, 'multiple_choice', 'Vy is used primarily for:', '[{"key":"A","label":"Best angle of climb to clear obstacles"},{"key":"B","label":"Best rate of climb to altitude"},{"key":"C","label":"Best glide"},{"key":"D","label":"Maximum crosswind capability"}]', 'B', 'Vy (best rate of climb) gains the most altitude per unit of time, best for a general climb.'),
('PPL-M14-Q05', 'PPL', 'PPL-M14', 5, 'multiple_choice', 'Which factor generally has the largest effect on density altitude?', '[{"key":"A","label":"Humidity"},{"key":"B","label":"Temperature"},{"key":"C","label":"Wind"},{"key":"D","label":"Runway slope"}]', 'B', 'Temperature generally has the largest effect on density altitude.'),
('PPL-M14-Q06', 'PPL', 'PPL-M14', 6, 'multiple_choice', 'A tailwind component on takeoff:', '[{"key":"A","label":"Shortens ground roll"},{"key":"B","label":"Lengthens ground roll, often disproportionately"},{"key":"C","label":"Has no effect"},{"key":"D","label":"Only affects landing, not takeoff"}]', 'B', 'A tailwind lengthens ground roll, often disproportionately since the effect scales with the square of the speed change.'),
('PPL-M14-Q07', 'PPL', 'PPL-M14', 7, 'multiple_choice', 'Ground roll differs from total distance to clear a 50-ft obstacle because:', '[{"key":"A","label":"They''re the same number"},{"key":"B","label":"Total distance includes additional air distance to climb to 50 ft"},{"key":"C","label":"Ground roll is always longer"},{"key":"D","label":"Obstacle distance ignores weight"}]', 'B', 'Total distance to a 50-ft obstacle includes the additional air distance needed to climb to that height beyond ground roll.'),
('PPL-M14-Q08', 'PPL', 'PPL-M14', 8, 'multiple_choice', 'An uphill runway slope on takeoff:', '[{"key":"A","label":"Shortens ground roll"},{"key":"B","label":"Lengthens ground roll"},{"key":"C","label":"Has no effect"},{"key":"D","label":"Only matters for landing"}]', 'B', 'An uphill slope resists acceleration, lengthening takeoff ground roll.'),
('PPL-M14-Q09', 'PPL', 'PPL-M14', 9, 'multiple_choice', 'A downhill runway slope on landing:', '[{"key":"A","label":"Shortens ground roll"},{"key":"B","label":"Lengthens ground roll and adds risk"},{"key":"C","label":"Has no effect"},{"key":"D","label":"Only matters for takeoff"}]', 'B', 'A downhill slope on landing lengthens ground roll and adds real risk, especially if braking is also compromised.'),
('PPL-M14-Q10', 'PPL', 'PPL-M14', 10, 'short_answer', 'A takeoff ground roll is 1,050 ft at 2,000 ft pressure altitude and 1,340 ft at 3,000 ft pressure altitude. Interpolate the ground roll at 2,700 ft pressure altitude. Show your work.', null, null, '1,050 + 0.70 x (1,340 - 1,050) = 1,253 ft.'),
('PPL-M14-Q11', 'PPL', 'PPL-M14', 11, 'short_answer', 'Field elevation 2,700 ft, altimeter setting 29.85. What is the pressure altitude? Show your work.', null, null, '1,000 x (29.92 - 29.85) + 2,700 = 2,770 ft.'),
('PPL-M14-Q12', 'PPL', 'PPL-M14', 12, 'multiple_choice', 'Which of the following degrades both lift and thrust simultaneously?', '[{"key":"A","label":"A tailwind"},{"key":"B","label":"High density altitude"},{"key":"C","label":"Runway slope"},{"key":"D","label":"A wet runway"}]', 'B', 'High density altitude reduces both lift and thrust at the same time, since both depend on air density.'),
('PPL-M14-Q13', 'PPL', 'PPL-M14', 13, 'multiple_choice', 'Why must climb rate be converted to a climb gradient to evaluate an obstacle?', '[{"key":"A","label":"It doesn''t need to be -- rate alone is sufficient"},{"key":"B","label":"A gradient compares altitude gained against horizontal distance, matching how obstacles are actually positioned"},{"key":"C","label":"Gradient is only used for landing"},{"key":"D","label":"Rate of climb and gradient are the same thing"}]', 'B', 'A gradient compares altitude gained against horizontal distance, which matches how an obstacle is actually positioned relative to the runway.'),
('PPL-M14-Q14', 'PPL', 'PPL-M14', 14, 'multiple_choice', 'A wet runway primarily affects:', '[{"key":"A","label":"Climb performance"},{"key":"B","label":"Braking effectiveness and landing distance"},{"key":"C","label":"Cruise fuel burn"},{"key":"D","label":"Density altitude"}]', 'B', 'A wet runway primarily reduces braking effectiveness and increases landing distance.'),
('PPL-M14-Q15', 'PPL', 'PPL-M14', 15, 'multiple_choice', 'Range is calculated using:', '[{"key":"A","label":"True airspeed x endurance"},{"key":"B","label":"Groundspeed x endurance"},{"key":"C","label":"Fuel burn x altitude"},{"key":"D","label":"Power required alone"}]', 'B', 'Range equals groundspeed multiplied by endurance -- groundspeed, not airspeed, determines how far the aircraft actually travels.'),
('PPL-M14-Q16', 'PPL', 'PPL-M14', 16, 'short_answer', 'Explain in one or two sentences why "the chart says it works" is not automatically the same as "I should go."', null, null, 'The chart reflects a specific, idealized set of published conditions and pilot technique; real conditions include rounding error, technique variation, and changing weather, all of which the chart doesn''t account for -- margin, not the chart alone, is what makes a flight genuinely safe.'),
('PPL-M14-Q17', 'PPL', 'PPL-M14', 17, 'short_answer', 'Name one common student mistake covered in this module and how to avoid it.', null, null, 'Answers will vary (e.g., skipping the density altitude calculation and using field elevation alone, rounding to the nearest chart value instead of properly interpolating, or reading only one chart and never checking climb performance for the same flight) -- avoided by working the full chart set and the actual interpolation method every time.'),
('PPL-M14-Q18', 'PPL', 'PPL-M14', 18, 'short_answer', 'State the five levels of the Apex Performance Pyramid in order.', null, null, 'Aircraft, Environment, Performance, Safety Margin, Pilot Decision.');

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M15',
  '{
    "modulePurpose": "Build the ability to plan, evaluate, brief, and safely execute a complete VFR cross-country flight as Pilot in Command -- integrating every prior module into one continuous decision-making process, not a paperwork exercise.",
    "objectives": [
      {"id": "obj-plan-complete-xc", "label": "Plan a complete VFR cross-country flight."},
      {"id": "obj-select-route", "label": "Select an appropriate route."},
      {"id": "obj-choose-checkpoints", "label": "Choose checkpoints."},
      {"id": "obj-measure-true-course", "label": "Measure true course."},
      {"id": "obj-calculate-magnetic-course", "label": "Calculate magnetic course."},
      {"id": "obj-calculate-compass-heading", "label": "Calculate compass heading."},
      {"id": "obj-calculate-wca", "label": "Calculate wind correction angle."},
      {"id": "obj-calculate-groundspeed", "label": "Calculate groundspeed."},
      {"id": "obj-calculate-ete", "label": "Calculate estimated time en route."},
      {"id": "obj-calculate-fuel-requirements", "label": "Calculate fuel requirements."},
      {"id": "obj-complete-nav-log", "label": "Complete a navigation log."},
      {"id": "obj-evaluate-weather-route", "label": "Evaluate weather along the route."},
      {"id": "obj-evaluate-notams", "label": "Evaluate NOTAMs."},
      {"id": "obj-evaluate-tfrs", "label": "Evaluate TFRs."},
      {"id": "obj-select-cruising-altitudes", "label": "Select cruise altitudes."},
      {"id": "obj-choose-diversion-airports", "label": "Choose diversion airports."},
      {"id": "obj-identify-lost-procedures", "label": "Identify lost procedures."},
      {"id": "obj-build-alternate-plans", "label": "Build alternate plans."},
      {"id": "obj-plan-fuel-reserves", "label": "Plan fuel reserves beyond legal minimums."},
      {"id": "obj-comprehensive-briefing", "label": "Conduct a comprehensive preflight briefing."},
      {"id": "obj-safe-go-no-go-xc", "label": "Make safe go/no-go decisions before departure."}
    ],
    "guidedNotes": [
      {"id": "apex-flight-planning-cycle", "section": "The Apex Flight Planning Cycle", "prompt": "What are the eight steps of the Apex Flight Planning Cycle, in order, and why does a Delay or Cancel decision restart the cycle rather than end it?"},
      {"id": "planning-the-flight", "section": "Planning the Flight", "prompt": "What goes into mission analysis, aircraft capability review, and airport/route selection before any calculation begins?"},
      {"id": "navigation-planning", "section": "Navigation Planning", "prompt": "How do checkpoints, true course, magnetic variation, wind correction angle, groundspeed, and estimated time en route all build into a navigation log?"},
      {"id": "weather-planning-xc", "section": "Weather Planning", "prompt": "What products make up a complete weather briefing for a cross-country flight, and why must it be re-checked throughout planning and the flight itself?"},
      {"id": "fuel-planning-xc", "section": "Fuel Planning", "prompt": "What goes into your total fuel required for a complete cross-country route, and why should fuel status be recalculated at every checkpoint?"},
      {"id": "performance-integration", "section": "Performance Integration", "prompt": "Why must weight and balance and takeoff/landing performance be verified for the actual planned loading and conditions at every airport on the route, not assumed from a prior flight?"},
      {"id": "navigation-log", "section": "The Navigation Log", "prompt": "What columns make up a complete navigation log, and how are running totals updated leg by leg throughout the flight?"},
      {"id": "risk-management-xc", "section": "Risk Management", "prompt": "How do PAVE, personal minimums, passenger pressure, lost procedures, and backup plans combine into the Apex Cycle''s \"Know Your Risks\" and \"Build Backup Plans\" steps?"}
    ],
    "scenario": {
      "narrative": "Eight scenarios built around the Apex Flight Planning Cycle -- practice recognizing when a completed plan needs to change mid-execution, not just building the plan itself.",
      "prompts": [
        {"id": "scenario-1-cold-front-mid-flight", "prompt": "Scenario 1 -- A Forecast Cold Front Arrives Halfway Through the Flight: The TAF shows a cold front expected to reach the route midpoint right around the time the flight would cross it. Do you launch as planned, and what would change your timing or route?"},
        {"id": "scenario-2-marginal-fuel-reserves", "prompt": "Scenario 2 -- Strong Headwinds Make Fuel Reserves Marginal: Actual winds aloft are stronger on the nose than forecast, and recalculated fuel reserve is now uncomfortably close to personal minimum. What''s your immediate next action?"},
        {"id": "scenario-3-tfr-appears-after-planning", "prompt": "Scenario 3 -- A TFR Appears After Planning Is Complete: The route was fully planned and briefed. A new TFR is published along part of the route shortly before departure. How do you discover this if you don''t recheck, and what are your routing options now?"},
        {"id": "scenario-4-fuel-stop-closes-unexpectedly", "prompt": "Scenario 4 -- One Planned Fuel Stop Unexpectedly Closes: Already airborne, you learn the planned intermediate fuel stop is now reported closed. What''s your new plan, and how does this affect your total fuel picture?"},
        {"id": "scenario-5-gps-fails-en-route", "prompt": "Scenario 5 -- GPS Fails En Route: The primary GPS navigation display fails with no warning, midway through the flight. Walk through continuing the flight using pilotage and dead reckoning alone -- what''s your first action?"},
        {"id": "scenario-6-unexpected-ceilings-develop", "prompt": "Scenario 6 -- Unexpected Ceilings Develop Along the Route: Ceilings along the route are noticeably lower than forecast, and continuing to drop. What''s your decision point, and what are your real options right now?"},
        {"id": "scenario-7-passenger-wants-to-continue", "prompt": "Scenario 7 -- A Passenger Wants to Continue Despite Deteriorating Weather: Conditions have become marginal. The passenger, aware of the schedule, encourages continuing. What do you do, and how do you communicate the decision as PIC?"},
        {"id": "scenario-8-destination-runway-closure", "prompt": "Scenario 8 -- Destination Airport Reports an Unexpected Runway Closure: Approaching the destination, you learn the primary runway is closed, with only a shorter crosswind runway available. Recalculate landing performance and defend your final decision."}
      ]
    },
    "checkrideCorner": [
      {"id": "cc-1", "question": "What are the eight steps of the Apex Flight Planning Cycle?"},
      {"id": "cc-2", "question": "How do you select a good checkpoint?"},
      {"id": "cc-3", "question": "What''s the difference between true course and magnetic course?"},
      {"id": "cc-4", "question": "What''s the difference between magnetic course and compass heading?"},
      {"id": "cc-5", "question": "What is a wind correction angle?"},
      {"id": "cc-6", "question": "What does a navigation log''s fuel column actually track?"},
      {"id": "cc-7", "question": "What''s the difference between a NOTAM and a TFR?"},
      {"id": "cc-8", "question": "Why do you check weather more than once for a single flight?"},
      {"id": "cc-9", "question": "What is a personal fuel minimum?"},
      {"id": "cc-10", "question": "What are the four C''s of lost procedures?"},
      {"id": "cc-11", "question": "Walk me through how you calculated your fuel requirements for this flight."},
      {"id": "cc-12", "question": "How would you evaluate whether a route through this airspace is a good choice?"},
      {"id": "cc-13", "question": "What''s your plan if your destination airport closes unexpectedly?"},
      {"id": "cc-14", "question": "How did you select this cruise altitude?"},
      {"id": "cc-15", "question": "Walk me through your NOTAM and TFR review process for this route."},
      {"id": "cc-16", "question": "How do you cross-check pilotage, dead reckoning, and GPS during a cross-country?"},
      {"id": "cc-17", "question": "Why must you check both takeoff and landing weight and balance for this flight?"},
      {"id": "cc-18", "question": "What would cause you to activate your alternate plan mid-flight?"},
      {"id": "cc-19", "question": "How does a delayed departure change the rest of your plan?"},
      {"id": "cc-20", "question": "What''s the difference between a legal fuel reserve and your personal fuel minimum?"},
      {"id": "cc-21", "question": "Your groundspeed is significantly slower than planned at your first checkpoint. Walk me through your response."},
      {"id": "cc-22", "question": "This flight is legal in every respect, but you have almost no margin anywhere. Would you go?"},
      {"id": "cc-23", "question": "Explain how weather, fuel, and performance planning interact on this specific route."},
      {"id": "cc-24", "question": "Walk me through your complete cross-country plan using the Apex Flight Planning Cycle, start to finish."},
      {"id": "cc-25", "question": "A passenger pressures you to continue despite deteriorating weather. Walk me through your response."},
      {"id": "cc-26", "question": "GPS fails midway through this flight. Walk me through your continued navigation."},
      {"id": "cc-27", "question": "Why is a completed navigation log not the same as a safe flight?"},
      {"id": "cc-28", "question": "How would your plan change if this were a night flight instead of a day flight?"},
      {"id": "cc-29", "question": "What''s the single biggest planning mistake you see students make, and why?"},
      {"id": "cc-30", "question": "Defend a planning decision you would make differently than what the minimums alone technically require."}
    ],
    "apexChallenge": {
      "instructions": "Using a provided PA-28 and current weather, complete a full cross-country planning exercise in writing: route selection, a complete navigation log, weight and balance verification, performance calculations, weather analysis, NOTAM and TFR review, fuel planning, alternate selection, risk assessment, and a final go/no-go decision. Check with your instructor for this cohort''s due date.",
      "fields": [
        {"id": "ac-route-navlog", "label": "Route selection and a complete navigation log.", "type": "textarea"},
        {"id": "ac-wb-performance", "label": "Weight and balance verification and performance calculations.", "type": "textarea"},
        {"id": "ac-weather-notam-tfr", "label": "Weather analysis, NOTAM review, and TFR review.", "type": "textarea"},
        {"id": "ac-fuel-alternate", "label": "Fuel planning and alternate selection.", "type": "textarea"},
        {"id": "ac-risk-godecision", "label": "Risk assessment and final go/no-go decision, justified using the Apex Flight Planning Cycle.", "type": "textarea"}
      ]
    }
  }'::jsonb
);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M15-Q01', 'PPL', 'PPL-M15', 1, 'multiple_choice', 'The Apex Flight Planning Cycle''s final step is:', '[{"key":"A","label":"Know Your Risks"},{"key":"B","label":"Build Backup Plans"},{"key":"C","label":"Brief Yourself"},{"key":"D","label":"Go / Delay / Cancel"}]', 'D', 'The final step is Go / Delay / Cancel -- and a Delay or Cancel decision restarts the cycle rather than ending it.'),
('PPL-M15-Q02', 'PPL', 'PPL-M15', 2, 'multiple_choice', 'True course is measured from:', '[{"key":"A","label":"Magnetic north"},{"key":"B","label":"True north"},{"key":"C","label":"The compass rose"},{"key":"D","label":"The runway heading"}]', 'B', 'True course is measured from true north on the sectional.'),
('PPL-M15-Q03', 'PPL', 'PPL-M15', 3, 'multiple_choice', 'Magnetic course equals:', '[{"key":"A","label":"True course alone"},{"key":"B","label":"True course corrected for magnetic variation"},{"key":"C","label":"Compass heading"},{"key":"D","label":"True course corrected for wind"}]', 'B', 'Magnetic course is true course corrected for local magnetic variation.'),
('PPL-M15-Q04', 'PPL', 'PPL-M15', 4, 'multiple_choice', 'Compass heading equals:', '[{"key":"A","label":"Magnetic course"},{"key":"B","label":"True course"},{"key":"C","label":"Magnetic heading corrected for compass deviation"},{"key":"D","label":"Groundspeed corrected for wind"}]', 'C', 'Compass heading is magnetic heading further corrected for the aircraft''s own compass deviation.'),
('PPL-M15-Q05', 'PPL', 'PPL-M15', 5, 'multiple_choice', 'A wind correction angle compensates for:', '[{"key":"A","label":"Engine performance"},{"key":"B","label":"Wind drift off the intended course"},{"key":"C","label":"Magnetic variation"},{"key":"D","label":"Compass deviation"}]', 'B', 'A wind correction angle compensates for wind drift, keeping the actual ground track matched to the intended course.'),
('PPL-M15-Q06', 'PPL', 'PPL-M15', 6, 'multiple_choice', 'Groundspeed is:', '[{"key":"A","label":"Indicated airspeed"},{"key":"B","label":"True airspeed"},{"key":"C","label":"Actual speed over the ground, accounting for wind"},{"key":"D","label":"Never affected by wind"}]', 'C', 'Groundspeed is the actual speed over the ground, accounting for wind.'),
('PPL-M15-Q07', 'PPL', 'PPL-M15', 7, 'multiple_choice', 'A TFR:', '[{"key":"A","label":"Appears on every printed sectional chart"},{"key":"B","label":"Exists only in the NOTAM system"},{"key":"C","label":"Never changes once published"},{"key":"D","label":"Is the same as an AIRMET"}]', 'B', 'A TFR is published only through the NOTAM system, not on printed sectional charts.'),
('PPL-M15-Q08', 'PPL', 'PPL-M15', 8, 'multiple_choice', 'Personal fuel minimums should be:', '[{"key":"A","label":"Looser than the legal minimum"},{"key":"B","label":"The same as the legal minimum"},{"key":"C","label":"Stricter than the legal minimum, set in advance"},{"key":"D","label":"Decided at the runway threshold"}]', 'C', 'Personal fuel minimums should be stricter than the legal minimum and set in advance of any specific flight''s pressures.'),
('PPL-M15-Q09', 'PPL', 'PPL-M15', 9, 'multiple_choice', 'Why must both takeoff and landing weight and balance be checked?', '[{"key":"A","label":"They''re always identical"},{"key":"B","label":"Fuel burn changes weight and CG over the flight"},{"key":"C","label":"Only takeoff CG matters"},{"key":"D","label":"Landing weight is irrelevant to CG"}]', 'B', 'Fuel burn changes both total weight and CG location over the course of the flight, so both must be checked separately.'),
('PPL-M15-Q10', 'PPL', 'PPL-M15', 10, 'short_answer', 'A leg is 22 NM at a groundspeed of 110 kt. How long will this leg take? Show your work.', null, null, '22 / 110 = 0.2 hours = 12 minutes.'),
('PPL-M15-Q11', 'PPL', 'PPL-M15', 11, 'short_answer', 'A leg takes 12 minutes at a fuel burn rate of 9.5 gal/hr. How much fuel is used on this leg? Show your work.', null, null, '(12/60) x 9.5 = 1.9 gallons.'),
('PPL-M15-Q12', 'PPL', 'PPL-M15', 12, 'multiple_choice', 'The four C''s of lost procedures are:', '[{"key":"A","label":"Climb, Confirm, Call, Continue"},{"key":"B","label":"Climb, Communicate, Confess, Comply"},{"key":"C","label":"Course, Checkpoint, Compass, Confirm"},{"key":"D","label":"Calm, Course, Compass, Comply"}]', 'B', 'The four C''s are Climb, Communicate, Confess, Comply.'),
('PPL-M15-Q13', 'PPL', 'PPL-M15', 13, 'multiple_choice', 'Why check weather more than once during trip planning?', '[{"key":"A","label":"It''s a regulatory requirement only"},{"key":"B","label":"Conditions change, and a single briefing can become outdated"},{"key":"C","label":"It''s unnecessary if the forecast was good"},{"key":"D","label":"Only required for IFR flights"}]', 'B', 'Conditions change over time, so a single briefing hours before departure can be outdated by the time the flight actually occurs.'),
('PPL-M15-Q14', 'PPL', 'PPL-M15', 14, 'multiple_choice', 'A completed navigation log demonstrates:', '[{"key":"A","label":"That the flight is automatically safe"},{"key":"B","label":"That the planning math was done correctly, which is only part of the decision"},{"key":"C","label":"Nothing useful"},{"key":"D","label":"That weather has been checked"}]', 'B', 'A completed nav log demonstrates the planning math was done correctly -- but that''s only part of a real go/no-go decision.'),
('PPL-M15-Q15', 'PPL', 'PPL-M15', 15, 'multiple_choice', 'Blindly trusting GPS without cross-checking is risky because:', '[{"key":"A","label":"GPS is never accurate"},{"key":"B","label":"A single point of navigation failure has no backup if not cross-checked against pilotage and dead reckoning"},{"key":"C","label":"GPS doesn''t work over land"},{"key":"D","label":"It''s illegal to use GPS for VFR flight"}]', 'B', 'Relying on GPS alone creates a single point of failure with no backup if it isn''t cross-checked against pilotage and dead reckoning.'),
('PPL-M15-Q16', 'PPL', 'PPL-M15', 16, 'short_answer', 'Explain in one or two sentences why "the nav log is complete" is not the same as "the flight is safe."', null, null, 'The nav log documents the plan''s math; it says nothing about whether conditions have changed, whether the pilot should continue, or whether the underlying assumptions still hold -- that judgment is the PIC''s job, not the log''s.'),
('PPL-M15-Q17', 'PPL', 'PPL-M15', 17, 'short_answer', 'Name one common student mistake covered in this module and how to avoid it.', null, null, 'Answers will vary (e.g., planning the shortest route without evaluating the airspace it crosses, calculating fuel and weather once and never revisiting either, or skipping NOTAMs/TFRs along the route) -- avoided by treating the Apex Flight Planning Cycle as a repeating process, not a one-time checklist.'),
('PPL-M15-Q18', 'PPL', 'PPL-M15', 18, 'short_answer', 'State the eight steps of the Apex Flight Planning Cycle in order.', null, null, 'Know Your Mission, Know Your Aircraft, Know Your Route, Know Your Weather, Know Your Risks, Build Backup Plans, Brief Yourself, Go / Delay / Cancel.');

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M16',
  '{
    "modulePurpose": "Build the judgment to recognize hazards, evaluate risk, and make and defend a timely decision as Pilot in Command -- before, during, and after every flight, not only when something has already gone wrong.",
    "objectives": [
      {"id": "obj-identify-hazards", "label": "Identify hazards before and during flight."},
      {"id": "obj-separate-hazard-risk", "label": "Separate hazards from risk."},
      {"id": "obj-apply-faa-models", "label": "Apply PAVE, IMSAFE, 5P, DECIDE, and 3P correctly, per current FAA source material."},
      {"id": "obj-hazardous-attitudes-antidotes", "label": "Recognize the five hazardous attitudes and state their correct antidotes."},
      {"id": "obj-external-pressure-bias", "label": "Identify external pressure and continuation bias."},
      {"id": "obj-personal-minimums-create", "label": "Create and defend personal minimums."},
      {"id": "obj-risk-stacking", "label": "Recognize risk stacking."},
      {"id": "obj-decision-triggers", "label": "Establish objective decision triggers."},
      {"id": "obj-srm-resources", "label": "Use available resources effectively (SRM)."},
      {"id": "obj-change-plan", "label": "Change a plan without viewing it as failure."},
      {"id": "obj-legal-vs-wise", "label": "Explain why legal does not always mean wise."},
      {"id": "obj-decide-while-options-exist", "label": "Make a decision while options still exist."},
      {"id": "obj-defend-dpe-questioning", "label": "Defend that decision under DPE-style questioning."},
      {"id": "obj-think-like-pic", "label": "Begin thinking like Pilot in Command before earning the certificate."}
    ],
    "guidedNotes": [
      {"id": "apex-decision-loop", "section": "The Apex Decision Loop", "prompt": "What are the six steps of the Apex Decision Loop, and why is it an Apex teaching tool built on FAA-standard frameworks rather than FAA terminology itself?"},
      {"id": "hazard-vs-risk-accident-chain", "section": "Hazard vs. Risk & the Accident Chain", "prompt": "What is the difference between a hazard and a risk, and how does the Apex Risk Stack show why individually manageable hazards can combine into real danger?"},
      {"id": "pave-imsafe", "section": "PAVE & IMSAFE", "prompt": "What are the four elements of PAVE and the six letters of IMSAFE, and how would you run both honestly before today''s flight?"},
      {"id": "personal-minimums-adm", "section": "Personal Minimums", "prompt": "What is the difference between a legal minimum and a personal minimum, and how should personal minimums be built and allowed to evolve over time?"},
      {"id": "five-p-decide-3p", "section": "5P, DECIDE & 3P", "prompt": "How do the 5P model, the DECIDE model, and the 3P model (with CARE and TEAM) differ in when and how you''d actually use each one?"},
      {"id": "hazardous-attitudes", "section": "Hazardous Attitudes", "prompt": "What are the five hazardous attitudes, and what is the correct FAA-standard antidote for each?"},
      {"id": "external-pressure-continuation-bias", "section": "External Pressure & Continuation Bias", "prompt": "What is continuation bias, why does an earlier decision change the options still available later, and what is an \"Apex Out\"?"},
      {"id": "decision-triggers-outcome-bias", "section": "Decision Triggers & Outcome Bias", "prompt": "Why should a decision trigger be set as a specific, objective number before the flight, and why doesn''t a good outcome automatically prove a decision was good?"}
    ],
    "scenario": {
      "narrative": "Ten scenarios rehearsing the Apex Decision Loop against realistic pressure -- weather, fatigue, passengers, mechanical indications, and combinations of factors that are each individually legal but collectively thin on margin.",
      "prompts": [
        {"id": "scenario-1-marginal-vfr-cross-country", "prompt": "Scenario 1 -- Marginal VFR Cross-Country: Ceilings and visibility are right at your personal minimums for the entire planned route, with no clear improving trend. What''s your go/no-go, and why? Walk the Apex Decision Loop."},
        {"id": "scenario-2-night-flight-fatigue", "prompt": "Scenario 2 -- Night Flight With Fatigue: A planned night flight follows a full workday. You feel \"fine,\" but haven''t slept more than 5 hours. Run an honest IMSAFE check out loud -- does \"fine\" settle the question?"},
        {"id": "scenario-3-high-density-altitude-departure", "prompt": "Scenario 3 -- High-Density-Altitude Departure: A hot afternoon departure from a high-elevation airport, aircraft loaded close to max gross weight. What do PAVE''s Aircraft and Environment elements tell you here, and what control options exist?"},
        {"id": "scenario-4-passenger-pressure", "prompt": "Scenario 4 -- Passenger Pressure: Conditions are marginal. The passenger, aware of a tight schedule, encourages you to continue. Identify the external pressure specifically -- what''s your Apex Out here?"},
        {"id": "scenario-5-rising-oil-temperature", "prompt": "Scenario 5 -- Rising Oil Temperature / Abnormal Indication: An abnormal engine indication develops in cruise flight, well before reaching the destination. Walk the DECIDE model live -- what''s your immediate action?"},
        {"id": "scenario-6-deteriorating-weather-enroute", "prompt": "Scenario 6 -- Deteriorating Weather Enroute: Conditions along the route are trending worse than forecast, with the destination still reporting VFR. What''s your trigger point, and has it been reached?"},
        {"id": "scenario-7-fuel-trending-below-plan", "prompt": "Scenario 7 -- Fuel Trending Below Plan: Actual fuel burn is running measurably higher than planned, discovered partway through the flight. Recalculate remaining range and reserve right now -- what''s your decision point?"},
        {"id": "scenario-8-strong-crosswind-destination", "prompt": "Scenario 8 -- Strong Crosswind at Destination: Reported winds exceed your personal crosswind minimum, though still within the aircraft''s demonstrated capability. Whose limit governs here -- the aircraft''s or yours?"},
        {"id": "scenario-9-unfamiliar-airport-night", "prompt": "Scenario 9 -- Unfamiliar Airport at Night: Arrival is planned at an airport never used before, after dark, with rising terrain nearby. What extra planning does \"unfamiliar\" and \"night\" each specifically demand?"},
        {"id": "scenario-10-everything-is-legal", "prompt": "Scenario 10 -- \"Everything Is Legal\": Every individual factor checks out legally -- weight, weather, fuel, and pilot currency -- but together, margin is thin. Build the Apex Risk Stack for this flight, out loud, and defend your final decision."}
      ]
    },
    "checkrideCorner": [
      {"id": "cc-1", "question": "Tell me about PAVE."},
      {"id": "cc-2", "question": "What is the difference between a hazard and a risk?"},
      {"id": "cc-3", "question": "Explain the five hazardous attitudes."},
      {"id": "cc-4", "question": "What does IMSAFE stand for, and when do you use it?"},
      {"id": "cc-5", "question": "What''s the difference between the 5P model and the 3P model?"},
      {"id": "cc-6", "question": "What are the six steps of the DECIDE model?"},
      {"id": "cc-7", "question": "What does SRM mean, and why does it matter for a single pilot?"},
      {"id": "cc-8", "question": "What is the Apex Decision Loop, and how is it different from FAA models?"},
      {"id": "cc-9", "question": "How do you establish personal minimums?"},
      {"id": "cc-10", "question": "You''re legal VFR, but ceilings are dropping along your route. What factors determine whether you continue?"},
      {"id": "cc-11", "question": "Your passenger is pressuring you to complete the trip. How do you manage that?"},
      {"id": "cc-12", "question": "What would make you divert?"},
      {"id": "cc-13", "question": "Give me an example of something that''s legal but may not be smart."},
      {"id": "cc-14", "question": "What''s the difference between the CARE checklist and the TEAM checklist?"},
      {"id": "cc-15", "question": "How do you use decision triggers, and why decide them before the flight?"},
      {"id": "cc-16", "question": "Walk me through the 5P model at a specific decision point in a flight."},
      {"id": "cc-17", "question": "How do you know when you''re experiencing continuation bias?"},
      {"id": "cc-18", "question": "Why should personal minimums be established before the flight?"},
      {"id": "cc-19", "question": "A DPE tells you the weather meets VFR minimums. Why might you still cancel?"},
      {"id": "cc-20", "question": "Walk me through the Apex Decision Loop using this exact scenario."},
      {"id": "cc-21", "question": "Explain the difference between outcome bias and a genuinely bad decision."},
      {"id": "cc-22", "question": "How does normalization of deviance develop over a pilot''s career, and how do you guard against it?"},
      {"id": "cc-23", "question": "Defend a decision to cancel a flight that, in hindsight, would have been fine."},
      {"id": "cc-24", "question": "What is your Apex Out for tonight''s opening scenario, and why is it acceptable?"}
    ],
    "apexChallenge": {
      "instructions": "Build a one-page PIC Decision Card you can actually reference during flight training. Every entry must be a specific, real number or a specific, real behavior -- not a general statement. Check with your instructor for this cohort''s due date.",
      "fields": [
        {"id": "ac-personal-minimums", "label": "Personal minimums (weather, wind/crosswind, ceiling, visibility, fuel, runway, night, terrain).", "type": "textarea"},
        {"id": "ac-imsafe-red-flags", "label": "IMSAFE red flags -- your specific personal indicators, not the generic checklist.", "type": "textarea"},
        {"id": "ac-fuel-minimum", "label": "Fuel minimum, stated as a specific reserve beyond the legal requirement.", "type": "textarea"},
        {"id": "ac-decision-triggers", "label": "Decision triggers -- specific, objective numbers for at least three categories.", "type": "textarea"},
        {"id": "ac-diversion-criteria", "label": "Diversion criteria.", "type": "textarea"},
        {"id": "ac-external-pressure-signs", "label": "Personal external-pressure warning signs, specific to your own life circumstances.", "type": "textarea"},
        {"id": "ac-apex-outs", "label": "Three acceptable \"outs\" you are genuinely willing to use.", "type": "textarea"}
      ]
    }
  }'::jsonb
);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M16-Q01', 'PPL', 'PPL-M16', 1, 'multiple_choice', 'PAVE stands for:', '[{"key":"A","label":"Plan, Aircraft, Visibility, Emergency"},{"key":"B","label":"Pilot, Aircraft, enVironment, External pressures"},{"key":"C","label":"Perceive, Assess, Verify, Execute"},{"key":"D","label":"Personal minimums, Airspace, Vectors, Emergency"}]', 'B', 'PAVE stands for Pilot, Aircraft, enVironment, External pressures.'),
('PPL-M16-Q02', 'PPL', 'PPL-M16', 2, 'multiple_choice', 'IMSAFE''s final letter, per current FAA source material, represents:', '[{"key":"A","label":"Experience"},{"key":"B","label":"Eating"},{"key":"C","label":"Emotion"},{"key":"D","label":"Endurance"}]', 'C', 'IMSAFE''s final letter represents Emotion, per current FAA source material.'),
('PPL-M16-Q03', 'PPL', 'PPL-M16', 3, 'multiple_choice', 'The 5P model''s five elements are:', '[{"key":"A","label":"Plan, Plane, Pilot, Passengers, Programming"},{"key":"B","label":"Perceive, Process, Perform, Plan, Pilot"},{"key":"C","label":"Pilot, Aircraft, Plan, Passengers, Programming"},{"key":"D","label":"Plan, Pilot, Passengers, Preparation, Programming"}]', 'A', 'The 5P model is Plan, Plane, Pilot, Passengers, Programming.'),
('PPL-M16-Q04', 'PPL', 'PPL-M16', 4, 'multiple_choice', 'The 3P model''s three steps are:', '[{"key":"A","label":"Plan, Prepare, Perform"},{"key":"B","label":"Perceive, Process, Perform"},{"key":"C","label":"Prepare, Process, Proceed"},{"key":"D","label":"Perceive, Plan, Perform"}]', 'B', '3P is Perceive, Process, Perform.'),
('PPL-M16-Q05', 'PPL', 'PPL-M16', 5, 'multiple_choice', 'Inside the 3P model, the CARE checklist is used during:', '[{"key":"A","label":"Perceive"},{"key":"B","label":"Process"},{"key":"C","label":"Perform"},{"key":"D","label":"None of the above"}]', 'B', 'CARE is used inside the Process step of 3P.'),
('PPL-M16-Q06', 'PPL', 'PPL-M16', 6, 'multiple_choice', 'Inside the 3P model, the TEAM checklist is used during:', '[{"key":"A","label":"Perceive"},{"key":"B","label":"Process"},{"key":"C","label":"Perform"},{"key":"D","label":"None of the above"}]', 'C', 'TEAM is used inside the Perform step of 3P.'),
('PPL-M16-Q07', 'PPL', 'PPL-M16', 7, 'multiple_choice', 'The DECIDE model''s six steps, in order, are:', '[{"key":"A","label":"Detect, Estimate, Choose, Identify, Do, Evaluate"},{"key":"B","label":"Detect, Evaluate, Choose, Identify, Do, Estimate"},{"key":"C","label":"Decide, Estimate, Choose, Identify, Do, Evaluate"},{"key":"D","label":"Detect, Estimate, Choose, Implement, Do, Evaluate"}]', 'A', 'DECIDE is Detect, Estimate, Choose, Identify, Do, Evaluate.'),
('PPL-M16-Q08', 'PPL', 'PPL-M16', 8, 'multiple_choice', 'Anti-authority''s antidote is:', '[{"key":"A","label":"It could happen to me"},{"key":"B","label":"Follow the rules, they are usually right"},{"key":"C","label":"Not so fast, think first"},{"key":"D","label":"Taking chances is foolish"}]', 'B', 'Anti-authority''s antidote is: follow the rules, they are usually right.'),
('PPL-M16-Q09', 'PPL', 'PPL-M16', 9, 'multiple_choice', 'Resignation''s antidote is:', '[{"key":"A","label":"I''m not helpless, I can make a difference"},{"key":"B","label":"Follow the rules"},{"key":"C","label":"It could happen to me"},{"key":"D","label":"Taking chances is foolish"}]', 'A', 'Resignation''s antidote is: I''m not helpless, I can make a difference.'),
('PPL-M16-Q10', 'PPL', 'PPL-M16', 10, 'multiple_choice', 'SRM is best defined as:', '[{"key":"A","label":"A required FAA certification"},{"key":"B","label":"The art and science of managing all available resources to ensure a successful flight outcome"},{"key":"C","label":"A specific avionics configuration"},{"key":"D","label":"A weather briefing service"}]', 'B', 'SRM is the art and science of managing all available resources, on-board and external, to ensure a successful flight outcome.'),
('PPL-M16-Q11', 'PPL', 'PPL-M16', 11, 'short_answer', 'A pilot notices a thunderstorm cell 40 miles from their route. Identify the hazard and the risk separately.', null, null, 'Hazard: the thunderstorm itself. Risk: the likelihood and severity of encountering severe turbulence, hail, or wind shear if the route passes close enough to the cell.'),
('PPL-M16-Q12', 'PPL', 'PPL-M16', 12, 'short_answer', 'A student pilot is flying with only 8 hours of total night experience on a moonless night to an airport with no runway lighting beyond minimum required. Identify at least two stacking risk factors.', null, null, 'Low night experience, moonless conditions (reduced visual reference), and minimal runway lighting are all stacking factors -- individually manageable, collectively reducing margin significantly.'),
('PPL-M16-Q13', 'PPL', 'PPL-M16', 13, 'short_answer', 'Rank these three factors by which most directly reflects "External Pressure" under PAVE: (a) an intermittent landing light, (b) a passenger''s connecting flight, (c) rising terrain along the route.', null, null, '(b) is the clearest External Pressure factor; (a) is an Aircraft factor; (c) is an Environment factor.'),
('PPL-M16-Q14', 'PPL', 'PPL-M16', 14, 'multiple_choice', 'A pilot cancels a flight due to a thunderstorm forecast that never develops. This decision was:', '[{"key":"A","label":"Wrong, because the storms never happened"},{"key":"B","label":"Right, based on the information available at the time"},{"key":"C","label":"Impossible to evaluate"},{"key":"D","label":"Only correct if storms had developed"}]', 'B', 'A decision should be judged by the information available at the time it was made, not by how it happened to turn out.'),
('PPL-M16-Q15', 'PPL', 'PPL-M16', 15, 'multiple_choice', 'Evaluating a past decision using only the information known at the time, not what was later learned, is the antidote to:', '[{"key":"A","label":"Continuation bias"},{"key":"B","label":"Outcome bias"},{"key":"C","label":"Normalization of deviance"},{"key":"D","label":"Confirmation bias"}]', 'B', 'This is the antidote to outcome bias -- judging a decision by its result rather than by what was known when it was made.'),
('PPL-M16-Q16', 'PPL', 'PPL-M16', 16, 'multiple_choice', 'A pilot who repeatedly departs slightly over their stated personal minimums without incident, and gradually accepts this as normal, is exhibiting:', '[{"key":"A","label":"Outcome bias"},{"key":"B","label":"Continuation bias"},{"key":"C","label":"Normalization of deviance"},{"key":"D","label":"Anti-authority attitude"}]', 'C', 'This is normalization of deviance -- repeated exposure without consequence quietly lowering the perceived standard.'),
('PPL-M16-Q17', 'PPL', 'PPL-M16', 17, 'scenario', 'A pilot is 90 minutes into a 2-hour flight. Weather has been trending worse since the 30-minute mark, though the destination remains technically VFR. Fuel is adequate. What should the pilot consider before deciding to continue?', null, null, 'The trend across the whole flight, not just the current destination report; whether a personal trigger point has already been passed; and that continuing now offers fewer good options than diverting would have offered 60 minutes earlier.'),
('PPL-M16-Q18', 'PPL', 'PPL-M16', 18, 'scenario', 'A pilot is legal in every respect for a planned flight -- weight, weather, fuel, and currency all individually check out -- but margin in each category is thin. What should the pilot do before committing to a go decision?', null, null, 'Build a full risk stack considering all factors together, not just individually; recognize that stacked thin margins can combine into an unacceptable overall risk even when each factor alone is legal.'),
('PPL-M16-Q19', 'PPL', 'PPL-M16', 19, 'short_answer', 'Explain why a personal minimum should be set before a specific flight is being planned, not during that planning.', null, null, 'Setting a minimum without the pressure of an actual, specific flight removes it from the influence of get-there-itis, hazardous attitudes, and external pressure -- a standard decided calmly is more likely to be honored honestly under pressure than one decided in the moment.'),
('PPL-M16-Q20', 'PPL', 'PPL-M16', 20, 'short_answer', 'A new private pilot has a legal crosswind limit equal to the aircraft''s demonstrated crosswind component. Should their personal minimum be the same number? Explain.', null, null, 'No -- a personal minimum should reflect the pilot''s own actual, current proficiency, which for a new pilot is very likely below the aircraft''s full demonstrated capability. The personal minimum should be set based on real experience, not the aircraft''s ceiling.'),
('PPL-M16-Q21', 'PPL', 'PPL-M16', 21, 'short_answer', '"The forecast is probably being conservative again, it usually is." Identify the likely hazardous attitude and its antidote.', null, null, 'Likely invulnerability (and/or anti-authority toward the forecast itself). Antidote: it could happen to me / follow the guidance, it''s usually right.'),
('PPL-M16-Q22', 'PPL', 'PPL-M16', 22, 'short_answer', '"Let''s just get in the air and see how it looks." Identify the likely hazardous attitude and its antidote.', null, null, 'Likely impulsivity. Antidote: not so fast, think first.'),
('PPL-M16-Q23', 'PPL', 'PPL-M16', 23, 'multiple_choice', 'Which FAA source document is the primary reference for the DECIDE model and the five hazardous attitudes?', '[{"key":"A","label":"FAR/AIM"},{"key":"B","label":"FAA-H-8083-9, Aviation Instructor''s Handbook"},{"key":"C","label":"Advisory Circular 61-98"},{"key":"D","label":"FAA-H-8083-3, Airplane Flying Handbook"}]', 'B', 'FAA-H-8083-9, the Aviation Instructor''s Handbook, is the primary reference for DECIDE and the five hazardous attitudes.'),
('PPL-M16-Q24', 'PPL', 'PPL-M16', 24, 'multiple_choice', 'A CFI recommends a personal minimum stricter than a student''s own initial estimate. This is an example of:', '[{"key":"A","label":"An inappropriate override of student authority"},{"key":"B","label":"A legitimate input to how personal minimums should evolve"},{"key":"C","label":"A regulatory requirement"},{"key":"D","label":"Irrelevant to personal minimums"}]', 'B', 'This is a legitimate input to how a student''s personal minimums should evolve over time.'),
('PPL-M16-Q25', 'PPL', 'PPL-M16', 25, 'short_answer', 'Explain in your own words why "a good outcome does not automatically mean you made a good decision."', null, null, 'A decision should be judged by the reasoning and information available at the time it was made, not by how it happened to turn out -- a risky decision can produce a fine outcome by luck, and a sound decision can still produce a bad outcome despite being the right call given what was known.'),
('PPL-M16-Q26', 'PPL', 'PPL-M16', 26, 'short_answer', 'Name one FAA-standard ADM model (5P, 3P, or DECIDE) and explain when a pilot would choose to use it over the others.', null, null, 'Answers will vary -- e.g., 3P (Perceive, Process, Perform) is best for a continuous, rapid, real-time loop; 5P is best reviewed at scheduled decision points through a flight; DECIDE suits an unfolding, evolving situation requiring a structured step-by-step response.'),
('PPL-M16-Q27', 'PPL', 'PPL-M16', 27, 'short_answer', 'State the six steps of the Apex Decision Loop in order, and explain what happens after Reassess.', null, null, 'Recognize, Assess, Options, Decide, Act, Reassess. After Reassess, the loop restarts at Recognize if conditions have changed, rather than treating the decision as final and closed.'),
('PPL-M16-Q28', 'PPL', 'PPL-M16', 28, 'short_answer', 'Explain the difference between LAW/REGULATION, FAA GUIDANCE, and APEX BEST PRACTICE, using one example of each.', null, null, 'LAW/REGULATION is a binding 14 CFR requirement (e.g., the 8-hour alcohol rule under 91.17); FAA GUIDANCE is a recommended, non-regulatory FAA framework (e.g., PAVE); APEX BEST PRACTICE is an Apex-authored teaching tool built on top of FAA guidance (e.g., the Apex Decision Loop).'),
('PPL-M16-Q29', 'PPL', 'PPL-M16', 29, 'short_answer', 'Describe a real or plausible example of an "Apex Out" and explain why having it identified in advance matters.', null, null, 'Answers will vary -- e.g., overnighting at the destination rather than a rushed night return. Identifying it in advance matters because if the backup plan feels unacceptable in the moment, that discomfort is itself evidence the primary plan is under pressure.'),
('PPL-M16-Q30', 'PPL', 'PPL-M16', 30, 'short_answer', 'Explain why external pressure is described as dangerous "because it acts on judgment rather than on the aircraft."', null, null, 'External pressure doesn''t change the actual weather, fuel, or performance numbers -- it only distorts how a pilot interprets and weighs that unchanged information, making a marginal picture feel more acceptable than it actually is.');

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M17',
  '{
    "modulePurpose": "Build the ability to recognize physiological and psychological degradation in yourself -- often the first and only warning available -- and to act on objective indicators rather than subjective feeling.",
    "objectives": [
      {"id": "obj-hypoxia-types-stages", "label": "Explain the physiological effects of hypoxia and its four types, and the stages of impairment."},
      {"id": "obj-spatial-disorientation-iceflags", "label": "Explain spatial disorientation and the eight illusions that cause it (ICEFLAGS)."},
      {"id": "obj-fatigue-decision-making", "label": "Describe fatigue''s effect on decision-making and reaction time, including acute vs. chronic fatigue and circadian effects."},
      {"id": "obj-alcohol-drugs-medications", "label": "Explain the effects of alcohol, drugs, and over-the-counter medications on flying ability, and the exact requirements of 14 CFR 91.17."},
      {"id": "obj-stress-cognitive-tunneling", "label": "Describe stress and cognitive tunneling and their effect on cognitive performance and attention."},
      {"id": "obj-carbon-monoxide-symptoms", "label": "Explain carbon monoxide poisoning symptoms, sources, and detection in piston aircraft."},
      {"id": "obj-shell-model-apply", "label": "Apply the SHELL model to classify a human factors mismatch by interface."},
      {"id": "obj-swiss-cheese-model-apply", "label": "Apply the Swiss Cheese Model to explain how minor gaps can align into a real accident."},
      {"id": "obj-apex-silent-six-apply", "label": "Apply the Apex Silent Six as a systematic personal self-check before and during flight."},
      {"id": "obj-subjective-assessment-unreliable", "label": "Recognize why subjective self-assessment (''I feel fine'') is an unreliable test on its own."},
      {"id": "obj-defend-aeromedical-minimum", "label": "Defend a personal minimum related to an aeromedical factor under DPE-style questioning."}
    ],
    "guidedNotes": [
      {"id": "apex-silent-six", "section": "The Apex Silent Six", "prompt": "What are the six factors in the Apex Silent Six, and why is each one described as a threat that degrades performance quietly?"},
      {"id": "shell-swiss-cheese-models", "section": "SHELL & Swiss Cheese Models", "prompt": "What are the four components of the SHELL model, and how does the Swiss Cheese Model explain how minor gaps in separate layers can align into a real accident?"},
      {"id": "hypoxia", "section": "Hypoxia", "prompt": "What are the four types of hypoxia, what does Time of Useful Consciousness tell you, and why is early hypoxia often described as pleasant rather than alarming?"},
      {"id": "spatial-disorientation-iceflags", "section": "Spatial Disorientation (ICEFLAGS)", "prompt": "What are the eight ICEFLAGS illusions, and why do instruments beat your instincts when one of them is actively occurring?"},
      {"id": "fatigue", "section": "Fatigue", "prompt": "What is the difference between acute and chronic fatigue, and how do circadian effects degrade performance independent of raw hours slept?"},
      {"id": "alcohol-drugs-medications", "section": "Alcohol, Drugs & Medications", "prompt": "What are the three independent conditions of 14 CFR 91.17, and why can even a \"non-drowsy\" over-the-counter medication still be disqualifying?"},
      {"id": "stress-cognitive-tunneling", "section": "Stress & Cognitive Tunneling", "prompt": "What is cognitive tunneling, and how does acute versus chronic stress each affect a pilot''s cognitive performance and attention?"},
      {"id": "carbon-monoxide", "section": "Carbon Monoxide", "prompt": "How can carbon monoxide enter the cabin of a piston aircraft, why is skin discoloration an unreliable warning sign, and what''s the correct immediate response if you suspect it?"}
    ],
    "scenario": {
      "narrative": "Ten scenarios rehearsing the Apex Silent Six against realistic, individually-minor factors that compound -- altitude, illusions, fatigue, medication, cabin heat, stress, turbulence, and combinations of all of them at once.",
      "prompts": [
        {"id": "scenario-1-high-altitude-mountain-crossing", "prompt": "Scenario 1 -- The High-Altitude Mountain Crossing: A planned cross-country requires 30 minutes above 12,500 ft to clear mountainous terrain, with no supplemental oxygen on board. What does 91.211 actually require here, and what are your real options?"},
        {"id": "scenario-2-night-departure-no-horizon", "prompt": "Scenario 2 -- Night Departure, No Visible Horizon: A night takeoff over dark, featureless terrain with no visible horizon and a rapid initial climb. Which specific illusion is most likely here, and why?"},
        {"id": "scenario-3-third-flight-lesson-saturday", "prompt": "Scenario 3 -- The Third Flight Lesson This Saturday: A CFI has already flown two lessons today and has a third scheduled for late afternoon, feeling \"a little tired but fine.\" What objective factors matter here beyond how the CFI feels?"},
        {"id": "scenario-4-cold-medicine-decision", "prompt": "Scenario 4 -- The Cold Medicine Decision: A pilot has a mild cold and took a non-drowsy cold medication two hours before a planned flight. How many separate IMSAFE flags does this scenario actually contain?"},
        {"id": "scenario-5-winter-cabin-heat", "prompt": "Scenario 5 -- The Winter Cabin Heat Scenario: A cold-weather flight with cabin heat running at maximum for over an hour, no CO detector on board. What specifically elevates the risk here?"},
        {"id": "scenario-6-stressful-week", "prompt": "Scenario 6 -- The Stressful Week: A pilot is going through a difficult personal situation and has a long-planned flight scheduled for this weekend. Is this a hazard the pilot would recognize on their own?"},
        {"id": "scenario-7-unexpected-turbulence", "prompt": "Scenario 7 -- The Unexpected Turbulence Encounter: Moderate, unexpected turbulence develops, and the pilot becomes intensely focused on the airspeed indicator, momentarily losing track of altitude and heading. What''s happening here in human factors terms?"},
        {"id": "scenario-8-post-flight-revelation", "prompt": "Scenario 8 -- The Post-Flight Revelation: After landing, a pilot realizes they don''t fully remember the last 15 minutes of an otherwise uneventful flight. What hazards from tonight could explain this?"},
        {"id": "scenario-9-combination-flight", "prompt": "Scenario 9 -- The Combination Flight: A hot afternoon, a pilot who skipped lunch, moderate turbulence, and a route that briefly requires 10,500 ft -- no single factor alone seems disqualifying. Build the Apex Silent Six for this flight, out loud."},
        {"id": "scenario-10-i-feel-completely-fine", "prompt": "Scenario 10 -- \"I Feel Completely Fine\": A pilot insists they feel completely fine despite several objective risk factors present -- poor sleep, a medication, a long day. Why can''t \"I feel fine\" settle this question on its own?"}
      ]
    },
    "checkrideCorner": [
      {"id": "cc-1", "question": "What are the four types of hypoxia?"},
      {"id": "cc-2", "question": "What are the symptoms of hypoxia, and at what altitudes should you be concerned?"},
      {"id": "cc-3", "question": "What''s the FAA''s rule regarding alcohol and flying?"},
      {"id": "cc-4", "question": "What are the eight illusions in ICEFLAGS?"},
      {"id": "cc-5", "question": "What''s the difference between acute and chronic fatigue?"},
      {"id": "cc-6", "question": "What are the four components of the SHELL model?"},
      {"id": "cc-7", "question": "What''s the regulatory oxygen requirement above 12,500 feet? Above 14,000 feet?"},
      {"id": "cc-8", "question": "What is cognitive tunneling?"},
      {"id": "cc-9", "question": "Describe the graveyard spiral illusion and what causes it."},
      {"id": "cc-10", "question": "How can carbon monoxide enter the cabin, and how would you detect it?"},
      {"id": "cc-11", "question": "How does fatigue affect pilot decision-making, even if you don''t feel tired?"},
      {"id": "cc-12", "question": "Explain the SHELL model and how it applies to a pilot''s own performance."},
      {"id": "cc-13", "question": "What''s the difference between the leans and the Coriolis illusion?"},
      {"id": "cc-14", "question": "Why might a non-drowsy OTC medication still be disqualifying?"},
      {"id": "cc-15", "question": "What immediate actions would you take if you suspected carbon monoxide in the cabin?"},
      {"id": "cc-16", "question": "What is circadian rhythm, and how does it affect fatigue beyond hours of sleep?"},
      {"id": "cc-17", "question": "Why is early hypoxia sometimes described as pleasant, and why does that make it more dangerous?"},
      {"id": "cc-18", "question": "How does carbon monoxide exposure relate to hypoxia physiologically?"},
      {"id": "cc-19", "question": "Explain the Swiss Cheese Model and how it applies to a human-factors-related accident."},
      {"id": "cc-20", "question": "Walk me through the Apex Silent Six using this exact scenario."},
      {"id": "cc-21", "question": "Why is a pulse oximeter potentially misleading during suspected CO exposure?"},
      {"id": "cc-22", "question": "Explain why alcohol''s effect on the body is described as causing histotoxic hypoxia specifically."},
      {"id": "cc-23", "question": "How does the Liveware-Liveware interface in the SHELL model apply to a passenger scenario?"},
      {"id": "cc-24", "question": "Defend a personal minimum related to a human factor that goes beyond the legal regulatory requirement."}
    ],
    "apexChallenge": {
      "instructions": "Track your own sleep for three consecutive nights before your next flight lesson. Immediately before that lesson, complete a full IMSAFE and Apex Silent Six self-check in writing, and submit a short reflection: would an honest check have flagged anything you might otherwise have missed? Check with your instructor for this cohort''s due date.",
      "fields": [
        {"id": "ac-sleep-log", "label": "Three-night sleep log (hours and honest quality notes for each night).", "type": "textarea"},
        {"id": "ac-imsafe-check", "label": "Completed IMSAFE self-check before the actual lesson.", "type": "textarea"},
        {"id": "ac-silent-six-check", "label": "Completed Apex Silent Six self-check before the actual lesson.", "type": "textarea"},
        {"id": "ac-reflection", "label": "Reflection: would an honest check have flagged anything subjective feeling would have missed?", "type": "textarea"}
      ]
    }
  }'::jsonb
);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M17-Q01', 'PPL', 'PPL-M17', 1, 'multiple_choice', 'Hypoxia caused by carbon monoxide binding to hemoglobin is classified as:', '[{"key":"A","label":"Hypoxic"},{"key":"B","label":"Hypemic"},{"key":"C","label":"Stagnant"},{"key":"D","label":"Histotoxic"}]', 'B', 'CO-induced hypoxia is hypemic hypoxia -- blood can''t carry enough oxygen.'),
('PPL-M17-Q02', 'PPL', 'PPL-M17', 2, 'multiple_choice', 'Hypoxia caused by alcohol''s effect on cellular oxygen use is classified as:', '[{"key":"A","label":"Hypoxic"},{"key":"B","label":"Hypemic"},{"key":"C","label":"Stagnant"},{"key":"D","label":"Histotoxic"}]', 'D', 'Alcohol impairs cells'' ability to use available oxygen, matching histotoxic hypoxia.'),
('PPL-M17-Q03', 'PPL', 'PPL-M17', 3, 'multiple_choice', 'Under 14 CFR 91.211, supplemental oxygen is required continuously above:', '[{"key":"A","label":"10,000 ft MSL"},{"key":"B","label":"12,500 ft MSL"},{"key":"C","label":"14,000 ft MSL"},{"key":"D","label":"18,000 ft MSL"}]', 'C', 'Supplemental oxygen is required continuously above 14,000 ft MSL for required crew.'),
('PPL-M17-Q04', 'PPL', 'PPL-M17', 4, 'multiple_choice', 'At FL450, time of useful consciousness is approximately:', '[{"key":"A","label":"20-30 minutes"},{"key":"B","label":"5-10 minutes"},{"key":"C","label":"30-60 seconds"},{"key":"D","label":"9-15 seconds"}]', 'D', 'At 45,000 ft, TUC is approximately 9-15 seconds.'),
('PPL-M17-Q05', 'PPL', 'PPL-M17', 5, 'multiple_choice', 'The illusion caused by a sudden return to level flight after a prolonged, gradual turn is:', '[{"key":"A","label":"The leans"},{"key":"B","label":"Coriolis illusion"},{"key":"C","label":"Graveyard spiral"},{"key":"D","label":"Somatogravic illusion"}]', 'A', 'The leans results from an abrupt correction following a turn too slow to stimulate the inner ear.'),
('PPL-M17-Q06', 'PPL', 'PPL-M17', 6, 'multiple_choice', 'A rapid acceleration on takeoff creating a false sensation of nose-up attitude is:', '[{"key":"A","label":"Inversion illusion"},{"key":"B","label":"Elevator illusion"},{"key":"C","label":"Somatogravic illusion"},{"key":"D","label":"Autokinesis"}]', 'C', 'The somatogravic illusion is a false nose-up sensation from rapid acceleration.'),
('PPL-M17-Q07', 'PPL', 'PPL-M17', 7, 'multiple_choice', 'Under 14 CFR 91.17, the maximum permitted blood alcohol concentration is:', '[{"key":"A","label":"0.02"},{"key":"B","label":"0.04"},{"key":"C","label":"0.08"},{"key":"D","label":"0.10"}]', 'B', 'The maximum permitted BAC under 91.17 is 0.04.'),
('PPL-M17-Q08', 'PPL', 'PPL-M17', 8, 'multiple_choice', 'The SHELL model''s central component, representing the human, is called:', '[{"key":"A","label":"Software"},{"key":"B","label":"Hardware"},{"key":"C","label":"Environment"},{"key":"D","label":"Liveware"}]', 'D', 'Liveware (the human) sits at the center of the SHELL model.'),
('PPL-M17-Q09', 'PPL', 'PPL-M17', 9, 'multiple_choice', 'In the Swiss Cheese Model, an accident occurs when:', '[{"key":"A","label":"A single major failure happens"},{"key":"B","label":"Gaps in every layer of defense happen to align"},{"key":"C","label":"The pilot makes one mistake"},{"key":"D","label":"Weather alone causes the event"}]', 'B', 'An accident occurs only when gaps in every layer of defense happen to align.'),
('PPL-M17-Q10', 'PPL', 'PPL-M17', 10, 'multiple_choice', 'Fatigue that resolves with a single night of adequate sleep is best described as:', '[{"key":"A","label":"Chronic fatigue"},{"key":"B","label":"Circadian fatigue"},{"key":"C","label":"Acute fatigue"},{"key":"D","label":"Cumulative fatigue"}]', 'C', 'Acute fatigue is short-term tiredness that usually resolves with one good rest period.'),
('PPL-M17-Q11', 'PPL', 'PPL-M17', 11, 'short_answer', 'A pilot notices their fingernails have NOT turned blue or red despite feeling a headache and mild confusion during a winter flight with the heater on. Should this reassure them about CO exposure? Explain your reasoning.', null, null, 'No -- skin/nail discoloration is not a reliable CO indicator and often doesn''t appear even at meaningfully elevated exposure levels; headache and confusion alone warrant immediate action (heat off, fresh air, land).'),
('PPL-M17-Q12', 'PPL', 'PPL-M17', 12, 'short_answer', 'A student pilot took a "non-drowsy" antihistamine three hours ago for hay fever and feels normal. Identify every separate IMSAFE flag present in this scenario.', null, null, 'At minimum two: the medication itself (Medication) and the underlying allergy condition being treated (Illness) -- both are independently relevant, not just the drowsiness question.'),
('PPL-M17-Q13', 'PPL', 'PPL-M17', 13, 'short_answer', 'Rank these three altitudes by regulatory oxygen obligation for the required minimum flight crew: (a) 13,000 ft for 45 minutes, (b) 14,500 ft for 10 minutes, (c) 11,000 ft for 3 hours.', null, null, '(b) requires oxygen immediately (above 14,000 ft, continuous requirement). (a) requires oxygen (30+ minutes above 12,500 ft threshold already exceeded). (c) requires no supplemental oxygen under 91.211 (below 12,500 ft).'),
('PPL-M17-Q14', 'PPL', 'PPL-M17', 14, 'multiple_choice', 'A pilot who feels "completely fine" despite poor sleep, a medication, and a long day should primarily rely on:', '[{"key":"A","label":"Their subjective feeling"},{"key":"B","label":"Objective indicators like hours slept and time awake"},{"key":"C","label":"Past experience flying in similar states"},{"key":"D","label":"Whether passengers are waiting"}]', 'B', 'The pilot should rely on objective indicators like hours slept and time awake, not subjective feeling.'),
('PPL-M17-Q15', 'PPL', 'PPL-M17', 15, 'multiple_choice', 'Cognitive tunneling is most accurately described as:', '[{"key":"A","label":"Falling asleep at the controls"},{"key":"B","label":"Attention narrowing onto one task, excluding other critical information"},{"key":"C","label":"A vestibular illusion"},{"key":"D","label":"A type of hypoxia"}]', 'B', 'Cognitive tunneling is attention narrowing onto one task, excluding other critical information.'),
('PPL-M17-Q16', 'PPL', 'PPL-M17', 16, 'multiple_choice', 'Which statement about circadian rhythm and fatigue is most accurate?', '[{"key":"A","label":"Circadian effects only matter on international flights"},{"key":"B","label":"Circadian low points occur regardless of hours actually slept"},{"key":"C","label":"Circadian rhythm has no measurable effect on GA pilots"},{"key":"D","label":"Circadian rhythm only affects night flights"}]', 'B', 'Circadian low points occur at predictable times regardless of hours actually slept.'),
('PPL-M17-Q17', 'PPL', 'PPL-M17', 17, 'scenario', 'A pilot is planning a flight that will briefly cross 13,000 ft for 40 minutes to clear terrain, with no oxygen equipment on board. What should the pilot do before this flight?', null, null, 'Recognize the flight as planned violates 14 CFR 91.211 (30+ minutes above 12,500 ft without oxygen for required crew); options include a lower route, a fuel stop to allow a longer lower-altitude path, or sourcing supplemental oxygen equipment before departure.'),
('PPL-M17-Q18', 'PPL', 'PPL-M17', 18, 'scenario', 'A pilot lands safely after a flight but doesn''t remember the final 15 minutes clearly, which included time at the aircraft''s highest altitude for the day. What should this pilot investigate before their next flight?', null, null, 'Investigate both hypoxia (given the altitude detail) and possible CO exposure as leading explanations; a safe landing doesn''t rule out a real physiological event, and the aircraft''s oxygen equipment, exhaust system, and personal fitness should all be reviewed before flying again.'),
('PPL-M17-Q19', 'PPL', 'PPL-M17', 19, 'short_answer', 'Using the SHELL model, classify each of the following as primarily a Software, Hardware, Environment, or Liveware-Liveware issue: (a) an outdated checklist, (b) a passenger pressuring the pilot to continue, (c) a malfunctioning attitude indicator, (d) dense haze reducing visibility.', null, null, '(a) Software. (b) Liveware-Liveware. (c) Hardware. (d) Environment.'),
('PPL-M17-Q20', 'PPL', 'PPL-M17', 20, 'short_answer', 'Apply the Apex Silent Six to a flight where the pilot: skipped breakfast, is flying at 9,500 ft, took an OTC pain reliever for a headache, and has a CO detector on board that shows no alert. Which factors are addressed, and which remain open questions?', null, null, 'Carbon Monoxide is actively monitored (detector, no alert). Substances (the pain reliever) and Stress/nutrition (skipped breakfast) are open questions requiring further self-assessment. Hypoxia is unlikely to be regulatorily triggered at 9,500 ft but individual tolerance still varies. Illusions and Fatigue aren''t addressed by the facts given and should be separately checked.'),
('PPL-M17-Q21', 'PPL', 'PPL-M17', 21, 'multiple_choice', 'A DPE asks why early hypoxia is particularly dangerous. The strongest answer notes that:', '[{"key":"A","label":"It causes immediate unconsciousness"},{"key":"B","label":"It often feels pleasant, working against self-recognition"},{"key":"C","label":"It only affects inexperienced pilots"},{"key":"D","label":"It has no measurable symptoms at all"}]', 'B', 'Early hypoxia often feels pleasant, which works against a pilot recognizing it in themselves.'),
('PPL-M17-Q22', 'PPL', 'PPL-M17', 22, 'multiple_choice', 'The correct immediate response to suspected carbon monoxide in the cabin, in order, generally begins with:', '[{"key":"A","label":"Calling ATC first"},{"key":"B","label":"Checking the pulse oximeter"},{"key":"C","label":"Turning cabin heat off and maximizing fresh air"},{"key":"D","label":"Waiting to see if symptoms worsen"}]', 'C', 'The correct immediate response begins with cabin heat off and maximizing fresh air, acting immediately rather than confirming the diagnosis first.'),
('PPL-M17-Q23', 'PPL', 'PPL-M17', 23, 'multiple_choice', 'Which of the following is NOT one of the ICEFLAGS illusions?', '[{"key":"A","label":"Autokinesis"},{"key":"B","label":"Somatogravic"},{"key":"C","label":"Vertigo"},{"key":"D","label":"Coriolis"}]', 'C', 'Vertigo is not one of the eight ICEFLAGS illusions.'),
('PPL-M17-Q24', 'PPL', 'PPL-M17', 24, 'multiple_choice', 'A pilot''s personal fuel and altitude minimums, set stricter than the legal floor, is an example of:', '[{"key":"A","label":"A regulatory requirement"},{"key":"B","label":"FAA guidance"},{"key":"C","label":"A personal minimum, per the distinction taught in Module 16"},{"key":"D","label":"An Apex proprietary framework"}]', 'C', 'This is a personal minimum, per the distinction taught in Module 16.'),
('PPL-M17-Q25', 'PPL', 'PPL-M17', 25, 'short_answer', 'Explain in your own words why the Apex Silent Six are described as "threats that degrade performance quietly."', null, null, 'Each of the six factors (hypoxia, illusions, fatigue, substances, stress, carbon monoxide) can meaningfully impair a pilot''s judgment or performance well before it produces an obvious, alarming symptom -- several, like early hypoxia or fatigue, can even feel pleasant or unremarkable while actively degrading capability.'),
('PPL-M17-Q26', 'PPL', 'PPL-M17', 26, 'short_answer', 'Name one FAA/ICAO-standard human factors model taught this module (SHELL or Swiss Cheese) and explain when a pilot or instructor would reach for it.', null, null, 'Answers will vary -- e.g., the SHELL model is useful for classifying exactly which interface (Software, Hardware, Environment, or Liveware) a specific mismatch belongs to; the Swiss Cheese Model is useful for explaining, after the fact or in training, how several individually survivable gaps aligned into a real accident.'),
('PPL-M17-Q27', 'PPL', 'PPL-M17', 27, 'short_answer', 'Describe a real or plausible connection between two of the Silent Six factors (e.g., alcohol and hypoxia, or CO and hypoxia) and why that connection matters operationally.', null, null, 'Carbon monoxide binds hemoglobin roughly 200 times more readily than oxygen, directly producing hypemic hypoxia -- so CO exposure is not a separate hazard from hypoxia, but a specific mechanism that causes one of its four types, and the two should be assessed together rather than independently.'),
('PPL-M17-Q28', 'PPL', 'PPL-M17', 28, 'short_answer', 'Explain why "I feel fine" is not, by itself, sufficient evidence of fitness to fly.', null, null, 'Several of the Silent Six factors, especially early hypoxia and fatigue, can actively distort a pilot''s own self-perception -- sometimes producing mild euphoria or a false sense of normalcy -- so subjective feeling is exactly the instrument most likely to fail silently when it matters most.'),
('PPL-M17-Q29', 'PPL', 'PPL-M17', 29, 'short_answer', 'Describe one personal minimum you would set related to a human factor from tonight, and explain your reasoning.', null, null, 'Answers will vary -- e.g., a personal oxygen altitude limit below the regulatory 12,500 ft threshold, or a bottle-to-throttle window longer than the legal 8 hours -- reasoning should connect to the pilot''s own actual tolerance or risk margin, not simply restate the legal minimum.'),
('PPL-M17-Q30', 'PPL', 'PPL-M17', 30, 'short_answer', 'Using the Swiss Cheese Model, identify which layer (Organization, Supervision, Preconditions, or The Act) each of the following belongs to: (a) the flight school does not require CO detectors, (b) an instructor doesn''t flag a student''s known fatigue pattern, (c) the student skips breakfast that morning, (d) the student flies despite feeling unusually tired.', null, null, '(a) Organization. (b) Supervision. (c) Preconditions. (d) The Act -- the point where accumulated gaps in the earlier layers finally align into an actual unsafe decision.');
