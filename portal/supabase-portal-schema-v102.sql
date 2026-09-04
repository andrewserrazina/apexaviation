-- Apex Advantage -- Modules 10-13 companion content (v102)
--
-- Ships real, authored Module Companion content + scored assessments for
-- PPL-M10 (Aviation Weather Theory), PPL-M11 (Aviation Weather Products &
-- Decision Making), PPL-M12 (Aviation Weather Decision-Making), and
-- PPL-M13 (Weight & Balance) -- same schema/shape as PPL-M01..M09
-- (supabase-portal-schema-v88.sql through v101.sql).
--
-- Each production package is written for the LIVE instructor-led class
-- (slide deck, timing notes, instructor prep, per-slide script) -- only
-- the subset that belongs in the async student companion workbook is
-- imported here: module purpose, the real learning objectives, guided-
-- notes prompts (one per major topic/framework, following each module's
-- own Content Summary section), the Scenario Workshop (condensed into
-- single write-in prompts per required scenario, matching the existing
-- modules' pattern), the full Checkride Corner question bank (question
-- text only -- this workbook is a write-your-own-answer/self-rate tool,
-- not a reveal-the-answer one, same as every other module), and, for
-- PPL-M13 only, a real standalone Apex Challenge section (the only one of
-- these four packages whose source material described one; M10/M11/M12
-- explicitly flagged "no standalone Apex Challenge section existed" and
-- that has not been fabricated here).
--
-- Also corrects site/portal-stable.js's GUIDED_NOTES_MODULES fallback
-- prompts for PPL-M10, PPL-M11, PPL-M12, and PPL-M13: the prompts already
-- live there described a generic/different curriculum framing than these
-- real production packages (e.g. PPL-M10's fallback covered "Density
-- Altitude & Wind Shear," which isn't part of this module's real content,
-- while omitting both of the module's actual named frameworks -- the Apex
-- Weather Chain and the Apex Weather Decision Model, entirely) -- a
-- pre-existing mismatch, fixed in the same application-code change that
-- introduces this content, same precedent as v101's own PPL-M09 fix.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v101.

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M10',
  '{
    "modulePurpose": "Build genuine weather intuition -- the ability to predict likely wind, cloud, precipitation, turbulence, and icing outcomes from first principles, and to make and defend sound go/no-go decisions using that understanding.",
    "objectives": [
      {"id": "obj-atmosphere-composition", "label": "Describe atmospheric composition."},
      {"id": "obj-atmosphere-layers", "label": "Explain atmospheric layers."},
      {"id": "obj-heat-transfer", "label": "Explain heat transfer processes."},
      {"id": "obj-pressure-systems", "label": "Explain pressure systems."},
      {"id": "obj-wind-formation", "label": "Explain wind formation."},
      {"id": "obj-coriolis", "label": "Explain the Coriolis Effect."},
      {"id": "obj-stability", "label": "Differentiate stable and unstable air."},
      {"id": "obj-cloud-formation", "label": "Predict cloud formation."},
      {"id": "obj-lifting-mechanisms", "label": "Explain lifting mechanisms."},
      {"id": "obj-frontal-systems", "label": "Explain frontal systems."},
      {"id": "obj-thunderstorm-development", "label": "Explain thunderstorm development."},
      {"id": "obj-turbulence-formation", "label": "Explain turbulence formation."},
      {"id": "obj-icing-formation", "label": "Explain icing formation."},
      {"id": "obj-weather-hazards", "label": "Analyze weather hazards."},
      {"id": "obj-go-no-go", "label": "Make weather-based go/no-go decisions."},
      {"id": "obj-defend-checkride", "label": "Defend weather decisions during a checkride."}
    ],
    "guidedNotes": [
      {"id": "apex-weather-chain", "section": "The Apex Weather Chain", "prompt": "What are the six sequential steps of the Apex Weather Chain, from Energy through Weather, and how do you use it to reason through what part of the chain is driving the weather you''re seeing?"},
      {"id": "atmosphere-heating", "section": "Atmosphere & Heating", "prompt": "What is the atmosphere''s basic composition, and why is the surface -- not sunlight passing directly through the air -- what actually heats the atmosphere?"},
      {"id": "pressure-wind-coriolis", "section": "Pressure & Wind", "prompt": "How do pressure gradients drive wind speed, and how do the Coriolis effect and surface friction together explain why wind spirals around a pressure system instead of flowing straight from high to low pressure?"},
      {"id": "stability-clouds", "section": "Moisture, Stability & Clouds", "prompt": "What does a small, shrinking temperature/dew point spread predict, and how does knowing only whether the air is stable or unstable let you predict cloud type, ride quality, and precipitation pattern?"},
      {"id": "lifting-mechanisms-fronts", "section": "Lifting Mechanisms & Fronts", "prompt": "What are the four lifting mechanisms that force air upward, and how do cold, warm, stationary, and occluded fronts differ in speed of movement and associated weather?"},
      {"id": "thunderstorms-turbulence-icing", "section": "Thunderstorms, Turbulence & Icing", "prompt": "What are the three stages of thunderstorm development and which stage holds the greatest hazard concentration, what are the four causes of turbulence, and what two conditions must occur together for structural icing to form?"},
      {"id": "apex-weather-decision-model", "section": "The Apex Weather Decision Model", "prompt": "What are the four questions of the Apex Weather Decision Model, and why does deciding your exit strategy before departure matter as much as the first three questions?"}
    ],
    "scenario": {
      "narrative": "Six scenarios built around the Apex Weather Decision Model -- practice reasoning through what exists, what''s developing, what could develop, and your exit strategy before you''re ever asked to do it live on a checkride.",
      "prompts": [
        {"id": "scenario-1-beautiful-morning", "prompt": "Scenario 1 -- The Beautiful Morning: Departure conditions are perfect, but the forecast deteriorates later in the day. Do you launch? What part of the Apex Weather Decision Model matters most here, and what''s your exit strategy if the forecast verifies?"},
        {"id": "scenario-2-summer-afternoon", "prompt": "Scenario 2 -- The Summer Afternoon: A cross-country flight is scheduled as convective activity develops. Do you proceed or delay, and what would confirm how quickly this is developing?"},
        {"id": "scenario-3-mountain-route", "prompt": "Scenario 3 -- The Mountain Route: Strong winds are forecast crossing mountainous terrain. What hazards exist, and how does terrain interact with wind to create them?"},
        {"id": "scenario-4-hidden-icing", "prompt": "Scenario 4 -- The Hidden Icing Threat: Temperature is near freezing at altitude, with visible moisture present. Walk through your risk assessment -- what are your options if you can''t avoid both conditions at once?"},
        {"id": "scenario-5-warm-front-trap", "prompt": "Scenario 5 -- The Warm Front Trap: Ceilings have been slowly lowering while the pilot continues toward the destination. What warning signs were missed, and at what point should a decision have been made?"},
        {"id": "scenario-6-dpe-weather-scenario", "prompt": "Scenario 6 -- The DPE Weather Scenario: An examiner presents a high pressure system, an approaching cold front, and a small dew point spread. Explain the likely weather this picture produces, walking through your reasoning using the Apex Weather Chain."}
      ]
    },
    "checkrideCorner": [
      {"id": "cc-1", "question": "What causes wind?"},
      {"id": "cc-2", "question": "Explain stable vs. unstable air."},
      {"id": "cc-3", "question": "What clouds are associated with thunderstorms?"},
      {"id": "cc-4", "question": "What lifting mechanisms create clouds?"},
      {"id": "cc-5", "question": "Describe a cold front."},
      {"id": "cc-6", "question": "Describe a warm front."},
      {"id": "cc-7", "question": "What conditions are required for icing?"},
      {"id": "cc-8", "question": "Why does fog form?"},
      {"id": "cc-9", "question": "What weather is associated with low pressure?"},
      {"id": "cc-10", "question": "How would weather affect your go/no-go decision?"},
      {"id": "cc-11", "question": "Why is the atmosphere heated from below rather than directly by sunlight passing through it?"},
      {"id": "cc-12", "question": "Explain the Coriolis effect and why wind doesn''t flow straight from high to low pressure."},
      {"id": "cc-13", "question": "What''s the difference between a stationary front and an occluded front?"},
      {"id": "cc-14", "question": "Walk me through the three stages of thunderstorm development."},
      {"id": "cc-15", "question": "What hazards are associated with thunderstorms, and what''s the correct avoidance strategy?"},
      {"id": "cc-16", "question": "What are the four types of turbulence covered tonight, and what causes each?"},
      {"id": "cc-17", "question": "Walk me through the Apex Weather Decision Model using a real scenario."},
      {"id": "cc-18", "question": "Why does Apex say most weather accidents begin with optimism, not recklessness?"},
      {"id": "cc-19", "question": "Why does even a small amount of structural ice matter for a light training aircraft?"},
      {"id": "cc-20", "question": "What''s the practical difference between predicting weather from stability alone versus needing a full forecast?"}
    ]
  }'::jsonb
);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M10-Q01', 'PPL', 'PPL-M10', 1, 'multiple_choice', 'The atmosphere is composed primarily of:', '[{"key":"A","label":"Oxygen and water vapor"},{"key":"B","label":"Nitrogen and oxygen"},{"key":"C","label":"Carbon dioxide and nitrogen"},{"key":"D","label":"Water vapor and carbon dioxide"}]', 'B', 'Nitrogen (~78%) and oxygen (~21%) make up nearly all of the atmosphere, with a small but critical fraction of water vapor.'),
('PPL-M10-Q02', 'PPL', 'PPL-M10', 2, 'multiple_choice', 'Most private pilot flying occurs in which atmospheric layer?', '[{"key":"A","label":"Stratosphere"},{"key":"B","label":"Troposphere"},{"key":"C","label":"Tropopause"},{"key":"D","label":"Mesosphere"}]', 'B', 'The troposphere -- nearly all private pilot flying occurs within this lowest layer.'),
('PPL-M10-Q03', 'PPL', 'PPL-M10', 3, 'multiple_choice', 'The atmosphere is primarily heated by:', '[{"key":"A","label":"Direct sunlight passing through the air"},{"key":"B","label":"The surface, which is heated by the sun and warms the air above it"},{"key":"C","label":"Wind friction"},{"key":"D","label":"Water vapor absorption alone"}]', 'B', 'The surface absorbs solar radiation and then heats the air above it through conduction and convection -- sunlight itself does not directly heat the air it passes through.'),
('PPL-M10-Q04', 'PPL', 'PPL-M10', 4, 'multiple_choice', 'A steep pressure gradient (tightly packed isobars) generally indicates:', '[{"key":"A","label":"Calm wind"},{"key":"B","label":"Stronger wind"},{"key":"C","label":"Stable air"},{"key":"D","label":"No weather significance"}]', 'B', 'Tightly packed isobars indicate a steep pressure gradient, which produces stronger wind.'),
('PPL-M10-Q05', 'PPL', 'PPL-M10', 5, 'multiple_choice', 'The Coriolis effect deflects moving air in the Northern Hemisphere to the:', '[{"key":"A","label":"Left"},{"key":"B","label":"Right"},{"key":"C","label":"It does not deflect air"},{"key":"D","label":"Straight down"}]', 'B', 'In the Northern Hemisphere, the Coriolis effect deflects moving air to the right.'),
('PPL-M10-Q06', 'PPL', 'PPL-M10', 6, 'multiple_choice', 'A small and shrinking temperature/dew point spread is a strong indicator of:', '[{"key":"A","label":"Thunderstorm risk"},{"key":"B","label":"Fog risk"},{"key":"C","label":"Turbulence risk"},{"key":"D","label":"Icing risk only"}]', 'B', 'A small, shrinking spread means the air is approaching saturation, which is the key predictive sign of fog risk.'),
('PPL-M10-Q07', 'PPL', 'PPL-M10', 7, 'multiple_choice', 'Which is a characteristic of stable air?', '[{"key":"A","label":"Cumuliform clouds"},{"key":"B","label":"Showery precipitation"},{"key":"C","label":"Stratiform clouds and steady precipitation"},{"key":"D","label":"Strong turbulence"}]', 'C', 'Stable air produces smooth flight, stratiform clouds, and steady precipitation.'),
('PPL-M10-Q08', 'PPL', 'PPL-M10', 8, 'multiple_choice', 'Which is a characteristic of unstable air?', '[{"key":"A","label":"Smooth air"},{"key":"B","label":"Cumuliform clouds and possible thunderstorms"},{"key":"C","label":"Poor visibility with steady rain"},{"key":"D","label":"No vertical air movement"}]', 'B', 'Unstable air produces turbulence, cumuliform clouds, showery precipitation, and possible thunderstorms.'),
('PPL-M10-Q09', 'PPL', 'PPL-M10', 9, 'multiple_choice', 'Cloud formation requires moisture, cooling, and:', '[{"key":"A","label":"High pressure"},{"key":"B","label":"Condensation nuclei"},{"key":"C","label":"A frontal boundary"},{"key":"D","label":"Strong wind"}]', 'B', 'Clouds require moisture, cooling, and condensation nuclei together.'),
('PPL-M10-Q10', 'PPL', 'PPL-M10', 10, 'multiple_choice', 'Cumulonimbus clouds are associated with:', '[{"key":"A","label":"Fair weather only"},{"key":"B","label":"Thunderstorm-level hazards"},{"key":"C","label":"High-altitude ice crystals only"},{"key":"D","label":"Fog formation"}]', 'B', 'Cumulonimbus is the vertical development cloud type representing the mature stage of thunderstorm formation, with thunderstorm-level hazards.'),
('PPL-M10-Q11', 'PPL', 'PPL-M10', 11, 'multiple_choice', 'Which lifting mechanism is caused by terrain forcing air upward?', '[{"key":"A","label":"Convection"},{"key":"B","label":"Orographic lift"},{"key":"C","label":"Frontal lift"},{"key":"D","label":"Convergence"}]', 'B', 'Orographic lift occurs when terrain forces air upward.'),
('PPL-M10-Q12', 'PPL', 'PPL-M10', 12, 'multiple_choice', 'Which lifting mechanism is caused by surface heating alone?', '[{"key":"A","label":"Orographic lift"},{"key":"B","label":"Convection"},{"key":"C","label":"Frontal lift"},{"key":"D","label":"Convergence"}]', 'B', 'Convection is driven by surface heating alone.'),
('PPL-M10-Q13', 'PPL', 'PPL-M10', 13, 'multiple_choice', 'A cold front is generally characterized by:', '[{"key":"A","label":"Slow movement and widespread steady precipitation"},{"key":"B","label":"Rapid movement and possible thunderstorms/turbulence"},{"key":"C","label":"No associated weather"},{"key":"D","label":"Only high clouds"}]', 'B', 'Cold fronts move quickly and can produce rapid weather changes, thunderstorms, and turbulence.'),
('PPL-M10-Q14', 'PPL', 'PPL-M10', 14, 'multiple_choice', 'A warm front is generally characterized by:', '[{"key":"A","label":"Rapid movement and severe turbulence"},{"key":"B","label":"Widespread clouds, reduced visibility, and steady precipitation"},{"key":"C","label":"No associated weather"},{"key":"D","label":"Sudden clearing"}]', 'B', 'Warm fronts move slowly and produce widespread clouds, reduced visibility, and steady precipitation.'),
('PPL-M10-Q15', 'PPL', 'PPL-M10', 15, 'multiple_choice', 'An occluded front occurs when:', '[{"key":"A","label":"Two air masses are stationary"},{"key":"B","label":"A cold front catches up to and lifts a warm front off the surface"},{"key":"C","label":"High pressure dominates an area"},{"key":"D","label":"Fog forms overnight"}]', 'B', 'An occluded front occurs when a faster cold front catches up to and lifts a warm front entirely off the surface.'),
('PPL-M10-Q16', 'PPL', 'PPL-M10', 16, 'multiple_choice', 'Which thunderstorm stage contains the greatest combination of hazards?', '[{"key":"A","label":"Cumulus"},{"key":"B","label":"Mature"},{"key":"C","label":"Dissipating"},{"key":"D","label":"All stages are equally hazardous"}]', 'B', 'The mature stage, where updrafts and downdrafts coexist, holds the greatest hazard concentration.'),
('PPL-M10-Q17', 'PPL', 'PPL-M10', 17, 'multiple_choice', 'The correct strategy for a thunderstorm cell along your route is to:', '[{"key":"A","label":"Thread carefully between the heaviest returns"},{"key":"B","label":"Avoid it entirely, with a wide margin"},{"key":"C","label":"Fly directly beneath it"},{"key":"D","label":"Increase speed to cross quickly"}]', 'B', 'Avoid the storm entirely with real margin -- never attempt to thread through gaps in the returns.'),
('PPL-M10-Q18', 'PPL', 'PPL-M10', 18, 'multiple_choice', 'Convective turbulence is generally worst:', '[{"key":"A","label":"Early morning"},{"key":"B","label":"Hot afternoons"},{"key":"C","label":"Overnight"},{"key":"D","label":"It doesn''t vary by time of day"}]', 'B', 'Convective turbulence peaks on hot afternoons, when accumulated surface heat drives the strongest convection.'),
('PPL-M10-Q19', 'PPL', 'PPL-M10', 19, 'multiple_choice', 'Mountain wave turbulence is often visually indicated by:', '[{"key":"A","label":"Cirrus clouds"},{"key":"B","label":"Lenticular clouds"},{"key":"C","label":"Fog"},{"key":"D","label":"Stratus clouds"}]', 'B', 'Lenticular clouds are a visual warning sign of mountain wave activity.'),
('PPL-M10-Q20', 'PPL', 'PPL-M10', 20, 'multiple_choice', 'Structural icing requires visible moisture and:', '[{"key":"A","label":"High wind"},{"key":"B","label":"Temperatures at or below freezing"},{"key":"C","label":"Low pressure"},{"key":"D","label":"A frontal passage"}]', 'B', 'Structural icing requires visible moisture and temperatures at or below freezing, occurring together.'),
('PPL-M10-Q21', 'PPL', 'PPL-M10', 21, 'multiple_choice', 'Which type of icing is generally considered the most dangerous?', '[{"key":"A","label":"Rime ice"},{"key":"B","label":"Mixed ice"},{"key":"C","label":"Clear ice"},{"key":"D","label":"All are equally dangerous"}]', 'C', 'Clear ice is generally considered the most dangerous -- it is hard, heavy, and difficult to remove.'),
('PPL-M10-Q22', 'PPL', 'PPL-M10', 22, 'scenario', 'Departure conditions are perfect, but the forecast shows deteriorating weather later in the day. Using the Apex Weather Decision Model, what should the pilot consider? Walk through all four questions.', null, null, 'What weather exists now (good), what weather is developing (deteriorating trend), what weather could develop (worse than forecast), and what the exit strategy is if conditions arrive earlier or worse than expected -- a clear personal decision point before launch.'),
('PPL-M10-Q23', 'PPL', 'PPL-M10', 23, 'scenario', 'A cross-country flight is scheduled for early afternoon, with convective activity developing along the route. What factors should drive the proceed/delay decision? Explain your reasoning.', null, null, 'The rate and intensity of development, available alternate routes or airports, personal and aircraft limitations, and a pre-set decision point for turning back -- not just how the sky looks at the moment of departure.'),
('PPL-M10-Q24', 'PPL', 'PPL-M10', 24, 'scenario', 'Ceilings have been slowly lowering throughout a flight, and the pilot continues toward the destination. What warning signs were likely missed? Identify at least two warning signs.', null, null, 'The trend itself (ceilings dropping over time, not a one-time observation), the shrinking margin between current conditions and personal/legal minimums, and the absence of a pre-decided point at which the pilot would divert or turn back.'),
('PPL-M10-Q25', 'PPL', 'PPL-M10', 25, 'scenario', 'An examiner presents a weather picture: a high pressure system, an approaching cold front, and a small dew point spread. What weather should the pilot expect? Explain using the Apex Weather Chain.', null, null, 'Currently fair weather under the high pressure system, but the approaching cold front signals a shift toward instability, possible thunderstorms, and turbulence; the small dew point spread adds fog/low-ceiling risk in the near term before the front''s passage changes conditions.'),
('PPL-M10-Q26', 'PPL', 'PPL-M10', 26, 'short_answer', 'Explain the Apex Weather Chain and why it''s useful even without a specific forecast in hand.', null, null, 'The Chain (Energy -> Pressure Differences -> Air Movement -> Lift -> Condensation -> Weather) lets a pilot reason through what weather should be developing from first principles, rather than needing to already have a forecast -- asking what part of the Chain is driving what you''re seeing builds real weather intuition.'),
('PPL-M10-Q27', 'PPL', 'PPL-M10', 27, 'short_answer', 'Why does Apex say ''most weather accidents begin with optimism,'' not recklessness?', null, null, 'Because the accident pattern most commonly involves a hopeful read of marginal or deteriorating conditions -- a pilot who wanted the weather to hold -- rather than a pilot who knowingly disregarded clear hazards.'),
('PPL-M10-Q28', 'PPL', 'PPL-M10', 28, 'short_answer', 'Explain the difference between what stable air and unstable air predict about a flight, using only the stability determination.', null, null, 'Stable air predicts smooth air, stratiform clouds, and poor visibility with steady precipitation; unstable air predicts turbulence, cumuliform clouds, and showery precipitation with possible thunderstorms -- the stability alone forecasts most of the flying experience.'),
('PPL-M10-Q29', 'PPL', 'PPL-M10', 29, 'short_answer', 'Why is a small temperature/dew point spread a more useful fog predictor than temperature or dew point alone?', null, null, 'Because fog forms when air cools to its dew point; the spread directly measures how close the air already is to saturation, regardless of the specific temperature -- a small spread means saturation (and fog) is close regardless of what the absolute numbers are.'),
('PPL-M10-Q30', 'PPL', 'PPL-M10', 30, 'short_answer', 'Describe the Apex Weather Decision Model and explain why the fourth question (exit strategy) matters as much as the first three.', null, null, 'The model asks: what weather exists, what weather is developing, what weather could develop, and what is my exit strategy. The exit strategy question matters because a plan decided calmly before departure is far more reliable than a decision made reactively and under pressure once conditions have already deteriorated.');

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M11',
  '{
    "modulePurpose": "Teach students to retrieve, interpret, and combine every major aviation weather product into a complete operational briefing, and to make and confidently defend a go/no-go decision using that briefing.",
    "objectives": [
      {"id": "obj-metar", "label": "Interpret METARs."},
      {"id": "obj-speci", "label": "Interpret SPECI reports."},
      {"id": "obj-taf", "label": "Decode TAFs."},
      {"id": "obj-pirep", "label": "Interpret PIREPs."},
      {"id": "obj-airmet", "label": "Explain AIRMETs."},
      {"id": "obj-sigmet", "label": "Explain SIGMETs."},
      {"id": "obj-convective-sigmet", "label": "Explain Convective SIGMETs."},
      {"id": "obj-surface-analysis", "label": "Read Surface Analysis Charts."},
      {"id": "obj-weather-depiction", "label": "Read Weather Depiction Charts."},
      {"id": "obj-radar", "label": "Read Radar Imagery."},
      {"id": "obj-satellite", "label": "Interpret Satellite Imagery."},
      {"id": "obj-prog-charts", "label": "Use Prog Charts."},
      {"id": "obj-winds-aloft", "label": "Explain Winds Aloft Forecasts."},
      {"id": "obj-faa-briefing", "label": "Obtain FAA Weather Briefings."},
      {"id": "obj-aviationweather-gov", "label": "Use AviationWeather.gov efficiently."},
      {"id": "obj-hazardous-trends", "label": "Identify hazardous weather trends."},
      {"id": "obj-complete-picture", "label": "Build a complete weather picture."},
      {"id": "obj-go-no-go-defend", "label": "Make and defend weather-based go/no-go decisions."}
    ],
    "guidedNotes": [
      {"id": "apex-weather-briefing-flow", "section": "The Apex Weather Briefing Flow", "prompt": "What are the four steps of the Apex Weather Briefing Flow, and why must a complete briefing work through all four in order?"},
      {"id": "metar-speci", "section": "METARs & SPECI Reports", "prompt": "What does a full METAR report, field by field, and what triggers a SPECI between routine hourly reports?"},
      {"id": "taf-decode", "section": "TAFs", "prompt": "What is the difference between a TAF''s FM, TEMPO, PROB30/PROB40, and BECMG groups, and how should forecast confidence change with how far into the period a segment falls?"},
      {"id": "pireps", "section": "PIREPs", "prompt": "What is the difference between a UA and a UUA PIREP, and why doesn''t a lack of PIREPs confirm safe conditions?"},
      {"id": "airmets-sigmets", "section": "AIRMETs & SIGMETs", "prompt": "What does each of AIRMET Sierra, Tango, and Zulu cover, and how does a SIGMET (or Convective SIGMET specifically) differ in severity and required response?"},
      {"id": "charts-imagery", "section": "Charts & Imagery", "prompt": "What does a surface analysis chart show, what does radar actually measure (and what does it NOT show), and when does satellite imagery -- visible, infrared, or water vapor -- beat radar?"},
      {"id": "winds-aloft-briefing-tools", "section": "Winds Aloft & AviationWeather.gov", "prompt": "How do you decode a winds aloft report, and how should wind direction relative to your course -- not just raw wind speed -- drive your cruise altitude selection?"},
      {"id": "apex-weather-decision-matrix", "section": "The Apex Weather Decision Matrix", "prompt": "What do Green, Yellow, Orange, and Red mean on the Apex Weather Decision Matrix, and why is the more conservative color the right call when you''re genuinely torn between two?"}
    ],
    "scenario": {
      "narrative": "Six scenarios built around the Apex Weather Briefing Flow and Decision Matrix -- practice combining every product into one operational picture and defending a specific color and decision, not just describing the weather.",
      "prompts": [
        {"id": "scenario-1-excellent-metar-poor-taf", "prompt": "Scenario 1 -- Excellent METAR, Poor TAF: The current METAR is excellent, but the TAF for later in your flight window is significantly worse. Do you launch? Which step of the Briefing Flow resolves this conflict, and what color is this on the Decision Matrix?"},
        {"id": "scenario-2-turbulence-pirep", "prompt": "Scenario 2 -- The Turbulence PIREP: An excellent forecast across every product is undermined by a moderate turbulence PIREP along the route. Now what -- does one PIREP outweigh an otherwise clean forecast?"},
        {"id": "scenario-3-isolated-storms-radar", "prompt": "Scenario 3 -- Isolated Storms on Radar: Radar shows isolated storm cells developing along a planned cross-country route. What does the word ''isolated'' tell you, and what doesn''t it tell you?"},
        {"id": "scenario-4-approaching-cold-front", "prompt": "Scenario 4 -- The Approaching Cold Front: The surface analysis chart shows an approaching cold front, and departure is in three hours. Do you proceed? What does Module 10 tell you to expect as this front approaches, and what''s your timing margin?"},
        {"id": "scenario-5-convective-sigmet", "prompt": "Scenario 5 -- The Convective SIGMET: Every product looked acceptable, then a Convective SIGMET is issued along the route. How does the plan change, and does this move the Decision Matrix color -- by how much?"},
        {"id": "scenario-6-dpe-weather-briefing", "prompt": "Scenario 6 -- The DPE Weather Briefing: A full product package (METAR, TAF, radar, satellite, PIREPs, winds aloft, AIRMETs) is presented for a complete briefing and go/no-go defense. Walk through the Briefing Flow step by step, then state your Decision Matrix color and defend it."}
      ]
    },
    "checkrideCorner": [
      {"id": "cc-1", "question": "What is the difference between a METAR and a SPECI?"},
      {"id": "cc-2", "question": "What does ''AUTO'' in a METAR tell you?"},
      {"id": "cc-3", "question": "How do you read a wind group with a gust value?"},
      {"id": "cc-4", "question": "What''s the difference between BKN and OVC, and why does it matter?"},
      {"id": "cc-5", "question": "What does a TEMPO group mean, and how is it different from a FM group?"},
      {"id": "cc-6", "question": "What''s the difference between PROB30 and PROB40?"},
      {"id": "cc-7", "question": "What does a BECMG group describe?"},
      {"id": "cc-8", "question": "What''s the difference between a UA and a UUA PIREP?"},
      {"id": "cc-9", "question": "Why might a lack of PIREPs NOT mean conditions are fine?"},
      {"id": "cc-10", "question": "What are the three AIRMET types, and what does each cover?"},
      {"id": "cc-11", "question": "What''s the difference between a non-convective and a Convective SIGMET?"},
      {"id": "cc-12", "question": "What criteria trigger a Convective SIGMET?"},
      {"id": "cc-13", "question": "How do you identify likely weather from a surface analysis chart alone?"},
      {"id": "cc-14", "question": "What is beam overshoot, and why does it matter?"},
      {"id": "cc-15", "question": "What is attenuation, and why does it matter?"},
      {"id": "cc-16", "question": "Why doesn''t radar show turbulence directly?"},
      {"id": "cc-17", "question": "When is water vapor imagery more useful than visible imagery?"},
      {"id": "cc-18", "question": "How do winds aloft affect your cruise altitude selection?"},
      {"id": "cc-19", "question": "What''s the difference between a surface prog chart and a surface analysis chart?"},
      {"id": "cc-20", "question": "Walk me through your AviationWeather.gov workflow for a cross-country briefing."},
      {"id": "cc-21", "question": "What are the five questions a complete weather briefing must answer?"},
      {"id": "cc-22", "question": "Explain the Apex Weather Decision Matrix and how you''d classify a marginal scenario."},
      {"id": "cc-23", "question": "Why does Apex say good pilots look for reasons NOT to go?"},
      {"id": "cc-24", "question": "A Convective SIGMET is issued for your route after you''ve already launched. What do you do?"},
      {"id": "cc-25", "question": "Give an example of a Green-looking briefing turned Red by a single product."}
    ]
  }'::jsonb
);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M11-Q01', 'PPL', 'PPL-M11', 1, 'multiple_choice', 'In a METAR, ''27012G18KT'' means:', '[{"key":"A","label":"Wind 270 degrees at 12 kt, no gusts"},{"key":"B","label":"Wind 270 degrees at 12 kt, gusting to 18 kt"},{"key":"C","label":"Wind 12 degrees at 270 kt"},{"key":"D","label":"Wind variable up to 18 kt"}]', 'B', 'Wind from 270 degrees true at 12 knots, gusting to 18 knots -- the G value is the peak gust speed.'),
('PPL-M11-Q02', 'PPL', 'PPL-M11', 2, 'multiple_choice', 'A METAR sky condition of ''BKN020'' indicates:', '[{"key":"A","label":"A ceiling at 2,000 ft AGL"},{"key":"B","label":"A ceiling at 20,000 ft AGL"},{"key":"C","label":"Few clouds at 2,000 ft"},{"key":"D","label":"Clear below 2,000 ft"}]', 'A', 'BKN020 is a broken ceiling at 2,000 feet AGL.'),
('PPL-M11-Q03', 'PPL', 'PPL-M11', 3, 'multiple_choice', 'What does ''AUTO'' indicate in a METAR?', '[{"key":"A","label":"The report was manually corrected"},{"key":"B","label":"The observation is fully automated"},{"key":"C","label":"The station is closed"},{"key":"D","label":"The report is a SPECI"}]', 'B', 'AUTO means the observation is fully automated, with no human augmentation.'),
('PPL-M11-Q04', 'PPL', 'PPL-M11', 4, 'multiple_choice', 'A SPECI is issued when:', '[{"key":"A","label":"Exactly one hour has passed"},{"key":"B","label":"Conditions change significantly between routine reports"},{"key":"C","label":"The tower closes"},{"key":"D","label":"Only during thunderstorms"}]', 'B', 'A SPECI is issued whenever conditions change significantly between routine hourly reports.'),
('PPL-M11-Q05', 'PPL', 'PPL-M11', 5, 'multiple_choice', 'In a TAF, an FM group indicates:', '[{"key":"A","label":"A temporary, fluctuating condition"},{"key":"B","label":"A complete change to a new forecast baseline"},{"key":"C","label":"A 30% probability event"},{"key":"D","label":"The forecast issuance time only"}]', 'B', 'FM indicates a complete replacement of the forecast baseline going forward.'),
('PPL-M11-Q06', 'PPL', 'PPL-M11', 6, 'multiple_choice', 'In a TAF, a TEMPO group indicates:', '[{"key":"A","label":"A permanent change"},{"key":"B","label":"Temporary conditions expected for under an hour at a time"},{"key":"C","label":"The forecast has expired"},{"key":"D","label":"Certainty of the described conditions"}]', 'B', 'TEMPO describes temporary, fluctuating conditions expected for under an hour at a time, with the base forecast still otherwise applying.'),
('PPL-M11-Q07', 'PPL', 'PPL-M11', 7, 'multiple_choice', 'PROB30 in a TAF means:', '[{"key":"A","label":"30% probability of the described conditions"},{"key":"B","label":"30-minute duration"},{"key":"C","label":"30 knots of wind"},{"key":"D","label":"30% cloud coverage"}]', 'A', 'PROB30 expresses a 30% forecast probability of the described condition, most often thunderstorms.'),
('PPL-M11-Q08', 'PPL', 'PPL-M11', 8, 'multiple_choice', 'A BECMG group describes:', '[{"key":"A","label":"An instantaneous change"},{"key":"B","label":"A gradual transition to new conditions over a specified window"},{"key":"C","label":"A canceled forecast"},{"key":"D","label":"Current conditions only"}]', 'B', 'BECMG describes a gradual transition to new conditions over a specified time window.'),
('PPL-M11-Q09', 'PPL', 'PPL-M11', 9, 'multiple_choice', 'A UUA PIREP designation indicates:', '[{"key":"A","label":"A routine report"},{"key":"B","label":"An urgent report, reserved for hazards like severe turbulence or icing"},{"key":"C","label":"An automated report"},{"key":"D","label":"A report from an unidentified aircraft"}]', 'B', 'UUA is an urgent pilot report, reserved for hazards like severe turbulence, severe icing, or a tornado.'),
('PPL-M11-Q10', 'PPL', 'PPL-M11', 10, 'multiple_choice', 'Why might PIREPs often provide the most valuable information?', '[{"key":"A","label":"They''re always more accurate than radar"},{"key":"B","label":"They come from a real aircraft in real conditions, filling gaps in observation coverage"},{"key":"C","label":"They''re required every hour"},{"key":"D","label":"They replace the need for a TAF"}]', 'B', 'PIREPs are real, current data from an actual aircraft, often filling gaps that forecast products alone can''t.'),
('PPL-M11-Q11', 'PPL', 'PPL-M11', 11, 'multiple_choice', 'AIRMET Sierra covers:', '[{"key":"A","label":"Icing and freezing levels"},{"key":"B","label":"IFR conditions and/or extensive mountain obscuration"},{"key":"C","label":"Turbulence and strong surface winds"},{"key":"D","label":"Convective activity"}]', 'B', 'AIRMET Sierra covers IFR conditions and mountain obscuration.'),
('PPL-M11-Q12', 'PPL', 'PPL-M11', 12, 'multiple_choice', 'AIRMET Tango covers:', '[{"key":"A","label":"IFR conditions"},{"key":"B","label":"Moderate turbulence, sustained winds of 30 kt or greater, and/or low-level wind shear"},{"key":"C","label":"Icing only"},{"key":"D","label":"Volcanic ash"}]', 'B', 'AIRMET Tango covers turbulence, sustained wind of 30 knots or greater, and low-level wind shear.'),
('PPL-M11-Q13', 'PPL', 'PPL-M11', 13, 'multiple_choice', 'AIRMET Zulu covers:', '[{"key":"A","label":"Turbulence"},{"key":"B","label":"Moderate icing and freezing levels"},{"key":"C","label":"IFR conditions"},{"key":"D","label":"Thunderstorms"}]', 'B', 'AIRMET Zulu covers icing and freezing levels.'),
('PPL-M11-Q14', 'PPL', 'PPL-M11', 14, 'multiple_choice', 'A Convective SIGMET implies:', '[{"key":"A","label":"Only heavy rain"},{"key":"B","label":"Significant turbulence, icing, and low-level wind shear potential, alongside severe thunderstorms"},{"key":"C","label":"Clear skies with isolated showers"},{"key":"D","label":"A routine forecast update"}]', 'B', 'A Convective SIGMET implies significant turbulence, icing, and wind shear together with severe thunderstorm activity.'),
('PPL-M11-Q15', 'PPL', 'PPL-M11', 15, 'multiple_choice', 'What''s the key legal/practical difference between a non-convective SIGMET and an AIRMET?', '[{"key":"A","label":"There is no difference"},{"key":"B","label":"SIGMETs cover more severe hazards affecting all aircraft, not just light GA"},{"key":"C","label":"AIRMETs are always more serious"},{"key":"D","label":"SIGMETs are only issued at night"}]', 'B', 'SIGMETs cover more severe hazards affecting all aircraft, not just light general aviation aircraft.'),
('PPL-M11-Q16', 'PPL', 'PPL-M11', 16, 'multiple_choice', 'On a surface analysis chart, tightly packed isobars indicate:', '[{"key":"A","label":"Calm wind"},{"key":"B","label":"A stronger pressure gradient and stronger wind"},{"key":"C","label":"Stable air only"},{"key":"D","label":"No weather significance"}]', 'B', 'Tightly packed isobars indicate a stronger pressure gradient and stronger wind.'),
('PPL-M11-Q17', 'PPL', 'PPL-M11', 17, 'multiple_choice', 'Radar reflectivity primarily shows:', '[{"key":"A","label":"Turbulence"},{"key":"B","label":"Precipitation intensity"},{"key":"C","label":"Cloud cover without precipitation"},{"key":"D","label":"Wind shear directly"}]', 'B', 'Radar reflectivity shows precipitation intensity, not turbulence or non-precipitating clouds.'),
('PPL-M11-Q18', 'PPL', 'PPL-M11', 18, 'multiple_choice', 'Beam overshoot is a radar limitation that can cause:', '[{"key":"A","label":"Overestimating nearby storm intensity"},{"key":"B","label":"Under-representing low-level precipitation at long range"},{"key":"C","label":"False station identifiers"},{"key":"D","label":"Loss of satellite signal"}]', 'B', 'Beam overshoot can cause radar to under-represent real precipitation and hazards far from the radar site.'),
('PPL-M11-Q19', 'PPL', 'PPL-M11', 19, 'multiple_choice', 'Attenuation in radar imagery refers to:', '[{"key":"A","label":"Signal weakening as it passes through heavy precipitation, potentially hiding cells behind it"},{"key":"B","label":"A software error"},{"key":"C","label":"Excess radar sensitivity"},{"key":"D","label":"Beam overshoot at short range"}]', 'A', 'Attenuation is signal weakening as it passes through heavy precipitation, which can hide or understate hazards behind a strong cell.'),
('PPL-M11-Q20', 'PPL', 'PPL-M11', 20, 'multiple_choice', 'Which satellite imagery type is usable at night?', '[{"key":"A","label":"Visible only"},{"key":"B","label":"Infrared and water vapor"},{"key":"C","label":"Neither"},{"key":"D","label":"Only visible and water vapor"}]', 'B', 'Infrared and water vapor imagery both work at night; visible imagery requires daylight.'),
('PPL-M11-Q21', 'PPL', 'PPL-M11', 21, 'multiple_choice', 'Water vapor satellite imagery is especially useful for:', '[{"key":"A","label":"Measuring precipitation intensity"},{"key":"B","label":"Spotting developing moisture/systems before clouds are visible"},{"key":"C","label":"Nighttime visible-light photography"},{"key":"D","label":"Measuring wind speed directly"}]', 'B', 'Water vapor imagery is useful for spotting developing moisture or systems before clouds have actually formed.'),
('PPL-M11-Q22', 'PPL', 'PPL-M11', 22, 'multiple_choice', 'A winds aloft report of ''2712'' at a given altitude means:', '[{"key":"A","label":"Wind from 271 degrees at 2 kt"},{"key":"B","label":"Wind from 270 degrees at 12 kt"},{"key":"C","label":"Wind from 27 degrees at 12 kt"},{"key":"D","label":"Wind speed 271 kt"}]', 'B', '2712 decodes as wind from 270 degrees at 12 knots.'),
('PPL-M11-Q23', 'PPL', 'PPL-M11', 23, 'multiple_choice', 'A surface prog chart differs from a surface analysis chart because it:', '[{"key":"A","label":"Shows current conditions only"},{"key":"B","label":"Forecasts future position of pressure systems and fronts"},{"key":"C","label":"Only covers radar data"},{"key":"D","label":"Replaces the need for a TAF"}]', 'B', 'A surface prog chart forecasts the future position of pressure systems and fronts, while a surface analysis chart shows current conditions.'),
('PPL-M11-Q24', 'PPL', 'PPL-M11', 24, 'multiple_choice', 'The Graphical Forecast for Aviation (GFA) is useful because it:', '[{"key":"A","label":"Replaces the need for any other product"},{"key":"B","label":"Consolidates several products into one visual timeline"},{"key":"C","label":"Only shows current METARs"},{"key":"D","label":"Is not available on AviationWeather.gov"}]', 'B', 'The GFA consolidates several products into one visual timeline.'),
('PPL-M11-Q25', 'PPL', 'PPL-M11', 25, 'scenario', 'A METAR is excellent, but the TAF for later in your flight window shows deteriorating conditions. Do you launch? Explain. Use the Apex Weather Briefing Flow.', null, null, 'A decision requires combining current AND forecast weather -- the Briefing Flow''s Step 2 (Forecast Weather) can''t be skipped just because Step 1 (Current Weather) looks good. The deteriorating TAF should shift the decision toward Yellow or Orange on the Decision Matrix, with a clear timing plan or delay considered.'),
('PPL-M11-Q26', 'PPL', 'PPL-M11', 26, 'scenario', 'Every product looks acceptable, then a Convective SIGMET is issued along your route. How does the plan change? Explain using the Decision Matrix.', null, null, 'A Convective SIGMET is serious enough to move an otherwise-Green picture toward Red -- avoidance (reroute, delay, or cancel) is the standard response, not something to weigh lightly against an otherwise good picture.'),
('PPL-M11-Q27', 'PPL', 'PPL-M11', 27, 'scenario', 'Radar shows isolated storm cells developing along your route. What does ''isolated'' tell you, and what doesn''t it tell you? Explain the limitation.', null, null, '''Isolated'' tells you the cells aren''t a continuous line, but it doesn''t tell you how fast new cells might develop, their individual severity, or whether gaps between them will remain open -- radar alone can''t confirm safe passage between isolated cells.'),
('PPL-M11-Q28', 'PPL', 'PPL-M11', 28, 'scenario', 'The surface analysis chart shows an approaching cold front, and your flight departs in three hours. Using Module 10 knowledge, what should you expect? Explain the timing risk.', null, null, 'Cold fronts move quickly and can produce rapid, sometimes severe weather changes including thunderstorms and turbulence; a three-hour window may or may not be enough margin depending on the front''s actual speed, which should be checked against the prog chart, not assumed.'),
('PPL-M11-Q29', 'PPL', 'PPL-M11', 29, 'scenario', 'A single PIREP reports severe turbulence at your planned altitude, along your route, from a similar aircraft, despite an otherwise clean forecast. Should this change your decision? Explain your reasoning.', null, null, 'Yes -- a single credible, recent, relevant PIREP should meaningfully change the plan, since it''s real-time data from an actual aircraft that no forecast product can fully replace or override.'),
('PPL-M11-Q30', 'PPL', 'PPL-M11', 30, 'short_answer', 'Explain the Apex Weather Briefing Flow and why the four steps must be worked in order.', null, null, 'Current Weather -> Forecast Weather -> Hazards -> Decision. Each step builds on the last: you can''t assess forecast weather without knowing current conditions, can''t assess hazards without both, and can''t make a sound decision without all three -- skipping a step means deciding on an incomplete picture.'),
('PPL-M11-Q31', 'PPL', 'PPL-M11', 31, 'short_answer', 'Explain the Apex Weather Decision Matrix and why choosing the more conservative color when torn is correct, not a failure to decide.', null, null, 'Green/Yellow/Orange/Red represent increasing levels of required caution. When genuinely uncertain between two colors, choosing the more conservative one reflects that real uncertainty exists -- it''s the matrix functioning as intended, not an inability to commit to an answer.'),
('PPL-M11-Q32', 'PPL', 'PPL-M11', 32, 'short_answer', 'Why can''t radar alone confirm a route is free of hazards?', null, null, 'Radar only shows precipitation -- it doesn''t show turbulence directly, doesn''t show non-precipitating clouds at all, and can under-represent hazards due to beam overshoot and attenuation, especially at longer range or behind heavy precipitation.'),
('PPL-M11-Q33', 'PPL', 'PPL-M11', 33, 'short_answer', 'Why does Apex teach ''good pilots look for reasons not to go'' instead of ''good pilots check the weather''?', null, null, 'Because the framing changes how the same information gets evaluated -- actively hunting for disqualifying hazards produces a more conservative, safer read of marginal weather than passively confirming the flight is technically permissible.'),
('PPL-M11-Q34', 'PPL', 'PPL-M11', 34, 'short_answer', 'What is the practical difference between a TAF''s FM group and its TEMPO group, and why does mixing them up matter?', null, null, 'FM completely replaces the forecast baseline going forward; TEMPO describes only temporary, fluctuating conditions layered on top of a baseline that still otherwise applies. Confusing them can lead a pilot to believe conditions have permanently changed when they''ve only temporarily dipped, or vice versa.'),
('PPL-M11-Q35', 'PPL', 'PPL-M11', 35, 'short_answer', 'Describe the five questions a complete weather briefing must answer, and explain why ''what uncertainties remain'' matters as much as ''what exists.''', null, null, 'What exists, what is changing, what hazards exist, what uncertainties remain, and whether conditions are acceptable for today''s flight. The uncertainty question matters because an honest gap in the picture (like an aging PIREP or a low-confidence forecast period) is itself decision-relevant information, not something to ignore because it''s inconvenient.');

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M12',
  '{
    "modulePurpose": "Build the judgment and discipline to make and defend conservative, evidence-based weather decisions -- especially when the weather is technically legal.",
    "objectives": [
      {"id": "obj-risk-assessments", "label": "Conduct structured weather risk assessments."},
      {"id": "obj-personal-minimums", "label": "Apply personal weather minimums."},
      {"id": "obj-evaluate-scenarios", "label": "Evaluate VFR and IFR weather scenarios."},
      {"id": "obj-hazardous-trends", "label": "Recognize hazardous weather trends."},
      {"id": "obj-get-there-itis", "label": "Identify get-there-itis."},
      {"id": "obj-risk-models", "label": "Apply the PAVE and 5P risk management models to weather."},
      {"id": "obj-inflight-deterioration", "label": "Recognize deteriorating weather in-flight."},
      {"id": "obj-delay-divert-cancel", "label": "Decide when to delay, divert, or cancel."},
      {"id": "obj-vfr-into-imc", "label": "Explain VFR into IMC accident chains."},
      {"id": "obj-conservative-habits", "label": "Build conservative weather decision habits."},
      {"id": "obj-defend-checkride", "label": "Defend weather decisions during a checkride."}
    ],
    "guidedNotes": [
      {"id": "apex-weather-decision-loop", "section": "The Apex Weather Decision Loop", "prompt": "What are the five steps of the Apex Weather Decision Loop, from What Exists to What Is the Safest Decision, and why should every real weather decision work through all five in order?"},
      {"id": "legal-vs-safe-minimums", "section": "Legal vs. Safe & Personal Minimums", "prompt": "What is the difference between legal weather minimums and personal minimums, and what factors belong on a written personal minimums worksheet?"},
      {"id": "hazardous-trends", "section": "Recognizing Hazardous Trends", "prompt": "Why does a consistent trend across successive reports matter more than any single data point, and what specific signs indicate a real hazardous trend developing?"},
      {"id": "human-factors-weather", "section": "Human Factors and Weather", "prompt": "What are get-there-itis, confirmation bias, plan continuation bias, and optimism bias, and why do they operate below conscious awareness in a real weather decision?"},
      {"id": "risk-management-models", "section": "Risk Management Models", "prompt": "How do PAVE, 5P, DECIDE, and CARE each apply specifically to a weather decision, and when would you reach for the fast CARE gut-check instead of a more detailed model?"},
      {"id": "five-questions-go-no-go", "section": "Go/No-Go: The Five Questions", "prompt": "What are the five go/no-go questions in order, and why do the last two -- would you recommend this flight to a student, would you defend it to a DPE -- matter as much as the legal and safety questions?"},
      {"id": "in-flight-decisions-xc-planning", "section": "In-Flight Decisions & Cross-Country Planning", "prompt": "Why is turning around early never a failure, and what weather-specific decision points, fuel reserves, and alternate airports should be identified during planning rather than improvised in flight?"},
      {"id": "learning-from-accidents", "section": "Learning from Weather Accidents", "prompt": "What are the five recurring weather accident patterns, and why is the earliest point in an accident chain almost always the easiest one to break?"}
    ],
    "scenario": {
      "narrative": "Eight scenarios rehearsing the exact DPE moment of presenting a weather picture and requiring a full risk assessment, a go/no-go decision, and a defense of that decision.",
      "prompts": [
        {"id": "scenario-1-legal-personal-minimums-no", "prompt": "Scenario 1 -- Legal Weather, Personal Minimums Say No: Weather meets every legal VFR requirement, but your written personal minimums say no. What do you do, and why should the written minimum be honored?"},
        {"id": "scenario-2-metar-improving-radar-worsening", "prompt": "Scenario 2 -- METAR Improving, Radar Worsening: Current conditions are trending better, but radar shows developing cells worsening along the route. How much weight should the radar trend carry against the improving current snapshot?"},
        {"id": "scenario-3-visibility-dropping-midxc", "prompt": "Scenario 3 -- Visibility Dropping Mid-Cross-Country: Halfway through a flight, visibility begins dropping steadily. What real options should you be evaluating right now, while margin still exists?"},
        {"id": "scenario-4-passengers-insist", "prompt": "Scenario 4 -- Passengers Insist on Continuing: Conditions are marginal, and your passengers push to continue to the original destination. As PIC, how do you make and communicate the decision?"},
        {"id": "scenario-5-forecast-accurate-reality-isnt", "prompt": "Scenario 5 -- Forecast Was Accurate, Reality Isn''t: A reasonable, well-sourced forecast turns out meaningfully worse than actual in-flight conditions. Does a good forecast excuse a bad outcome?"},
        {"id": "scenario-6-thunderstorms-25-miles", "prompt": "Scenario 6 -- Thunderstorms 25 Miles Away: Cells are visible and reported 25 miles from your position and route. Should you continue, using your specific personal minimum lateral distance?"},
        {"id": "scenario-7-destination-ifr-alternate-vfr", "prompt": "Scenario 7 -- Destination Goes IFR, Alternate Remains VFR: Your destination transitions to IFR while your planned alternate remains solidly VFR. Walk through executing the pre-planned diversion."},
        {"id": "scenario-8-complete-dpe-weather-scenario", "prompt": "Scenario 8 -- The Complete DPE Weather Scenario: A full scenario requires a risk assessment, go/no-go analysis, diversion plan, and defense. Narrate your walkthrough of the Weather Decision Loop to a specific, defended decision."}
      ]
    },
    "checkrideCorner": [
      {"id": "cc-1", "question": "What''s the difference between legal weather minimums and personal minimums?"},
      {"id": "cc-2", "question": "How should experience level affect personal minimums?"},
      {"id": "cc-3", "question": "Name three factors that belong in a personal weather minimums worksheet."},
      {"id": "cc-4", "question": "How do you distinguish a real hazardous trend from normal reporting variation?"},
      {"id": "cc-5", "question": "What is get-there-itis, and what''s the first step in managing it?"},
      {"id": "cc-6", "question": "Explain confirmation bias and how it affects weather decisions specifically."},
      {"id": "cc-7", "question": "Explain plan continuation bias and why it gets stronger over the course of a flight."},
      {"id": "cc-8", "question": "What is optimism bias, and how does it relate to Module 10''s teaching?"},
      {"id": "cc-9", "question": "Walk me through PAVE applied specifically to a weather decision."},
      {"id": "cc-10", "question": "Walk me through the 5P model applied specifically to a weather decision."},
      {"id": "cc-11", "question": "What does the DECIDE model add that PAVE and 5P don''t?"},
      {"id": "cc-12", "question": "What is the CARE checklist, and when would you use it instead of a more detailed model?"},
      {"id": "cc-13", "question": "Walk me through the five go/no-go questions, in order."},
      {"id": "cc-14", "question": "Why do the last two go/no-go questions (recommend to a student, defend to a DPE) matter?"},
      {"id": "cc-15", "question": "How do you recognize deteriorating weather in flight versus just normal variation?"},
      {"id": "cc-16", "question": "When would you declare an emergency for a weather-related situation?"},
      {"id": "cc-17", "question": "What is scud running, and why is it never an acceptable strategy?"},
      {"id": "cc-18", "question": "How do weather decision points differ from ordinary navigation checkpoints?"},
      {"id": "cc-19", "question": "Why does fuel reserve function as a weather-decision tool, not just a range calculation?"},
      {"id": "cc-20", "question": "Walk me through the decision chain in a VFR-into-IMC accident, and where it could break."},
      {"id": "cc-21", "question": "Why do weather accidents almost never begin with a single bad decision?"},
      {"id": "cc-22", "question": "What''s the practical difference between delay, divert, and cancel?"},
      {"id": "cc-23", "question": "Why does Apex say ''there''s always another day to fly''?"},
      {"id": "cc-24", "question": "Walk me through the Apex Weather Decision Loop using a scenario I give you right now."},
      {"id": "cc-25", "question": "Give an example of a decision that was legal but not one you''d defend to a DPE."}
    ]
  }'::jsonb
);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M12-Q01', 'PPL', 'PPL-M12', 1, 'multiple_choice', 'Meeting legal VFR weather minimums means:', '[{"key":"A","label":"The flight is automatically safe"},{"key":"B","label":"The flight is permitted, not automatically wise"},{"key":"C","label":"No personal minimums apply"},{"key":"D","label":"A DPE would always approve the flight"}]', 'B', 'Legal minimums permit a flight; they don''t automatically make it a wise decision.'),
('PPL-M12-Q02', 'PPL', 'PPL-M12', 2, 'multiple_choice', 'Personal weather minimums should be:', '[{"key":"A","label":"Set only after departure"},{"key":"B","label":"Looser than legal minimums"},{"key":"C","label":"Written down before the pressure of a specific flight exists"},{"key":"D","label":"The same for every pilot regardless of experience"}]', 'C', 'Personal minimums should be written down in advance, before the pressure of a specific flight exists.'),
('PPL-M12-Q03', 'PPL', 'PPL-M12', 3, 'multiple_choice', 'A single low ceiling report is less significant than:', '[{"key":"A","label":"A METAR issued at night"},{"key":"B","label":"A consistent downward trend across successive reports"},{"key":"C","label":"A SPECI"},{"key":"D","label":"A PIREP"}]', 'B', 'A consistent downward trend across successive reports matters more than any single data point.'),
('PPL-M12-Q04', 'PPL', 'PPL-M12', 4, 'multiple_choice', 'Get-there-itis is best described as:', '[{"key":"A","label":"A mechanical malfunction"},{"key":"B","label":"A powerful, often unconscious urge to complete a flight as planned"},{"key":"C","label":"A type of weather briefing"},{"key":"D","label":"A regulatory requirement"}]', 'B', 'Get-there-itis is an often unconscious urge to complete a flight as planned despite changing conditions.'),
('PPL-M12-Q05', 'PPL', 'PPL-M12', 5, 'multiple_choice', 'Confirmation bias in weather decision-making means:', '[{"key":"A","label":"Confirming a flight plan with ATC"},{"key":"B","label":"Selectively noticing data that supports the decision you already want to make"},{"key":"C","label":"Requiring a second pilot''s confirmation before departure"},{"key":"D","label":"Verifying a forecast against radar"}]', 'B', 'Confirmation bias is selectively noticing data that supports a decision already wanted, while ignoring contradicting data.'),
('PPL-M12-Q06', 'PPL', 'PPL-M12', 6, 'multiple_choice', 'Plan continuation bias tends to:', '[{"key":"A","label":"Weaken the further into a flight or plan you are"},{"key":"B","label":"Strengthen the further into a flight or plan you are"},{"key":"C","label":"Have no relationship to flight progress"},{"key":"D","label":"Only affect first solo flights"}]', 'B', 'Plan continuation bias strengthens the further into a flight or plan a pilot already is.'),
('PPL-M12-Q07', 'PPL', 'PPL-M12', 7, 'multiple_choice', 'In the PAVE checklist, weather primarily falls under:', '[{"key":"A","label":"Pilot"},{"key":"B","label":"Aircraft"},{"key":"C","label":"enVironment"},{"key":"D","label":"External pressures"}]', 'C', 'Weather falls under enVironment in the PAVE checklist.'),
('PPL-M12-Q08', 'PPL', 'PPL-M12', 8, 'multiple_choice', 'The 5P model includes all of the following EXCEPT:', '[{"key":"A","label":"Plan"},{"key":"B","label":"Plane"},{"key":"C","label":"Passengers"},{"key":"D","label":"Procedures"}]', 'D', 'The 5P model is Plan, Plane, Pilot, Passengers, Programming -- not Procedures.'),
('PPL-M12-Q09', 'PPL', 'PPL-M12', 9, 'multiple_choice', 'In the DECIDE model, the first step is:', '[{"key":"A","label":"Choose"},{"key":"B","label":"Detect"},{"key":"C","label":"Do"},{"key":"D","label":"Evaluate"}]', 'B', 'DECIDE begins with Detect.'),
('PPL-M12-Q10', 'PPL', 'PPL-M12', 10, 'multiple_choice', 'The CARE checklist is best used:', '[{"key":"A","label":"Only during preflight planning, never in flight"},{"key":"B","label":"As a fast gut-check, including in the moments before or during a flight"},{"key":"C","label":"Only by instructors, never by students"},{"key":"D","label":"As a replacement for PAVE and 5P"}]', 'B', 'CARE is a fast, four-question gut-check usable in the moments right before or during a flight.'),
('PPL-M12-Q11', 'PPL', 'PPL-M12', 11, 'multiple_choice', 'In the Five Questions go/no-go framework, which question comes last?', '[{"key":"A","label":"Can I legally go?"},{"key":"B","label":"Can I safely go?"},{"key":"C","label":"Would I defend this decision to a DPE?"},{"key":"D","label":"Can I comfortably go?"}]', 'C', 'The final question is: would I defend this decision to a DPE?'),
('PPL-M12-Q12', 'PPL', 'PPL-M12', 12, 'multiple_choice', 'Turning around early during a flight is best understood as:', '[{"key":"A","label":"A failure of planning"},{"key":"B","label":"A viable, respected option, not a failure"},{"key":"C","label":"Only appropriate for instrument-rated pilots"},{"key":"D","label":"A last resort after all other options are exhausted"}]', 'B', 'Turning around early is a viable, respected option -- never a failure.'),
('PPL-M12-Q13', 'PPL', 'PPL-M12', 13, 'multiple_choice', 'A precautionary landing is:', '[{"key":"A","label":"Only used after declaring an emergency"},{"key":"B","label":"Landing at the nearest suitable airport before a situation becomes a genuine emergency"},{"key":"C","label":"Illegal without ATC authorization"},{"key":"D","label":"The same as a forced landing"}]', 'B', 'A precautionary landing is landing at the nearest suitable airport before a situation becomes a genuine emergency.'),
('PPL-M12-Q14', 'PPL', 'PPL-M12', 14, 'multiple_choice', 'Scud running refers to:', '[{"key":"A","label":"A safe technique for descending through clouds"},{"key":"B","label":"Flying beneath a lowering ceiling to maintain visual contact with the ground"},{"key":"C","label":"A standard instrument approach procedure"},{"key":"D","label":"Flying above a cloud layer to avoid icing"}]', 'B', 'Scud running is flying beneath a lowering ceiling to maintain visual ground contact -- never an acceptable strategy.'),
('PPL-M12-Q15', 'PPL', 'PPL-M12', 15, 'multiple_choice', 'Weather-related conditions are:', '[{"key":"A","label":"Never a legitimate reason to declare an emergency"},{"key":"B","label":"A legitimate reason to declare an emergency"},{"key":"C","label":"Only relevant to IFR flights"},{"key":"D","label":"Grounds for automatic certificate suspension"}]', 'B', 'Weather deterioration is a fully legitimate reason to declare an emergency.'),
('PPL-M12-Q16', 'PPL', 'PPL-M12', 16, 'multiple_choice', 'A weather decision point is best described as:', '[{"key":"A","label":"A random moment during a flight"},{"key":"B","label":"A pre-planned point where a specific weather condition triggers a specific action"},{"key":"C","label":"The exact moment fuel runs low"},{"key":"D","label":"A location marked only on IFR charts"}]', 'B', 'A weather decision point is a pre-planned location where a specific weather condition triggers a specific, pre-decided action.'),
('PPL-M12-Q17', 'PPL', 'PPL-M12', 17, 'multiple_choice', 'Fuel reserved specifically for weather-driven route changes functions as:', '[{"key":"A","label":"An unnecessary buffer"},{"key":"B","label":"A genuine weather-decision tool, not just a range calculation"},{"key":"C","label":"A regulatory requirement only"},{"key":"D","label":"Irrelevant to VFR flight planning"}]', 'B', 'A weather-specific fuel margin preserves real decision-making flexibility -- it''s a decision tool, not just a range number.'),
('PPL-M12-Q18', 'PPL', 'PPL-M12', 18, 'multiple_choice', 'In most weather accident chains, the accident:', '[{"key":"A","label":"Begins with a single bad decision"},{"key":"B","label":"Begins with several individually-reasonable-feeling decisions"},{"key":"C","label":"Is entirely unpredictable"},{"key":"D","label":"Only involves pilots with under 100 hours"}]', 'B', 'Most weather accident chains involve several individually-reasonable-feeling decisions in sequence, not one obviously bad one.'),
('PPL-M12-Q19', 'PPL', 'PPL-M12', 19, 'multiple_choice', 'Which of the following best distinguishes ''delay'' from ''cancel''?', '[{"key":"A","label":"There is no meaningful difference"},{"key":"B","label":"Delay expects improvement within a known window; cancel means conditions won''t support a safe flight today"},{"key":"C","label":"Cancel is always the more conservative option in every case"},{"key":"D","label":"Delay only applies to IFR flights"}]', 'B', 'Delay expects improvement within a known window; cancel means conditions won''t support a safe flight today, period.'),
('PPL-M12-Q20', 'PPL', 'PPL-M12', 20, 'multiple_choice', 'Optimism bias in weather decision-making is best described as:', '[{"key":"A","label":"A useful and accurate way to assess marginal conditions"},{"key":"B","label":"The tendency to believe things will probably work out fine, even with mixed evidence"},{"key":"C","label":"A bias that only affects low-time pilots"},{"key":"D","label":"The same thing as confirmation bias"}]', 'B', 'Optimism bias is the tendency to believe things will probably work out fine despite mixed evidence.'),
('PPL-M12-Q21', 'PPL', 'PPL-M12', 21, 'scenario', 'A pilot''s personal minimums say no, but the weather is fully legal. What should the pilot do, and why? Explain your reasoning.', null, null, 'Honor the personal minimum -- it was set deliberately, without the pressure of the specific flight, specifically to prevent in-the-moment rationalization. ''It''s legal'' does not override a genuine, previously committed personal minimum.'),
('PPL-M12-Q22', 'PPL', 'PPL-M12', 22, 'scenario', 'A pilot notices the METAR trending better while radar shows developing cells worsening along the route. How should the pilot weigh these two products? Explain your reasoning.', null, null, 'Neither product should be dismissed -- the improving METAR reflects current surface conditions only, while worsening radar reflects a real and growing hazard along the route; the Apex Weather Decision Loop''s ''what is changing'' and ''what could go wrong'' steps should carry more weight here than the current snapshot alone.'),
('PPL-M12-Q23', 'PPL', 'PPL-M12', 23, 'scenario', 'Passengers pressure a pilot to continue into marginal conditions. What should the pilot do, and how should the decision be communicated? Explain your reasoning.', null, null, 'As PIC, the pilot retains final authority and should communicate the decision clearly and calmly, citing the specific conditions or minimums driving it -- passenger pressure, spoken or unspoken, is a known human factor that should never override a sound risk assessment.'),
('PPL-M12-Q24', 'PPL', 'PPL-M12', 24, 'scenario', 'A forecast the pilot briefed was reasonable and well-sourced, but actual in-flight conditions are meaningfully worse. Does a ''good'' forecast excuse a bad outcome? Explain your reasoning.', null, null, 'No -- a reasonable forecast reduces blame but does not change the actual risk in front of the pilot right now; the appropriate response is to reassess current conditions using the Weather Decision Loop and adjust the plan, not to continue simply because the forecast was defensible.'),
('PPL-M12-Q25', 'PPL', 'PPL-M12', 25, 'scenario', 'Thunderstorm cells are reported 25 miles from the current position and route. Should the flight continue? Explain your reasoning using personal minimums.', null, null, 'Depends on the pilot''s specific personal minimum lateral distance from thunderstorm activity -- if 25 miles doesn''t meet that pre-set standard, the flight should not continue on the current track; cells can also develop or move significantly within the time it takes to close that distance.'),
('PPL-M12-Q26', 'PPL', 'PPL-M12', 26, 'short_answer', 'Explain the difference between legal and safe, using a weather-specific example.', null, null, 'Legal means the flight meets regulatory minimums (e.g., 3 miles visibility, clear of clouds); safe means the flight is appropriate given the specific pilot''s experience, currency, and the aircraft''s capability. A flight can be fully legal and still not be a decision an experienced, disciplined pilot would make.'),
('PPL-M12-Q27', 'PPL', 'PPL-M12', 27, 'short_answer', 'Why does Apex teach that personal minimums should be written down in advance rather than decided in the moment?', null, null, 'Because in-the-moment decisions are vulnerable to get-there-itis, plan continuation bias, and optimism bias -- a standard set calmly, without the pressure of a specific flight, is far more likely to be honored honestly when that pressure actually arrives.'),
('PPL-M12-Q28', 'PPL', 'PPL-M12', 28, 'short_answer', 'Describe the Apex Weather Decision Loop and explain why ''what are my options'' comes before ''what is the safest decision.''', null, null, 'What Exists -> What Is Changing -> What Could Go Wrong -> What Are My Options -> What Is the Safest Decision. Options must be identified before a decision can be made among them -- skipping straight to a decision without first generating real options (delay, alternate, divert, cancel) risks a false binary of ''go'' or ''don''t go'' alone.'),
('PPL-M12-Q29', 'PPL', 'PPL-M12', 29, 'short_answer', 'Explain why ''there''s always another day to fly'' represents an asymmetry, not just a saying.', null, null, 'A canceled or delayed flight costs time and convenience -- a fully recoverable cost. Continuing into deteriorating weather risks an outcome that is often irreversible. The two costs are not comparable in kind, which is why professional pilots treat the conservative choice as obvious rather than a difficult tradeoff.'),
('PPL-M12-Q30', 'PPL', 'PPL-M12', 30, 'short_answer', 'Using one of the module''s case studies, explain where the accident chain could have been broken earliest, and why the earliest point is usually the easiest to break.', null, null, 'Answers will vary by case study, but should identify a specific early decision point (e.g., the original marginal departure decision) rather than a later, more dramatic moment -- early points typically still have full options available (delay, alternate route, cancel), while later points in the chain have progressively fewer safe options remaining.');

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M13',
  '{
    "modulePurpose": "Build the ability to calculate weight and balance precisely and, more importantly, to understand what every loading decision means for how the airplane will actually fly -- producing pilots who think like a PIC, not an accountant.",
    "objectives": [
      {"id": "obj-wb-matters", "label": "Explain why weight and balance matters."},
      {"id": "obj-datum", "label": "Explain the aircraft datum."},
      {"id": "obj-arms", "label": "Explain arms."},
      {"id": "obj-moments", "label": "Explain moments."},
      {"id": "obj-cg", "label": "Explain center of gravity."},
      {"id": "obj-empty-weight", "label": "Explain empty weight."},
      {"id": "obj-useful-load", "label": "Explain useful load."},
      {"id": "obj-payload", "label": "Explain payload."},
      {"id": "obj-max-gross-weight", "label": "Explain maximum gross weight."},
      {"id": "obj-ramp-weight", "label": "Explain ramp weight."},
      {"id": "obj-takeoff-weight", "label": "Explain takeoff weight."},
      {"id": "obj-landing-weight", "label": "Explain landing weight."},
      {"id": "obj-calc-loading", "label": "Calculate aircraft loading."},
      {"id": "obj-calc-moments", "label": "Calculate moments."},
      {"id": "obj-calc-cg", "label": "Calculate CG."},
      {"id": "obj-loading-graphs", "label": "Interpret loading graphs."},
      {"id": "obj-loading-tables", "label": "Use loading tables."},
      {"id": "obj-cg-envelopes", "label": "Use CG envelopes."},
      {"id": "obj-forward-cg-effects", "label": "Explain forward CG effects."},
      {"id": "obj-aft-cg-effects", "label": "Explain aft CG effects."},
      {"id": "obj-cg-stability", "label": "Explain how CG changes aircraft stability."},
      {"id": "obj-cg-stalls", "label": "Explain how CG affects stalls."},
      {"id": "obj-cg-rotation", "label": "Explain how CG affects rotation."},
      {"id": "obj-cg-landing", "label": "Explain how CG affects landing."},
      {"id": "obj-outside-envelope-danger", "label": "Explain why airplanes become dangerous outside the envelope."},
      {"id": "obj-safe-loading-decisions", "label": "Make safe loading decisions before every flight."}
    ],
    "guidedNotes": [
      {"id": "apex-loading-framework", "section": "The Apex Loading Framework", "prompt": "What are the five questions of the Apex Loading Framework, in order, and why does the last question -- would you put your own family in this airplane -- matter as much as the legal question?"},
      {"id": "fundamental-terms", "section": "Fundamental Terms", "prompt": "What is the difference between datum, station, arm, moment, and moment index, and how do empty weight, useful load, payload, and the several defined weight categories relate to each other?"},
      {"id": "understanding-cg", "section": "Understanding CG", "prompt": "Using the seesaw metaphor, what is CG conceptually, and why does adding weight anywhere other than the current CG shift the balance point?"},
      {"id": "cg-flight-effects", "section": "How CG Changes Flight Characteristics", "prompt": "What are the specific advantages and disadvantages of a forward CG versus an aft CG, and why do the aft CG disadvantages compound each other into a genuinely dangerous combination?"},
      {"id": "calculations-six-step", "section": "Weight & Balance Calculations", "prompt": "What are the six steps of the computation method, in order, and how does interpolating a loading table differ from reading a loading graph?"},
      {"id": "cg-envelope", "section": "CG Envelope Interpretation", "prompt": "What sets the forward CG limit versus the aft CG limit, and why must you check both takeoff and landing CG separately as fuel burns?"},
      {"id": "wb-risk-management", "section": "Weight & Balance and Risk Management", "prompt": "Why is being ''inside the envelope'' not automatically the same as being safe, and what specific factors build real margin beyond the legal minimum?"}
    ],
    "scenario": {
      "narrative": "Eight scenarios built around the Apex Loading Framework -- practice calculating a real loading, then defending whether you''d actually fly it, not just whether it''s legal.",
      "prompts": [
        {"id": "scenario-1-four-adults", "prompt": "Scenario 1 -- Four Adults Want to Fly Together: Four adults of varying weights, plus a modest amount of shared baggage, want to fly together in a four-seat aircraft. Calculate the loading -- is it legal, is fuel a constraint, and would you make this flight?"},
        {"id": "scenario-2-last-minute-passenger", "prompt": "Scenario 2 -- Last-Minute Passenger Arrives: A loading calculation was already finalized for three occupants, and a fourth person arrives wanting to come along. Do you recalculate from scratch, or estimate -- and what''s the real risk of skipping the recalculation?"},
        {"id": "scenario-3-family-vacation-baggage", "prompt": "Scenario 3 -- Family Vacation With Full Baggage: A family wants to fill the baggage compartment to its stated physical limit. What two separate checks does this require, and what would you leave behind if the numbers don''t work?"},
        {"id": "scenario-4-student-wants-full-fuel", "prompt": "Scenario 4 -- The Student Who Wants Full Fuel: A student insists on topping off to full fuel, reasoning that more fuel is always safer. Is that reasoning always true from a weight and balance standpoint, and how do you explain the tradeoff professionally?"},
        {"id": "scenario-5-removing-baggage-cg-shift", "prompt": "Scenario 5 -- Removing Baggage Changes the CG Unexpectedly: Removing baggage from the aft compartment shifts the CG further aft than expected, not more forward. Why can removing weight make a loading worse instead of better?"},
        {"id": "scenario-6-passenger-rear-seat", "prompt": "Scenario 6 -- A Passenger Insists on Sitting in the Back: A passenger''s seating preference wasn''t the original assumption used in the finished loading calculation. Does seat position actually matter here, and how do you recalculate?"},
        {"id": "scenario-7-heavy-instructor-student", "prompt": "Scenario 7 -- Heavy Instructor Plus Heavy Student: Both occupants are above-average weight, loading the front seats more heavily than typical. Which CG limit is most at risk, and what loading strategy compensates for it?"},
        {"id": "scenario-8-fuel-stop-vs-baggage", "prompt": "Scenario 8 -- Fuel Stop vs. Baggage Removal Decision: A planned loading is slightly over useful load. Compare carrying less fuel and planning a fuel stop against removing baggage, and make and defend a final decision using the Apex Loading Framework."}
      ]
    },
    "checkrideCorner": [
      {"id": "cc-1", "question": "What is the aircraft datum, and why does it matter?"},
      {"id": "cc-2", "question": "What''s the difference between empty weight and basic empty weight?"},
      {"id": "cc-3", "question": "How do you calculate a moment?"},
      {"id": "cc-4", "question": "What is useful load, and how is it calculated?"},
      {"id": "cc-5", "question": "What is payload, and how does it differ from useful load?"},
      {"id": "cc-6", "question": "What does the moment index simplify, and why is it used?"},
      {"id": "cc-7", "question": "What''s the difference between ramp weight and takeoff weight?"},
      {"id": "cc-8", "question": "What is maximum gross weight?"},
      {"id": "cc-9", "question": "How many pounds does one gallon of aviation gasoline weigh?"},
      {"id": "cc-10", "question": "What is zero fuel weight, conceptually?"},
      {"id": "cc-11", "question": "Walk me through how you''d calculate CG for this loading."},
      {"id": "cc-12", "question": "What happens aerodynamically if you''re loaded outside the aft CG limit?"},
      {"id": "cc-13", "question": "How does CG location affect stall speed?"},
      {"id": "cc-14", "question": "If you''re at max gross weight at departure, how does your CG change as fuel burns off?"},
      {"id": "cc-15", "question": "Where do you find the empty weight and moment for this specific aircraft?"},
      {"id": "cc-16", "question": "What''s the difference between the loading table method and the loading graph method?"},
      {"id": "cc-17", "question": "How do you interpolate between two listed values on a loading table?"},
      {"id": "cc-18", "question": "Why must you check both takeoff CG and landing CG separately?"},
      {"id": "cc-19", "question": "What''s the difference between the forward CG limit and the aft CG limit, in terms of what sets each one?"},
      {"id": "cc-20", "question": "Why is a forward CG more stable than an aft CG?"},
      {"id": "cc-21", "question": "This loading is legal but very close to the aft limit. Would you fly it? Why or why not?"},
      {"id": "cc-22", "question": "Explain why a forward CG produces a longer landing roll."},
      {"id": "cc-23", "question": "Removing 20 pounds of baggage from the aft compartment -- what happens to the CG, and why might that surprise someone?"},
      {"id": "cc-24", "question": "Walk me through the Apex Loading Framework using this exact scenario."},
      {"id": "cc-25", "question": "Why can an aft CG loading reduce stall warning margin?"},
      {"id": "cc-26", "question": "A passenger shows up unannounced right before departure. Walk me through your process."},
      {"id": "cc-27", "question": "Explain the relationship between CG location and elevator authority during flare."},
      {"id": "cc-28", "question": "Why is ''inside the envelope'' not automatically the same as ''safe to fly''?"},
      {"id": "cc-29", "question": "You''ve used another aircraft''s weight and balance sheet by mistake. What''s the risk, and how would you catch it?"},
      {"id": "cc-30", "question": "Defend a loading decision you would make differently than what the numbers alone technically allow."}
    ],
    "apexChallenge": {
      "instructions": "You''ll receive a complete PA-28 loading scenario (basic empty weight and moment, specific passenger weights, baggage, and fuel load). Determine whether the loading is legal, determine whether it''s safe beyond legality, calculate every item''s moment and the total CG, plot the CG on the aircraft''s CG envelope, and explain how the airplane will fly at this loading. Check with your instructor for this cohort''s due date.",
      "fields": [
        {"id": "ac-legal-determination", "label": "Is the loading legal? Show the check against useful load and the CG envelope.", "type": "textarea"},
        {"id": "ac-moment-cg-calculation", "label": "Calculate every item''s moment and the total CG (show your work).", "type": "textarea"},
        {"id": "ac-cg-envelope-plot", "label": "Describe where the calculated CG falls on the CG envelope, and how much margin exists to each limit.", "type": "textarea"},
        {"id": "ac-flight-characteristics", "label": "Explain how the airplane will fly at this loading -- stall speed, stability, and control characteristics.", "type": "textarea"},
        {"id": "ac-changes-justification", "label": "Identify any changes you would make to this loading, and justify why.", "type": "textarea"}
      ]
    }
  }'::jsonb
);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M13-Q01', 'PPL', 'PPL-M13', 1, 'multiple_choice', 'The aircraft datum is:', '[{"key":"A","label":"The CG"},{"key":"B","label":"A fixed reference point from which arms are measured"},{"key":"C","label":"The empty weight"},{"key":"D","label":"The maximum gross weight"}]', 'B', 'The datum is a fixed reference point from which every arm is measured.'),
('PPL-M13-Q02', 'PPL', 'PPL-M13', 2, 'multiple_choice', 'Moment is calculated as:', '[{"key":"A","label":"Weight + Arm"},{"key":"B","label":"Weight - Arm"},{"key":"C","label":"Weight x Arm"},{"key":"D","label":"Weight / Arm"}]', 'C', 'Moment equals weight multiplied by arm.'),
('PPL-M13-Q03', 'PPL', 'PPL-M13', 3, 'multiple_choice', 'Basic empty weight differs from empty weight because it:', '[{"key":"A","label":"Excludes unusable fuel"},{"key":"B","label":"Includes installed optional equipment"},{"key":"C","label":"Is always lower"},{"key":"D","label":"Never changes"}]', 'B', 'Basic empty weight adds all installed optional equipment specific to the individual aircraft.'),
('PPL-M13-Q04', 'PPL', 'PPL-M13', 4, 'multiple_choice', 'Useful load equals:', '[{"key":"A","label":"Max gross weight - basic empty weight"},{"key":"B","label":"Max gross weight + basic empty weight"},{"key":"C","label":"Payload + fuel only"},{"key":"D","label":"Basic empty weight alone"}]', 'A', 'Useful load equals maximum gross weight minus basic empty weight.'),
('PPL-M13-Q05', 'PPL', 'PPL-M13', 5, 'multiple_choice', 'One gallon of avgas weighs:', '[{"key":"A","label":"5 lb"},{"key":"B","label":"6 lb"},{"key":"C","label":"7 lb"},{"key":"D","label":"8 lb"}]', 'B', 'Avgas weighs 6 pounds per gallon.'),
('PPL-M13-Q06', 'PPL', 'PPL-M13', 6, 'multiple_choice', 'A forward CG generally results in:', '[{"key":"A","label":"Lower stall speed"},{"key":"B","label":"Higher stall speed"},{"key":"C","label":"No change in stall speed"},{"key":"D","label":"Reduced stability"}]', 'B', 'A forward CG generally results in a higher stall speed.'),
('PPL-M13-Q07', 'PPL', 'PPL-M13', 7, 'multiple_choice', 'An aft CG generally results in:', '[{"key":"A","label":"Increased stability"},{"key":"B","label":"Reduced stability"},{"key":"C","label":"A longer landing roll"},{"key":"D","label":"A higher stall speed"}]', 'B', 'An aft CG generally results in reduced stability.'),
('PPL-M13-Q08', 'PPL', 'PPL-M13', 8, 'multiple_choice', 'The forward CG limit is set primarily by:', '[{"key":"A","label":"Fuel capacity"},{"key":"B","label":"Available elevator authority for flare/landing"},{"key":"C","label":"Baggage compartment size"},{"key":"D","label":"Engine power"}]', 'B', 'The forward limit is set primarily by available elevator authority for flare and landing.'),
('PPL-M13-Q09', 'PPL', 'PPL-M13', 9, 'multiple_choice', 'The aft CG limit is set primarily by:', '[{"key":"A","label":"Stability and control recovery margin"},{"key":"B","label":"Fuel tank location"},{"key":"C","label":"Maximum gross weight"},{"key":"D","label":"Runway length"}]', 'A', 'The aft limit is set primarily by the stability and control margin needed for safe recovery.'),
('PPL-M13-Q10', 'PPL', 'PPL-M13', 10, 'short_answer', 'Empty weight 1,467 lb / moment 57,213. Add a 170 lb pilot at a 37.0 in arm. What is the pilot''s moment? Show your work.', null, null, '170 x 37.0 = 6,290 lb-in.'),
('PPL-M13-Q11', 'PPL', 'PPL-M13', 11, 'short_answer', 'Total weight is 2,200 lb and total moment is 99,000 lb-in. What is the CG? Show your work.', null, null, '99,000 / 2,200 = 45.0 in.'),
('PPL-M13-Q12', 'PPL', 'PPL-M13', 12, 'multiple_choice', 'Interpolation on a loading table is used to:', '[{"key":"A","label":"Round to the nearest listed value"},{"key":"B","label":"Find a proportional value between two listed values"},{"key":"C","label":"Avoid calculating moment"},{"key":"D","label":"Replace the CG envelope check"}]', 'B', 'Interpolation finds a proportional value between two listed table values.'),
('PPL-M13-Q13', 'PPL', 'PPL-M13', 13, 'multiple_choice', 'Why must landing CG be checked separately from takeoff CG?', '[{"key":"A","label":"It never changes"},{"key":"B","label":"Fuel burn changes both weight and CG location"},{"key":"C","label":"Landing weight is always higher"},{"key":"D","label":"The envelope only applies at takeoff"}]', 'B', 'Fuel burn changes both total weight and CG location, so a loading legal at takeoff can become illegal by landing if not separately verified.'),
('PPL-M13-Q14', 'PPL', 'PPL-M13', 14, 'multiple_choice', 'A loading that sits exactly on the envelope boundary line is:', '[{"key":"A","label":"Illegal"},{"key":"B","label":"Legal, with no margin for error"},{"key":"C","label":"Automatically the safest option"},{"key":"D","label":"Undefined"}]', 'B', 'A loading exactly on the boundary line is legal, but with no margin for error.'),
('PPL-M13-Q15', 'PPL', 'PPL-M13', 15, 'multiple_choice', 'Removing weight from an aft baggage compartment can:', '[{"key":"A","label":"Never affect CG"},{"key":"B","label":"Only move CG forward"},{"key":"C","label":"Move CG forward or aft depending on the arm relative to current CG"},{"key":"D","label":"Only move CG aft"}]', 'C', 'Removing weight from an aft compartment can move the CG forward or aft, depending on that item''s arm relative to the current CG.'),
('PPL-M13-Q16', 'PPL', 'PPL-M13', 16, 'short_answer', 'Explain in one or two sentences why ''inside the envelope'' is not automatically the same as ''safe.''', null, null, 'The envelope defines the legal minimum requirement; safety additionally depends on margin, the specific flight''s conditions, and whether the loading leaves room for error, turbulence, or a last-minute change.'),
('PPL-M13-Q17', 'PPL', 'PPL-M13', 17, 'short_answer', 'Name one common student mistake covered in this module and how to avoid it.', null, null, 'Answers will vary (e.g., using a memorized or generic arm instead of the specific aircraft''s current data, rounding instead of properly interpolating a loading table, or checking only takeoff CG and never recalculating for landing) -- avoided by working the six-step method fully and explicitly, every time.'),
('PPL-M13-Q18', 'PPL', 'PPL-M13', 18, 'short_answer', 'State the Apex Loading Framework''s five questions in order.', null, null, 'Can I legally load it? Can I safely load it? How will it fly? Should I change anything? Would I put my own family in this airplane?');
