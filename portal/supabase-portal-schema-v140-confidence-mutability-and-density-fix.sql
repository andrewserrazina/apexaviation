-- Apex Advantage — Pre-merge integrity patch on Sprint 4/4.1's unified
-- readiness architecture: confidence sources must be mutable, and global
-- confidence must not be weighted by authored-prompt density.
--
-- ISSUE 1 — confidence sources behaved as first-write-wins.
-- record_task_evidence_internal()'s source ledger insert used
-- `on conflict do nothing`. That's correct for OBJECTIVE evidence (a
-- retried network request for the same practice attempt must never
-- double-count), but wrong for CONFIDENCE-ONLY evidence
-- (p_correct is null): a student who rated a Checkride Corner prompt
-- "Not Yet", studied, and came back to rate the SAME prompt "Confident"
-- would have that improved rating silently discarded forever, because
-- (profile_id, acs_task_id, source_type, source_id) already existed in
-- task_evidence_sources. Confidence is a mutable current-state signal,
-- not an immutable attempt record, and must be allowed to change.
--
-- Fix: the ledger insert's ON CONFLICT now does UPDATE ... WHERE
-- p_correct is null. Postgres treats a DO UPDATE whose WHERE clause
-- evaluates false as a no-op for that row (same effect as DO NOTHING) --
-- so an objective-evidence conflict (p_correct is not null) is
-- completely unaffected, preserving objective-attempt idempotency
-- exactly as before. A confidence-only conflict now actually updates
-- self_confidence and recorded_at, and (via `xmax = 0` on the RETURNING
-- clause) the function can tell a genuinely NEW source from a re-rating
-- of an existing one -- used below to make sure a re-rating never
-- manufactures a second review_attempt_count/review_correct_count for
-- the same underlying action.
--
-- ISSUE 2 — global confidence was weighted by curriculum density.
-- compute_readiness_snapshot() averaged every task_evidence_sources row
-- directly across the whole scoped-task set: a task with 50 authored
-- confidence prompts contributed 50 rows to the average, a task with 5
-- prompts contributed 5 -- so a task Apex happened to author more
-- content for automatically dominated the global confidence component,
-- independent of the student's actual confidence.
--
-- Fix: confidence is now aggregated in two steps -- first average a
-- student's ratings WITHIN each scoped ACS task (one number per task,
-- regardless of how many prompts map to it), then average ACROSS tasks
-- with at least one rating (each contributing exactly once). Uses the
-- same get_readiness_scoped_acs_tasks() scope already authoritative for
-- coverage/knowledge -- no parallel taxonomy, no new scope rule.
--
-- Both issues live inside functions this patch is the sole author of
-- reworking; no other v3 scoring semantics (coverage, knowledge, the
-- 0.40/0.45/0.15 weights, risk-management mirroring, evidence_level
-- thresholds) are touched. algorithm_version stays 'v3' -- production
-- has exactly 7 v3 snapshot rows across 3 profiles (one disposable
-- Sprint 4.1 test account, two real accounts with a single zero-evidence
-- baseline snapshot each, created the same day v3 shipped), zero of
-- which have more than one v3 row -- there is no meaningful multi-
-- snapshot v3 history to preserve as a distinct historical model. This
-- is a pre-release correctness fix, not a redefinition of a shipped
-- model.

create or replace function public.record_task_evidence_internal(
  p_profile_id uuid, p_acs_task_id uuid, p_correct boolean, p_is_scenario boolean DEFAULT false,
  p_source_type text DEFAULT NULL::text, p_source_id text DEFAULT NULL::text, p_is_review boolean DEFAULT false,
  p_self_confidence numeric DEFAULT NULL::numeric
)
 RETURNS task_evidence
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.task_evidence%rowtype;
  v_source_was_new boolean := true;
  v_review_success boolean := coalesce(p_self_confidence, 0) >= 0.5;
  v_count_review boolean;
