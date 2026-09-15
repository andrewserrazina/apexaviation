# Ground School ACS Mapping Gap Report

Sprint 4 Part 4 — developer-facing record of every `content_acs_mappings` row added by
`portal/supabase-portal-schema-v133-ground-school-acs-mapping-expansion.sql`, plus every
module's intentionally-unmapped content and why. Sprint 3 (v126) had already mapped PPL-M01
(5 rows). This migration adds 449 rows across 12 further modules. No ACS task was flipped to
`digital_assessment_supported = true` as part of this work — every row below attaches to one
of the 19 tasks that were already digitally assessable.

## Methodology

Every row was selected by reading the actual question/prompt text from `module_quiz_questions`
and `module_companion_content.checkrideCorner` directly (matching Sprint 3/v126's own
precedent) — never guessed from ids or module titles. Two structural rules governed what could
be mapped at all:

1. **`module_quiz_question` rows are multiple-choice only.** `record_ground_school_evidence()`
   is only ever *called* by the client (`wireModuleQuizSection()`, `site/portal-stable.js`)
   for `question_type = 'multiple_choice'` — `short_answer`/`scenario`-type quiz questions
   never produce an objective `isCorrect` and are never submitted to the evidence RPC at all.
   Mapping them would create rows that can never carry evidence, so none were created.
2. **`checkride_corner` and `scenario_workshop` run on the self-rating pathway** (Confident /
   Needs Review / Not Yet, `p_is_correct = null`), so any genuinely on-task item is mappable
   regardless of question "type." `scenario_workshop`'s rating is module-level (one shared
   rating per module, `content_id` = the bare module id), so it is mapped only when a
   module's scenario is one coherent topic, never when it's several independent mini-scenarios
   under one shared rating.

Left unmapped everywhere they appear, even within an otherwise-mapped module: administrative/
exam-process items; generic ADM-framework *name* recall (SHELL, Swiss Cheese, PAVE, 5P, DECIDE,
CARE, Apex's own Silent Six — these test remembering a mnemonic's letters, not the specific
fact or judgment a real ACS task element tests); general right-of-way/minimum-safe-altitude
operating rules with no clean fit among the 19 scoped tasks; and open-ended "defend a decision
you'd make differently" items with no single correct answer to grade against.

`mapping_type` is `knowledge` for plain factual/procedural content and `knowledge, risk
management` for content that genuinely tests a risk-judgment element of the task. This is the
first content this repo has ever mapped with a risk-management-typed row on Task C (Weather
Information) or Task F (Performance and Limitations) — `risk_management_score` had silently
fallen back to matching `knowledge_score` for every member on those tasks until this migration.

## Overall coverage

