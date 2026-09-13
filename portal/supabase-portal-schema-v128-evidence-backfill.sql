-- Apex Advantage — Sprint 3: unified ACS evidence, historical backfill (v128)
--
-- Backfills real, reliable historical evidence for the newly-mapped
-- PPL-M01 content into task_evidence, via the same
-- record_task_evidence_internal() path a live student action uses --
-- never a bespoke aggregate-increment script. Idempotent by construction
-- via task_evidence_sources (v127): re-running this file finds every
-- (profile, task, source_type, source_id) tuple already present and
-- no-ops on every row rather than incrementing counters again.
--
-- Only backfills what can be reliably recreated:
--   - module_quiz_attempts.results (Sprint 2 already stores true
--     per-question correctness) for the 3 newly-mapped multiple-choice
--     questions on PPL-M01.
--   - guided_notes Checkride Corner ratings for the 2 newly-mapped
--     questions on PPL-M01.
-- Does NOT backfill portal_practice_attempts rows predating Sprint 2's
-- per-question response tracking (aggregate score/total only, no
-- question ids) -- that evidence cannot be reliably recreated and is
-- explicitly left alone; those students show "Insufficient Evidence"
-- honestly rather than an inflated history.

-- Calls record_task_evidence_internal() directly (not the client-facing
-- record_ground_school_evidence() wrapper) -- a migration runs with no
-- auth.uid() session to satisfy that wrapper's ownership check, so this
-- goes straight to the same internal evidence logic every live call
-- site ultimately reaches, with content_acs_mappings resolved inline.
do $$
declare
  v_attempt record;
  v_qid text;
  v_is_correct boolean;
  v_note record;
  v_task record;
begin
  for v_attempt in
    select id, profile_id, results
    from public.module_quiz_attempts
    where course_id = 'PPL' and module_id = 'PPL-M01' and results is not null
  loop
    for v_qid in select jsonb_object_keys(v_attempt.results) loop
      v_is_correct := (v_attempt.results ->> v_qid)::boolean;
      for v_task in
        select acs_task_id from public.content_acs_mappings
        where content_type = 'module_quiz_question' and content_id = v_qid
      loop
        perform public.record_task_evidence_internal(
          v_attempt.profile_id, v_task.acs_task_id, v_is_correct, false,
          'module_quiz_question', v_attempt.id::text || ':' || v_qid
        );
      end loop;
    end loop;
  end loop;

  for v_note in
    select profile_id, module_id, prompt_id, response_text
    from public.guided_notes
    where course_id = 'PPL' and module_id = 'PPL-M01' and section_id = 'checkride-corner'
      and prompt_id like '%-rating' and response_text in ('confident', 'needs_review', 'not_yet')
  loop
    for v_task in
      select acs_task_id from public.content_acs_mappings
      where content_type = 'checkride_corner'
        and content_id = v_note.module_id || ':' || regexp_replace(v_note.prompt_id, '-rating$', '')
    loop
      perform public.record_task_evidence_internal(
        v_note.profile_id, v_task.acs_task_id, null, false,
        'checkride_corner', v_note.module_id || ':' || v_note.prompt_id, false,
        case v_note.response_text when 'confident' then 1.0 when 'needs_review' then 0.5 else 0.0 end
      );
    end loop;
  end loop;
end;
$$;
