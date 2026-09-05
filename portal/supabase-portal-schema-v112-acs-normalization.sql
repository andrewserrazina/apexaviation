-- Apex Advantage Sprint 0 Phase C -- ACS normalization (v112) -- REV2
--
-- NOT YET APPLIED TO PRODUCTION. Source-controlled, locally tested only,
-- per the explicit Phase C stop gate. This is Sprint 0's mobile-backend
-- product work, not a security-hardening migration.
--
-- ===========================================================================
-- REV2 CHANGE NOTE (independent review, Rev1 -> Rev2)
-- ===========================================================================
-- Rev1 of this migration DERIVED the ACS task list from dpe_questions.acs_
-- reference free text -- i.e. Apex content defined the taxonomy. Independent
-- review correctly flagged this backwards: readiness coverage must be
-- measured against the COMPLETE official ACS, not just the subset of tasks
-- Apex happened to write a question for. Rev2 replaces that with the
-- authoritative FAA source:
--
--   FAA-S-ACS-6C, "Private Pilot for Airplane Category Airman Certification
--   Standards" (publication date November 2023; effective for testing
--   May 31, 2024) -- attached to this task as a PDF and read directly with
--   pdftotext (poppler-utils) to extract its real Table of Contents. Every
--   Area of Operation / Task title below is copied verbatim from that
--   extraction (12 Areas of Operation, 61 Tasks total) -- none of it is
--   derived from dpe_questions, previous migrations, or memory. See
--   SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT_REV2.md section 4 for the
--   full extraction methodology and the exact text verification performed
--   (the PDF's own front matter and revision-history table confirm
--   "FAA-S-ACS-6C" and "supersedes FAA-S-ACS-6B", which was cross-checked
--   before trusting the extraction).
--
-- No Instrument ACS is seeded here -- no authoritative Instrument ACS
-- document was supplied, and Rev2's own rule ("do not derive an ACS merely
-- from existing question strings") applies just as much to Instrument as to
-- Private Pilot. Every instrument dpe_questions row is therefore reported as
-- unresolved (reason: no_authoritative_acs_seeded_for_exam_type) until a real
-- FAA-S-ACS-8 (or successor) source is supplied. This is a deliberate,
-- documented staging decision, not an oversight.
--
-- Rev1 also had two further defects fixed here:
--  (1) its backfill ran `delete from content_acs_mappings where
--      content_type = 'dpe_question'` on every re-run, which would have
--      silently deleted any manually-curated mapping a human added in the
--      meantime. Rev2 adds explicit mapping_source provenance
--      ('deterministic_backfill' | 'human_curated') and the backfill now
--      deletes/regenerates ONLY rows it itself created -- a manual mapping
--      is never touched by a re-run, proven by a dedicated regression test.
--  (2) it allowed multiple `active = true` acs_versions rows per
--      certificate_type with no way to pick "the" applicable one
--      unambiguously. Rev2 adds a partial unique index enforcing at most one
--      active version per certificate_type, plus a get_active_acs_version()
--      helper every consumer (readiness, daily drills) now calls instead of
--      an inline `where active = true`.
--
-- ---------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------
--
-- acs_versions   -- one row per (certificate_type, ACS revision). Lets a
--                    future Instrument/Commercial ACS, or a future PPL ACS
--                    revision, coexist without touching old data. At most
--                    one ACTIVE row per certificate_type (enforced below).
-- acs_tasks      -- one row per Area-of-Operation + Task, scoped to a
--                    specific acs_version_id. area_code/task_code/area_title/
--                    task_title are the FAA's own identifiers and titles,
--                    copied verbatim -- never paraphrased, never inferred
--                    from Apex content.
-- content_acs_mappings -- generic join: any (content_type, content_id)
--                    pair (today: 'dpe_question') to any acs_task_id, with
--                    a mapping_type (which KSA component, taken verbatim
--                    from the source acs_reference text when auto-derived),
--                    a weight, and a mapping_source recording HOW the row
--                    was created (see REV2 change note above).
--
-- ---------------------------------------------------------------------
-- B. Backfill methodology (read this before trusting the numbers below)
-- ---------------------------------------------------------------------
--
-- dpe_questions.acs_reference is free text, authored over many separate
-- content-writing sessions, and is NOT a reliable machine-readable key on
-- its own. Under Rev2, the backfill's job is narrower and safer than Rev1's:
-- it parses ONLY the strict, unambiguous shape
--   ^Area of Operation <roman>, Task <letter> --- ... (...)
-- to extract an (area_code, task_code) pair, then looks up whether that
-- exact pair already exists in the AUTHORITATIVE acs_tasks seeded in
-- section C below. It never creates a new acs_tasks row from Apex content.
-- If the parsed pair doesn't exist in the authoritative set for that
-- exam_type, the row is reported unresolved (reason:
-- area_task_not_found_in_authoritative_acs) rather than silently accepted.
--
-- Because the task's title now always comes from the authoritative source
-- (never from Apex's own paraphrase in acs_reference), the "title conflict
-- between two rows claiming the same task" failure mode from Rev1 is
-- structurally eliminated -- there is no longer any Apex-supplied title to
-- disagree about. This category is kept in the report's count table (always
-- 0) with this explanation, rather than silently dropped.
--
-- Rows with a "/" (multi-task references) or a "Special Emphasis Area"
-- prefix are still never guessed at -- see acs_unresolved_mappings.
--
-- `dpe_questions.acs_reference` itself is NOT modified, dropped, or
-- reinterpreted by this migration.
--
-- Idempotent + manual-curation-safe: every DDL statement uses IF NOT
-- EXISTS; the backfill DELETE only ever removes rows with
-- mapping_source = 'deterministic_backfill', so re-running this file after
-- a human has added a 'human_curated' mapping cannot lose that work.
--
-- Rollback: `drop table if exists content_acs_mappings, acs_tasks, acs_versions cascade;`
-- (no other table is touched; dpe_questions and every existing content
-- table are completely unaffected either way).

