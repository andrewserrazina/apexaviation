-- Apex Advantage — Sprint 4.1 Part 2+4 (schema): ACS digital-assessment
-- scope correction + per-source confidence ledger
--
-- ISSUE 2 (readiness integrity audit): digital_assessment_supported = true
-- was set in v126 categorically -- "this Area+Task belongs to Area I,
-- VI, or IX, which are inherently oral-exam-testable in principle" --
-- not because live content was verified to exist. Auditing actual
-- content_acs_mappings coverage against the 19 tasks currently flagged
-- true found 6 Emergency Operations tasks (IX.B-G) with ZERO mapped
-- content of any kind (dpe_question, module_quiz_question,
-- checkride_corner, or scenario_workshop) -- these are inherently
-- flight-maneuver/simulated-engine-failure tasks with no oral/quiz
-- content anywhere in Apex's system. Counting them in the readiness
-- denominator with permanent zero evidence would silently penalize
-- every student for a task Apex has no way to observe -- exactly the
-- invariant violation this sprint exists to close.
--
-- IX.A (Emergency Descent) is NOT included in this correction: it
-- already has 16 real dpe_question mappings (an oral-exam pathway
-- testing procedural knowledge of emergency descents, distinct from
-- physically flying the maneuver), so it keeps a genuine evidence path
-- and stays in scope.
--
-- VI.C (Diversion) and VI.D (Lost Procedures) also had zero mapped
-- content despite being flagged true -- but unlike IX.B-G, Apex DOES
-- have real, substantive Ground School content that tests exactly
-- these two tasks: PPL-M08's "four C's of lost procedures" material
-- (quiz Q16-18, Checkride Corner cc-15/cc-19) and its diversion-trigger
-- material (quiz Q20, cc-18) were mapped in Sprint 4 as part of a
-- module-wide "everything -> Pilotage and Dead Reckoning (VI.A)"
-- simplification. Rather than excluding VI.C/VI.D for lack of content
-- that already exists, this migration re-attributes those 7 specific
-- items to the tasks they actually test -- giving VI.C/VI.D genuine,
-- non-invented evidence pathways instead of defaulting to exclusion.
-- Recorded as a mapping-gap-report correction, not a new mapping pass.

-- ── Flip the 6 Emergency tasks with no evidence pathway ─────────────
update public.acs_tasks
set digital_assessment_supported = false
where area_code = 'IX' and task_code in ('B','C','D','E','F','G')
  and acs_version_id = public.get_active_acs_version('private_pilot');

-- ── Re-attribute 7 PPL-M08 items from VI.A to their real task ───────
-- Lost Procedures (VI.D): the four C's + "does the Nav Loop change
-- once truly lost" continuation.
do $$
declare
  v_old_task uuid;
  v_new_task uuid;
begin
  select id into v_old_task from public.acs_tasks
    where area_code = 'VI' and task_code = 'A' and acs_version_id = public.get_active_acs_version('private_pilot');
  select id into v_new_task from public.acs_tasks
    where area_code = 'VI' and task_code = 'D' and acs_version_id = public.get_active_acs_version('private_pilot');

  delete from public.content_acs_mappings
  where acs_task_id = v_old_task
    and (content_type, content_id) in (
      ('module_quiz_question', 'PPL-M08-Q16'),
      ('module_quiz_question', 'PPL-M08-Q17'),
      ('module_quiz_question', 'PPL-M08-Q18'),
      ('checkride_corner', 'PPL-M08:cc-15'),
      ('checkride_corner', 'PPL-M08:cc-19')
    );

  insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
  values
    ('module_quiz_question', 'PPL-M08-Q16', v_new_task, 'knowledge', 'human_curated'),
    ('module_quiz_question', 'PPL-M08-Q17', v_new_task, 'knowledge', 'human_curated'),
    ('module_quiz_question', 'PPL-M08-Q18', v_new_task, 'knowledge', 'human_curated'),
    ('checkride_corner', 'PPL-M08:cc-15', v_new_task, 'knowledge', 'human_curated'),
    ('checkride_corner', 'PPL-M08:cc-19', v_new_task, 'knowledge', 'human_curated')
  on conflict (content_type, content_id, acs_task_id) do nothing;
end $$;

-- Diversion (VI.C): the diversion-trigger question + the "destination
-- closes, walk through your diversion process" Checkride Corner item.
do $$
declare
  v_old_task uuid;
  v_new_task uuid;
