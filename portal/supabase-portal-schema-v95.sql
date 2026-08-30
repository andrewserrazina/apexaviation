-- Apex Advantage — Fix outdated BasicMed limits in the Checkride Prep
-- question bank (v95)
--
-- dpe_questions.priv-3 ("What are the requirements and limitations of
-- flying under BasicMed?") stated the pre-2024 aircraft limits: "6 or
-- fewer seats" and "6,000 lbs or less max takeoff weight." Sections 815
-- and 828 of the FAA Reauthorization Act of 2024 directed the FAA to
-- raise these limits; the FAA's implementing final rule took effect
-- November 18, 2024 (89 FR 90884), raising the maximum certificated
-- takeoff weight to 12,500 lbs and the maximum occupant count to 7 (6
-- passengers, up from 5). Confirmed against the FAA's own current
-- BasicMed page (faa.gov/licenses_certificates/airmen_certification/
-- basic_med) before writing this fix.
--
-- Everything else in this answer (the July 14, 2006 prior-medical-
-- certificate requirement, the physician exam, the online course, the
-- 18,000 ft MSL / 250 knot operating limits, and the no-compensation-
-- or-hire restriction) is unchanged by this rule and stays as-is.
--
-- portal/supabase-portal-schema-v5.sql (the original seed) is fixed in
-- place in this same pass, so a fresh install never seeds the outdated
-- figures -- this migration is the hotfix for the database that already
-- ran the original v5.sql.
--
-- Run this in the Supabase SQL editor.

update public.dpe_questions
set
  model_answer = 'You must have held a valid medical certificate at some point after July 14, 2006, complete a physician''s comprehensive medical exam using the FAA''s checklist, and complete a free online medical education course. Under BasicMed, you''re limited to aircraft with 7 or fewer occupants (6 or fewer passengers) and a maximum certificated takeoff weight of 12,500 lbs or less, flying no higher than 18,000 feet MSL, no faster than 250 knots, and not for compensation or hire (with limited exceptions).',
  common_mistakes = 'Citing the pre-2024 limits (6 seats / 6,000 lbs) instead of the current figures, forgetting the weight/occupant limitations entirely, or believing BasicMed has no altitude or airspeed limits.'
where id = 'priv-3';