create table if not exists public.acs_versions (
  id uuid primary key default gen_random_uuid(),
  certificate_type text not null,
  version_code text not null,
  effective_date date,
  source_document text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (certificate_type, version_code)
);
comment on table public.acs_versions is 'One row per (certificate_type, ACS revision). Additive -- never replaces dpe_questions.acs_reference. At most one active row per certificate_type (see idx_acs_versions_one_active_per_cert below).';
comment on column public.acs_versions.source_document is 'Human-readable provenance, e.g. "FAA-S-ACS-6C PDF, extracted via pdftotext from the attached authoritative source, Sprint 0 Phase C Rev2". Not machine-parsed.';

-- REV2.15: at most one ACTIVE version per certificate_type, so every
-- consumer has an unambiguous "the applicable version" to select instead of
-- risking multiple `active = true` rows with no tiebreak.
create unique index if not exists idx_acs_versions_one_active_per_cert
  on public.acs_versions (certificate_type) where active;

create table if not exists public.acs_tasks (
  id uuid primary key default gen_random_uuid(),
  acs_version_id uuid not null references public.acs_versions(id) on delete cascade,
  area_code text not null,
  area_title text not null,
  task_code text not null,
  task_title text not null,
  sort_order integer,
  created_at timestamptz not null default now(),
  unique (acs_version_id, area_code, task_code)
);
comment on table public.acs_tasks is 'One row per Area-of-Operation + Task within a specific acs_version_id. area_code/task_code/area_title/task_title are the FAA document''s own identifiers and titles, copied verbatim -- never inferred from Apex content.';
create index if not exists idx_acs_tasks_version on public.acs_tasks (acs_version_id);

create table if not exists public.content_acs_mappings (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id text not null,
  acs_task_id uuid not null references public.acs_tasks(id) on delete cascade,
  mapping_type text,
  mapping_source text not null default 'deterministic_backfill'
    check (mapping_source in ('deterministic_backfill', 'human_curated')),
  weight numeric not null default 1.0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique (content_type, content_id, acs_task_id)
);
comment on table public.content_acs_mappings is 'Generic content-to-ACS-task join. content may map to more than one acs_task_id (multiple rows). mapping_source records provenance so an automatic re-backfill can regenerate its own rows without ever touching a human_curated one (REV2.2). Never replaces or rewrites the source content row.';
comment on column public.content_acs_mappings.created_by is 'Set only for human_curated rows (the admin who added the mapping). Null for deterministic_backfill rows -- the migration itself has no profile id to attribute to.';

create index if not exists idx_content_acs_mappings_task on public.content_acs_mappings (acs_task_id);
create index if not exists idx_content_acs_mappings_content on public.content_acs_mappings (content_type, content_id);
create index if not exists idx_content_acs_mappings_source on public.content_acs_mappings (mapping_source);

-- RLS: this is reference/curriculum data, not user data -- readable by
-- any authenticated client (mirrors dpe_questions/dpe_categories' own
-- existing public-read posture), writable only by service_role (content
-- curation happens server-side/admin-side, never by a learner).
alter table public.acs_versions enable row level security;
alter table public.acs_tasks enable row level security;
alter table public.content_acs_mappings enable row level security;

drop policy if exists "Anyone can read ACS versions" on public.acs_versions;
create policy "Anyone can read ACS versions" on public.acs_versions for select using (true);

drop policy if exists "Anyone can read ACS tasks" on public.acs_tasks;
create policy "Anyone can read ACS tasks" on public.acs_tasks for select using (true);

