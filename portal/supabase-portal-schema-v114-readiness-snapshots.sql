-- Apex Advantage Sprint 0 Phase C -- Readiness snapshots (v114)
--
-- NOT YET APPLIED TO PRODUCTION. Source-controlled, locally tested only.
--
-- IMPORTANT PRODUCT CONSTRAINT: readiness is a TRAINING INDICATOR, not a
-- pass-probability estimate. Nothing in this migration, and nothing that
-- consumes readiness_snapshots downstream (mobile bootstrap DTO, Edge
-- Functions, future UI copy), may express readiness as "N% chance of
-- passing" or "you will/won't pass." The fields below are named to make
-- that distinction unambiguous to every future reader of this schema.
--
-- ===========================================================================
-- REV2 CHANGE NOTE
-- ===========================================================================
-- Independent review of Rev1 correctly noted that, once the ACS taxonomy is
-- authoritative (v112 Rev2 -- the complete 61-task FAA-S-ACS-6C, not just
-- the tasks Apex has content for), the coverage denominator here
-- automatically becomes "all applicable tasks in the ACS," which is exactly
-- what REV2.14 requires -- no code change was needed for that half of the
-- fix, since coverage_score's query already joins through acs_versions/
-- acs_tasks rather than through Apex content.
--
-- What DID need fixing: a task Apex has never written ANY content for looks
-- identical, from a learner's evidence alone, to a task the learner simply
-- hasn't studied -- both show zero attempts. That is dishonest: the learner
-- did not fail to study something Apex never offered. This migration adds
-- an explicit check for content-less tasks in the active version and, when
-- any exist, adds reason_codes: ["insufficient_content_coverage"] so every
-- consumer (the mobile bootstrap DTO especially) can surface that
-- limitation rather than silently blending it into the score as if it were
-- the learner's gap.
--
-- Also: get_active_acs_version() (v112 REV2.15) replaces the inline
-- `where v.active` join, so this function always resolves the one
-- unambiguous applicable ACS version rather than assuming there is exactly
-- one `active = true` row (now actually guaranteed by v112's partial unique
-- index, but this keeps the selection logic in one place regardless).
--
-- Rollback: `drop function if exists public.compute_readiness_snapshot();
-- drop table if exists public.readiness_snapshots;` -- depends only on
-- task_evidence/acs_tasks/acs_versions (v112/v113), never modifies them.

create table if not exists public.readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  algorithm_version text not null default 'v1',
  overall_score numeric not null,
  coverage_score numeric not null,
  knowledge_score numeric not null,
  risk_management_score numeric not null,
  confidence_score numeric not null,
  evidence_level text not null check (evidence_level in ('low', 'moderate', 'high')),
  weak_tasks jsonb not null default '[]'::jsonb,
  reason_codes jsonb not null default '[]'::jsonb,
  evidence_volume integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.readiness_snapshots is 'A training-readiness INDICATOR, not a pass-probability estimate. Never surface as "chance of passing."';

create index if not exists idx_readiness_snapshots_profile_created on public.readiness_snapshots (profile_id, created_at desc);

alter table public.readiness_snapshots enable row level security;

drop policy if exists "Members read their own readiness snapshots" on public.readiness_snapshots;
create policy "Members read their own readiness snapshots" on public.readiness_snapshots
  for select using (auth.uid() = profile_id);

-- No INSERT/UPDATE/DELETE policy -- the only write path is
-- compute_readiness_snapshot() below.
revoke insert, update, delete on public.readiness_snapshots from anon, authenticated;