begin
  if p_source_type is not null and p_source_id is not null then
    insert into public.task_evidence_sources (profile_id, acs_task_id, source_type, source_id, self_confidence, recorded_at)
    values (p_profile_id, p_acs_task_id, p_source_type, p_source_id, p_self_confidence, now())
    on conflict (profile_id, acs_task_id, source_type, source_id) do update set
      self_confidence = excluded.self_confidence,
      recorded_at = now()
    where p_correct is null
    returning (xmax = 0) into v_source_was_new;

    if v_source_was_new is null then
      -- Objective (p_correct is not null) resubmission of an existing
      -- source: the WHERE clause above suppressed the update, so this is
      -- a pure no-op, byte-identical to pre-patch behavior. Objective-
      -- attempt idempotency is unchanged.
      select * into v_row from public.task_evidence
      where profile_id = p_profile_id and acs_task_id = p_acs_task_id;
      return v_row;
    end if;
  end if;

  -- Only a genuinely NEW source counts as review activity. A confidence
  -- RE-rating of an already-known source (v_source_was_new = false) must
  -- not manufacture a second review attempt/correct count for the same
  -- underlying action -- current callers (Checkride Corner/Scenario
  -- Workshop ratings) never pass p_is_review = true anyway, so this is
  -- belt-and-suspenders correctness for any future caller that might.
  v_count_review := p_is_review and v_source_was_new;

  if p_correct is null then
    insert into public.task_evidence (
      profile_id, acs_task_id, self_confidence, confidence_updated_at,
      review_attempt_count, review_correct_count, last_attempt_at
    ) values (
      p_profile_id, p_acs_task_id, p_self_confidence, now(),
      case when v_count_review then 1 else 0 end,
      case when v_count_review and v_review_success then 1 else 0 end,
      now()
    )
    on conflict (profile_id, acs_task_id) do update set
      self_confidence = p_self_confidence,
      confidence_updated_at = now(),
      review_attempt_count = public.task_evidence.review_attempt_count + case when v_count_review then 1 else 0 end,
      review_correct_count = public.task_evidence.review_correct_count + case when v_count_review and v_review_success then 1 else 0 end,
      last_attempt_at = now()
    returning * into v_row;
  else
    insert into public.task_evidence (
      profile_id, acs_task_id, attempt_count, correct_count, scenario_attempt_count,
      last_attempt_at, last_correct_at
    ) values (
      p_profile_id, p_acs_task_id, 1,
      case when p_correct then 1 else 0 end,
      case when p_is_scenario then 1 else 0 end,
      now(),
      case when p_correct then now() else null end
    )
    on conflict (profile_id, acs_task_id) do update set
      attempt_count = public.task_evidence.attempt_count + 1,
      correct_count = public.task_evidence.correct_count + case when p_correct then 1 else 0 end,
      scenario_attempt_count = public.task_evidence.scenario_attempt_count + case when p_is_scenario then 1 else 0 end,
      last_attempt_at = now(),
      last_correct_at = case when p_correct then now() else public.task_evidence.last_correct_at end
    returning * into v_row;
  end if;

  update public.task_evidence
  set recent_accuracy = round(correct_count::numeric / nullif(attempt_count, 0), 4),
      confidence_alignment = case
        when self_confidence is not null and attempt_count > 0
        then round(1 - abs(self_confidence - (correct_count::numeric / attempt_count)), 4)
        else null
      end,
      evidence_score = least(1.0, round(
        coalesce(correct_count::numeric / nullif(attempt_count, 0), 0) * least(1.0, attempt_count / 5.0)
        + least(0.15, 0.03 * greatest(0, review_correct_count - 1))
      , 4)),
      updated_at = now()
  where profile_id = p_profile_id and acs_task_id = p_acs_task_id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke execute on function public.record_task_evidence_internal(uuid, uuid, boolean, boolean, text, text, boolean, numeric) from public, anon, authenticated;
grant execute on function public.record_task_evidence_internal(uuid, uuid, boolean, boolean, text, text, boolean, numeric) to service_role;

-- ── compute_readiness_snapshot(): per-task confidence normalization ──
-- Only the confidence-aggregation subquery changes; every other block
-- (coverage, knowledge, risk-management mirroring, evidence_level,
-- category_breakdown, weak_tasks, the 0.40/0.45/0.15 weights) is
-- byte-identical to the live v3 function.
create or replace function public.compute_readiness_snapshot()
 RETURNS readiness_snapshots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile_id uuid := auth.uid();
  v_total_scoped_tasks integer;
  v_covered_scoped_tasks integer;
  v_strong_scoped_tasks integer;
  v_weak_scoped_tasks integer;
  v_coverage numeric;
  v_breadth_frac numeric;
  v_knowledge numeric;
  v_confidence numeric;
  v_overall numeric;
  v_total_attempts integer;
  v_evidence_level text;
  v_weak_tasks jsonb;
  v_reason_codes jsonb := '[]'::jsonb;
  v_category_breakdown jsonb;
  v_row public.readiness_snapshots%rowtype;
  v_ai_weak_categories text[];