- **454** total `content_acs_mappings` rows now exist across Ground School content
  (449 added by this migration, on top of Sprint 3's original 5 PPL-M01 rows).
- 12 modules newly mapped: PPL-M03, M04, M07, M08, M09, M10, M11, M12, M13, M14, M15, M17.
- 7 modules remain intentionally unmapped: PPL-M02, M05, M06, M16, M18, M19, M20 (see below).
- 8 of the 9 real `dpe_category` values now have Ground School content evidence (all but
  `emergency`, which no Ground School module's content genuinely tests — Apex's Emergency
  Operations tasks are inherently flight-maneuver tasks, not knowledge-testable via quiz/
  Checkride Corner content).

| ACS category | Task | module_quiz_question | checkride_corner | scenario_workshop | Total |
|---|---|---:|---:|---:|---:|
| aeromedical | I.H | 17 | 21 | 0 | 38 |
| aircraft-systems | I.G | 10 | 20 | 1 | 31 |
| airspace | I.E | 9 | 6 | 0 | 15 |
| airworthiness | I.B | 8 | 6 | 0 | 14 |
| crosscountry | I.D | 15 | 29 | 1 | 45 |
| crosscountry | VI.A | 24 | 28 | 1 | 53 |
| crosscountry | VI.B | 20 | 22 | 1 | 43 |
| eligibility | I.A | 5 | 6 | 0 | 11 |
| performance | I.F | 26 | 58 | 2 | 86 |
| weather | I.C | 59 | 57 | 2 | 118 |

## Per-module detail

### PPL-M03 — Aircraft Systems

Mapped to: `aircraft-systems` (I.G)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M03-Q01` | I.G | aircraft-systems | knowledge | Which stroke of the engine cycle immediately follows compression? |
| module_quiz_question | `PPL-M03-Q02` | I.G | aircraft-systems | knowledge | Carburetor ice is most accurately described as: |
| module_quiz_question | `PPL-M03-Q03` | I.G | aircraft-systems | knowledge | In normal operation, the alternator: |
| module_quiz_question | `PPL-M03-Q04` | I.G | aircraft-systems | knowledge | An illuminated ALT annunciator combined with an ammeter showing discharge most likely indicates: |
| module_quiz_question | `PPL-M03-Q05` | I.G | aircraft-systems | knowledge | In most steam-gauge trainers, the vacuum system typically powers: |
| module_quiz_question | `PPL-M03-Q06` | I.G | aircraft-systems | knowledge | If the pitot tube is blocked but the static port remains clear, which instrument is primarily aff... |
| module_quiz_question | `PPL-M03-Q07` | I.G | aircraft-systems | knowledge | With the static port blocked and no alternate static source, the altimeter will most likely: |
| module_quiz_question | `PPL-M03-Q08` | I.G | aircraft-systems | knowledge | Carbon monoxide is dangerous partly because: |
| module_quiz_question | `PPL-M03-Q09` | I.G | aircraft-systems | knowledge | A circuit breaker differs from a fuse primarily in that: |
| module_quiz_question | `PPL-M03-Q10` | I.G | aircraft-systems | knowledge | ADS-B Out primarily provides: |
| checkride_corner | `PPL-M03:cc-1` | I.G | aircraft-systems | knowledge | What are the four strokes of the engine cycle, in order? |
| checkride_corner | `PPL-M03:cc-10` | I.G | aircraft-systems | knowledge | Walk me through your load-shedding procedure after confirming an alternator failure. |
| checkride_corner | `PPL-M03:cc-11` | I.G | aircraft-systems | knowledge | What is the difference between a circuit breaker and a fuse, and what is each protecting? |
| checkride_corner | `PPL-M03:cc-12` | I.G | aircraft-systems | knowledge | What instruments does the vacuum system typically power, and why does that matter? |
| checkride_corner | `PPL-M03:cc-13` | I.G | aircraft-systems | knowledge | How would you recognize a vacuum system failure in flight? |
| checkride_corner | `PPL-M03:cc-14` | I.G | aircraft-systems | knowledge | Which flight instruments rely on the pitot-static system, and what does each depend on specifically? |
| checkride_corner | `PPL-M03:cc-15` | I.G | aircraft-systems | knowledge | What happens to your instruments if the pitot tube becomes blocked, but the static port remains c... |
| checkride_corner | `PPL-M03:cc-16` | I.G | aircraft-systems | knowledge | What happens if the static port becomes blocked, and how does an alternate static source change t... |
| checkride_corner | `PPL-M03:cc-17` | I.G | aircraft-systems | knowledge | What is the difference between fixed and retractable landing gear in terms of systems complexity? |
| checkride_corner | `PPL-M03:cc-18` | I.G | aircraft-systems | knowledge | How does carbon monoxide enter the cabin, and why is it particularly dangerous? |
| checkride_corner | `PPL-M03:cc-19` | I.G | aircraft-systems | knowledge | What is the relationship between cabin heat and carburetor heat systems, and why does this matter... |
| checkride_corner | `PPL-M03:cc-2` | I.G | aircraft-systems | knowledge | What conditions favor carburetor ice, and how would you recognize it in flight? |
| checkride_corner | `PPL-M03:cc-20` | I.G | aircraft-systems | knowledge | What is the purpose of a transponder with ADS-B Out, and how does it connect to airspace requirem... |
| checkride_corner | `PPL-M03:cc-3` | I.G | aircraft-systems | knowledge | Why does an aircraft engine use dual magnetos instead of a single ignition system? |
| checkride_corner | `PPL-M03:cc-4` | I.G | aircraft-systems | knowledge | What does mixture control actually do, and why does it need adjustment with altitude? |
| checkride_corner | `PPL-M03:cc-5` | I.G | aircraft-systems | knowledge | Why must fuel tanks be vented, and what happens if a vent becomes blocked? |
| checkride_corner | `PPL-M03:cc-6` | I.G | aircraft-systems | knowledge | What is fuel sumping, and why is it a genuine risk-management action rather than a formality? |
| checkride_corner | `PPL-M03:cc-7` | I.G | aircraft-systems | knowledge | How do you manage fuel tank selection during a typical flight, and what should you verify beforeh... |
| checkride_corner | `PPL-M03:cc-8` | I.G | aircraft-systems | knowledge | Describe the relationship between the battery and the alternator in normal operation. |
| checkride_corner | `PPL-M03:cc-9` | I.G | aircraft-systems | knowledge | What indications would alert you to an alternator failure in flight? |
| scenario_workshop | `PPL-M03` | I.G | aircraft-systems | knowledge | Scenario Workshop (module-level self-rating) |

### PPL-M04 — FARs Simplified

Mapped to: `aeromedical` (I.H), `airspace` (I.E), `airworthiness` (I.B), `crosscountry` (I.D), `eligibility` (I.A)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M04-Q01` | I.A | eligibility | knowledge | Under Part 61, a flight review must be completed every: |
| module_quiz_question | `PPL-M04-Q02` | I.A | eligibility | knowledge | To carry passengers during the day, a pilot must have completed 3 takeoffs and landings within th... |
| module_quiz_question | `PPL-M04-Q03` | I.B | airworthiness | knowledge | Which document is NOT part of ARROW? |
| module_quiz_question | `PPL-M04-Q04` | I.B | airworthiness | knowledge | An annual inspection completed on March 10, 2026 expires at the end of: |
| module_quiz_question | `PPL-M04-Q05` | I.B | airworthiness | knowledge | A 100-hour inspection is required only when the aircraft is: |
| module_quiz_question | `PPL-M04-Q06` | I.B | airworthiness | knowledge | A VOR check is required every: |
| module_quiz_question | `PPL-M04-Q07` | I.B | airworthiness | knowledge | Altimeter and static system tests are required every: |
| module_quiz_question | `PPL-M04-Q08` | I.B | airworthiness | knowledge | Which is legally mandatory: a Service Bulletin or an Airworthiness Directive? |
| module_quiz_question | `PPL-M04-Q09` | I.B | airworthiness | knowledge | Under § 91.205, which is part of the day VFR required equipment list (A TOMATO FLAMES)? |
| module_quiz_question | `PPL-M04-Q10` | I.B | airworthiness | knowledge | If an inoperative item has no MEL and is not required by 91.205, the KOEL, or an AD, it may be: |
| module_quiz_question | `PPL-M04-Q15` | I.D | crosscountry | knowledge | Required fuel reserve for a day VFR flight is enough fuel to fly to the first point of intended l... |
| module_quiz_question | `PPL-M04-Q16` | I.D | crosscountry | knowledge | Required fuel reserve for a night VFR flight is enough fuel to fly to the first point of intended... |
| module_quiz_question | `PPL-M04-Q17` | I.H | aeromedical | knowledge | The maximum blood alcohol concentration allowed for a crew member to act is: |
| module_quiz_question | `PPL-M04-Q18` | I.H | aeromedical | knowledge | Under § 91.17, a crew member may not act within how many hours after consuming alcohol? |
| module_quiz_question | `PPL-M04-Q19` | I.E | airspace | knowledge | ADS-B Out is generally required above: |
| module_quiz_question | `PPL-M04-Q20` | I.H | aeromedical | knowledge | The 'E' in IMSAFE stands for: |
| checkride_corner | `PPL-M04:cc-1` | I.A | eligibility | knowledge | What is the difference between Part 61 and Part 91? |
| checkride_corner | `PPL-M04:cc-10` | I.B | airworthiness | knowledge | What's the difference between a Service Bulletin and an Airworthiness Directive? |
| checkride_corner | `PPL-M04:cc-11` | I.B | airworthiness | knowledge | Walk me through the § 91.213 decision tree for an inoperative instrument. |
| checkride_corner | `PPL-M04:cc-12` | I.B | airworthiness | knowledge | What does A TOMATO FLAMES cover, and when does it apply? |
| checkride_corner | `PPL-M04:cc-16` | I.D | crosscountry | knowledge | What fuel reserve is required for a night VFR flight? |
| checkride_corner | `PPL-M04:cc-17` | I.H | aeromedical | knowledge | What are the alcohol rules under § 91.17? |
| checkride_corner | `PPL-M04:cc-18` | I.H | aeromedical | knowledge | Walk me through IMSAFE and how you'd actually use it before a flight. |
| checkride_corner | `PPL-M04:cc-19` | I.H | aeromedical | knowledge | What is 6-HITS, and how does it differ from IMSAFE? |
| checkride_corner | `PPL-M04:cc-4` | I.A | eligibility | knowledge | What's required to act as PIC after 24 months without a flight review? |
| checkride_corner | `PPL-M04:cc-5` | I.A | eligibility | knowledge | What are the passenger currency requirements for day flight? |
| checkride_corner | `PPL-M04:cc-6` | I.A | eligibility | knowledge | What's different about night passenger currency vs. day? |
| checkride_corner | `PPL-M04:cc-7` | I.B | airworthiness | knowledge | Name the five ARROW documents. |
| checkride_corner | `PPL-M04:cc-8` | I.B | airworthiness | knowledge | What does AV1ATES help you remember, and what's each inspection interval? |
| checkride_corner | `PPL-M04:cc-9` | I.B | airworthiness | knowledge | What's the difference between an annual and a 100-hour inspection? |

### PPL-M07 — Sectional Charts

Mapped to: `airspace` (I.E), `crosscountry` (I.D)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M07-Q01` | VI.A | crosscountry | knowledge | A blue airport symbol with tick marks indicates: |
| module_quiz_question | `PPL-M07-Q02` | VI.A | crosscountry | knowledge | A magenta airport symbol with no tick marks indicates: |
| module_quiz_question | `PPL-M07-Q03` | VI.A | crosscountry | knowledge | An airport symbol with an "R" inside it means: |
| module_quiz_question | `PPL-M07-Q05` | I.E | airspace | knowledge | Which line style depicts Class B airspace? |
| module_quiz_question | `PPL-M07-Q06` | I.E | airspace | knowledge | Which line style depicts Class D airspace? |
| module_quiz_question | `PPL-M07-Q07` | I.E | airspace | knowledge | A magenta vignette shading indicates a Class E floor of: |
| module_quiz_question | `PPL-M07-Q08` | I.E | airspace | knowledge | A blue vignette shading indicates a Class E floor of: |
| module_quiz_question | `PPL-M07-Q09` | I.E | airspace | knowledge | Class G airspace is depicted on a sectional by: |
| module_quiz_question | `PPL-M07-Q10` | VI.A | crosscountry | knowledge | A boxed number like "95" printed in a chart quadrant represents: |
| module_quiz_question | `PPL-M07-Q12` | VI.A | crosscountry | knowledge | A filled (solid) dot atop an obstacle symbol indicates: |
| module_quiz_question | `PPL-M07-Q13` | VI.A | crosscountry | knowledge | A cluster of obstacle symbols close together on a sectional should be treated as: |
| module_quiz_question | `PPL-M07-Q15` | VI.B | crosscountry | knowledge | What is the key visual difference between a VOR and a VORTAC symbol? |
| module_quiz_question | `PPL-M07-Q16` | VI.B | crosscountry | knowledge | Why does a sectional chart print a Morse code identifier beside a navaid? |
| module_quiz_question | `PPL-M07-Q17` | I.E | airspace | knowledge | What does a hatched border around a charted area with an "R-" number indicate? |
| module_quiz_question | `PPL-M07-Q18` | I.E | airspace | knowledge | What's the key legal difference between a Restricted Area and a Warning Area? |
| module_quiz_question | `PPL-M07-Q19` | I.E | airspace | knowledge | Can an active TFR ever be shown on a printed sectional chart? |
| checkride_corner | `PPL-M07:cc-1` | VI.A | crosscountry | knowledge | What is the difference between a towered and non-towered airport symbol? |
| checkride_corner | `PPL-M07:cc-10` | VI.A | crosscountry | knowledge | What's the difference between a lighted and unlighted tower symbol? |
| checkride_corner | `PPL-M07:cc-11` | VI.A | crosscountry | knowledge | How would you identify a wind farm on a sectional, and what should you do about it? |
| checkride_corner | `PPL-M07:cc-12` | VI.B | crosscountry | knowledge | What's the difference between a VOR, a VORTAC, and a TACAN symbol? |
| checkride_corner | `PPL-M07:cc-13` | VI.B | crosscountry | knowledge | Why does the chart show a Morse code identifier next to a navaid? |
| checkride_corner | `PPL-M07:cc-14` | I.E | airspace | knowledge | What's the difference between a Restricted Area and a Warning Area? |
| checkride_corner | `PPL-M07:cc-15` | I.E | airspace | knowledge | Can a TFR ever appear on a printed sectional chart? Why or why not? |
| checkride_corner | `PPL-M07:cc-18` | I.E | airspace | knowledge | A DPE points to an MOA on your chart. What's your complete answer? |
| checkride_corner | `PPL-M07:cc-2` | VI.A | crosscountry | knowledge | What do the tick marks around an airport symbol indicate? |
| checkride_corner | `PPL-M07:cc-3` | VI.A | crosscountry | knowledge | What does the "R" inside an airport symbol mean? |
| checkride_corner | `PPL-M07:cc-4` | VI.A | crosscountry | knowledge | What information is contained in an airport's data block? |
| checkride_corner | `PPL-M07:cc-5` | I.E | airspace | knowledge | What's the difference between a solid and dashed blue line on a sectional? |
| checkride_corner | `PPL-M07:cc-6` | I.E | airspace | knowledge | What does magenta vignette shading indicate about Class E airspace? |
| checkride_corner | `PPL-M07:cc-7` | I.E | airspace | knowledge | How do you determine the floor of Class E airspace at a specific point? |
| checkride_corner | `PPL-M07:cc-8` | VI.A | crosscountry | knowledge | What is a Maximum Elevation Figure, and how is it calculated? |
| checkride_corner | `PPL-M07:cc-9` | VI.A | crosscountry | knowledge | How do terrain shading colors differ from contour lines in what they tell you? |

### PPL-M08 — Pilotage & Dead Reckoning

Mapped to: `crosscountry` (I.D)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M08-Q01` | VI.A | crosscountry | knowledge | Pilotage is best defined as: |
| module_quiz_question | `PPL-M08-Q02` | VI.A | crosscountry | knowledge | Dead reckoning is based on: |
| module_quiz_question | `PPL-M08-Q03` | VI.A | crosscountry | knowledge | Which best describes a good checkpoint? |
| module_quiz_question | `PPL-M08-Q04` | VI.A | crosscountry | knowledge | In the Apex Navigation Loop, which stage corresponds most directly to pilotage? |
| module_quiz_question | `PPL-M08-Q05` | VI.A | crosscountry | knowledge | True course is measured from: |
| module_quiz_question | `PPL-M08-Q06` | VI.A | crosscountry | knowledge | Magnetic variation is: |
| module_quiz_question | `PPL-M08-Q07` | VI.A | crosscountry | knowledge | Wind correction angle compensates for: |
| module_quiz_question | `PPL-M08-Q08` | VI.A | crosscountry | knowledge | Magnetic heading equals: |
| module_quiz_question | `PPL-M08-Q11` | VI.A | crosscountry | knowledge | At 60 knots groundspeed, approximately how far does an aircraft travel in one minute? |
| module_quiz_question | `PPL-M08-Q12` | VI.A | crosscountry | knowledge | A checkpoint arrives significantly earlier than planned. This most likely indicates: |
| module_quiz_question | `PPL-M08-Q13` | VI.A | crosscountry | knowledge | A checkpoint arrives significantly later than planned. This most likely indicates: |
| module_quiz_question | `PPL-M08-Q14` | VI.A | crosscountry | knowledge | A consistent crosswind primarily affects: |
| module_quiz_question | `PPL-M08-Q16` | VI.A | crosscountry | knowledge | What is the first of the four C's in lost procedures? |
| module_quiz_question | `PPL-M08-Q17` | VI.A | crosscountry | knowledge | Why is climbing typically the first action when uncertain of position? |
| module_quiz_question | `PPL-M08-Q18` | VI.A | crosscountry | knowledge | In lost procedures, "Confess" means: |
| module_quiz_question | `PPL-M08-Q20` | VI.A | crosscountry | knowledge | Which of the following is NOT a common diversion trigger? |
| module_quiz_question | `PPL-M08-Q22` | VI.A | crosscountry | knowledge | A stronger-than-forecast headwind primarily changes: |
| module_quiz_question | `PPL-M08-Q23` | VI.A | crosscountry | knowledge | What should a pilot do immediately after discovering an actual groundspeed significantly differen... |
| checkride_corner | `PPL-M08:cc-1` | VI.A | crosscountry | knowledge | What is pilotage? |
| checkride_corner | `PPL-M08:cc-10` | VI.A | crosscountry | knowledge | How do you calculate time enroute given distance and groundspeed? |
| checkride_corner | `PPL-M08:cc-11` | VI.A | crosscountry | knowledge | Your checkpoint arrives 8 minutes early. What does that tell you? |
| checkride_corner | `PPL-M08:cc-12` | VI.A | crosscountry | knowledge | Your checkpoint arrives 12 minutes late. What's your immediate next action? |
| checkride_corner | `PPL-M08:cc-13` | VI.A | crosscountry | knowledge | What's the difference between airspeed and groundspeed, and why does it matter for ETA? |
| checkride_corner | `PPL-M08:cc-14` | VI.A | crosscountry | knowledge | Landmarks keep appearing to your right of centerline. What's happening, and what do you do? |
| checkride_corner | `PPL-M08:cc-15` | VI.A | crosscountry | knowledge | Walk me through the four C's of lost procedures. |
| checkride_corner | `PPL-M08:cc-16` | VI.A | crosscountry | knowledge | How do you re-intercept your intended course after drifting off it? |
| checkride_corner | `PPL-M08:cc-17` | VI.A | crosscountry | knowledge | You're behind schedule by 15 minutes at your second checkpoint. What do you recalculate, and in w... |
| checkride_corner | `PPL-M08:cc-18` | VI.A | crosscountry | knowledge | Your destination airport closes unexpectedly 30 minutes out. Walk me through your diversion process. |
| checkride_corner | `PPL-M08:cc-19` | VI.A | crosscountry | knowledge | How does the Apex Navigation Loop change, if at all, once you're truly lost? |
| checkride_corner | `PPL-M08:cc-2` | VI.A | crosscountry | knowledge | What is dead reckoning? |
| checkride_corner | `PPL-M08:cc-20` | VI.A | crosscountry | knowledge | What's the single biggest mistake students make when selecting checkpoints? |
| checkride_corner | `PPL-M08:cc-3` | VI.A | crosscountry | knowledge | How do you choose checkpoints? |
| checkride_corner | `PPL-M08:cc-4` | VI.A | crosscountry | knowledge | How do you know you're off course? |
| checkride_corner | `PPL-M08:cc-5` | VI.A | crosscountry | knowledge | What would you do if GPS failed right now, mid-flight? |
| checkride_corner | `PPL-M08:cc-6` | VI.A | crosscountry | knowledge | Walk me through your navigation process on a cross-country, start to finish. |
| checkride_corner | `PPL-M08:cc-7` | VI.A | crosscountry | knowledge | What's the difference between true course and magnetic heading? |
| checkride_corner | `PPL-M08:cc-8` | VI.A | crosscountry | knowledge | What is magnetic variation? |
| checkride_corner | `PPL-M08:cc-9` | VI.A | crosscountry | knowledge | What is a wind correction angle, and why is it needed? |
| scenario_workshop | `PPL-M08` | VI.A | crosscountry | knowledge | Scenario Workshop (module-level self-rating) |

### PPL-M09 — Navigation Systems

Mapped to: `crosscountry` (I.D)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M09-Q01` | VI.B | crosscountry | knowledge | VOR stands for: |
| module_quiz_question | `PPL-M09-Q02` | VI.B | crosscountry | knowledge | A radial is: |
| module_quiz_question | `PPL-M09-Q03` | VI.B | crosscountry | knowledge | A TO indication means: |
| module_quiz_question | `PPL-M09-Q04` | VI.B | crosscountry | knowledge | A FROM indication means: |
| module_quiz_question | `PPL-M09-Q05` | VI.B | crosscountry | knowledge | The OBS is used to: |
| module_quiz_question | `PPL-M09-Q06` | VI.B | crosscountry | knowledge | A deflected CDI needle indicates: |
| module_quiz_question | `PPL-M09-Q08` | VI.B | crosscountry | knowledge | VOR signal reception is best described as: |
| module_quiz_question | `PPL-M09-Q09` | VI.B | crosscountry | knowledge | A VOR station can be fully functional and still be unreceivable because of: |
| module_quiz_question | `PPL-M09-Q10` | VI.B | crosscountry | knowledge | DME measures: |
| module_quiz_question | `PPL-M09-Q11` | VI.B | crosscountry | knowledge | Slant-range error is most significant when: |
| module_quiz_question | `PPL-M09-Q12` | VI.B | crosscountry | knowledge | GPS position is determined by: |
| module_quiz_question | `PPL-M09-Q13` | VI.B | crosscountry | knowledge | WAAS improves GPS accuracy by: |
| module_quiz_question | `PPL-M09-Q14` | VI.B | crosscountry | knowledge | RAIM stands for: |
| module_quiz_question | `PPL-M09-Q15` | VI.B | crosscountry | knowledge | A RAIM warning should be treated as: |
| module_quiz_question | `PPL-M09-Q16` | VI.B | crosscountry | knowledge | The most common source of GPS-related navigation error is: |
| module_quiz_question | `PPL-M09-Q17` | VI.B | crosscountry | knowledge | ADS-B Out primarily: |
| module_quiz_question | `PPL-M09-Q18` | VI.B | crosscountry | knowledge | ADS-B is best described as: |
| module_quiz_question | `PPL-M09-Q19` | VI.B | crosscountry | knowledge | In-cockpit weather display via ADS-B should be used for: |
| checkride_corner | `PPL-M09:cc-1` | VI.B | crosscountry | knowledge | What is a radial, and how is it measured? |
| checkride_corner | `PPL-M09:cc-10` | VI.B | crosscountry | knowledge | How does GPS determine your position, conceptually? |
| checkride_corner | `PPL-M09:cc-11` | VI.B | crosscountry | knowledge | What is WAAS, and what does it improve? |
| checkride_corner | `PPL-M09:cc-12` | VI.B | crosscountry | knowledge | What is RAIM, and what should you do if you get a RAIM warning? |
| checkride_corner | `PPL-M09:cc-13` | VI.B | crosscountry | knowledge | What are the most common causes of GPS-related navigation errors? |
| checkride_corner | `PPL-M09:cc-14` | VI.B | crosscountry | knowledge | What's the difference between ADS-B In and ADS-B Out? |
| checkride_corner | `PPL-M09:cc-15` | VI.B | crosscountry | knowledge | Why is ADS-B not considered a primary navigation source? |
| checkride_corner | `PPL-M09:cc-16` | VI.B | crosscountry | knowledge | What is the Apex Navigation Pyramid, and why does layer order matter? |
| checkride_corner | `PPL-M09:cc-17` | VI.B | crosscountry | knowledge | Your GPS fails, then your VOR reception disappears too. Walk me through your plan. |
| checkride_corner | `PPL-M09:cc-18` | VI.B | crosscountry | knowledge | Which navigation system would you trust most, and why? |
| checkride_corner | `PPL-M09:cc-19` | VI.B | crosscountry | knowledge | How do you build navigation redundancy into a single cross-country flight? |
| checkride_corner | `PPL-M09:cc-2` | VI.B | crosscountry | knowledge | Explain the difference between TO and FROM. |
| checkride_corner | `PPL-M09:cc-20` | VI.B | crosscountry | knowledge | Why does Apex say the pilot is usually the weakest link in the navigation system? |
| checkride_corner | `PPL-M09:cc-3` | VI.B | crosscountry | knowledge | What does the OBS actually do? |
| checkride_corner | `PPL-M09:cc-4` | VI.B | crosscountry | knowledge | How do you track a VOR course once established? |
| checkride_corner | `PPL-M09:cc-5` | VI.B | crosscountry | knowledge | What is reverse sensing, and how do you avoid it? |
| checkride_corner | `PPL-M09:cc-6` | VI.B | crosscountry | knowledge | What is a VOR service volume, and why does it matter? |
| checkride_corner | `PPL-M09:cc-7` | VI.B | crosscountry | knowledge | Why can a fully functional VOR station still be unreceivable? |
| checkride_corner | `PPL-M09:cc-8` | VI.B | crosscountry | knowledge | What does DME actually measure? |
| checkride_corner | `PPL-M09:cc-9` | VI.B | crosscountry | knowledge | Explain slant-range error and when it matters most. |
| scenario_workshop | `PPL-M09` | VI.B | crosscountry | knowledge | Scenario Workshop (module-level self-rating) |

### PPL-M10 — Weather Theory

Mapped to: `weather` (I.C)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M10-Q01` | I.C | weather | knowledge | The atmosphere is composed primarily of: |
| module_quiz_question | `PPL-M10-Q02` | I.C | weather | knowledge | Most private pilot flying occurs in which atmospheric layer? |
| module_quiz_question | `PPL-M10-Q03` | I.C | weather | knowledge | The atmosphere is primarily heated by: |
| module_quiz_question | `PPL-M10-Q04` | I.C | weather | knowledge | A steep pressure gradient (tightly packed isobars) generally indicates: |
| module_quiz_question | `PPL-M10-Q05` | I.C | weather | knowledge | The Coriolis effect deflects moving air in the Northern Hemisphere to the: |
| module_quiz_question | `PPL-M10-Q06` | I.C | weather | knowledge | A small and shrinking temperature/dew point spread is a strong indicator of: |
| module_quiz_question | `PPL-M10-Q07` | I.C | weather | knowledge | Which is a characteristic of stable air? |
| module_quiz_question | `PPL-M10-Q08` | I.C | weather | knowledge | Which is a characteristic of unstable air? |
| module_quiz_question | `PPL-M10-Q09` | I.C | weather | knowledge | Cloud formation requires moisture, cooling, and: |
| module_quiz_question | `PPL-M10-Q10` | I.C | weather | knowledge | Cumulonimbus clouds are associated with: |
| module_quiz_question | `PPL-M10-Q11` | I.C | weather | knowledge | Which lifting mechanism is caused by terrain forcing air upward? |
| module_quiz_question | `PPL-M10-Q12` | I.C | weather | knowledge | Which lifting mechanism is caused by surface heating alone? |
| module_quiz_question | `PPL-M10-Q13` | I.C | weather | knowledge | A cold front is generally characterized by: |
| module_quiz_question | `PPL-M10-Q14` | I.C | weather | knowledge | A warm front is generally characterized by: |
| module_quiz_question | `PPL-M10-Q15` | I.C | weather | knowledge | An occluded front occurs when: |
| module_quiz_question | `PPL-M10-Q16` | I.C | weather | knowledge | Which thunderstorm stage contains the greatest combination of hazards? |
| module_quiz_question | `PPL-M10-Q17` | I.C | weather | knowledge | The correct strategy for a thunderstorm cell along your route is to: |
| module_quiz_question | `PPL-M10-Q18` | I.C | weather | knowledge | Convective turbulence is generally worst: |
| module_quiz_question | `PPL-M10-Q19` | I.C | weather | knowledge | Mountain wave turbulence is often visually indicated by: |
| module_quiz_question | `PPL-M10-Q20` | I.C | weather | knowledge | Structural icing requires visible moisture and: |
| module_quiz_question | `PPL-M10-Q21` | I.C | weather | knowledge | Which type of icing is generally considered the most dangerous? |
| checkride_corner | `PPL-M10:cc-1` | I.C | weather | knowledge | What causes wind? |
| checkride_corner | `PPL-M10:cc-10` | I.C | weather | knowledge | How would weather affect your go/no-go decision? |
| checkride_corner | `PPL-M10:cc-11` | I.C | weather | knowledge | Why is the atmosphere heated from below rather than directly by sunlight passing through it? |
| checkride_corner | `PPL-M10:cc-12` | I.C | weather | knowledge | Explain the Coriolis effect and why wind doesn't flow straight from high to low pressure. |
| checkride_corner | `PPL-M10:cc-13` | I.C | weather | knowledge | What's the difference between a stationary front and an occluded front? |
| checkride_corner | `PPL-M10:cc-14` | I.C | weather | knowledge | Walk me through the three stages of thunderstorm development. |
| checkride_corner | `PPL-M10:cc-15` | I.C | weather | knowledge | What hazards are associated with thunderstorms, and what's the correct avoidance strategy? |
| checkride_corner | `PPL-M10:cc-16` | I.C | weather | knowledge | What are the four types of turbulence covered tonight, and what causes each? |
| checkride_corner | `PPL-M10:cc-17` | I.C | weather | knowledge | Walk me through the Apex Weather Decision Model using a real scenario. |
| checkride_corner | `PPL-M10:cc-18` | I.C | weather | knowledge | Why does Apex say most weather accidents begin with optimism, not recklessness? |
| checkride_corner | `PPL-M10:cc-19` | I.C | weather | knowledge | Why does even a small amount of structural ice matter for a light training aircraft? |
| checkride_corner | `PPL-M10:cc-2` | I.C | weather | knowledge | Explain stable vs. unstable air. |
| checkride_corner | `PPL-M10:cc-20` | I.C | weather | knowledge | What's the practical difference between predicting weather from stability alone versus needing a ... |
| checkride_corner | `PPL-M10:cc-3` | I.C | weather | knowledge | What clouds are associated with thunderstorms? |
| checkride_corner | `PPL-M10:cc-4` | I.C | weather | knowledge | What lifting mechanisms create clouds? |
| checkride_corner | `PPL-M10:cc-5` | I.C | weather | knowledge | Describe a cold front. |
| checkride_corner | `PPL-M10:cc-6` | I.C | weather | knowledge | Describe a warm front. |
| checkride_corner | `PPL-M10:cc-7` | I.C | weather | knowledge | What conditions are required for icing? |
| checkride_corner | `PPL-M10:cc-8` | I.C | weather | knowledge | Why does fog form? |
| checkride_corner | `PPL-M10:cc-9` | I.C | weather | knowledge | What weather is associated with low pressure? |
| scenario_workshop | `PPL-M10` | I.C | weather | knowledge | Scenario Workshop (module-level self-rating) |

### PPL-M11 — Weather Products

Mapped to: `weather` (I.C)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M11-Q01` | I.C | weather | knowledge | In a METAR, '27012G18KT' means: |
| module_quiz_question | `PPL-M11-Q02` | I.C | weather | knowledge | A METAR sky condition of 'BKN020' indicates: |
| module_quiz_question | `PPL-M11-Q03` | I.C | weather | knowledge | What does 'AUTO' indicate in a METAR? |
| module_quiz_question | `PPL-M11-Q04` | I.C | weather | knowledge | A SPECI is issued when: |
| module_quiz_question | `PPL-M11-Q05` | I.C | weather | knowledge | In a TAF, an FM group indicates: |
| module_quiz_question | `PPL-M11-Q06` | I.C | weather | knowledge | In a TAF, a TEMPO group indicates: |
| module_quiz_question | `PPL-M11-Q07` | I.C | weather | knowledge | PROB30 in a TAF means: |
| module_quiz_question | `PPL-M11-Q08` | I.C | weather | knowledge | A BECMG group describes: |
| module_quiz_question | `PPL-M11-Q09` | I.C | weather | knowledge | A UUA PIREP designation indicates: |
| module_quiz_question | `PPL-M11-Q10` | I.C | weather | knowledge | Why might PIREPs often provide the most valuable information? |
| module_quiz_question | `PPL-M11-Q11` | I.C | weather | knowledge | AIRMET Sierra covers: |
| module_quiz_question | `PPL-M11-Q12` | I.C | weather | knowledge | AIRMET Tango covers: |
| module_quiz_question | `PPL-M11-Q13` | I.C | weather | knowledge | AIRMET Zulu covers: |
| module_quiz_question | `PPL-M11-Q14` | I.C | weather | knowledge | A Convective SIGMET implies: |
| module_quiz_question | `PPL-M11-Q15` | I.C | weather | knowledge | What's the key legal/practical difference between a non-convective SIGMET and an AIRMET? |
| module_quiz_question | `PPL-M11-Q16` | I.C | weather | knowledge | On a surface analysis chart, tightly packed isobars indicate: |
| module_quiz_question | `PPL-M11-Q17` | I.C | weather | knowledge | Radar reflectivity primarily shows: |
| module_quiz_question | `PPL-M11-Q18` | I.C | weather | knowledge | Beam overshoot is a radar limitation that can cause: |
| module_quiz_question | `PPL-M11-Q19` | I.C | weather | knowledge | Attenuation in radar imagery refers to: |
| module_quiz_question | `PPL-M11-Q20` | I.C | weather | knowledge | Which satellite imagery type is usable at night? |
| module_quiz_question | `PPL-M11-Q21` | I.C | weather | knowledge | Water vapor satellite imagery is especially useful for: |
| module_quiz_question | `PPL-M11-Q22` | I.C | weather | knowledge | A winds aloft report of '2712' at a given altitude means: |
| module_quiz_question | `PPL-M11-Q23` | I.C | weather | knowledge | A surface prog chart differs from a surface analysis chart because it: |
| module_quiz_question | `PPL-M11-Q24` | I.C | weather | knowledge | The Graphical Forecast for Aviation (GFA) is useful because it: |
| checkride_corner | `PPL-M11:cc-1` | I.C | weather | knowledge | What is the difference between a METAR and a SPECI? |
| checkride_corner | `PPL-M11:cc-10` | I.C | weather | knowledge | What are the three AIRMET types, and what does each cover? |
| checkride_corner | `PPL-M11:cc-11` | I.C | weather | knowledge | What's the difference between a non-convective and a Convective SIGMET? |
| checkride_corner | `PPL-M11:cc-12` | I.C | weather | knowledge | What criteria trigger a Convective SIGMET? |
| checkride_corner | `PPL-M11:cc-13` | I.C | weather | knowledge | How do you identify likely weather from a surface analysis chart alone? |
| checkride_corner | `PPL-M11:cc-14` | I.C | weather | knowledge | What is beam overshoot, and why does it matter? |
| checkride_corner | `PPL-M11:cc-15` | I.C | weather | knowledge | What is attenuation, and why does it matter? |
| checkride_corner | `PPL-M11:cc-16` | I.C | weather | knowledge | Why doesn't radar show turbulence directly? |
| checkride_corner | `PPL-M11:cc-17` | I.C | weather | knowledge | When is water vapor imagery more useful than visible imagery? |
| checkride_corner | `PPL-M11:cc-18` | I.C | weather | knowledge | How do winds aloft affect your cruise altitude selection? |
| checkride_corner | `PPL-M11:cc-19` | I.C | weather | knowledge | What's the difference between a surface prog chart and a surface analysis chart? |
| checkride_corner | `PPL-M11:cc-2` | I.C | weather | knowledge | What does 'AUTO' in a METAR tell you? |
| checkride_corner | `PPL-M11:cc-20` | I.C | weather | knowledge | Walk me through your AviationWeather.gov workflow for a cross-country briefing. |
| checkride_corner | `PPL-M11:cc-21` | I.C | weather | knowledge | What are the five questions a complete weather briefing must answer? |
| checkride_corner | `PPL-M11:cc-22` | I.C | weather | knowledge | Explain the Apex Weather Decision Matrix and how you'd classify a marginal scenario. |
| checkride_corner | `PPL-M11:cc-23` | I.C | weather | knowledge | Why does Apex say good pilots look for reasons NOT to go? |
| checkride_corner | `PPL-M11:cc-24` | I.C | weather | knowledge | A Convective SIGMET is issued for your route after you've already launched. What do you do? |
| checkride_corner | `PPL-M11:cc-25` | I.C | weather | knowledge | Give an example of a Green-looking briefing turned Red by a single product. |
| checkride_corner | `PPL-M11:cc-3` | I.C | weather | knowledge | How do you read a wind group with a gust value? |
| checkride_corner | `PPL-M11:cc-4` | I.C | weather | knowledge | What's the difference between BKN and OVC, and why does it matter? |
| checkride_corner | `PPL-M11:cc-5` | I.C | weather | knowledge | What does a TEMPO group mean, and how is it different from a FM group? |
| checkride_corner | `PPL-M11:cc-6` | I.C | weather | knowledge | What's the difference between PROB30 and PROB40? |
| checkride_corner | `PPL-M11:cc-7` | I.C | weather | knowledge | What does a BECMG group describe? |
| checkride_corner | `PPL-M11:cc-8` | I.C | weather | knowledge | What's the difference between a UA and a UUA PIREP? |
| checkride_corner | `PPL-M11:cc-9` | I.C | weather | knowledge | Why might a lack of PIREPs NOT mean conditions are fine? |
| scenario_workshop | `PPL-M11` | I.C | weather | knowledge | Scenario Workshop (module-level self-rating) |

### PPL-M12 — Weather Decision Making

Mapped to: `weather` (I.C)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M12-Q01` | I.C | weather | knowledge | Meeting legal VFR weather minimums means: |
| module_quiz_question | `PPL-M12-Q02` | I.C | weather | knowledge, risk management | Personal weather minimums should be: |
| module_quiz_question | `PPL-M12-Q03` | I.C | weather | knowledge, risk management | A single low ceiling report is less significant than: |
| module_quiz_question | `PPL-M12-Q04` | I.C | weather | knowledge, risk management | Get-there-itis is best described as: |
| module_quiz_question | `PPL-M12-Q05` | I.C | weather | knowledge, risk management | Confirmation bias in weather decision-making means: |
| module_quiz_question | `PPL-M12-Q06` | I.C | weather | knowledge, risk management | Plan continuation bias tends to: |
| module_quiz_question | `PPL-M12-Q12` | I.C | weather | knowledge, risk management | Turning around early during a flight is best understood as: |
| module_quiz_question | `PPL-M12-Q13` | I.C | weather | knowledge, risk management | A precautionary landing is: |
| module_quiz_question | `PPL-M12-Q14` | I.C | weather | knowledge, risk management | Scud running refers to: |
| module_quiz_question | `PPL-M12-Q16` | I.C | weather | knowledge, risk management | A weather decision point is best described as: |
| module_quiz_question | `PPL-M12-Q17` | I.C | weather | knowledge, risk management | Fuel reserved specifically for weather-driven route changes functions as: |
| module_quiz_question | `PPL-M12-Q18` | I.C | weather | knowledge, risk management | In most weather accident chains, the accident: |
| module_quiz_question | `PPL-M12-Q19` | I.C | weather | knowledge, risk management | Which of the following best distinguishes 'delay' from 'cancel'? |
| module_quiz_question | `PPL-M12-Q20` | I.C | weather | knowledge, risk management | Optimism bias in weather decision-making is best described as: |
| checkride_corner | `PPL-M12:cc-1` | I.C | weather | knowledge, risk management | What's the difference between legal weather minimums and personal minimums? |
| checkride_corner | `PPL-M12:cc-15` | I.C | weather | knowledge, risk management | How do you recognize deteriorating weather in flight versus just normal variation? |
| checkride_corner | `PPL-M12:cc-16` | I.C | weather | knowledge, risk management | When would you declare an emergency for a weather-related situation? |
| checkride_corner | `PPL-M12:cc-17` | I.C | weather | knowledge, risk management | What is scud running, and why is it never an acceptable strategy? |
| checkride_corner | `PPL-M12:cc-18` | I.C | weather | knowledge, risk management | How do weather decision points differ from ordinary navigation checkpoints? |
| checkride_corner | `PPL-M12:cc-19` | I.C | weather | knowledge, risk management | Why does fuel reserve function as a weather-decision tool, not just a range calculation? |
| checkride_corner | `PPL-M12:cc-2` | I.C | weather | knowledge, risk management | How should experience level affect personal minimums? |
| checkride_corner | `PPL-M12:cc-22` | I.C | weather | knowledge, risk management | What's the practical difference between delay, divert, and cancel? |
| checkride_corner | `PPL-M12:cc-3` | I.C | weather | knowledge, risk management | Name three factors that belong in a personal weather minimums worksheet. |
| checkride_corner | `PPL-M12:cc-5` | I.C | weather | knowledge, risk management | What is get-there-itis, and what's the first step in managing it? |
| checkride_corner | `PPL-M12:cc-6` | I.C | weather | knowledge, risk management | Explain confirmation bias and how it affects weather decisions specifically. |
| checkride_corner | `PPL-M12:cc-7` | I.C | weather | knowledge, risk management | Explain plan continuation bias and why it gets stronger over the course of a flight. |

### PPL-M13 — Weight & Balance

Mapped to: `performance` (I.F)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M13-Q01` | I.F | performance | knowledge | The aircraft datum is: |
| module_quiz_question | `PPL-M13-Q02` | I.F | performance | knowledge | Moment is calculated as: |
| module_quiz_question | `PPL-M13-Q03` | I.F | performance | knowledge | Basic empty weight differs from empty weight because it: |
| module_quiz_question | `PPL-M13-Q04` | I.F | performance | knowledge | Useful load equals: |
| module_quiz_question | `PPL-M13-Q05` | I.F | performance | knowledge | One gallon of avgas weighs: |
| module_quiz_question | `PPL-M13-Q06` | I.F | performance | knowledge | A forward CG generally results in: |
| module_quiz_question | `PPL-M13-Q07` | I.F | performance | knowledge | An aft CG generally results in: |
| module_quiz_question | `PPL-M13-Q08` | I.F | performance | knowledge | The forward CG limit is set primarily by: |
| module_quiz_question | `PPL-M13-Q09` | I.F | performance | knowledge | The aft CG limit is set primarily by: |
| module_quiz_question | `PPL-M13-Q12` | I.F | performance | knowledge | Interpolation on a loading table is used to: |
| module_quiz_question | `PPL-M13-Q13` | I.F | performance | knowledge | Why must landing CG be checked separately from takeoff CG? |
| module_quiz_question | `PPL-M13-Q14` | I.F | performance | knowledge | A loading that sits exactly on the envelope boundary line is: |
| module_quiz_question | `PPL-M13-Q15` | I.F | performance | knowledge | Removing weight from an aft baggage compartment can: |
| checkride_corner | `PPL-M13:cc-1` | I.F | performance | knowledge | What is the aircraft datum, and why does it matter? |
| checkride_corner | `PPL-M13:cc-10` | I.F | performance | knowledge | What is zero fuel weight, conceptually? |
| checkride_corner | `PPL-M13:cc-11` | I.F | performance | knowledge | Walk me through how you'd calculate CG for this loading. |
| checkride_corner | `PPL-M13:cc-12` | I.F | performance | knowledge | What happens aerodynamically if you're loaded outside the aft CG limit? |
| checkride_corner | `PPL-M13:cc-13` | I.F | performance | knowledge | How does CG location affect stall speed? |
| checkride_corner | `PPL-M13:cc-14` | I.F | performance | knowledge | If you're at max gross weight at departure, how does your CG change as fuel burns off? |
| checkride_corner | `PPL-M13:cc-15` | I.F | performance | knowledge | Where do you find the empty weight and moment for this specific aircraft? |
| checkride_corner | `PPL-M13:cc-16` | I.F | performance | knowledge | What's the difference between the loading table method and the loading graph method? |
| checkride_corner | `PPL-M13:cc-17` | I.F | performance | knowledge | How do you interpolate between two listed values on a loading table? |
| checkride_corner | `PPL-M13:cc-18` | I.F | performance | knowledge | Why must you check both takeoff CG and landing CG separately? |
| checkride_corner | `PPL-M13:cc-19` | I.F | performance | knowledge | What's the difference between the forward CG limit and the aft CG limit, in terms of what sets ea... |
| checkride_corner | `PPL-M13:cc-2` | I.F | performance | knowledge | What's the difference between empty weight and basic empty weight? |
| checkride_corner | `PPL-M13:cc-20` | I.F | performance | knowledge | Why is a forward CG more stable than an aft CG? |
| checkride_corner | `PPL-M13:cc-21` | I.F | performance | knowledge, risk management | This loading is legal but very close to the aft limit. Would you fly it? Why or why not? |
| checkride_corner | `PPL-M13:cc-22` | I.F | performance | knowledge | Explain why a forward CG produces a longer landing roll. |
| checkride_corner | `PPL-M13:cc-23` | I.F | performance | knowledge | Removing 20 pounds of baggage from the aft compartment -- what happens to the CG, and why might t... |
| checkride_corner | `PPL-M13:cc-24` | I.F | performance | knowledge | Walk me through the Apex Loading Framework using this exact scenario. |
| checkride_corner | `PPL-M13:cc-25` | I.F | performance | knowledge | Why can an aft CG loading reduce stall warning margin? |
| checkride_corner | `PPL-M13:cc-26` | I.F | performance | knowledge, risk management | A passenger shows up unannounced right before departure. Walk me through your process. |
| checkride_corner | `PPL-M13:cc-27` | I.F | performance | knowledge | Explain the relationship between CG location and elevator authority during flare. |
| checkride_corner | `PPL-M13:cc-28` | I.F | performance | knowledge, risk management | Why is 'inside the envelope' not automatically the same as 'safe to fly'? |
| checkride_corner | `PPL-M13:cc-29` | I.F | performance | knowledge, risk management | You've used another aircraft's weight and balance sheet by mistake. What's the risk, and how woul... |
| checkride_corner | `PPL-M13:cc-3` | I.F | performance | knowledge | How do you calculate a moment? |
| checkride_corner | `PPL-M13:cc-4` | I.F | performance | knowledge | What is useful load, and how is it calculated? |
| checkride_corner | `PPL-M13:cc-5` | I.F | performance | knowledge | What is payload, and how does it differ from useful load? |
| checkride_corner | `PPL-M13:cc-6` | I.F | performance | knowledge | What does the moment index simplify, and why is it used? |
| checkride_corner | `PPL-M13:cc-7` | I.F | performance | knowledge | What's the difference between ramp weight and takeoff weight? |
| checkride_corner | `PPL-M13:cc-8` | I.F | performance | knowledge | What is maximum gross weight? |
| checkride_corner | `PPL-M13:cc-9` | I.F | performance | knowledge | How many pounds does one gallon of aviation gasoline weigh? |
| scenario_workshop | `PPL-M13` | I.F | performance | knowledge | Scenario Workshop (module-level self-rating) |

### PPL-M14 — Aircraft Performance

Mapped to: `performance` (I.F)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M14-Q01` | I.F | performance | knowledge | Density altitude is: |
| module_quiz_question | `PPL-M14-Q02` | I.F | performance | knowledge | Power available minus power required equals: |
| module_quiz_question | `PPL-M14-Q03` | I.F | performance | knowledge | Vx is used primarily for: |
| module_quiz_question | `PPL-M14-Q04` | I.F | performance | knowledge | Vy is used primarily for: |
| module_quiz_question | `PPL-M14-Q05` | I.F | performance | knowledge | Which factor generally has the largest effect on density altitude? |
| module_quiz_question | `PPL-M14-Q06` | I.F | performance | knowledge | A tailwind component on takeoff: |
| module_quiz_question | `PPL-M14-Q07` | I.F | performance | knowledge | Ground roll differs from total distance to clear a 50-ft obstacle because: |
| module_quiz_question | `PPL-M14-Q08` | I.F | performance | knowledge | An uphill runway slope on takeoff: |
| module_quiz_question | `PPL-M14-Q09` | I.F | performance | knowledge | A downhill runway slope on landing: |
| module_quiz_question | `PPL-M14-Q12` | I.F | performance | knowledge | Which of the following degrades both lift and thrust simultaneously? |
| module_quiz_question | `PPL-M14-Q13` | I.F | performance | knowledge | Why must climb rate be converted to a climb gradient to evaluate an obstacle? |
| module_quiz_question | `PPL-M14-Q14` | I.F | performance | knowledge | A wet runway primarily affects: |
| module_quiz_question | `PPL-M14-Q15` | I.F | performance | knowledge | Range is calculated using: |
| checkride_corner | `PPL-M14:cc-1` | I.F | performance | knowledge | What is density altitude, and why does it matter? |
| checkride_corner | `PPL-M14:cc-10` | I.F | performance | knowledge | What is glide performance, conceptually? |
| checkride_corner | `PPL-M14:cc-11` | I.F | performance | knowledge | Walk me through how you'd calculate density altitude for this airport. |
| checkride_corner | `PPL-M14:cc-12` | I.F | performance | knowledge | How does a tailwind affect your takeoff distance, and why more than it seems? |
| checkride_corner | `PPL-M14:cc-13` | I.F | performance | knowledge | How do you interpolate between two values on a performance chart? |
| checkride_corner | `PPL-M14:cc-14` | I.F | performance | knowledge | What's the difference between ground roll and total distance to clear a 50-ft obstacle? |
| checkride_corner | `PPL-M14:cc-15` | I.F | performance | knowledge | How does runway slope affect your takeoff and landing planning? |
| checkride_corner | `PPL-M14:cc-16` | I.F | performance | knowledge | How does high humidity affect density altitude? |
| checkride_corner | `PPL-M14:cc-17` | I.F | performance | knowledge | Why does weight affect both takeoff distance and climb performance? |
| checkride_corner | `PPL-M14:cc-18` | I.F | performance | knowledge | What's the difference between a wet runway and a contaminated runway? |
| checkride_corner | `PPL-M14:cc-19` | I.F | performance | knowledge | How do you determine required climb gradient to clear a known obstacle? |
| checkride_corner | `PPL-M14:cc-2` | I.F | performance | knowledge | What's the difference between power available and power required? |
| checkride_corner | `PPL-M14:cc-20` | I.F | performance | knowledge | What's the relationship between range, groundspeed, and endurance? |
| checkride_corner | `PPL-M14:cc-21` | I.F | performance | knowledge, risk management | This takeoff distance is legal but leaves almost no margin. Would you go? Why or why not? |
| checkride_corner | `PPL-M14:cc-22` | I.F | performance | knowledge | Explain why high density altitude reduces both lift and thrust at the same time. |
| checkride_corner | `PPL-M14:cc-23` | I.F | performance | knowledge | A 60-foot obstacle sits beyond the runway. Walk me through how you'd determine if you can clear it. |
| checkride_corner | `PPL-M14:cc-24` | I.F | performance | knowledge | Walk me through the Apex Performance Pyramid using this exact scenario. |
| checkride_corner | `PPL-M14:cc-25` | I.F | performance | knowledge | Why can a cool morning at a high-elevation airport still produce a dangerous density altitude? |
| checkride_corner | `PPL-M14:cc-26` | I.F | performance | knowledge, risk management | You're at max gross weight and the only usable runway has a tailwind component. Walk me through y... |
| checkride_corner | `PPL-M14:cc-27` | I.F | performance | knowledge | Explain the relationship between excess power and climb performance. |
| checkride_corner | `PPL-M14:cc-28` | I.F | performance | knowledge, risk management | Why is "the chart says it works" not the same as "I should go"? |
| checkride_corner | `PPL-M14:cc-29` | I.F | performance | knowledge, risk management | You've used a generic POH chart instead of your specific aircraft's data. What's the risk? |
| checkride_corner | `PPL-M14:cc-3` | I.F | performance | knowledge | What's the difference between Vx and Vy? |
| checkride_corner | `PPL-M14:cc-4` | I.F | performance | knowledge | What is service ceiling? |
| checkride_corner | `PPL-M14:cc-5` | I.F | performance | knowledge | What is absolute ceiling? |
| checkride_corner | `PPL-M14:cc-6` | I.F | performance | knowledge | What is pressure altitude? |
| checkride_corner | `PPL-M14:cc-7` | I.F | performance | knowledge | What's the difference between ground roll and total distance over a 50-ft obstacle? |
| checkride_corner | `PPL-M14:cc-8` | I.F | performance | knowledge | What does a headwind do to takeoff distance? |
| checkride_corner | `PPL-M14:cc-9` | I.F | performance | knowledge | What does a tailwind do to landing distance? |
| scenario_workshop | `PPL-M14` | I.F | performance | knowledge | Scenario Workshop (module-level self-rating) |

### PPL-M15 — Cross-Country Planning

Mapped to: `crosscountry` (I.D)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M15-Q01` | I.D | crosscountry | knowledge | The Apex Flight Planning Cycle's final step is: |
| module_quiz_question | `PPL-M15-Q02` | I.D | crosscountry | knowledge | True course is measured from: |
| module_quiz_question | `PPL-M15-Q03` | I.D | crosscountry | knowledge | Magnetic course equals: |
| module_quiz_question | `PPL-M15-Q04` | I.D | crosscountry | knowledge | Compass heading equals: |
| module_quiz_question | `PPL-M15-Q05` | I.D | crosscountry | knowledge | A wind correction angle compensates for: |
| module_quiz_question | `PPL-M15-Q06` | I.D | crosscountry | knowledge | Groundspeed is: |
| module_quiz_question | `PPL-M15-Q07` | I.D | crosscountry | knowledge | A TFR: |
| module_quiz_question | `PPL-M15-Q08` | I.D | crosscountry | knowledge | Personal fuel minimums should be: |
| module_quiz_question | `PPL-M15-Q09` | I.D | crosscountry | knowledge | Why must both takeoff and landing weight and balance be checked? |
| module_quiz_question | `PPL-M15-Q12` | I.D | crosscountry | knowledge | The four C's of lost procedures are: |
| module_quiz_question | `PPL-M15-Q13` | I.D | crosscountry | knowledge | Why check weather more than once during trip planning? |
| module_quiz_question | `PPL-M15-Q14` | I.D | crosscountry | knowledge | A completed navigation log demonstrates: |
| module_quiz_question | `PPL-M15-Q15` | I.D | crosscountry | knowledge | Blindly trusting GPS without cross-checking is risky because: |
| checkride_corner | `PPL-M15:cc-1` | I.D | crosscountry | knowledge | What are the eight steps of the Apex Flight Planning Cycle? |
| checkride_corner | `PPL-M15:cc-10` | I.D | crosscountry | knowledge | What are the four C's of lost procedures? |
| checkride_corner | `PPL-M15:cc-11` | I.D | crosscountry | knowledge | Walk me through how you calculated your fuel requirements for this flight. |
| checkride_corner | `PPL-M15:cc-12` | I.D | crosscountry | knowledge | How would you evaluate whether a route through this airspace is a good choice? |
| checkride_corner | `PPL-M15:cc-13` | I.D | crosscountry | knowledge | What's your plan if your destination airport closes unexpectedly? |
| checkride_corner | `PPL-M15:cc-14` | I.D | crosscountry | knowledge | How did you select this cruise altitude? |
| checkride_corner | `PPL-M15:cc-15` | I.D | crosscountry | knowledge | Walk me through your NOTAM and TFR review process for this route. |
| checkride_corner | `PPL-M15:cc-16` | I.D | crosscountry | knowledge | How do you cross-check pilotage, dead reckoning, and GPS during a cross-country? |
| checkride_corner | `PPL-M15:cc-17` | I.D | crosscountry | knowledge | Why must you check both takeoff and landing weight and balance for this flight? |
| checkride_corner | `PPL-M15:cc-18` | I.D | crosscountry | knowledge | What would cause you to activate your alternate plan mid-flight? |
| checkride_corner | `PPL-M15:cc-19` | I.D | crosscountry | knowledge | How does a delayed departure change the rest of your plan? |
| checkride_corner | `PPL-M15:cc-2` | I.D | crosscountry | knowledge | How do you select a good checkpoint? |
| checkride_corner | `PPL-M15:cc-20` | I.D | crosscountry | knowledge | What's the difference between a legal fuel reserve and your personal fuel minimum? |
| checkride_corner | `PPL-M15:cc-21` | I.D | crosscountry | knowledge | Your groundspeed is significantly slower than planned at your first checkpoint. Walk me through y... |
| checkride_corner | `PPL-M15:cc-22` | I.D | crosscountry | knowledge, risk management | This flight is legal in every respect, but you have almost no margin anywhere. Would you go? |
| checkride_corner | `PPL-M15:cc-23` | I.D | crosscountry | knowledge | Explain how weather, fuel, and performance planning interact on this specific route. |
| checkride_corner | `PPL-M15:cc-24` | I.D | crosscountry | knowledge | Walk me through your complete cross-country plan using the Apex Flight Planning Cycle, start to f... |
| checkride_corner | `PPL-M15:cc-25` | I.D | crosscountry | knowledge, risk management | A passenger pressures you to continue despite deteriorating weather. Walk me through your response. |
| checkride_corner | `PPL-M15:cc-26` | I.D | crosscountry | knowledge | GPS fails midway through this flight. Walk me through your continued navigation. |
| checkride_corner | `PPL-M15:cc-27` | I.D | crosscountry | knowledge, risk management | Why is a completed navigation log not the same as a safe flight? |
| checkride_corner | `PPL-M15:cc-28` | I.D | crosscountry | knowledge | How would your plan change if this were a night flight instead of a day flight? |
| checkride_corner | `PPL-M15:cc-3` | I.D | crosscountry | knowledge | What's the difference between true course and magnetic course? |
| checkride_corner | `PPL-M15:cc-4` | I.D | crosscountry | knowledge | What's the difference between magnetic course and compass heading? |
| checkride_corner | `PPL-M15:cc-5` | I.D | crosscountry | knowledge | What is a wind correction angle? |
| checkride_corner | `PPL-M15:cc-6` | I.D | crosscountry | knowledge | What does a navigation log's fuel column actually track? |
| checkride_corner | `PPL-M15:cc-7` | I.D | crosscountry | knowledge | What's the difference between a NOTAM and a TFR? |
| checkride_corner | `PPL-M15:cc-8` | I.D | crosscountry | knowledge | Why do you check weather more than once for a single flight? |
| checkride_corner | `PPL-M15:cc-9` | I.D | crosscountry | knowledge | What is a personal fuel minimum? |
| scenario_workshop | `PPL-M15` | I.D | crosscountry | knowledge | Scenario Workshop (module-level self-rating) |

### PPL-M17 — Human Factors

Mapped to: `aeromedical` (I.H)

| Content type | Content ID | ACS Task | Category | mapping_type | Topic |
|---|---|---|---|---|---|
| module_quiz_question | `PPL-M17-Q01` | I.H | aeromedical | knowledge | Hypoxia caused by carbon monoxide binding to hemoglobin is classified as: |
| module_quiz_question | `PPL-M17-Q02` | I.H | aeromedical | knowledge | Hypoxia caused by alcohol's effect on cellular oxygen use is classified as: |
| module_quiz_question | `PPL-M17-Q03` | I.H | aeromedical | knowledge | Under 14 CFR 91.211, supplemental oxygen is required continuously above: |
| module_quiz_question | `PPL-M17-Q04` | I.H | aeromedical | knowledge | At FL450, time of useful consciousness is approximately: |
| module_quiz_question | `PPL-M17-Q05` | I.H | aeromedical | knowledge | The illusion caused by a sudden return to level flight after a prolonged, gradual turn is: |
| module_quiz_question | `PPL-M17-Q06` | I.H | aeromedical | knowledge | A rapid acceleration on takeoff creating a false sensation of nose-up attitude is: |
| module_quiz_question | `PPL-M17-Q07` | I.H | aeromedical | knowledge | Under 14 CFR 91.17, the maximum permitted blood alcohol concentration is: |
| module_quiz_question | `PPL-M17-Q10` | I.H | aeromedical | knowledge | Fatigue that resolves with a single night of adequate sleep is best described as: |
| module_quiz_question | `PPL-M17-Q14` | I.H | aeromedical | knowledge | A pilot who feels "completely fine" despite poor sleep, a medication, and a long day should prima... |
| module_quiz_question | `PPL-M17-Q15` | I.H | aeromedical | knowledge | Cognitive tunneling is most accurately described as: |
| module_quiz_question | `PPL-M17-Q16` | I.H | aeromedical | knowledge | Which statement about circadian rhythm and fatigue is most accurate? |
| module_quiz_question | `PPL-M17-Q21` | I.H | aeromedical | knowledge | A DPE asks why early hypoxia is particularly dangerous. The strongest answer notes that: |
| module_quiz_question | `PPL-M17-Q22` | I.H | aeromedical | knowledge | The correct immediate response to suspected carbon monoxide in the cabin, in order, generally beg... |
| module_quiz_question | `PPL-M17-Q23` | I.H | aeromedical | knowledge | Which of the following is NOT one of the ICEFLAGS illusions? |
| checkride_corner | `PPL-M17:cc-1` | I.H | aeromedical | knowledge | What are the four types of hypoxia? |
| checkride_corner | `PPL-M17:cc-10` | I.H | aeromedical | knowledge | How can carbon monoxide enter the cabin, and how would you detect it? |
| checkride_corner | `PPL-M17:cc-11` | I.H | aeromedical | knowledge | How does fatigue affect pilot decision-making, even if you don't feel tired? |
| checkride_corner | `PPL-M17:cc-13` | I.H | aeromedical | knowledge | What's the difference between the leans and the Coriolis illusion? |
| checkride_corner | `PPL-M17:cc-14` | I.H | aeromedical | knowledge | Why might a non-drowsy OTC medication still be disqualifying? |
| checkride_corner | `PPL-M17:cc-15` | I.H | aeromedical | knowledge | What immediate actions would you take if you suspected carbon monoxide in the cabin? |
| checkride_corner | `PPL-M17:cc-16` | I.H | aeromedical | knowledge | What is circadian rhythm, and how does it affect fatigue beyond hours of sleep? |
| checkride_corner | `PPL-M17:cc-17` | I.H | aeromedical | knowledge | Why is early hypoxia sometimes described as pleasant, and why does that make it more dangerous? |
| checkride_corner | `PPL-M17:cc-18` | I.H | aeromedical | knowledge | How does carbon monoxide exposure relate to hypoxia physiologically? |
| checkride_corner | `PPL-M17:cc-2` | I.H | aeromedical | knowledge | What are the symptoms of hypoxia, and at what altitudes should you be concerned? |
| checkride_corner | `PPL-M17:cc-21` | I.H | aeromedical | knowledge | Why is a pulse oximeter potentially misleading during suspected CO exposure? |
| checkride_corner | `PPL-M17:cc-22` | I.H | aeromedical | knowledge | Explain why alcohol's effect on the body is described as causing histotoxic hypoxia specifically. |
| checkride_corner | `PPL-M17:cc-3` | I.H | aeromedical | knowledge | What's the FAA's rule regarding alcohol and flying? |
| checkride_corner | `PPL-M17:cc-4` | I.H | aeromedical | knowledge | What are the eight illusions in ICEFLAGS? |
| checkride_corner | `PPL-M17:cc-5` | I.H | aeromedical | knowledge | What's the difference between acute and chronic fatigue? |
| checkride_corner | `PPL-M17:cc-7` | I.H | aeromedical | knowledge | What's the regulatory oxygen requirement above 12,500 feet? Above 14,000 feet? |
| checkride_corner | `PPL-M17:cc-8` | I.H | aeromedical | knowledge | What is cognitive tunneling? |
| checkride_corner | `PPL-M17:cc-9` | I.H | aeromedical | knowledge | Describe the graveyard spiral illusion and what causes it. |

## Notable intentionally-unmapped items within mapped modules

These are called out individually because they sit inside an otherwise-mapped module and a
reader might otherwise expect them to be mapped too:

- **PPL-M04 FARs Simplified**: right-of-way (Q11-Q13, cc-13/14), minimum safe altitude (Q14,
  cc-15) — general operating rules with no clean fit among the 19 scoped tasks. PIC authority /
  emergency authority under §91.3(b) (cc-2, cc-3) — a real regulatory concept, but not an
  element any of the 19 scoped tasks' ACS text actually enumerates. "Legal but not safe" (cc-20)
  — open-ended, no single correct answer. Scenario Workshop — 5 independent mini-scenarios
  (currency/right-of-way/emergency-authority/inoperative-equipment/Class-B-deviation) under one
  shared module-level rating; not granular enough to attribute to one task.
- **PPL-M07 Sectional Charts**: "full process for analyzing an unfamiliar route" (cc-16), "risk
  changes at night" (cc-17), "what to do, not just what it looks like" (cc-19, pedagogical), and
  "confirm current chart edition" (cc-20, a currency/publication-process question, not chart
  symbology) are all either too broad-synthesis or off the chart-reading/airspace-classification
  subject to attribute to one task. Scenario Workshop — 6 independent mixed-theme mini-scenarios
  under one shared rating.
- **PPL-M12 Weather Decision Making**: generic ADM-model-name recall (PAVE, 5P, DECIDE, the CARE
  checklist, and the five-questions/case-study walkthrough items built around them — Q07-Q11,
  Q15, cc-4, cc-8/9/10/11/12/13/14, cc-20/21/23/24/25) tests remembering a named framework, not a
  weather-specific judgment, and was left unmapped even though the module's core subject
  otherwise qualified for `knowledge, risk management`. Scenario Workshop — predominantly
  generic-ADM framing, not weather-specific.
- **PPL-M13/M14 (Weight & Balance / Aircraft Performance)**: "defend a loading/performance
  decision you'd make differently" (cc-30 in each) — open-ended, no single correct answer.
- **PPL-M15 Cross-Country Planning**: "biggest planning mistake students make" (cc-29, opinion)
  and "defend a planning decision" (cc-30, open-ended) left unmapped.
- **PPL-M17 Human Factors**: SHELL model (Q08, cc-6, cc-12, cc-23) and the Swiss Cheese Model
  (Q09, cc-19) are named generic frameworks, not the physiological/regulatory facts Task H
  (Human Factors) actually tests. Apex's own "Silent Six" walkthrough (cc-20) is Apex's ADM
  framework, not a Human Factors fact. Personal fuel/altitude minimums beyond the legal floor
  (Q24) and "defend a personal minimum" (cc-24) are ADM/personal-minimums judgment, not
  physiology. Scenario Workshop left unmapped.

## Intentionally unmapped modules

| Module | Reason |
|---|---|
| PPL-M02 Aerodynamics | Content (four forces, lift generation, angle of attack, load factor, drag, stability) is flight-maneuver territory — no assessable knowledge task among the 19 genuinely fits aerodynamic theory as its own subject. |
| PPL-M05 | No authored `module_companion_content` exists — generic fallback content only. |
| PPL-M06 Airport Operations | Its actual content (traffic patterns, radio calls, right-of-way on the ground, runway markings) does not match Task E's real subject (National Airspace System — airspace *classification*, not airport-surface operations). No other scoped task fits airport-operations content either. |
| PPL-M16 Aeronautical Decision-Making | `adm` is a domain-agnostic framework category with no standalone ACS task among the 19 scoped tasks — no single-task association is genuinely defensible (this is the same reasoning that keeps Modules 12/17's generic-ADM-model items unmapped, just for an entire module here). |
| PPL-M18 | No authored `module_companion_content` exists — generic fallback content only. |
| PPL-M19 | No authored `module_companion_content` exists — generic fallback content only. |
| PPL-M20 | No authored `module_companion_content` exists — generic fallback content only. |

## Scope-stability note (Sprint 5 candidate, not implemented)

This migration adds only *content* mappings onto the 19 tasks that were already
`digital_assessment_supported = true`. It does not add any new task to that set. While
reading module content for this migration, no clear candidate for a *new* digitally-assessable
task emerged — the unmapped modules above are unmapped either because they have no content, or
because their content is genuinely flight-maneuver/framework territory rather than a gap in
which task is currently in scope. No scope-expansion candidate is being recommended for Sprint 5
from this work.

---

# Addendum: Sprint 4.1 Phase 9 — Targeted Cross-Domain Mapping QA

This addendum records the targeted cross-domain mapping QA pass performed in Sprint
4.1 Phase 9 (migration `v138_mapping_qa_corrections`), on top of the Sprint 4 mapping
expansion recorded above. This was a **targeted pass**, not a re-audit of all 449
mappings — only the pairings the sprint specification flagged as likely to bleed
across domains were checked: Aircraft Systems ↔ Aeromedical, Aircraft Systems ↔
Airspace, Weather ↔ ADM/risk management, Weight & Balance ↔ Performance, Navigation
↔ Airspace, Emergency ↔ Aircraft Systems.

## Finding 1 (severity: high) — Area IX.A "Emergency Descent" had no genuine content

Auditing IX.A's 16 `dpe_question` mappings by reading their actual question text
found **zero** of them were about emergency descent. All 16 were cross-country
flight planning, navigation, or weather-in-planning content (`xc-1` through
`xc-33`, `wx-8`) that had been seeded onto the wrong `acs_task_id`. Separately,
all 16 genuine Emergency Operations `dpe_question` rows (`emerg-1` through
`emerg-16`) were seeded onto Area X.A ("Maneuvering with One Engine Inoperative
(AMEL, AMES)") — a multiengine-only task that does not apply to Apex's
single-engine Private Pilot curriculum.

This was an active-impact bug: IX.A is the one Emergency Operations task Sprint
4.1's `v134` migration kept `digital_assessment_supported = true` (on the belief,
now proven incorrect, that its 16 mappings were real emergency-descent evidence).
Every student who had ever studied cross-country planning would have been
credited with "emergency" category evidence they never earned.

**Fix** — each of the 16 misrouted questions was reattached to the task its
content actually tests:

| content_id | Reattached to |
|---|---|
| `wx-8` | I.C Weather Information |
| `xc-1`, `xc-2`, `xc-27`, `xc-7`, `xc-8`, `xc-32`, `xc-33` | I.D Cross-Country Flight Planning |
| `xc-5`, `xc-28`, `xc-29`, `xc-30` | VI.A Pilotage and Dead Reckoning |
| `xc-6` | VI.B Navigation Systems and Radar Services |
| `xc-3` | VI.C Diversion |
| `xc-4` | VI.D Lost Procedures |
| `xc-31` | I.E National Airspace System (TFRs are airspace-restriction knowledge) |
| `emerg-6` ("procedure for an emergency descent") | IX.A Emergency Descent — IX.A now has its one genuine content item |
| `emerg-1`, `emerg-2` | IX.B Emergency Approach and Landing (Simulated) |
| `emerg-3`, `emerg-5`, `emerg-7`, `emerg-9`–`emerg-14` | IX.C Systems and Equipment Malfunctions |
| `emerg-4`, `emerg-8`, `emerg-15`, `emerg-16` | Unmapped (no Area IX task's Knowledge/Risk-Management element covers general 91.3(b) authority, post-accident reporting, an inadvertent-IMC encounter, or NMAC reporting — left honestly unmapped rather than forced onto the wrong task) |

IX.B and IX.C remain `digital_assessment_supported = false` (the `v134` decision
is unchanged by this migration — reattaching real content to the correct task
does not, by itself, reopen that scope decision). See Known Limitations below.

## Finding 2 (severity: low) — genuine dual-topic content, Aircraft Systems ↔ Aeromedical / Airspace

Three PPL-M03 (Aircraft Systems) items test a second task's knowledge directly,
not just the systems pathway M03 already covers:

- `PPL-M03-Q08` and `PPL-M03:cc-18` both ask specifically *why* carbon monoxide is
  dangerous / what makes it dangerous — physiological knowledge (Human Factors),
  not just how it enters the cabin. Added a second mapping to **I.H Human
  Factors** alongside the existing I.G Operation of Systems mapping.
- `PPL-M03:cc-20` explicitly asks how ADS-B Out "connects to airspace
  requirements" — genuinely tests National Airspace System knowledge, not just
  equipment function. Added a second mapping to **I.E National Airspace System**.

Checked but left single-mapped (content genuinely doesn't cross domains):
- `PPL-M03:cc-19` (cabin heat / carb heat system relationship) — about system
  design, not physiological effect. Stays I.G only.
- `PPL-M03-Q10` / `PPL-M09-Q17/18/19` (ADS-B function/navigation-use questions)
  — none ask about airspace equipage requirements, only what the system does or
  how to use it for situational awareness. Stay in their original category.
- `PPL-M04-Q19` (ADS-B equipage altitude requirement) — already correctly
  airspace-only; it's the equipage-requirement counterpart to M03's
  system-function questions, not a duplicate.

## Pairings checked with no correction needed

- **Weather ↔ ADM/risk management**: moot after Sprint 4.1 Issue 3 — v3 no
  longer computes an independent risk-management subscore (it mirrors
  `knowledge_score` and always discloses this via `reason_codes`), so no
  `mapping_type`-based risk-only aggregation exists to audit.
- **Weight & Balance ↔ Performance**: not actually a cross-category case — both
  are already the same `performance` category / single task (I.F), by design.
- **Navigation ↔ Airspace**: M07 (Sectional Charts) content was already split
  correctly at the Sprint 4 mapping-expansion stage (classification/depiction
  items → airspace, chart-reading/nav items → crosscountry); no further items
  needed correction beyond `xc-31`/`xc-32` above.

## Known Limitations / Future Sprint Consideration

Fixing the Area X→IX reattachment for `emerg-1/2/3/5/7/9–14` revealed that
IX.B ("Emergency Approach and Landing") and IX.C ("Systems and Equipment
Malfunctions") now have genuine oral-knowledge content mapped to them, which
they did not have when `v134` set `digital_assessment_supported = false` for
all of IX.B–G. Whether that content is *sufficient* to reopen those two tasks'
assessability is a real question worth a future sprint's deliberate attention —
it is explicitly **not** decided or acted on here, per Sprint 4.1's scope
boundary ("Do NOT expand scope into Sprint 5"). IX.D–G remain unsupported with
no content of any kind.
