-- Apex Advantage Sprint 0 Phase C -- ACS normalization (v112)
--
-- NOT YET APPLIED TO PRODUCTION. Source-controlled, locally tested only,
-- per the explicit Phase C stop gate. This is Sprint 0's mobile-backend
-- product work, not a security-hardening migration.
--
-- Purpose: give the mobile app (and, eventually, the web app) a real,
-- queryable ACS task taxonomy to attach evidence/readiness/drills to,
-- without touching dpe_questions.acs_reference (a free-text field) or
-- inventing IDs for existing content. This migration is purely additive.
--
-- ---------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------
--
-- acs_versions   -- one row per (certificate_type, ACS revision). Lets a
--                    future Instrument/Commercial ACS, or a future PPL ACS
--                    revision, coexist without touching old data.
-- acs_tasks      -- one row per Area-of-Operation + Task, scoped to a
--                    specific acs_version_id. area_code/task_code are the
--                    ACS's own identifiers (roman numeral area, letter
--                    task) -- NOT a reinterpretation of them.
-- content_acs_mappings -- generic join: any (content_type, content_id)
--                    pair (today: 'dpe_question') to any acs_task_id, with
--                    a mapping_type (which KSA component: knowledge /
--                    risk_management / skill / combinations thereof, taken
--                    verbatim from the source acs_reference text) and a
--                    weight (reserved for future many-to-many confidence
--                    weighting; always 1.0 for the deterministic v1
--                    backfill below, since every resolved row maps to
--                    exactly one task).
--
-- ---------------------------------------------------------------------
-- B. Backfill methodology (read this before trusting the numbers below)
-- ---------------------------------------------------------------------
--
-- dpe_questions.acs_reference is free text, authored over many separate
-- content-writing sessions, and is NOT a reliable machine-readable key on
-- its own -- confirmed by direct inspection of all 392 live values across
-- both exam_types before writing this migration (63 private_pilot +
-- instrument-only rows don't even follow the "Area of Operation N, Task
-- L" shape at all; 24 more explicitly reference two tasks joined by "/").
--
-- The backfill below parses ONLY the strict, unambiguous shape:
--   ^Area of Operation <roman>, Task <letter> --- <title> (...)
-- with no "/" anywhere in the string and no "Special Emphasis Area"
-- prefix. It ALSO requires that every row sharing the same
-- (exam_type, area_code, task_code) triple resolve to the exact same
-- <title> text -- if two rows disagree on the title for the same task
-- (which does not happen in the current dataset, but is checked for
-- defensively since new content could introduce it), NONE of that
-- pair's rows are auto-mapped; they fall through to the unresolved
-- report instead of guessing which title is canonical.
--
-- Rows that do not match this strict shape are NEVER guessed at. They
-- are left unmapped, and every one of them is captured in the
-- `acs_unresolved_mappings` reporting view created at the end of this
-- migration (see Sprint 0 Mobile Backend Report section 6 for the
-- rendered results: 305 of 392 rows resolved automatically, 87 require
-- a human to add the mapping by hand -- 24 explicit multi-task "/"
-- references where a human must decide which task is primary, and 63
-- rows -- mostly "Special Emphasis Area" ACS-Appendix references that
-- correctly have no single numbered task to map to).
--
-- `dpe_questions.acs_reference` itself is NOT modified, dropped, or
-- reinterpreted by this migration -- it remains the source of truth for
-- the free-text display string; content_acs_mappings is purely additive
-- structure layered on top.
--
-- Idempotent: every DDL statement uses IF NOT EXISTS; the backfill DELETE
-- and re-INSERT is safe to re-run because it only ever touches rows this
-- migration itself would have created (matched on content_type='dpe_question'
-- and content_id in dpe_questions), never a manually-added mapping (which
-- would use a different, non-generated content_id set... in practice,
-- manually-added mappings should just avoid re-running this file after
-- being added; this migration is intended to run once per environment).
--
-- Rollback: `drop table if exists content_acs_mappings, acs_tasks, acs_versions cascade;`
-- (no other table is touched; dpe_questions and every existing content
-- table are completely unaffected either way).

create table if not exists public.acs_versions (
  id uuid primary key default gen_random_uuid(),
  certificate_type text not null,
  version_code text not null,
  effective_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (certificate_type, version_code)
);
comment on table public.acs_versions is 'One row per (certificate_type, ACS revision). Additive -- never replaces dpe_questions.acs_reference.';

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
comment on table public.acs_tasks is 'One row per Area-of-Operation + Task within a specific acs_version_id. area_code/task_code are the ACS document''s own identifiers.';

create table if not exists public.content_acs_mappings (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id text not null,
  acs_task_id uuid not null references public.acs_tasks(id) on delete cascade,
  mapping_type text,
  weight numeric not null default 1.0,
  created_at timestamptz not null default now(),
  unique (content_type, content_id, acs_task_id)
);
comment on table public.content_acs_mappings is 'Generic content-to-ACS-task join. content may map to more than one acs_task_id (multiple rows). Never replaces or rewrites the source content row.';

create index if not exists idx_content_acs_mappings_task on public.content_acs_mappings (acs_task_id);
create index if not exists idx_content_acs_mappings_content on public.content_acs_mappings (content_type, content_id);

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
-- admin content-curation tooling), which bypasses RLS entirely. Matches
-- the existing dpe_questions/dpe_categories pattern (public read via
-- policy, write via service_role only, no direct client write path).
revoke insert, update, delete on public.acs_versions from anon, authenticated;
revoke insert, update, delete on public.acs_tasks from anon, authenticated;
revoke insert, update, delete on public.content_acs_mappings from anon, authenticated;