begin
  if v_profile_id is null then
    raise exception 'Not signed in.';
  end if;

  select count(*) into v_total_scoped_tasks
  from public.get_readiness_scoped_acs_tasks(v_profile_id);

  select count(distinct e.acs_task_id) into v_covered_scoped_tasks
  from public.task_evidence e
  join public.get_readiness_scoped_acs_tasks(v_profile_id) t on t.id = e.acs_task_id
  where e.profile_id = v_profile_id and e.attempt_count > 0;

  select count(*) filter (where coalesce(e.evidence_score, 0) >= 0.8),
         count(*) filter (where coalesce(e.evidence_score, 0) < 0.6)
  into v_strong_scoped_tasks, v_weak_scoped_tasks
  from public.task_evidence e
  join public.get_readiness_scoped_acs_tasks(v_profile_id) t on t.id = e.acs_task_id
  where e.profile_id = v_profile_id and e.attempt_count > 0;
  v_strong_scoped_tasks := coalesce(v_strong_scoped_tasks, 0);
  v_weak_scoped_tasks := coalesce(v_weak_scoped_tasks, 0);

  v_coverage := case when v_total_scoped_tasks > 0
    then round(100.0 * v_covered_scoped_tasks / v_total_scoped_tasks, 2)
    else 0 end;
  v_breadth_frac := case when v_total_scoped_tasks > 0
    then v_covered_scoped_tasks::numeric / v_total_scoped_tasks
    else 0 end;

  if exists (
    select 1 from public.get_readiness_scoped_acs_tasks(v_profile_id) t
    where not exists (select 1 from public.content_acs_mappings m where m.acs_task_id = t.id)
  ) then
    v_reason_codes := v_reason_codes || '["insufficient_content_coverage"]'::jsonb;
  end if;

  select round(100.0 * avg(coalesce(e.evidence_score, 0)), 2),
         coalesce(sum(e.attempt_count), 0)
  into v_knowledge, v_total_attempts
  from public.get_readiness_scoped_acs_tasks(v_profile_id) t
  left join public.task_evidence e on e.acs_task_id = t.id and e.profile_id = v_profile_id;
  v_knowledge := coalesce(v_knowledge, 0);

  v_reason_codes := v_reason_codes || '["risk_management_not_independently_measured"]'::jsonb;

  -- Issue 2 fix: normalize to one confidence value PER SCOPED TASK
  -- first (avg across that task's rated sources, however many there
  -- are), THEN average across tasks that have at least one rating.
  -- A task with 50 rated prompts and a task with 5 rated prompts each
  -- contribute exactly one data point to v_confidence -- authoring
  -- density can no longer change the weighting.
  select round(100.0 * avg(per_task.task_avg_confidence), 2) into v_confidence
  from (
    select s.acs_task_id, avg(s.self_confidence) as task_avg_confidence
    from public.get_readiness_scoped_acs_tasks(v_profile_id) t
    join public.task_evidence_sources s on s.acs_task_id = t.id and s.profile_id = v_profile_id
    where s.self_confidence is not null
    group by s.acs_task_id
  ) per_task;
  if v_confidence is null then
    v_confidence := 50;
    v_reason_codes := v_reason_codes || '["confidence_calibration_not_yet_available"]'::jsonb;
  end if;

  v_overall := round(0.40 * v_coverage + 0.45 * v_knowledge + 0.15 * v_confidence, 2);

  v_evidence_level := case
    when v_total_attempts < 10 or v_breadth_frac < 0.3 then 'low'
    when v_total_attempts < 40 or v_breadth_frac < 0.6 then 'moderate'
    else 'high'
  end;
  if v_evidence_level = 'low' then
    v_reason_codes := v_reason_codes || '["low_sample_size"]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('acs_task_id', e.acs_task_id, 'task_code', t.task_code, 'area_code', t.area_code, 'evidence_score', e.evidence_score)), '[]'::jsonb)
  into v_weak_tasks
  from (
    select e.* from public.task_evidence e
    join public.get_readiness_scoped_acs_tasks(v_profile_id) t on t.id = e.acs_task_id
    where e.profile_id = v_profile_id and e.attempt_count > 0
    order by e.evidence_score asc, e.attempt_count asc
    limit 5
  ) e
  join public.acs_tasks t on t.id = e.acs_task_id;

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
      'assessable_task_count', cat.assessable_task_count,
      'evidenced_task_count', cat.evidenced_task_count,
      'weak_task_count', cat.weak_task_count,
      'strong_task_count', cat.strong_task_count,
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
      count(*) as assessable_task_count,
      count(*) filter (where e.attempt_count > 0) as evidenced_task_count,
      count(*) filter (where e.attempt_count > 0 and coalesce(e.evidence_score, 0) < 0.6) as weak_task_count,
      count(*) filter (where e.attempt_count > 0 and coalesce(e.evidence_score, 0) >= 0.8) as strong_task_count,
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
    evidence_volume, category_breakdown,
    assessable_task_count, evidenced_task_count, strong_task_count, weak_task_count
  ) values (
    v_profile_id, 'v3', v_overall, v_coverage, v_knowledge,
    v_knowledge, v_confidence,
    v_evidence_level, v_weak_tasks, v_reason_codes,
    v_total_attempts, v_category_breakdown,
    v_total_scoped_tasks, v_covered_scoped_tasks, v_strong_scoped_tasks, v_weak_scoped_tasks
  ) returning * into v_row;

  return v_row;
end;
$function$;