begin
  select id into v_old_task from public.acs_tasks
    where area_code = 'VI' and task_code = 'A' and acs_version_id = public.get_active_acs_version('private_pilot');
  select id into v_new_task from public.acs_tasks
    where area_code = 'VI' and task_code = 'C' and acs_version_id = public.get_active_acs_version('private_pilot');

  delete from public.content_acs_mappings
  where acs_task_id = v_old_task
    and (content_type, content_id) in (
      ('module_quiz_question', 'PPL-M08-Q20'),
      ('checkride_corner', 'PPL-M08:cc-18')
    );

  insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source)
  values
    ('module_quiz_question', 'PPL-M08-Q20', v_new_task, 'knowledge', 'human_curated'),
    ('checkride_corner', 'PPL-M08:cc-18', v_new_task, 'knowledge', 'human_curated')
  on conflict (content_type, content_id, acs_task_id) do nothing;
end $$;

-- ── v3 snapshot contract: exact top-level counts ────────────────────
-- Additive, nullable columns -- historical v1/v2 rows are untouched and
-- simply carry null here. Training Report/dashboard must read these
-- directly rather than summing category_breakdown buckets (summing was
-- already exact for v2, but the exact top-level count is the
-- authoritative source of truth going forward, not a derived-and-hoped-
-- to-match value).
alter table public.readiness_snapshots
  add column if not exists assessable_task_count integer,
  add column if not exists evidenced_task_count integer,
  add column if not exists strong_task_count integer,
  add column if not exists weak_task_count integer;

-- ── Per-source confidence ledger (Issue 6) ──────────────────────────
-- task_evidence.self_confidence is a single scalar, overwritten by
-- whichever mapped Checkride Corner/Scenario Workshop item was rated
-- most recently for that (profile, acs_task) pair -- at Sprint 4 scale
-- (up to dozens of rated prompts per task) the LAST prompt a student
-- happens to rate can make an otherwise-strong task read as
-- self_confidence = 0, or vice versa. task_evidence_sources already
-- has exactly the right shape to fix this without a larger evidence-
-- dimension redesign: its primary key (profile_id, acs_task_id,
-- source_type, source_id) already guarantees one row per distinct
-- rated content item (a repeat submission of the SAME item is already
-- a no-op via the existing "on conflict do nothing" ledger check in
-- record_task_evidence_internal(), so this can never double-count one
-- item's rating as two). Adding self_confidence here lets snapshot
-- generation average across every distinct rated source for a task,
-- instead of trusting whichever one happened to write last.
alter table public.task_evidence_sources
  add column if not exists self_confidence numeric;

-- record_task_evidence_internal(): identical to the live version except
-- the ledger insert now also stores p_self_confidence (previously
-- discarded after the ledger-dedup check). No other behavior changes --
-- the dedup semantics (one row per distinct source, "on conflict do
-- nothing" against the existing primary key) are untouched, so a retry
-- of the exact same source still cannot double-write anything.
create or replace function public.record_task_evidence_internal(p_profile_id uuid, p_acs_task_id uuid, p_correct boolean, p_is_scenario boolean DEFAULT false, p_source_type text DEFAULT NULL::text, p_source_id text DEFAULT NULL::text, p_is_review boolean DEFAULT false, p_self_confidence numeric DEFAULT NULL::numeric)
 RETURNS task_evidence
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.task_evidence%rowtype;
  v_ledger_rows integer;
  v_review_success boolean := coalesce(p_self_confidence, 0) >= 0.5;
begin
  if p_source_type is not null and p_source_id is not null then
    insert into public.task_evidence_sources (profile_id, acs_task_id, source_type, source_id, self_confidence)
    values (p_profile_id, p_acs_task_id, p_source_type, p_source_id, p_self_confidence)
    on conflict do nothing;
    get diagnostics v_ledger_rows = row_count;
    if v_ledger_rows = 0 then
      select * into v_row from public.task_evidence
      where profile_id = p_profile_id and acs_task_id = p_acs_task_id;
      return v_row;
    end if;
  end if;

  if p_correct is null then
    insert into public.task_evidence (
      profile_id, acs_task_id, self_confidence, confidence_updated_at,
      review_attempt_count, review_correct_count, last_attempt_at
    ) values (
      p_profile_id, p_acs_task_id, p_self_confidence, now(),
      case when p_is_review then 1 else 0 end,
      case when p_is_review and v_review_success then 1 else 0 end,
      now()
    )
    on conflict (profile_id, acs_task_id) do update set
      self_confidence = p_self_confidence,
      confidence_updated_at = now(),
      review_attempt_count = public.task_evidence.review_attempt_count + case when p_is_review then 1 else 0 end,
      review_correct_count = public.task_evidence.review_correct_count + case when p_is_review and v_review_success then 1 else 0 end,
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

revoke execute on function public.record_task_evidence_internal(uuid, uuid, boolean, boolean, text, text, boolean, numeric) from public, anon;
grant execute on function public.record_task_evidence_internal(uuid, uuid, boolean, boolean, text, text, boolean, numeric) to authenticated, service_role;
