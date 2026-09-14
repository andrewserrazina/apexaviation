-- Apex Advantage — Sprint 4 Part 2: exact ACS task counts in category_breakdown
--
-- The Sprint 3 Training Report migration needs to state exact counts
-- ("14 of 19 currently assessable ACS tasks have evidence") without
-- reverse-engineering them from the already-rounded task_breadth_pct
-- percentage, which is not guaranteed to reconstruct the original
-- integer numerator/denominator. This migration adds the raw integers
-- the inner grouping query already computes internally (as breadth_pct's
-- own inputs) but previously discarded, plus a symmetric strong_task_count
-- alongside the existing weak_task_count.
--
-- This is purely additive to category_breakdown's jsonb shape -- no
-- scoring formula changes, so algorithm_version stays 'v2' (the same
-- non-bump rule Sprint 3 itself used when category_breakdown was first
-- added: a wire-shape addition, not a methodology change). Verified
-- additive/non-breaking against mobile: mobile-readiness's shape()
-- already passes category_breakdown through untouched, and
-- ReadinessCard.tsx (the only mobile screen rendering readiness) never
-- reads category_breakdown at all.
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

  select count(*) into v_total_scoped_tasks
  from public.get_readiness_scoped_acs_tasks(v_profile_id);

  select count(distinct e.acs_task_id) into v_covered_scoped_tasks
  from public.task_evidence e
  join public.get_readiness_scoped_acs_tasks(v_profile_id) t on t.id = e.acs_task_id
  where e.profile_id = v_profile_id and e.attempt_count > 0;

  v_coverage := case when v_total_scoped_tasks > 0
    then round(100.0 * v_covered_scoped_tasks / v_total_scoped_tasks, 2)
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

  v_evidence_level := case
    when v_total_attempts < 10 then 'low'
    when v_total_attempts < 40 then 'moderate'
    else 'high'
  end;
  if v_evidence_level = 'low' then
    v_reason_codes := v_reason_codes || '["low_sample_size"]'::jsonb;
  end if;

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

  -- Category breakdown -- now also carrying exact integer
  -- assessable_task_count/evidenced_task_count/strong_task_count
  -- alongside the existing percentage/weak_task_count fields.
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