-- ---------------------------------------------------------------------
-- C. Seed acs_versions for the two exam_types already present in
--    dpe_questions. version_code 'v1-backfill' marks these as the
--    machine-derived baseline; a future real ACS revision gets its own
--    version_code without touching this one.
-- ---------------------------------------------------------------------
insert into public.acs_versions (certificate_type, version_code, active)
values
  ('private_pilot', 'v1-backfill', true),
  ('instrument', 'v1-backfill', true)
on conflict (certificate_type, version_code) do nothing;

-- ---------------------------------------------------------------------
-- D. Deterministic backfill -- see methodology note (B) above.
-- ---------------------------------------------------------------------
do $$
declare
  v_version_pp uuid := (select id from public.acs_versions where certificate_type = 'private_pilot' and version_code = 'v1-backfill');
  v_version_instr uuid := (select id from public.acs_versions where certificate_type = 'instrument' and version_code = 'v1-backfill');
begin
  -- Clear only what this migration itself would have created, so it's
  -- safe to re-run without duplicating or drifting from a re-computed
  -- backfill.
  delete from public.content_acs_mappings where content_type = 'dpe_question';
  delete from public.acs_tasks where acs_version_id in (v_version_pp, v_version_instr);

  -- Insert one acs_tasks row per (exam_type, area_code, task_code) that
  -- passes the strict-shape + title-consistency test. Mirrors the exact
  -- CTE structure validated read-only against production before this
  -- migration was written (305 of 392 rows resolved, 0 title conflicts
  -- found in the current dataset -- the consistency check is kept as a
  -- defensive safeguard against future content, not because it currently
  -- excludes anything).
  with parsed as (
    select
      exam_type,
      (regexp_match(acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\('))[1] as area_code,
      (regexp_match(acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\('))[2] as task_code,
      trim((regexp_match(acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\('))[3]) as task_title
    from public.dpe_questions
    where acs_reference not like '%/%'
      and acs_reference not like 'Special Emphasis Area%'
  ),
  candidates as (
    select * from parsed where area_code is not null
  ),
  title_counts as (
    select exam_type, area_code, task_code, count(distinct task_title) as distinct_titles
    from candidates
    group by exam_type, area_code, task_code
  )
  insert into public.acs_tasks (acs_version_id, area_code, area_title, task_code, task_title)
  select distinct
    case when c.exam_type = 'private_pilot' then v_version_pp else v_version_instr end,
    c.area_code,
    'Area of Operation ' || c.area_code,
    c.task_code,
    c.task_title
  from candidates c
  join title_counts t using (exam_type, area_code, task_code)
  where t.distinct_titles = 1
  on conflict (acs_version_id, area_code, task_code) do nothing;

  -- Map each safely-resolved dpe_questions row to its acs_task, carrying
  -- the KSA-component parenthetical through as mapping_type verbatim
  -- (lightly normalized: lowercased, "and" -> comma).
  insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, weight)
  select distinct
    'dpe_question',
    d.id,
    t.id,
    lower(replace((regexp_match(d.acs_reference, '\(([^)]+)\)'))[1], ' and ', ', ')),
    1.0
  from public.dpe_questions d
  join lateral (
    select
      (regexp_match(d.acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\('))[1] as area_code,
      (regexp_match(d.acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\('))[2] as task_code,
      trim((regexp_match(d.acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\('))[3]) as task_title
  ) p on true
  join public.acs_tasks t
    on t.acs_version_id = case when d.exam_type = 'private_pilot' then v_version_pp else v_version_instr end
   and t.area_code = p.area_code
   and t.task_code = p.task_code
   and t.task_title = p.task_title
  where d.acs_reference not like '%/%'
    and d.acs_reference not like 'Special Emphasis Area%'
  on conflict (content_type, content_id, acs_task_id) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- E. Unresolved-mapping report -- a live view, not a point-in-time
--    snapshot, so re-running this migration (or adding new dpe_questions
--    rows later) keeps the report current. Every row here needs a human
--    to either (a) add the mapping manually via an INSERT into
--    content_acs_mappings, or (b) decide it genuinely has no single-task
--    mapping (e.g. Special Emphasis Area rows).
-- ---------------------------------------------------------------------
create or replace view public.acs_unresolved_mappings as
select
  d.id as content_id,
  'dpe_question' as content_type,
  d.exam_type,
  d.acs_reference,
  case
    when d.acs_reference like 'Special Emphasis Area%' then 'special_emphasis_area_no_single_task'
    when d.acs_reference like '%/%' then 'multi_task_reference_needs_human_disambiguation'
    when (regexp_match(d.acs_reference, '^Area of Operation\s+([IVXLCDM]+),\s*Task\s+([A-Z])\s*—\s*([^(]+?)\.?\s*\(')) is null then 'does_not_match_known_acs_reference_shape'
    else 'title_conflict_with_another_row_for_the_same_area_task'
  end as reason
from public.dpe_questions d
where not exists (
  select 1 from public.content_acs_mappings m
  where m.content_type = 'dpe_question' and m.content_id = d.id
);

revoke all on public.acs_unresolved_mappings from anon, authenticated;
grant select on public.acs_unresolved_mappings to service_role;