drop policy if exists "Anyone can read content ACS mappings" on public.content_acs_mappings;
create policy "Anyone can read content ACS mappings" on public.content_acs_mappings for select using (true);

-- No INSERT/UPDATE/DELETE policy on any of the three -- writes only ever
-- happen via service_role (this migration's own backfill, and any future
-- admin content-curation tooling for human_curated rows), which bypasses
-- RLS entirely.
revoke insert, update, delete on public.acs_versions from anon, authenticated;
revoke insert, update, delete on public.acs_tasks from anon, authenticated;
revoke insert, update, delete on public.content_acs_mappings from anon, authenticated;

-- ---------------------------------------------------------------------
-- REV2.15: unambiguous version selection helper. Every consumer (readiness,
-- daily drills, any future admin tooling) should call this instead of an
-- inline `where active = true` query, so the "one applicable version" rule
-- lives in exactly one place.
-- ---------------------------------------------------------------------
create or replace function public.get_active_acs_version(p_certificate_type text)
returns uuid
language sql stable
set search_path to 'public'
as $function$
  select id from public.acs_versions
  where certificate_type = p_certificate_type and active
  limit 1
$function$;

revoke execute on function public.get_active_acs_version(text) from public, anon;
grant execute on function public.get_active_acs_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- C. Seed the authoritative Private Pilot ACS version, then its complete
--    Area of Operation / Task taxonomy (61 tasks, 12 Areas of Operation),
--    extracted verbatim from the attached FAA-S-ACS-6C PDF's own Table of
--    Contents. Included in full even for tasks Apex currently has ZERO
--    content mapped to (e.g. seaplane/multiengine-only tasks) -- see the
--    REV2 change note above for why this matters for readiness coverage.
-- ---------------------------------------------------------------------
insert into public.acs_versions (certificate_type, version_code, effective_date, source_document, active)
values (
  'private_pilot',
  'FAA-S-ACS-6C',
  '2024-05-31',
  'FAA-S-ACS-6C, Private Pilot for Airplane Category Airman Certification Standards (publication date November 2023; supersedes FAA-S-ACS-6B). Taxonomy extracted verbatim from the attached authoritative PDF via pdftotext, Sprint 0 Phase C Rev2.',
  true
)
on conflict (certificate_type, version_code) do nothing;

insert into public.acs_tasks (acs_version_id, area_code, area_title, task_code, task_title, sort_order)
select (select id from public.acs_versions where certificate_type = 'private_pilot' and version_code = 'FAA-S-ACS-6C'),
       x.area_code, x.area_title, x.task_code, x.task_title, x.sort_order
