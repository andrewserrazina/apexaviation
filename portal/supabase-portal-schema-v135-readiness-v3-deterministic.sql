-- Apex Advantage — Sprint 4.1 Part 3: deterministic readiness v3
--
-- v2's compute_readiness_snapshot() had three integrity defects,
-- audited and fixed together since they all live in this one function:
--
-- ISSUE 1 (non-determinism): v2 compared the freshly-computed overall
-- score to the MOST RECENT v2 snapshot from the last 24 hours and
-- clamped the swing to +/-15. Because that comparison snapshot is
-- itself the output of a PRIOR dampened call, calling refresh
-- repeatedly with zero evidence change let the score visibly drift
-- toward the raw value over several calls (30 -> 45 -> 60 -> 70) --
-- the number of refresh calls affected the result, not the evidence.
-- v3 removes dampening entirely: the canonical score is the honest,
-- fully-deterministic function of current evidence. (Audited: the
-- client-side gauge already renders a smooth stroke-dashoffset
-- transition on its SVG ring -- if visual smoothing is ever wanted
-- again, it belongs there, in presentation, not in the persisted
-- readiness truth.)
--
-- ISSUE 3 (risk management not independently measured): task_evidence
-- aggregates ALL evidence for a task -- knowledge and risk-management-
-- tagged content alike -- into one evidence_score. v2's risk_management_
-- score averaged evidence_score across tasks that merely HAVE a
-- risk_management-tagged mapping, so a task's 100 ordinary knowledge
-- events could dominate a score labeled "risk management." v3 does not
-- pretend to measure this independently: risk_management_score mirrors
-- knowledge_score and carries no separate weight in overall_score
-- (Option A from the audit -- the honest minimal fix, not a
-- multidimensional evidence-ledger redesign). reason_codes always
-- carries risk_management_not_independently_measured so this is
-- visible in the API, not just in code comments.
--
-- ISSUE 6 (confidence latest-write-wins): task_evidence.self_confidence
-- is a single scalar overwritten by whichever mapped Checkride Corner/
-- Scenario Workshop item a student rated most recently for that task --
-- at Sprint 4 scale (dozens of rated prompts possible per task) the
-- last rating alone could make a mostly-Confident task read as zero.
-- v3's confidence_score instead averages every distinct rated SOURCE
-- (task_evidence_sources.self_confidence, added in v134) across every
-- scoped task -- a real aggregate of the collection, not a last-write
-- scalar. This is also a genuine semantic change from v2's
-- confidence_score, which measured *calibration* (agreement between
-- self-rating and objective accuracy, task_evidence.confidence_alignment)
-- -- a different, narrower concept that stayed null for any task whose
-- only evidence was self-rated (never objectively graded). v3's
-- confidence_score answers "how confident does the student feel,"
-- which can be reported even with limited objective evidence -- exactly
-- what lets the Training Report say "confidence is high, but objective
-- evidence remains limited."
--
-- Also folds in the Issue 2 scope correction (v134): coverage/knowledge/
-- confidence and category_breakdown are computed ONLY over
-- get_readiness_scoped_acs_tasks(), which (after v134) excludes the 6
-- Emergency tasks Apex has no evidence pathway for -- this function's
-- own logic is otherwise identical to v2 for the scoping join, since
-- v134 corrected digital_assessment_supported at the data level rather
-- than requiring a query change here.
--
-- Evidence sufficiency (evidence_level) now considers BOTH attempt
-- volume AND task breadth, not volume alone -- 200 attempts
-- concentrated on 2 of 13 scoped tasks is not "high" evidence.
--
-- Weights rebalanced for the 3-term (not 4-term) overall formula:
-- coverage 0.40, knowledge 0.45 (absorbing risk's former 0.20 divided
-- proportionally), confidence 0.15. See
-- SPRINT_4_1_READINESS_INTEGRITY_REPORT.md for the full v3 formula
-- writeup in both technical and plain-English terms.
--
-- algorithm_version = 'v3'. No historical v1/v2 row is rewritten by
-- this migration -- this function only governs what NEW snapshots look
-- like going forward, exactly like v129's and v131's own precedent of
-- replacing this same function body in place.
create or replace function public.compute_readiness_snapshot()
returns public.readiness_snapshots
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Risk management: not independently measured (Issue 3). See header
  -- comment. Mirrors knowledge_score for wire-compatibility only.
  v_reason_codes := v_reason_codes || '["risk_management_not_independently_measured"]'::jsonb;

  -- Confidence (Issue 6): a genuine aggregate of every distinct rated
  -- source across every scoped task, not a single latest-write scalar.
  select round(100.0 * avg(s.self_confidence), 2) into v_confidence
  from public.get_readiness_scoped_acs_tasks(v_profile_id) t
  join public.task_evidence_sources s on s.acs_task_id = t.id and s.profile_id = v_profile_id
  where s.self_confidence is not null;
  if v_confidence is null then
    v_confidence := 50;
    v_reason_codes := v_reason_codes || '["confidence_calibration_not_yet_available"]'::jsonb;
  end if;

  v_overall := round(0.40 * v_coverage + 0.45 * v_knowledge + 0.15 * v_confidence, 2);

  -- Evidence sufficiency: volume AND breadth, not volume alone.
  v_evidence_level := case
    when v_total_attempts < 10 or v_breadth_frac < 0.3 then 'low'
    when v_total_attempts < 40 or v_breadth_frac < 0.6 then 'moderate'
    else 'high'
  end;
  if v_evidence_level = 'low' then
    v_reason_codes := v_reason_codes || '["low_sample_size"]'::jsonb;
  end if;

  -- No dampener (Issue 1): v3 is fully deterministic from the current
  -- evidence state. Repeated calls with unchanged evidence return
  -- identical values -- see the 5x-refresh determinism test in
  -- SPRINT_4_1_READINESS_INTEGRITY_REPORT.md.

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

revoke execute on function public.compute_readiness_snapshot() from public, anon;
grant execute on function public.compute_readiness_snapshot() to authenticated, service_role;