-- ---------------------------------------------------------------------
-- compute_readiness_snapshot() -- self-scoped via auth.uid(), no
-- caller-supplied profile_id at all (per "use auth.uid() ... wherever
-- possible"). Callable by any authenticated learner for their own
-- account; recomputes from their own current task_evidence rows.
--
-- Algorithm v1 (documented so a future v2 can change the formula without
-- silently reinterpreting old rows -- old snapshots keep algorithm_version
-- = 'v1' forever; a v2 snapshot is a new row, not an edit):
--
--   coverage_score  = (# distinct ACS tasks for the learner's exam_type
--                       with >=1 attempt) / (total # ACS tasks for that
--                       exam_type), scaled 0-100.
--   knowledge_score = avg(evidence_score) across the learner's
--                       task_evidence rows, scaled 0-100.
--   risk_management_score = avg(evidence_score) restricted to tasks
--                       whose content_acs_mappings.mapping_type mentions
--                       'risk_management', scaled 0-100. Falls back to
--                       knowledge_score if the learner has no risk-
--                       management-tagged evidence yet (never divides by
--                       zero into an undefined/negative value).
--   confidence_score = avg(confidence_alignment) across task_evidence
--                       rows that have a non-null value, scaled 0-100,
--                       defaulting to a neutral 50 when no learner has
--                       yet supplied confidence-calibration data (v1
--                       limitation -- see Sprint 0 report "Known Risks":
--                       nothing in the mobile app captures a genuine
--                       self-reported confidence rating yet, so this
--                       dimension is a documented placeholder, not
--                       fabricated data).
--   overall_score   = round(0.35*coverage + 0.30*knowledge +
--                            0.20*risk_management + 0.15*confidence)
--
--   evidence_level: total attempt volume across all of the learner's
--     task_evidence rows -- <10 => 'low', <40 => 'moderate', else
--     'high'. Guards against tiny sample sizes being read as
--     authoritative: reason_codes includes 'low_sample_size' whenever
--     evidence_level = 'low', and every consumer of this table (the
--     mobile bootstrap DTO especially) MUST surface evidence_level
--     alongside overall_score, never the score alone.
--
--   Single-session-swing guard: if a snapshot for this profile+
--     algorithm_version was created within the last 24 hours and the
--     newly computed overall_score would move more than 15 points from
--     it, the stored overall_score is clamped to within 15 points of the
--     prior one UNLESS total attempt volume (evidence_volume, stored on
--     each snapshot precisely so this comparison is possible) grew by at
--     least 20% in the interim -- i.e. a big score swing is only trusted
--     when it's backed by a correspondingly large amount of new
--     evidence, not one unusually good or bad session. A
--     'score_change_dampened' reason code is added whenever this clamp
--     actually changes the value.
--
--   Duplicate-submission guard: this function recomputes entirely from
--     the CURRENT state of task_evidence: calling it twice in a row with
--     no new evidence produces an identical score, not a double-counted
--     one. Real duplicate-attempt prevention happens one layer down, in
--     the practice-completion idempotency guarantee (Phase C8) that
--     task_evidence itself is built from.
-- ---------------------------------------------------------------------
create or replace function public.compute_readiness_snapshot()
returns public.readiness_snapshots
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_id uuid := auth.uid();
  v_exam_type text;
  v_active_version uuid;
  v_total_tasks integer;
  v_covered_tasks integer;
  v_content_less_tasks integer;
  v_coverage numeric;
  v_knowledge numeric;
  v_risk numeric;
  v_confidence numeric;
  v_overall numeric;
  v_total_attempts integer;
  v_evidence_level text;
  v_weak_tasks jsonb;
  v_reason_codes jsonb := '[]'::jsonb;
  v_prev record;
  v_row public.readiness_snapshots%rowtype;
begin
  if v_profile_id is null then
    raise exception 'Not signed in.';
  end if;

  -- Certificate track: today the app only serves private_pilot content
  -- to real users (see get-premium-content's own exam_type='private_pilot'
  -- restriction) -- hard-coded here for the same reason, not a guess.
  v_exam_type := 'private_pilot';
  v_active_version := public.get_active_acs_version(v_exam_type);

  select count(*) into v_total_tasks
  from public.acs_tasks t
  where t.acs_version_id = v_active_version;

  select count(distinct e.acs_task_id) into v_covered_tasks
  from public.task_evidence e
  join public.acs_tasks t on t.id = e.acs_task_id
  where e.profile_id = v_profile_id and t.acs_version_id = v_active_version and e.attempt_count > 0;

  v_coverage := case when v_total_tasks > 0 then round(100.0 * v_covered_tasks / v_total_tasks, 2) else 0 end;

  -- REV2.14: a task Apex has zero content mapped to is not the same thing
  -- as a task the learner hasn't studied -- flag the limitation explicitly
  -- rather than silently scoring it the same as an unstudied-but-available
  -- task.
  select count(*) into v_content_less_tasks
  from public.acs_tasks t
  where t.acs_version_id = v_active_version
    and not exists (
      select 1 from public.content_acs_mappings m
      where m.acs_task_id = t.id
    );
  if v_content_less_tasks > 0 then
    v_reason_codes := v_reason_codes || '["insufficient_content_coverage"]'::jsonb;
  end if;

  select round(100.0 * avg(evidence_score), 2), coalesce(sum(attempt_count), 0)
  into v_knowledge, v_total_attempts
  from public.task_evidence where profile_id = v_profile_id;
  v_knowledge := coalesce(v_knowledge, 0);

  select round(100.0 * avg(e.evidence_score), 2) into v_risk
  from public.task_evidence e
  join public.content_acs_mappings m on m.acs_task_id = e.acs_task_id
  where e.profile_id = v_profile_id and m.mapping_type ilike '%risk_management%';
  v_risk := coalesce(v_risk, v_knowledge);

  select round(100.0 * avg(confidence_alignment), 2) into v_confidence
  from public.task_evidence where profile_id = v_profile_id and confidence_alignment is not null;
  if v_confidence is null then
    v_confidence := 50;
    v_reason_codes := v_reason_codes || '["confidence_calibration_not_yet_available"]'::jsonb;
  end if;

  v_overall := round(0.35 * v_coverage + 0.30 * v_knowledge + 0.20 * v_risk + 0.15 * v_confidence, 2);

  v_evidence_level := case
    when v_total_attempts < 10 then 'low'
    when v_total_attempts < 40 then 'moderate'
    else 'high'
  end;
  if v_evidence_level = 'low' then
    v_reason_codes := v_reason_codes || '["low_sample_size"]'::jsonb;
  end if;

  -- Single-session-swing guard.
  select * into v_prev
  from public.readiness_snapshots
  where profile_id = v_profile_id and algorithm_version = 'v1' and created_at > now() - interval '24 hours'
  order by created_at desc limit 1;

  if found then
    if abs(v_overall - v_prev.overall_score) > 15
       and v_total_attempts < v_prev.evidence_volume * 1.2
    then
      -- The swing is large but not backed by a proportionally large
      -- amount of new evidence (< 20% more attempts than the prior
      -- snapshot) -- clamp to a 15-point move from the prior score
      -- rather than trust one session's worth of data to swing the
      -- headline number.
      if v_overall > v_prev.overall_score then
        v_overall := least(v_overall, v_prev.overall_score + 15);
      else
        v_overall := greatest(v_overall, v_prev.overall_score - 15);
      end if;
      v_reason_codes := v_reason_codes || '["score_change_dampened"]'::jsonb;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('acs_task_id', e.acs_task_id, 'task_code', t.task_code, 'area_code', t.area_code, 'evidence_score', e.evidence_score)), '[]'::jsonb)
  into v_weak_tasks
  from (
    select * from public.task_evidence
    where profile_id = v_profile_id
    order by evidence_score asc, attempt_count asc
    limit 5
  ) e
  join public.acs_tasks t on t.id = e.acs_task_id;

  insert into public.readiness_snapshots (
    profile_id, algorithm_version, overall_score, coverage_score, knowledge_score,
    risk_management_score, confidence_score, evidence_level, weak_tasks, reason_codes,
    evidence_volume
  ) values (
    v_profile_id, 'v1', v_overall, v_coverage, v_knowledge, v_risk, v_confidence,
    v_evidence_level, v_weak_tasks, v_reason_codes, v_total_attempts
  ) returning * into v_row;

  return v_row;
end;
$function$;

revoke execute on function public.compute_readiness_snapshot() from public, anon;
grant execute on function public.compute_readiness_snapshot() to authenticated, service_role;