from (values
    ('I', 'Area of Operation I. Preflight Preparation', 'A', 'Pilot Qualifications', 1),
    ('I', 'Area of Operation I. Preflight Preparation', 'B', 'Airworthiness Requirements', 2),
    ('I', 'Area of Operation I. Preflight Preparation', 'C', 'Weather Information', 3),
    ('I', 'Area of Operation I. Preflight Preparation', 'D', 'Cross-Country Flight Planning', 4),
    ('I', 'Area of Operation I. Preflight Preparation', 'E', 'National Airspace System', 5),
    ('I', 'Area of Operation I. Preflight Preparation', 'F', 'Performance and Limitations', 6),
    ('I', 'Area of Operation I. Preflight Preparation', 'G', 'Operation of Systems', 7),
    ('I', 'Area of Operation I. Preflight Preparation', 'H', 'Human Factors', 8),
    ('I', 'Area of Operation I. Preflight Preparation', 'I', 'Water and Seaplane Characteristics, Seaplane Bases, Maritime Rules, and Aids to Marine Navigation (ASES, AMES)', 9),
    ('II', 'Area of Operation II. Preflight Procedures', 'A', 'Preflight Assessment', 10),
    ('II', 'Area of Operation II. Preflight Procedures', 'B', 'Flight Deck Management', 11),
    ('II', 'Area of Operation II. Preflight Procedures', 'C', 'Engine Starting', 12),
    ('II', 'Area of Operation II. Preflight Procedures', 'D', 'Taxiing (ASEL, AMEL)', 13),
    ('II', 'Area of Operation II. Preflight Procedures', 'E', 'Taxiing and Sailing (ASES, AMES)', 14),
    ('II', 'Area of Operation II. Preflight Procedures', 'F', 'Before Takeoff Check', 15),
    ('III', 'Area of Operation III. Airport and Seaplane Base Operations', 'A', 'Communications, Light Signals, and Runway Lighting Systems', 16),
    ('III', 'Area of Operation III. Airport and Seaplane Base Operations', 'B', 'Traffic Patterns', 17),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'A', 'Normal Takeoff and Climb', 18),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'B', 'Normal Approach and Landing', 19),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'C', 'Soft-Field Takeoff and Climb (ASEL)', 20),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'D', 'Soft-Field Approach and Landing (ASEL)', 21),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'E', 'Short-Field Takeoff and Maximum Performance Climb (ASEL, AMEL)', 22),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'F', 'Short-Field Approach and Landing (ASEL, AMEL)', 23),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'G', 'Confined Area Takeoff and Maximum Performance Climb (ASES, AMES)', 24),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'H', 'Confined Area Approach and Landing (ASES, AMES)', 25),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'I', 'Glassy Water Takeoff and Climb (ASES, AMES)', 26),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'J', 'Glassy Water Approach and Landing (ASES, AMES)', 27),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'K', 'Rough Water Takeoff and Climb (ASES, AMES)', 28),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'L', 'Rough Water Approach and Landing (ASES, AMES)', 29),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'M', 'Forward Slip to a Landing (ASEL, ASES)', 30),
    ('IV', 'Area of Operation IV. Takeoffs, Landings, and Go-Arounds', 'N', 'Go-Around/Rejected Landing', 31),
    ('V', 'Area of Operation V. Performance Maneuvers and Ground Reference Maneuvers', 'A', 'Steep Turns', 32),
    ('V', 'Area of Operation V. Performance Maneuvers and Ground Reference Maneuvers', 'B', 'Ground Reference Maneuvers', 33),
    ('VI', 'Area of Operation VI. Navigation', 'A', 'Pilotage and Dead Reckoning', 34),
    ('VI', 'Area of Operation VI. Navigation', 'B', 'Navigation Systems and Radar Services', 35),
    ('VI', 'Area of Operation VI. Navigation', 'C', 'Diversion', 36),
    ('VI', 'Area of Operation VI. Navigation', 'D', 'Lost Procedures', 37),
    ('VII', 'Area of Operation VII. Slow Flight and Stalls', 'A', 'Maneuvering During Slow Flight', 38),
    ('VII', 'Area of Operation VII. Slow Flight and Stalls', 'B', 'Power-Off Stalls', 39),
    ('VII', 'Area of Operation VII. Slow Flight and Stalls', 'C', 'Power-On Stalls', 40),
    ('VII', 'Area of Operation VII. Slow Flight and Stalls', 'D', 'Spin Awareness', 41),
    ('VIII', 'Area of Operation VIII. Basic Instrument Maneuvers', 'A', 'Straight-and-Level Flight', 42),
    ('VIII', 'Area of Operation VIII. Basic Instrument Maneuvers', 'B', 'Constant Airspeed Climbs', 43),
    ('VIII', 'Area of Operation VIII. Basic Instrument Maneuvers', 'C', 'Constant Airspeed Descents', 44),
    ('VIII', 'Area of Operation VIII. Basic Instrument Maneuvers', 'D', 'Turns to Headings', 45),
    ('VIII', 'Area of Operation VIII. Basic Instrument Maneuvers', 'E', 'Recovery from Unusual Flight Attitudes', 46),
    ('VIII', 'Area of Operation VIII. Basic Instrument Maneuvers', 'F', 'Radio Communications, Navigation Systems/Facilities, and Radar Services', 47),
    ('IX', 'Area of Operation IX. Emergency Operations', 'A', 'Emergency Descent', 48),
    ('IX', 'Area of Operation IX. Emergency Operations', 'B', 'Emergency Approach and Landing (Simulated) (ASEL, ASES)', 49),
    ('IX', 'Area of Operation IX. Emergency Operations', 'C', 'Systems and Equipment Malfunctions', 50),
    ('IX', 'Area of Operation IX. Emergency Operations', 'D', 'Emergency Equipment and Survival Gear', 51),
    ('IX', 'Area of Operation IX. Emergency Operations', 'E', 'Engine Failure During Takeoff Before VMC (Simulated) (AMEL, AMES)', 52),
    ('IX', 'Area of Operation IX. Emergency Operations', 'F', 'Engine Failure After Liftoff (Simulated) (AMEL, AMES)', 53),
    ('IX', 'Area of Operation IX. Emergency Operations', 'G', 'Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)', 54),
    ('X', 'Area of Operation X. Multiengine Operations', 'A', 'Maneuvering with One Engine Inoperative (AMEL, AMES)', 55),
    ('X', 'Area of Operation X. Multiengine Operations', 'B', 'VMC Demonstration (AMEL, AMES)', 56),
    ('X', 'Area of Operation X. Multiengine Operations', 'C', 'One Engine Inoperative (Simulated) (solely by Reference to Instruments) During Straight-and-Level Flight and Turns (AMEL, AMES)', 57),
    ('X', 'Area of Operation X. Multiengine Operations', 'D', 'Instrument Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)', 58),
    ('XI', 'Area of Operation XI. Night Operations', 'A', 'Night Operations', 59),
    ('XII', 'Area of Operation XII. Postflight Procedures', 'A', 'After Landing, Parking, and Securing (ASEL, AMEL)', 60),
    ('XII', 'Area of Operation XII. Postflight Procedures', 'B', 'Seaplane Post-Landing Procedures (ASES, AMES)', 61)
) as x(area_code, area_title, task_code, task_title, sort_order)
on conflict (acs_version_id, area_code, task_code) do nothing;

