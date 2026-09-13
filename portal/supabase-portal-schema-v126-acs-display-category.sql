-- Apex Advantage — Sprint 3: unified ACS evidence, Part A (v126)
--
-- Two new columns on acs_tasks (v112), never on content_acs_mappings:
--
-- 1. dpe_category text references dpe_categories(id) -- the canonical,
--    one-task-one-category bridge from the real FAA task structure to
--    Apex's existing 11-key student-facing taxonomy. Deliberately NOT a
--    column on content_acs_mappings: that table can have many rows
--    pointing at one acs_task (many content items -> one task), while
--    task_evidence is already aggregated to one row per (profile, task).
--    Joining the aggregate back through content_acs_mappings would let
--    one task's evidence double-count in every category any of its
--    mapped content items happens to carry -- a correctness bug, not a
--    style choice. This column carries no claim that the Apex category
--    *is* an FAA Area of Operation -- it is a pure product-display
--    rollup layer on top of the authoritative FAA task structure.
--
-- 2. digital_assessment_supported boolean -- a separate signal from
--    dpe_category, deliberately: it answers "can Apex currently observe
--    this task at all," not "which product category does it display
--    under." Apex's oral-exam-question content has no mechanism to
--    observe the ~42 hands-on flight-maneuver/procedural tasks (taxiing,
--    takeoffs, landings, stalls, instrument maneuvers, multiengine,
--    night ops, postflight) -- treating their absence of task_evidence
--    as a negative readiness signal would conflate "no product coverage"
--    with "poor student performance." All 61 tasks stay in acs_tasks
--    untouched (full ACS visibility preserved for a future instructor/
--    flight-evidence integration); this column is exactly the field a
--    future task-level UI would key a "not yet tracked" state on.
--
-- Mapping below reuses ACS_TRACKER's own already-vetted Area-I mapping
-- (site/portal-stable.js, "verified directly against the ACS document"
-- per its own header comment) as the base, rather than inventing a new
-- one. privileges and adm intentionally end up with zero mapped tasks --
-- the FAA ACS bundles "privileges and limitations" into the same Task A
-- as "qualifications" (one task, one canonical category), and ADM/Risk
-- Management is a cross-cutting Special Emphasis Area with no discrete
-- Task of its own to attach a column value to. Documented as a real,
-- honestly-reported structural gap between the FAA's task granularity
-- and Apex's product taxonomy, not an oversight.

alter table public.acs_tasks
  add column if not exists dpe_category text references public.dpe_categories(id),
  add column if not exists digital_assessment_supported boolean not null default false;

update public.acs_tasks at
set dpe_category = m.category,
    digital_assessment_supported = true
from (values
  ('I','A','eligibility'),
  ('I','B','airworthiness'),
  ('I','C','weather'),
  ('I','D','crosscountry'),
  ('I','E','airspace'),
  ('I','F','performance'),
  ('I','G','aircraft-systems'),
  ('I','H','aeromedical'),
  ('VI','A','crosscountry'),
  ('VI','B','crosscountry'),
  ('VI','C','crosscountry'),
  ('VI','D','crosscountry'),
  ('IX','A','emergency'),
  ('IX','B','emergency'),
  ('IX','C','emergency'),
  ('IX','D','emergency'),
  ('IX','E','emergency'),
  ('IX','F','emergency'),
  ('IX','G','emergency')
) as m(area_code, task_code, category)
where at.area_code = m.area_code and at.task_code = m.task_code
  and at.acs_version_id = public.get_active_acs_version('private_pilot');

-- Every other task (Areas I.I, II, III, IV, V, VII, VIII, X, XI, XII --
-- 42 of 61) is left with dpe_category = null, digital_assessment_supported
-- = false by the column defaults above -- intentionally unmapped, not
-- guessed.

create or replace function public.get_readiness_scoped_acs_tasks(p_profile_id uuid default null)
returns setof public.acs_tasks
language sql
stable
security definer
set search_path = public
as $$
  select t.* from public.get_applicable_acs_tasks(p_profile_id) t
  where t.digital_assessment_supported = true
$$;

revoke execute on function public.get_readiness_scoped_acs_tasks(uuid) from public, anon;
grant execute on function public.get_readiness_scoped_acs_tasks(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- content_acs_mappings: PPL-M01's Ground School content, hand-curated
-- and content-verified (not guessed from ids) -- see Sprint 3 report
-- for the full per-question reasoning. Only rows that genuinely test a
-- specific ACS task element are inserted; exam-process/administrative
-- questions (module quiz Q02/Q06/Q11/Q15, Checkride Corner cc-3/cc-4/
-- cc-5, and the module's Scenario Workshop content -- all Part-61-vs-141/
-- exam-structure topics, not a real ACS Task element) are intentionally
-- left unmapped rather than force-fit to inflate coverage.
-- ---------------------------------------------------------------------
insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'module_quiz_question', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M01-Q01'),  -- minimum age for Private Pilot Certificate
  ('PPL-M01-Q04'),  -- BasicMed
  ('PPL-M01-Q09')   -- Part 61 minimum total flight time
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'A'
    and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;

insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
select 'checkride_corner', v.content_id, t.id, 'knowledge', 'human_curated'
from (values
  ('PPL-M01:cc-1'),  -- Private Pilot Certificate eligibility requirements
  ('PPL-M01:cc-2')   -- student pilot cert vs. medical certificate
) as v(content_id)
cross join lateral (
  select id from public.acs_tasks
  where area_code = 'I' and task_code = 'A'
    and acs_version_id = public.get_active_acs_version('private_pilot')
) t
on conflict (content_type, content_id, acs_task_id) do nothing;
