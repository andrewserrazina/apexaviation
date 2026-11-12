-- Instrument Rating ASEL syllabus (Draft 0.1): scope FAA experience
-- requirements per-rating instead of globally, then replace the
-- Instrument Rating Course's 14 old placeholder lessons with the real
-- 36-lesson I01-I26/G01-G10 catalog from the source workbook. Applied live
-- via mcp__Supabase__apply_migration on 2026-11-11 (migration:
-- instrument_rating_syllabus_structure). Zero enrollments/completions/
-- logbook/lesson references existed against the 14 old placeholder rows
-- (verified before writing this migration) -- safe to replace wholesale.

-- ───────────────────────── scope faa_experience_requirements per rating ─────────────────────────
alter table public.faa_experience_requirements add column if not exists syllabus_id uuid references public.syllabi(id);

update public.faa_experience_requirements
set syllabus_id = '53c52f9e-4cab-4d8b-b40c-8202ed39c0ee'  -- Private Pilot Course
where syllabus_id is null;

alter table public.faa_experience_requirements alter column syllabus_id set not null;

-- the old fkey on student_faa_experience_checks depends on the unique index
-- we're about to replace on faa_experience_requirements -- drop it first
alter table public.student_faa_experience_checks
  drop constraint student_faa_experience_checks_requirement_key_fkey;

alter table public.faa_experience_requirements
  drop constraint faa_experience_requirements_requirement_key_key;
alter table public.faa_experience_requirements
  add constraint faa_experience_requirements_syllabus_requirement_key unique (syllabus_id, requirement_key);

-- ───────────────────────── switch student_faa_experience_checks to reference by id ─────────────────────────
alter table public.student_faa_experience_checks add column if not exists requirement_id uuid references public.faa_experience_requirements(id);

update public.student_faa_experience_checks c
set requirement_id = r.id
from public.faa_experience_requirements r
where r.requirement_key = c.requirement_key
  and r.syllabus_id = '53c52f9e-4cab-4d8b-b40c-8202ed39c0ee'
  and c.requirement_id is null;

alter table public.student_faa_experience_checks alter column requirement_id set not null;

alter table public.student_faa_experience_checks
  drop constraint student_faa_experience_checks_student_id_requirement_key_key;
alter table public.student_faa_experience_checks drop column requirement_key;
alter table public.student_faa_experience_checks
  add constraint student_faa_experience_checks_student_id_requirement_id_key unique (student_id, requirement_id);

-- ───────────────────────── Instrument Rating Course: replace placeholder lessons ─────────────────────────
delete from public.syllabus_lessons where syllabus_id = '223370c5-517d-40c2-b684-c4d1fac87da3';

insert into public.syllabus_lessons
  (syllabus_id, lesson_code, stage, mode, plan_flight_hours, plan_ground_hours, duration_hours, sort_order, title, description)