-- ---------------------------------------------------------------------
-- D. Deterministic content backfill -- maps dpe_questions onto the
--    AUTHORITATIVE tasks seeded above. Never creates a new acs_tasks row.
--    Only ever deletes/regenerates rows this exact backfill itself created
--    (mapping_source = 'deterministic_backfill'), so a human-curated
--    mapping added between two runs of this migration always survives
--    (REV2.2 -- proven by a dedicated regression test).
-- ---------------------------------------------------------------------
do $$
begin
  delete from public.content_acs_mappings
  where content_type = 'dpe_question' and mapping_source = 'deterministic_backfill';

  insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source, weight)
  select distinct
    'dpe_question',
    d.id,
    t.id,
    lower(replace((regexp_match(d.acs_reference, '\(([^)]+)\)'))[1], ' and ', ', ')),
    'deterministic_backfill',
    1.0
  from public.dpe_questions d
  join lateral (
    select
      (regexp_match(d.acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\('))[1] as area_code,
      (regexp_match(d.acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\('))[2] as task_code
  ) p on p.area_code is not null
  join public.acs_versions v on v.certificate_type = d.exam_type and v.active
  join public.acs_tasks t
    on t.acs_version_id = v.id
   and t.area_code = p.area_code
   and t.task_code = p.task_code
  where d.acs_reference not like '%/%'
    and d.acs_reference not like 'Special Emphasis Area%'
  on conflict (content_type, content_id, acs_task_id) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- E. Unresolved-mapping report -- a live view, not a point-in-time
--    snapshot. Every row here needs a human to either (a) add a
--    human_curated mapping, or (b) decide it genuinely has no single-task
--    mapping (e.g. Special Emphasis Area rows, or content for an exam_type
--    with no authoritative ACS seeded yet).
-- ---------------------------------------------------------------------
create or replace view public.acs_unresolved_mappings as
select
  d.id as content_id,
  'dpe_question' as content_type,
  d.exam_type,
  d.acs_reference,
  case
    when not exists (select 1 from public.acs_versions v where v.certificate_type = d.exam_type and v.active)
      then 'no_authoritative_acs_seeded_for_exam_type'
    when d.acs_reference like 'Special Emphasis Area%' then 'special_emphasis_area_no_single_task'
    when d.acs_reference like '%/%' then 'multi_task_reference_needs_human_disambiguation'
    when (regexp_match(d.acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\(')) is null
      then 'does_not_match_known_acs_reference_shape'
    else 'area_task_not_found_in_authoritative_acs'
  end as reason
from public.dpe_questions d
where not exists (
  select 1 from public.content_acs_mappings m
  where m.content_type = 'dpe_question' and m.content_id = d.id
);
comment on view public.acs_unresolved_mappings is 'Every dpe_questions row with no content_acs_mappings row at all, classified by why. "title_conflict" from Rev1 is structurally impossible now that task titles come from the authoritative FAA source rather than Apex text -- see the Rev2 report''s ACS Mapping Results section for that count (always 0, by design, not by omission).';

revoke all on public.acs_unresolved_mappings from anon, authenticated;
grant select on public.acs_unresolved_mappings to service_role;

-- ===========================================================================
-- REV3 ADDITIONS -- task applicability + learner training context
-- ===========================================================================
--
-- Independent review of Rev2 correctly found that treating all 61
-- authoritative tasks as applicable to every Private Pilot applicant is
-- wrong: FAA-S-ACS-6C itself qualifies many tasks to specific airplane
-- classes (single-engine land, multiengine land, single-engine sea,
-- multiengine sea). An ASEL (single-engine land) learner -- the class Apex
-- actually serves today -- must never be scored against seaplane-only or
-- multiengine-only tasks.
--
-- F. ACS TASK APPLICABILITY
--
-- acs_task_applicability is a normalized junction table (one row per
-- applicable class), not a text[] column -- chosen per REV3.2's own
-- preference for a normalized design when in doubt, and because it makes
-- "is task T applicable to class C" a plain indexed join rather than an
-- array-containment operation sprinkled through every consumer query.
--
-- Populated directly from the qualifier text already present in the
-- authoritative task titles extracted in section C above (e.g. "Taxiing
-- (ASEL, AMEL)") -- NOT inferred from Apex content, exactly as REV3.1
-- requires. A task with no class qualifier in its official title applies
-- to all four classes (e.g. "Pilot Qualifications" -- every Private Pilot
-- applicant, regardless of class, is tested on this). This produces 45 of
-- the 61 tasks applicable to ASEL -- the 16 excluded are every seaplane-
-- only (ASES/AMES) and multiengine-only (AMEL/AMES) task, matching
-- FAA-S-ACS-6C's own class-qualification scheme exactly.
create table if not exists public.acs_task_applicability (
  acs_task_id uuid not null references public.acs_tasks(id) on delete cascade,
  aircraft_class text not null check (aircraft_class in ('ASEL', 'AMEL', 'ASES', 'AMES')),
  primary key (acs_task_id, aircraft_class)
);
comment on table public.acs_task_applicability is 'Which airplane class(es) an ACS task applies to, per FAA-S-ACS-6C''s own class qualifiers on each task title. A task with no qualifier in its official title is applicable to all four classes.';

create index if not exists idx_acs_task_applicability_class on public.acs_task_applicability (aircraft_class, acs_task_id);

alter table public.acs_task_applicability enable row level security;
drop policy if exists "Anyone can read ACS task applicability" on public.acs_task_applicability;
create policy "Anyone can read ACS task applicability" on public.acs_task_applicability for select using (true);
revoke insert, update, delete on public.acs_task_applicability from anon, authenticated;

insert into public.acs_task_applicability (acs_task_id, aircraft_class)
select t.id, x.aircraft_class
from (values
    ('I', 'A', 'ASEL'), ('I', 'A', 'AMEL'), ('I', 'A', 'ASES'), ('I', 'A', 'AMES'),
    ('I', 'B', 'ASEL'), ('I', 'B', 'AMEL'), ('I', 'B', 'ASES'), ('I', 'B', 'AMES'),
    ('I', 'C', 'ASEL'), ('I', 'C', 'AMEL'), ('I', 'C', 'ASES'), ('I', 'C', 'AMES'),
    ('I', 'D', 'ASEL'), ('I', 'D', 'AMEL'), ('I', 'D', 'ASES'), ('I', 'D', 'AMES'),
    ('I', 'E', 'ASEL'), ('I', 'E', 'AMEL'), ('I', 'E', 'ASES'), ('I', 'E', 'AMES'),
    ('I', 'F', 'ASEL'), ('I', 'F', 'AMEL'), ('I', 'F', 'ASES'), ('I', 'F', 'AMES'),
    ('I', 'G', 'ASEL'), ('I', 'G', 'AMEL'), ('I', 'G', 'ASES'), ('I', 'G', 'AMES'),
    ('I', 'H', 'ASEL'), ('I', 'H', 'AMEL'), ('I', 'H', 'ASES'), ('I', 'H', 'AMES'),
    ('I', 'I', 'ASES'), ('I', 'I', 'AMES'),
    ('II', 'A', 'ASEL'), ('II', 'A', 'AMEL'), ('II', 'A', 'ASES'), ('II', 'A', 'AMES'),
    ('II', 'B', 'ASEL'), ('II', 'B', 'AMEL'), ('II', 'B', 'ASES'), ('II', 'B', 'AMES'),
    ('II', 'C', 'ASEL'), ('II', 'C', 'AMEL'), ('II', 'C', 'ASES'), ('II', 'C', 'AMES'),
    ('II', 'D', 'ASEL'), ('II', 'D', 'AMEL'),
    ('II', 'E', 'ASES'), ('II', 'E', 'AMES'),
    ('II', 'F', 'ASEL'), ('II', 'F', 'AMEL'), ('II', 'F', 'ASES'), ('II', 'F', 'AMES'),
    ('III', 'A', 'ASEL'), ('III', 'A', 'AMEL'), ('III', 'A', 'ASES'), ('III', 'A', 'AMES'),
    ('III', 'B', 'ASEL'), ('III', 'B', 'AMEL'), ('III', 'B', 'ASES'), ('III', 'B', 'AMES'),
    ('IV', 'A', 'ASEL'), ('IV', 'A', 'AMEL'), ('IV', 'A', 'ASES'), ('IV', 'A', 'AMES'),
    ('IV', 'B', 'ASEL'), ('IV', 'B', 'AMEL'), ('IV', 'B', 'ASES'), ('IV', 'B', 'AMES'),
    ('IV', 'C', 'ASEL'),
    ('IV', 'D', 'ASEL'),
    ('IV', 'E', 'ASEL'), ('IV', 'E', 'AMEL'),
    ('IV', 'F', 'ASEL'), ('IV', 'F', 'AMEL'),
    ('IV', 'G', 'ASES'), ('IV', 'G', 'AMES'),
    ('IV', 'H', 'ASES'), ('IV', 'H', 'AMES'),
    ('IV', 'I', 'ASES'), ('IV', 'I', 'AMES'),
    ('IV', 'J', 'ASES'), ('IV', 'J', 'AMES'),
    ('IV', 'K', 'ASES'), ('IV', 'K', 'AMES'),
    ('IV', 'L', 'ASES'), ('IV', 'L', 'AMES'),
    ('IV', 'M', 'ASEL'), ('IV', 'M', 'ASES'),
    ('IV', 'N', 'ASEL'), ('IV', 'N', 'AMEL'), ('IV', 'N', 'ASES'), ('IV', 'N', 'AMES'),
    ('V', 'A', 'ASEL'), ('V', 'A', 'AMEL'), ('V', 'A', 'ASES'), ('V', 'A', 'AMES'),
    ('V', 'B', 'ASEL'), ('V', 'B', 'AMEL'), ('V', 'B', 'ASES'), ('V', 'B', 'AMES'),
    ('VI', 'A', 'ASEL'), ('VI', 'A', 'AMEL'), ('VI', 'A', 'ASES'), ('VI', 'A', 'AMES'),
    ('VI', 'B', 'ASEL'), ('VI', 'B', 'AMEL'), ('VI', 'B', 'ASES'), ('VI', 'B', 'AMES'),
    ('VI', 'C', 'ASEL'), ('VI', 'C', 'AMEL'), ('VI', 'C', 'ASES'), ('VI', 'C', 'AMES'),
    ('VI', 'D', 'ASEL'), ('VI', 'D', 'AMEL'), ('VI', 'D', 'ASES'), ('VI', 'D', 'AMES'),
    ('VII', 'A', 'ASEL'), ('VII', 'A', 'AMEL'), ('VII', 'A', 'ASES'), ('VII', 'A', 'AMES'),
    ('VII', 'B', 'ASEL'), ('VII', 'B', 'AMEL'), ('VII', 'B', 'ASES'), ('VII', 'B', 'AMES'),
    ('VII', 'C', 'ASEL'), ('VII', 'C', 'AMEL'), ('VII', 'C', 'ASES'), ('VII', 'C', 'AMES'),
    ('VII', 'D', 'ASEL'), ('VII', 'D', 'AMEL'), ('VII', 'D', 'ASES'), ('VII', 'D', 'AMES'),
    ('VIII', 'A', 'ASEL'), ('VIII', 'A', 'AMEL'), ('VIII', 'A', 'ASES'), ('VIII', 'A', 'AMES'),
    ('VIII', 'B', 'ASEL'), ('VIII', 'B', 'AMEL'), ('VIII', 'B', 'ASES'), ('VIII', 'B', 'AMES'),
    ('VIII', 'C', 'ASEL'), ('VIII', 'C', 'AMEL'), ('VIII', 'C', 'ASES'), ('VIII', 'C', 'AMES'),
    ('VIII', 'D', 'ASEL'), ('VIII', 'D', 'AMEL'), ('VIII', 'D', 'ASES'), ('VIII', 'D', 'AMES'),
    ('VIII', 'E', 'ASEL'), ('VIII', 'E', 'AMEL'), ('VIII', 'E', 'ASES'), ('VIII', 'E', 'AMES'),
    ('VIII', 'F', 'ASEL'), ('VIII', 'F', 'AMEL'), ('VIII', 'F', 'ASES'), ('VIII', 'F', 'AMES'),
    ('IX', 'A', 'ASEL'), ('IX', 'A', 'AMEL'), ('IX', 'A', 'ASES'), ('IX', 'A', 'AMES'),
    ('IX', 'B', 'ASEL'), ('IX', 'B', 'ASES'),
    ('IX', 'C', 'ASEL'), ('IX', 'C', 'AMEL'), ('IX', 'C', 'ASES'), ('IX', 'C', 'AMES'),
    ('IX', 'D', 'ASEL'), ('IX', 'D', 'AMEL'), ('IX', 'D', 'ASES'), ('IX', 'D', 'AMES'),
    ('IX', 'E', 'AMEL'), ('IX', 'E', 'AMES'),
    ('IX', 'F', 'AMEL'), ('IX', 'F', 'AMES'),
    ('IX', 'G', 'AMEL'), ('IX', 'G', 'AMES'),
    ('X', 'A', 'AMEL'), ('X', 'A', 'AMES'),
    ('X', 'B', 'AMEL'), ('X', 'B', 'AMES'),
    ('X', 'C', 'AMEL'), ('X', 'C', 'AMES'),
    ('X', 'D', 'AMEL'), ('X', 'D', 'AMES'),
    ('XI', 'A', 'ASEL'), ('XI', 'A', 'AMEL'), ('XI', 'A', 'ASES'), ('XI', 'A', 'AMES'),
    ('XII', 'A', 'ASEL'), ('XII', 'A', 'AMEL'),
    ('XII', 'B', 'ASES'), ('XII', 'B', 'AMES')
) as x(area_code, task_code, aircraft_class)
join public.acs_tasks t on t.area_code = x.area_code and t.task_code = x.task_code
  and t.acs_version_id = (select id from public.acs_versions where certificate_type = 'private_pilot' and version_code = 'FAA-S-ACS-6C')
on conflict (acs_task_id, aircraft_class) do nothing;

-- ---------------------------------------------------------------------
-- G. Learner training context (REV3.3/3.4)
-- ---------------------------------------------------------------------
--
-- profiles.primary_aircraft_class is the smallest clean addition needed:
-- no existing field anywhere in the schema captures a learner's airplane
-- class (searched before adding this -- profiles has no such column, and
-- no other table tracks it either; the closest existing field,
-- certificate_status, is free text used for a different purpose).
--
-- Defaulted to 'ASEL' for every row, existing and future: this matches
-- current Apex product reality exactly -- every piece of curriculum
-- content in this codebase (dpe_questions, Ground School, Study Packs) is
-- single-engine-land-oriented with no seaplane or multiengine track sold
-- today. This is a safe, honest default for v1, not a guess -- it is
-- revisited the moment Apex actually sells seaplane/multiengine content
-- and a real class-selection UI is warranted (see Sprint 0 report "Known
-- Limitations").
alter table public.profiles add column if not exists primary_aircraft_class text
  not null default 'ASEL' check (primary_aircraft_class in ('ASEL', 'AMEL', 'ASES', 'AMES'));
comment on column public.profiles.primary_aircraft_class is 'The airplane class this learner is training toward, for ACS-task-applicability filtering (readiness coverage, Daily Drill targeting). Defaults to ASEL -- see v112''s own header comment for why that default is safe for current Apex v1 product reality.';

-- ---------------------------------------------------------------------
-- get_member_training_context() -- the ONE resolution path for
-- certificate_type + aircraft_class + active ACS version, used by every
-- consumer (readiness, daily drills, mobile-bootstrap) instead of each
-- reimplementing slightly different lookup logic.
--
-- p_profile_id is optional: omitted (or null), it resolves auth.uid() --
-- the auth.uid()-bound path every direct authenticated RPC caller uses
-- (mirrors compute_readiness_snapshot/get_or_create_daily_drill). Supplied
-- explicitly, it lets a trusted server-side caller (mobile-bootstrap, which
-- already independently verifies the JWT via auth.getUser() and works with
-- a bare service-role client rather than forwarding the Authorization
-- header) resolve a specific learner's context without needing to change
-- that established calling convention.
--
-- Security: an explicit p_profile_id that DIFFERS from a real, non-null
-- auth.uid() is always rejected -- an authenticated end-user's own JWT
-- cannot be forged to claim someone else's auth.uid(), so this closes the
-- one real risk of accepting an explicit argument at all (a learner trying
-- to read another learner's training context) while still allowing the
-- genuine service-role case, where there is no forwarded end-user JWT at
-- all and auth.uid() is simply null.
-- ---------------------------------------------------------------------
create or replace function public.get_member_training_context(p_profile_id uuid default null)
returns table (profile_id uuid, certificate_type text, aircraft_class text, acs_version_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_profile_id uuid;
  v_certificate_type text := 'private_pilot';
  v_aircraft_class text;
begin
  if p_profile_id is not null and auth.uid() is not null and p_profile_id <> auth.uid() then
    raise exception 'Not authorized to resolve another member''s training context.';
  end if;

  v_profile_id := coalesce(p_profile_id, auth.uid());
  if v_profile_id is null then
    raise exception 'Not signed in.';
  end if;

  select coalesce(p.primary_aircraft_class, 'ASEL') into v_aircraft_class
  from public.profiles p where p.id = v_profile_id;
  if v_aircraft_class is null then
    raise exception 'Profile not found.';
  end if;

  return query select v_profile_id, v_certificate_type, v_aircraft_class,
    public.get_active_acs_version(v_certificate_type);
end;
$function$;

revoke execute on function public.get_member_training_context(uuid) from public, anon;
grant execute on function public.get_member_training_context(uuid) to authenticated, service_role;

-- get_applicable_acs_tasks() -- the single query every consumer (readiness,
-- daily drills) uses to get "the tasks that count for this learner right
-- now," rather than each reimplementing the applicability join separately.
create or replace function public.get_applicable_acs_tasks(p_profile_id uuid default null)
returns setof public.acs_tasks
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.*
  from public.acs_tasks t
  join public.acs_task_applicability a on a.acs_task_id = t.id
  join public.get_member_training_context(p_profile_id) ctx on true
  where t.acs_version_id = ctx.acs_version_id
    and a.aircraft_class = ctx.aircraft_class
$function$;

revoke execute on function public.get_applicable_acs_tasks(uuid) from public, anon;
grant execute on function public.get_applicable_acs_tasks(uuid) to authenticated, service_role;
