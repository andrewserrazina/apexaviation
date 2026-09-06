-- V119: Sprint 1B Stage 1 -- practice contract hardening.
--
-- Two independently-audited defects in the mobile-practice contract
-- (SPRINT_1B_V119_PRACTICE_CONTRACT_REPORT.md has the full writeup):
--
--   1. Targeted start (action:'start' with acs_task_id) silently fell
--      back to an UNCONSTRAINED general dpe_questions query whenever
--      content_acs_mappings had zero rows for that task, because the
--      Edge Function only applied its .in('id', questionIds) filter
--      `if (questionIds.length)`. Fixed entirely in the Edge Function
--      (portal/supabase/functions/mobile-practice/index.ts) -- targeted
--      start now fails closed (404, zero attempts created) whenever no
--      eligible mapped question survives, and never backfills with
--      unrelated general questions. That fix touches no schema and adds
--      no function, so this migration carries none of it -- see this
--      repo's regression suite section 41 for the data-level proof (the
--      TypeScript branch itself cannot execute in this sandbox, matching
--      the same documented limitation as reveal's own authorization
--      predicate in section 24 and mobile-daily-drill's fail-closed fix
--      in section 40's closing note).
--
--   2. mobile-practice had no authenticated resume path -- a native
--      client that lost its in-memory session (restart, force-close)
--      could not re-fetch an ad-hoc practice session's own question set,
--      unlike Daily Drill's fetch-or-create path. This migration adds
--      that path's ownership + integrity + order-preservation logic as a
--      single RPC, resume_mobile_practice_session(), for the same reason
--      complete_mobile_practice_session() (v113) and
--      start_daily_drill_practice_session() (v118) are RPCs rather than
--      inline Edge Function logic: the guarantee here (a different
--      learner can never resume this session; a corrupt stored question
--      set is refused, not repaired; the returned order is byte-for-byte
--      the stored order) is security- and integrity-critical enough that
--      it needs to be provable in this repo's psql-based regression
--      harness, not just asserted in a code comment.
--
-- NOT a schema/table-shape migration -- portal_practice_attempts already
-- carries every column resume needs (id, profile_id, mode, question_ids,
-- started_at, completed_at). No column, index, or constraint changes.
--
-- NOT YET DEPLOYED. Source-controlled only, alongside the rest of
-- Sprint 1B Stage 1 -- see SPRINT_1B_PRACTICE_EXPANSION.md.

create or replace function public.resume_mobile_practice_session(p_attempt_id uuid)
  returns table(
    session_id uuid,
    mode text,
    started_at timestamptz,
    completed_at timestamptz,
    question_ids jsonb,
    total integer
  )
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_profile_id uuid := auth.uid();
  v_attempt public.portal_practice_attempts%rowtype;
  v_stored_ids jsonb;
  v_count integer;
  v_distinct_count integer;
  v_resolved_count integer;
begin
  if v_profile_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_attempt from public.portal_practice_attempts
  where id = p_attempt_id;

  if not found then
    raise exception 'session_not_found: no practice session with this id exists';
  end if;
  if v_attempt.profile_id <> v_profile_id then
    raise exception 'not_your_session: this practice session belongs to a different learner';
  end if;

  -- Fail-closed integrity validation on the stored question set, mirroring
  -- v118's start_daily_drill_practice_session() hardening: never silently
  -- filter, dedupe, substitute, or reshuffle a corrupt set -- refuse
  -- cleanly instead. The client never supplies question_ids here; this
  -- only validates what a prior `start` call itself already stored.
  v_stored_ids := v_attempt.question_ids;
  if v_stored_ids is null or jsonb_typeof(v_stored_ids) <> 'array' or jsonb_array_length(v_stored_ids) = 0 then
    raise exception 'invalid_question_set: this practice session has no valid question set to resume';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_stored_ids) as elem(value)
    where jsonb_typeof(elem.value) <> 'string' or length(trim(both from (elem.value #>> '{}'))) = 0
  ) then
    raise exception 'invalid_question_set: this practice session has no valid question set to resume';
  end if;

  v_count := jsonb_array_length(v_stored_ids);

  select count(distinct qid) into v_distinct_count
  from jsonb_array_elements_text(v_stored_ids) as qid;
  if v_distinct_count <> v_count then
    raise exception 'invalid_question_set: this practice session has no valid question set to resume';
  end if;

  select count(*) into v_resolved_count
  from jsonb_array_elements_text(v_stored_ids) as qid
  join public.dpe_questions dq on dq.id = qid;
  if v_resolved_count <> v_count then
    raise exception 'invalid_question_set: this practice session has no valid question set to resume';
  end if;

  -- v_stored_ids is returned exactly as stored -- a jsonb array preserves
  -- element order, so this is the byte-for-byte stored order, never
  -- resorted/reshuffled. The Edge Function resolves question text/category
  -- for these ids and maps over this same array to build the response,
  -- so the final wire order is provably the stored order.
  return query select v_attempt.id, v_attempt.mode, v_attempt.started_at, v_attempt.completed_at, v_stored_ids, v_attempt.total;
end;
$function$;

revoke execute on function public.resume_mobile_practice_session(uuid) from public, anon;
grant execute on function public.resume_mobile_practice_session(uuid) to authenticated, service_role;