values
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G01', 1, 'Ground', 0.0, 1.5, 1.5, 0,
   'G01 • Enrollment, Logbook Audit and Study Plan',
   'Ground, 1.5 hrs. Review prior XC PIC and instrument time, eligibility, study cadence, instructor/aircraft availability, and learning goals. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G02', 1, 'Ground', 0.0, 1.5, 1.5, 1,
   'G02 • IFR Regulations and Currency',
   'Ground, 1.5 hrs. §§61.65, 61.57(c), 91.167–91.193, clearances, alternate requirements, and operating rules. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G03', 1, 'Ground', 0.0, 1.5, 1.5, 2,
   'G03 • Instrument Systems and Aircraft-Specific Avionics',
   'Ground, 1.5 hrs. Pitot-static, gyros/electrical, GPS/VOR/ILS, autopilot if equipped, limitations and failure modes. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G04', 1, 'Ground', 0.0, 1.5, 1.5, 3,
   'G04 • Instrument Charts and IFR Flight Planning',
   'Ground, 1.5 hrs. En route/terminal charts, takeoff minima context, ODPs/SIDs/STARs, briefing and navigation workflow. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I01', 1, 'Dual', 1.5, 0.5, 2.0, 4,
   'I01 • IFR Orientation, Equipment and Baseline',
   'Dual, 1.5 flight hrs. Systems/limitations, IFR equipment, flight instruments, preflight, cockpit organization and instrument scan. Completion: explain applicable aircraft/equipment limitations; establish a disciplined scan and maintain safe heading, altitude and airspeed with coaching. Documentation: actual flight, actual/simulated instrument time, qualifying XC PIC and CFII instruction as applicable; N/A/P/R task ratings; conditions, approaches, deficiencies, and instructor sign-off.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I02', 1, 'Dual', 1.5, 0.5, 2.0, 5,
   'I02 • Attitude Instrument Flying and Trim',
   'Dual, 1.5 flight hrs. Pitch/power/performance, straight-and-level, constant-speed climbs, descents and instrument cross-check. Completion: stabilize selected pitch/power configurations and correct deviations promptly; no loss of aircraft control.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I03', 1, 'Dual', 1.5, 0.5, 2.0, 6,
   'I03 • Instrument Turns and Timed Maneuvers',
   'Dual, 1.5 flight hrs. Standard-rate turns, compass and magnetic considerations, timed turns, climbs/descents through assigned altitudes. Completion: fly coordinated instrument maneuvers using appropriate scan; anticipate level-offs and report deviations.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I04', 1, 'Dual', 1.5, 0.5, 2.0, 7,
   'I04 • Partial-Panel and Unusual Attitudes',
   'Dual, 1.5 flight hrs. Recognize unreliable instruments, alternate scan, nose-high/nose-low recovery and use of supporting avionics. Completion: detect failures, recover unusual attitudes promptly and safely, and apply limitations without fixation.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I05', 1, 'Dual', 1.5, 0.5, 2.0, 8,
   'I05 • IFR Clearances and Avionics Workflow',
   'Dual, 1.5 flight hrs. Clearance copying, readbacks, flight-plan entries, COM/NAV setup, route sequencing and departure briefing. Completion: correctly interpret and read back a clearance; verify avionics configuration before each phase.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I06', 1, 'Dual', 1.5, 0.5, 2.0, 9,
   'I06 • Intercepting and Tracking Navigation',
   'Dual, 1.5 flight hrs. VOR/GPS tracking, wind corrections, CDI interpretation, changeover and course interception. Completion: maintain situational awareness and appropriate course/altitude control; identify off-course indications.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I07', 1, 'Dual evaluation', 2.0, 0.5, 2.5, 10,
   'I07 • Stage Check 1 — Basic Instrument Proficiency',
   'Dual evaluation, 2.0 flight hrs. Instrument scan, basic maneuvers, unusual attitudes, partial panel and navigation setup. Completion: demonstrate stage-specific independent control and explain deviations; record deficiencies and corrective training. Stage 1 progression gate: formal instructor evaluation confirms applicable stage tasks have met their written stage standards; no critical unresolved deficiency; any remediation/repeat attempt documented. Stage-check completion does not itself certify §61.65 eligibility.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G06', 2, 'Ground', 0.0, 1.5, 1.5, 11,
   'G06 • Holding and Approach Workshop',
   'Ground, 1.5 hrs. Hold clearances/entries, approach plates, NOTAMs, minimums, approach briefs and missed approaches. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G07', 2, 'Ground', 0.0, 1.5, 1.5, 12,
   'G07 • IFR ATC and Lost Communications',
   'Ground, 1.5 hrs. Clearance reads, route changes, deviations, emergencies, lost comms and decision hierarchy. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I08', 2, 'Dual', 1.5, 0.5, 2.0, 13,
   'I08 • Departure Procedures and IFR ATC',
   'Dual, 1.5 flight hrs. ODP/SID interpretation, climb gradients, clearances, ATC communications and departure deviations. Completion: brief and fly the applicable departure safely, with route and terrain awareness.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I09', 2, 'Dual', 1.5, 0.5, 2.0, 14,
   'I09 • En Route Navigation and Airway Operations',
   'Dual, 1.5 flight hrs. Charts, MEA/MOCA, route changes, navigation aids, position reports and altitude planning. Completion: manage route and clearances without losing situational awareness or aircraft control.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I10', 2, 'Dual', 2.0, 0.5, 2.5, 15,
   'I10 • Holding and Course Reversals',
   'Dual, 2.0 flight hrs. Hold entries, timing/distance adjustments, wind correction, HILPT and procedure-turn decisions. Completion: select the appropriate entry, establish the hold, correct for wind and comply with clearances.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I11', 2, 'Dual', 1.5, 0.5, 2.0, 16,
   'I11 • ILS/LOC Approaches',
   'Dual, 1.5 flight hrs. Approach briefing, localizer/glideslope, minima, missed-approach points and missed instructions. Completion: fly and brief an installed-equipment-appropriate precision approach to applicable ACS standards.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I12', 2, 'Dual', 2.0, 0.5, 2.5, 17,
   'I12 • RNAV (GPS) Approaches',
   'Dual, 2.0 flight hrs. Database integrity, loading/activating, leg sequencing, GPS integrity and applicable LNAV minima. Completion: brief and execute an available RNAV procedure using verified approved equipment and legal minima.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I13', 2, 'Dual', 1.5, 0.5, 2.0, 18,
   'I13 • VOR and Nonprecision Approaches',
   'Dual, 1.5 flight hrs. Step-downs, MDA, timing where published, visual transition and missed approach. Completion: maintain required step-down and altitude discipline; never descend below authorized minima.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I14', 2, 'Dual', 1.5, 0.5, 2.0, 19,
   'I14 • Circling and Missed Approaches',
   'Dual, 1.5 flight hrs. Circling limitations and wind, missed-approach execution, climb/route verification and decision-making. Completion: recognize unstable conditions and perform a prompt go-around/missed approach when appropriate.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I15', 2, 'Dual evaluation', 2.0, 0.5, 2.5, 20,
   'I15 • Stage Check 2 — IFR Procedures',
   'Dual evaluation, 2.0 flight hrs. Clearances, a hold, precision/nonprecision approaches, misses, communications and task management. Completion: demonstrate stage competence on assigned ACS tasks with deficiencies recorded for remediation. Stage 2 progression gate: formal instructor evaluation confirms applicable stage tasks have met their written stage standards; no critical unresolved deficiency; any remediation/repeat attempt documented. Stage-check completion does not itself certify §61.65 eligibility.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G05', 3, 'Ground', 0.0, 1.5, 1.5, 21,
   'G05 • IFR Weather and Risk Management',
   'Ground, 1.5 hrs. Clouds, icing, convective weather, ceilings/visibility, turbulence, forecast uncertainty and escape planning. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G08', 3, 'Ground', 0.0, 1.5, 1.5, 22,
   'G08 • 250-NM Cross-Country Planning',
   'Ground, 1.5 hrs. Route design, filed IFR, approach-kind matrix, fuel and alternate strategy, landing suitability and compliance. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I16', 3, 'Dual', 2.0, 0.5, 2.5, 23,
   'I16 • IFR Weather, Alternate and Flight Planning',
   'Dual, 2.0 flight hrs. Briefing and dispatch, icing/thunderstorms, alternate rules, fuel, aircraft performance and escape routes. Completion: present a defensible go/no-go plan and choose legal, practical alternates and fuel margins.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I17', 3, 'Dual', 2.0, 0.5, 2.5, 24,
   'I17 • Complex Airspace and Real-World IFR En Route',
   'Dual, 2.0 flight hrs. Clearances, reroutes, ATC services, changes in minima, terrain awareness and workload management. Completion: prioritize aircraft control, navigation and communications during reroutes.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I18', 3, 'Dual', 2.0, 0.5, 2.5, 25,
   'I18 • Abnormal Avionics and Emergency Operations',
   'Dual, 2.0 flight hrs. Vacuum/electrical/nav failures where relevant, lost comms, inadvertent icing avoidance and diversion. Completion: identify and isolate failures; choose an appropriate emergency strategy using actual equipment procedures.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I19', 3, 'Dual', 2.0, 0.5, 2.5, 26,
   'I19 • Approach Combinations and Workload Scenarios',
   'Dual, 2.0 flight hrs. Multiple approach types, holds and reroutes under realistic weather, fuel and workload constraints. Completion: handle consecutive approaches and a safe missed/diversion with sound risk management.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I20', 3, 'Dual IFR cross-country', 4.5, 0.5, 5.0, 27,
   'I20 • Qualifying 250-NM IFR Cross-Country',
   'Dual IFR cross-country, 4.5 flight hrs. With authorized instructor and a filed IFR flight plan: ≥250 NM by airways/ATC-directed routing; instrument approach at each airport; three different kinds of approaches using navigation systems. Completion: before dispatch, verify route, airways/routing, airports and approach kinds under §61.65(d)(2)(ii); after the flight, record the actual route and approaches. Extend or redo the flight if it does not qualify.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I21', 3, 'Dual evaluation', 2.0, 0.5, 2.5, 28,
   'I21 • Stage Check 3 — IFR Cross-Country Readiness',
   'Dual evaluation, 2.0 flight hrs. Integrated preflight, clearance, en route, diversion, instrument approaches, weather/alternates and emergencies. Completion: demonstrate integrated proficiency and satisfactory threat/error management; document remaining gaps. Stage 3 progression gate: formal instructor evaluation confirms applicable stage tasks have met their written stage standards; no critical unresolved deficiency; any remediation/repeat attempt documented. Stage-check completion does not itself certify §61.65 eligibility.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G09', 4, 'Ground', 0.0, 1.5, 1.5, 29,
   'G09 • Knowledge Test and Integrated Scenarios',
   'Ground, 1.5 hrs. Sporty''s completion, written-test readiness, oral scenarios and risk-management discussions. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'G10', 4, 'Ground', 0.0, 1.5, 1.5, 30,
   'G10 • Final ACS Oral and Certification Audit',
   'Ground, 1.5 hrs. Mock oral, ACS gaps, IACRA/checkride readiness, logbook and endorsement review. Completion: explain operational decisions from current source documents and demonstrate knowledge using scenario questions; any deficient concept receives targeted follow-up.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I22', 4, 'Dual', 2.0, 0.5, 2.5, 31,
   'I22 • Precision Standards and Weak-Area Review',
   'Dual, 2.0 flight hrs. Target holding, intercepts, precision/nonprecision approaches, planning and cockpit management gaps. Completion: repeat deficient tasks until observed performance meets the applicable published ACS standard.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I23', 4, 'Dual', 2.0, 0.5, 2.5, 32,
   'I23 • Partial-Panel and Emergency Proficiency',
   'Dual, 2.0 flight hrs. Failures, unusual attitudes, lost communications, missed approaches and emergency judgment. Completion: demonstrate safe and timely prioritization, aircraft control and correct published procedures.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I24', 4, 'Dual evaluation', 2.0, 0.5, 2.5, 33,
   'I24 • Mock Oral and Flight Practical Evaluation',
   'Dual evaluation, 2.0 flight hrs. Scenario-based oral, IFR planning, systems, weather, approaches, holds, emergency and postflight evaluation. Completion: all applicable ACS elements have recorded evidence or an assigned remediation plan.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I25', 4, 'Dual', 2.0, 0.5, 2.5, 34,
   'I25 • Targeted Corrections and Recent Training',
   'Dual, 2.0 flight hrs. Retrain weak ACS tasks, recheck actual instrument time and recent airplane instrument instruction. Completion: demonstrate corrected task proficiency; verify the qualifying 3 hours in the preceding two calendar months.'),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'I26', 4, 'Dual / evaluation', 2.0, 0.5, 2.5, 35,
   'I26 • Final Audit, Proficiency Flight and Release',
   'Dual / evaluation, 2.0 flight hrs. Verify logged eligibility: 50 XC PIC, 40 instrument, 15 instrument-instructor hours, qualifying IFR XC, test results and required endorsements. Completion: independent practical-test readiness decision by authorized instructor after a documented audit. Stage 4 progression gate: formal instructor evaluation confirms applicable stage tasks have met their written stage standards; no critical unresolved deficiency; any remediation/repeat attempt documented. Stage-check completion does not itself certify §61.65 eligibility.');

-- ───────────────────────── seed Instrument Rating's own §61.65 experience requirements ─────────────────────────
insert into public.faa_experience_requirements (syllabus_id, requirement_key, label, minimum, sort_order) values
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'xc_pic_total', 'Cross-country PIC total', 50, 1),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'xc_pic_airplane', 'Cross-country PIC in airplane', 10, 2),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'instrument_actual_sim', 'Actual or simulated instrument', 40, 3),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'instrument_instructor_training', 'Instrument training by rated instrument instructor', 15, 4),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'recent_instrument_training', 'Recent airplane instrument training within 2 calendar months', 3, 5),
  ('223370c5-517d-40c2-b684-c4d1fac87da3', 'qualifying_250nm_xc', 'Qualifying 250-NM IFR cross-country', 1, 6)
on conflict (syllabus_id, requirement_key) do nothing;
