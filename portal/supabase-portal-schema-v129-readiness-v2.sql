-- Apex Advantage — Sprint 3 Part C: unified readiness engine (v129)
--
-- Replaces compute_readiness_snapshot()'s implementation (same function
-- name/signature the mobile app and mobile-readiness Edge Function
-- already call -- no client change needed to pick this up) with
-- algorithm_version = 'v2'. Old 'v1' rows are never rewritten -- they
-- remain exactly as computed, per the existing "old snapshots keep
-- algorithm_version = 'v1' forever" rule already documented on v1 itself.
--
-- Two corrections from v1, both found by direct re-reading of the live
-- v1 function body before writing this migration:
--
-- 1. READINESS SCOPE (the most important change). v1 scored every
--    aircraft-class-applicable task, including the ~42 hands-on flight-
--    maneuver/procedural tasks (takeoffs, landings, stalls, instrument
--    maneuvers, postflight, ...) that Apex's oral-exam-style content has
--    no way to digitally observe at all. Treating a student's total
--    silence on "Short-Field Landing" as a knowledge gap would conflate
--    missing PRODUCT coverage with poor STUDENT performance. v2 scores
--    only get_readiness_scoped_acs_tasks(profile) (v126) -- the ~19
--    tasks with digital_assessment_supported = true. All 61 tasks stay
--    fully visible in acs_tasks/get_applicable_acs_tasks() for a future
--    instructor/flight-evidence integration; only the readiness
--    denominator narrows.
--
-- 2. ZERO-EVIDENCE-TASK BUG. v1's knowledge_score/risk_management_score
--    use an INNER JOIN from task_evidence to the applicable-task set, so
--    a scoped task with no task_evidence row at all is silently excluded
--    from the average rather than counted as zero -- a student with
--    real evidence on only 2 of ~19 scoped tasks could read as
--    artificially "high knowledge" from those 2 alone. v2 starts from
--    the scoped task set and LEFT JOINs task_evidence, coalescing a
--    missing row to evidence_score = 0.
--
-- New in v2: category_breakdown (grouped via the v126 acs_tasks.dpe_category
-- bridge -- never through content_acs_mappings, which would double-count
-- a task's evidence across every content item mapped to it), two-
-- dimensional evidence sufficiency (volume x breadth, not attempt-volume
-- alone), and a category-level AI DPE reason code with a 30-day recency
-- cutoff.
--
-- BACKWARD COMPATIBILITY WITH THE MOBILE APP (verified by reading
-- ReadinessCard.tsx directly before writing this): its EVIDENCE_LABEL is
-- a TypeScript Record keyed on exactly {'low','moderate','high'} -- any
-- other string would render as `undefined` and crash `.toUpperCase()`.
-- The two-dimensional sufficiency table below produces a 4-value result
-- (none/limited/developing/strong) for exactly the reason Part C wants
-- -- but that 4-value result is NOT written into the top-level
-- readiness_snapshots.evidence_level column, to avoid breaking that
-- contract. Instead: the DETAILED 4-value label is computed only inside
-- each category_breakdown entry (a field mobile's ReadinessCard.tsx
-- never reads today) and the top-level evidence_level keeps v1's exact
-- 3-value vocabulary and thresholds -- now correctly computed over the
-- SCOPED attempt volume instead of all 61 tasks' volume. mobile-readiness
-- (below) additionally exposes the overall detailed label under a new,
-- additive `evidence_sufficiency` key for the web Readiness Detail view
-- (Part D) to use, so neither platform's existing contract is disturbed.

alter table public.readiness_snapshots
  add column if not exists category_breakdown jsonb not null default '[]'::jsonb;

-- Historical v1 rows used 'low'/'moderate'/'high' only. Widened (never
-- narrowed) so both vocabularies validate; v2 still only ever writes the
-- original three into this column (see BACKWARD COMPATIBILITY note above)
-- -- the wider constraint exists so category_breakdown's richer per-
-- category labels could, if a future sprint chooses to, also live in a
-- dedicated top-level column without a second migration.
alter table public.readiness_snapshots drop constraint if exists readiness_snapshots_evidence_level_check;
alter table public.readiness_snapshots add constraint readiness_snapshots_evidence_level_check
  check (evidence_level in ('low', 'moderate', 'high', 'none', 'limited', 'developing', 'strong'));

create or replace function public.compute_readiness_snapshot()
returns public.readiness_snapshots
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_id uuid := auth.uid();
  v_exam_type text;
  v_total_scoped_tasks integer;
  v_covered_scoped_tasks integer;
  v_coverage numeric;
  v_knowledge numeric;
  v_risk numeric;
  v_confidence numeric;
  v_overall numeric;
  v_total_attempts integer;
  v_evidence_level text;
  v_weak_tasks jsonb;
  v_reason_codes jsonb := '[]'::jsonb;
  v_category_breakdown jsonb;
  v_prev record;
  v_row public.readiness_snapshots%rowtype;
  v_ai_weak_categories text[];
begin
  if v_profile_id is null then
    raise exception 'Not signed in.';
  end if;

  v_exam_type := 'private_pilot';

  -- ---- Coverage, scoped to digitally-assessable tasks only (v126). ----
  select count(*) into v_total_scoped_tasks
  from public.get_readiness_scoped_acs_tasks(v_profile_id);

  select count(distinct e.acs_task_id) into v_covered_scoped_tasks
  from public.task_evidence e
  join public.get_readiness_scoped_acs_tasks(v_profile_id) t on t.id = e.acs_task_id
  where e.profile_id = v_profile_id and e.attempt_count > 0;

  v_coverage := case when v_total_scoped_tasks > 0
    then round(100.0 * v_covered_scoped_tasks / v_total_scoped_tasks, 2)
    else 0 end;

  -- A scoped (digitally-assessable) task with literally zero
  -- content_acs_mappings rows is not the same thing as a task the
  -- learner hasn't studied -- Apex has no content pointed at it either.
  -- Verified live against production before writing this: 10 of the 19
  -- digitally-assessable tasks (all of Area IX B-G, all of Area VI) have
  -- zero mapped content today, despite being flagged assessable -- a
  -- real, honestly-reported gap, carried over from v1's own
  -- insufficient_content_coverage reason code (there scoped to all 61
  -- tasks; here correctly narrowed to only the ~19 in-scope ones).
  if exists (
    select 1 from public.get_readiness_scoped_acs_tasks(v_profile_id) t
    where not exists (select 1 from public.content_acs_mappings m where m.acs_task_id = t.id)
  ) then
    v_reason_codes := v_reason_codes || '["insufficient_content_coverage"]'::jsonb;
  end if;

  -- ---- Knowledge / attempt volume: LEFT JOIN fixes the v1 zero-evidence
  -- exclusion bug -- a scoped task with no task_evidence row contributes
  -- evidence_score = 0 to the average, not "not counted at all". ----
  select round(100.0 * avg(coalesce(e.evidence_score, 0)), 2),
         coalesce(sum(e.attempt_count), 0)
  into v_knowledge, v_total_attempts
  from public.get_readiness_scoped_acs_tasks(v_profile_id) t
  left join public.task_evidence e on e.acs_task_id = t.id and e.profile_id = v_profile_id;
  v_knowledge := coalesce(v_knowledge, 0);

  -- risk_management_score: unchanged from v1's own fallback rule (falls
  -- back to knowledge_score when no risk_management-tagged evidence
  -- exists yet -- true today, since v126's mapping_type is 'knowledge'
  -- for every row inserted so far).
  select round(100.0 * avg(coalesce(e.evidence_score, 0)), 2) into v_risk
  from public.get_readiness_scoped_acs_tasks(v_profile_id) t
  left join public.task_evidence e on e.acs_task_id = t.id and e.profile_id = v_profile_id
  join public.content_acs_mappings m on m.acs_task_id = t.id and m.mapping_type ilike '%risk_management%';
  v_risk := coalesce(v_risk, v_knowledge);

  select round(100.0 * avg(e.confidence_alignment), 2) into v_confidence
  from public.get_readiness_scoped_acs_tasks(v_profile_id) t
  join public.task_evidence e on e.acs_task_id = t.id and e.profile_id = v_profile_id
  where e.confidence_alignment is not null;
  if v_confidence is null then
    v_confidence := 50;
    v_reason_codes := v_reason_codes || '["confidence_calibration_not_yet_available"]'::jsonb;
  end if;

  v_overall := round(0.35 * v_coverage + 0.30 * v_knowledge + 0.20 * v_risk + 0.15 * v_confidence, 2);

  -- Top-level evidence_level: v1's exact 3-value vocabulary/thresholds,
  -- preserved verbatim for mobile compatibility -- only the input
  -- (v_total_attempts) changed, now correctly scoped.
  v_evidence_level := case
    when v_total_attempts < 10 then 'low'
    when v_total_attempts < 40 then 'moderate'
    else 'high'
  end;
  if v_evidence_level = 'low' then
    v_reason_codes := v_reason_codes || '["low_sample_size"]'::jsonb;
  end if;

  -- Single-session-swing guard (unchanged from v1, still per-algorithm_
  -- version so a v1->v2 transition is never itself read as a swing).
  select * into v_prev
  from public.readiness_snapshots
  where profile_id = v_profile_id and algorithm_version = 'v2' and created_at > now() - interval '24 hours'
  order by created_at desc limit 1;

  if found then
    if abs(v_overall - v_prev.overall_score) > 15
       and v_total_attempts < v_prev.evidence_volume * 1.2
    then
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
    select e.* from public.task_evidence e
    join public.get_readiness_scoped_acs_tasks(v_profile_id) t on t.id = e.acs_task_id
    where e.profile_id = v_profile_id
    order by e.evidence_score asc, e.attempt_count asc
    limit 5
  ) e
  join public.acs_tasks t on t.id = e.acs_task_id;

  -- ---- AI DPE weak-domain category reason codes (30-day hard cutoff,
  -- no decay curve -- a stale verdict is simply absent, not dampened).
  -- Reuses the exact 11-value exact-match domain->category table already
  -- built and tested in sync_review_queue() (v125) -- never a new fuzzy
  -- mapping mechanism. Category-level only: no acs_task_id is ever
  -- touched by this, so it can never fabricate task-level evidence. ----
  with latest_session as (
    select debrief from public.ai_dpe_sessions
    where profile_id = v_profile_id and status = 'completed'
      and debrief is not null and ended_at > now() - interval '30 days'
    order by ended_at desc limit 1
  )
  select coalesce(array_agg(distinct cat), array[]::text[]) into v_ai_weak_categories
  from (
    select case trim(lower(d ->> 'domain'))
      when 'eligibility & documents' then 'eligibility'
      when 'airworthiness' then 'airworthiness'
      when 'privileges & limitations' then 'privileges'
      when 'airspace' then 'airspace'
      when 'weather' then 'weather'
      when 'performance & w&b' then 'performance'
      when 'aeromedical factors' then 'aeromedical'
      when 'cross-country planning' then 'crosscountry'
      when 'emergency operations' then 'emergency'
      when 'aircraft systems' then 'aircraft-systems'
      when 'aeronautical decision-making & risk management' then 'adm'
      else null
    end as cat
    from latest_session, jsonb_array_elements(debrief -> 'perDomain') d
    where d ->> 'verdict' = 'weak'
  ) x
  where cat is not null;

  -- ---- Category breakdown. Grouped via acs_tasks.dpe_category (v126) --
  -- never through content_acs_mappings, which can hold many rows per
  -- task and would double-count a task's evidence across every content
  -- item that happens to test it. Starts from the SCOPED task set, so a
  -- category's denominator is only its digitally-assessable tasks.
  -- privileges/adm never appear here: no scoped task carries either
  -- value (v126), so the group by simply never produces those rows --
  -- not an explicit exclusion, a structural consequence of the mapping.
  --
  -- Two-dimensional evidence sufficiency (volume x breadth), per Part C:
  -- "40 attempts on 1 of 8 tasks" must not read the same as "40 attempts
  -- spread across 7 of 8 tasks." attempt_volume = sum(attempt_count)
  -- over the category's scoped tasks; task_breadth_pct = % of those
  -- tasks with attempt_count > 0.
  --   volume 0                                       -> none
  --   volume 1-9,   breadth < 80%                    -> limited
  --   volume 1-9,   breadth >= 80%                   -> developing
  --   volume 10-39, breadth < 40%                    -> limited
  --   volume 10-39, breadth >= 40%                   -> developing
  --   volume >=40,  breadth < 80%                    -> developing
  --   volume >=40,  breadth >= 80%                   -> strong
  -- score is null whenever the level is 'none' -- never a fabricated 0%.
  -- weak_task_count: scoped tasks in the category with real evidence
  -- (attempt_count > 0) whose evidence_score is below 0.6 -- a below-
  -- midpoint accuracy/volume-dampened score, not merely "not yet studied".
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category', cat.dpe_category,
      'label', dc.label,
      'score', case when cat.attempt_volume = 0 then null else round(cat.avg_score * 100, 2) end,
      'evidence_level', case
        when cat.attempt_volume = 0 then 'none'
        when cat.attempt_volume < 10 then
          case when cat.breadth_pct >= 80 then 'developing' else 'limited' end
        when cat.attempt_volume < 40 then
          case when cat.breadth_pct < 40 then 'limited' else 'developing' end
        else
          case when cat.breadth_pct >= 80 then 'strong' else 'developing' end
      end,
      'attempt_volume', cat.attempt_volume,
      'task_breadth_pct', cat.breadth_pct,
      'weak_task_count', cat.weak_task_count,
      'last_demonstrated_at', cat.last_demonstrated_at,
      'ai_dpe_reason_code', case when cat.dpe_category = any(v_ai_weak_categories) then 'recent_ai_dpe_weak' else null end
    )
    order by dc.sort_order
  ), '[]'::jsonb)
  into v_category_breakdown
  from (
    select
      t.dpe_category,
      coalesce(sum(e.attempt_count), 0) as attempt_volume,
      round(100.0 * count(*) filter (where e.attempt_count > 0) / count(*), 2) as breadth_pct,
      avg(coalesce(e.evidence_score, 0)) as avg_score,
      count(*) filter (where e.attempt_count > 0 and coalesce(e.evidence_score, 0) < 0.6) as weak_task_count,
      max(e.last_attempt_at) as last_demonstrated_at
    from public.get_readiness_scoped_acs_tasks(v_profile_id) t
    left join public.task_evidence e on e.acs_task_id = t.id and e.profile_id = v_profile_id
    where t.dpe_category is not null
    group by t.dpe_category
  ) cat
  join public.dpe_categories dc on dc.id = cat.dpe_category;

  insert into public.readiness_snapshots (
    profile_id, algorithm_version, overall_score, coverage_score, knowledge_score,
    risk_management_score, confidence_score, evidence_level, weak_tasks, reason_codes,
    evidence_volume, category_breakdown
  ) values (
    v_profile_id, 'v2', v_overall, v_coverage, v_knowledge, v_risk, v_confidence,
    v_evidence_level, v_weak_tasks, v_reason_codes, v_total_attempts, v_category_breakdown
  ) returning * into v_row;

  return v_row;
end;
$function$;

revoke execute on function public.compute_readiness_snapshot() from public, anon;
grant execute on function public.compute_readiness_snapshot() to authenticated, service_role;
