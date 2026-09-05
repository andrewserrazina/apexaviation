-- Apex Advantage Sprint 1A -- Daily Drill / mobile-practice bridge (v118).
--
-- NOT YET APPLIED TO PRODUCTION. Source-controlled, locally tested only.
--
-- ===========================================================================
-- INTEGRATION GAP THIS CLOSES
-- ===========================================================================
-- Sprint 1 (Expo) tracing of the reviewed backend found that mobile-daily-
-- drill's response (drill + questions) carries no session_id, and nothing
-- in v115 ever links a daily_drills row to a portal_practice_attempts row.
-- mobile-practice's reveal/complete actions work exclusively against a
-- portal_practice_attempts row, which only mobile-practice's own `start`
-- action can create -- and that action independently re-queries/shuffles
-- its own question set, never the caller's explicit question_ids. There is
-- also no existing RPC that ever transitions daily_drills.status to
-- 'completed'. A learner could not, therefore, actually complete Today's
-- Drill's own curated questions through the reveal/self-rate/complete
-- contract as originally specified -- this migration adds that missing
-- link, narrowly, without touching the Daily Drill selection algorithm,
-- the readiness algorithm, XP amounts, or ad-hoc mobile-practice sessions.
--
-- ===========================================================================
-- DESIGN
-- ===========================================================================
-- 1. daily_drills gains a nullable practice_attempt_id, unique (so one
--    practice attempt can never be linked to more than one drill),
--    ON DELETE SET NULL (deleting an attempt -- nothing does today --
--    would only clear the link, never cascade-delete the drill itself).
--
-- 2. start_daily_drill_practice_session(p_drill_id) supersedes
--    mark_daily_drill_started() as the entry point mobile-daily-drill's
--    `start` action calls. Atomically, under the drill row's own
--    `SELECT ... FOR UPDATE` lock (the same serialization pattern already
--    proven in complete_mobile_practice_session()):
--      - verifies the drill belongs to the caller
--      - if already linked (pending, in_progress, OR completed), returns
--        the existing linkage untouched -- never creates a second attempt,
--        never resets a completed drill
--      - otherwise inserts exactly one portal_practice_attempts row whose
--        question_ids are byte-for-byte the drill's own question_ids (the
--        client never supplies question_ids), then links it
--    mark_daily_drill_started()'s EXECUTE grant is revoked from
--    authenticated: calling it directly could flip a drill to
--    'in_progress' with no linked session, an inconsistent state the new
--    function's callers can no longer produce. The function itself is
--    left in place (nothing else in this codebase calls it), not dropped.
--
-- 3. complete_mobile_practice_session(uuid, jsonb) is extended, based on
--    the CURRENT production v117 body verbatim (re-read directly from
--    production immediately before writing this migration, not assumed),
--    with one additional step in the same transaction, after the practice
--    attempt itself is marked completed: if a daily_drills row is linked
--    to this exact attempt (practice_attempt_id = p_attempt_id) and owned
--    by the same profile, mark it status = 'completed',
--    completed_at = <the attempt's completed_at>. This only ever touches a
--    row when a real link exists; an ordinary ad-hoc mobile-practice
--    session (no linked drill) is completely unaffected. Because this
--    step only runs in the "genuinely completing now" branch -- the
--    function's existing already_completed short-circuit returns before
--    ever reaching it -- a drill can only ever be marked completed once,
--    by construction, with no separate idempotency mechanism needed.
--    Every other guarantee of the v117 body (SELECT...FOR UPDATE lock,
--    ownership check, full payload validation, duplicate-question
--    rejection, per-question response history, portal_question_progress
--    increments, task evidence, study activity, completed_at, the shared
--    award_xp_on_practice_attempt trigger as the sole XP authority, no
--    mobile_practice_completed event, sequential AND true concurrent
--    idempotency) is preserved unchanged.
--
-- ===========================================================================
-- SECURITY
-- ===========================================================================
-- The client can never: supply profile_id, supply a drill's question_ids
-- (they come only from the stored daily_drills row), link an arbitrary
-- attempt to a drill (the new RPC is the only writer of
-- practice_attempt_id, and it only ever links the ONE attempt it itself
-- just created), link another learner's attempt (auth.uid()-bound, row
-- ownership checked before any write), mark a drill completed directly
-- (only complete_mobile_practice_session's SECURITY DEFINER body writes
-- that column, gated by the attempt's own ownership check), or bypass
-- entitlement (start_daily_drill_practice_session operates on a drill row
-- that get_or_create_daily_drill() already gated on
-- checkride_prep_unlocked at generation time; RLS on daily_drills remains
-- select-only for authenticated).
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Do not drop practice_attempt_id if any row has been linked without
-- first deciding what should happen to those learners' in-progress/
-- completed drills. If no rows have been linked yet:
--   revoke execute on function public.start_daily_drill_practice_session(uuid) from authenticated, service_role;
--   drop function if exists public.start_daily_drill_practice_session(uuid);
--   grant execute on function public.mark_daily_drill_started(uuid) to authenticated;
--   alter table public.daily_drills drop constraint if exists daily_drills_practice_attempt_id_key;
--   alter table public.daily_drills drop column if exists practice_attempt_id;
-- and revert complete_mobile_practice_session() to the v117 body (this
-- file's header comment above reproduces it verbatim minus the new step).

-- ---------------------------------------------------------------------
-- 1. Explicit linkage column.
-- ---------------------------------------------------------------------
alter table public.daily_drills
  add column if not exists practice_attempt_id uuid references public.portal_practice_attempts(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_drills_practice_attempt_id_key'
      and conrelid = 'public.daily_drills'::regclass
  ) then
    alter table public.daily_drills
      add constraint daily_drills_practice_attempt_id_key unique (practice_attempt_id);
  end if;
end $$;

comment on column public.daily_drills.practice_attempt_id is
  'v118 bridge: the portal_practice_attempts row created for this drill''s own question_ids by start_daily_drill_practice_session(). Null until Start is first called. One attempt can never be linked to more than one drill (unique).';

-- ---------------------------------------------------------------------
-- 2. Atomic, resumable, concurrency-safe Start.
-- ---------------------------------------------------------------------
create or replace function public.start_daily_drill_practice_session(p_drill_id uuid)
returns public.daily_drills
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_id uuid := auth.uid();
  v_drill public.daily_drills%rowtype;
  v_attempt_id uuid;
  v_question_ids jsonb;
  v_total integer;
begin
  if v_profile_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_drill from public.daily_drills
  where id = p_drill_id
  for update;

  if not found or v_drill.profile_id <> v_profile_id then
    -- Same "not found" wording regardless of nonexistent-vs-wrong-owner,
    -- matching mark_daily_drill_started()'s existing convention -- never
    -- confirm to a caller that a drill_id belonging to someone else exists.
    raise exception 'Drill not found.';
  end if;

  -- Already linked -- pending, in_progress, or completed: resume/return
  -- the existing state. Never create a second attempt, never reset a
  -- completed drill.
  if v_drill.practice_attempt_id is not null then
    return v_drill;
  end if;

  v_question_ids := coalesce(v_drill.question_ids, '[]'::jsonb);
  v_total := jsonb_array_length(v_question_ids);
  if v_total = 0 then
    raise exception 'This Daily Drill has no questions to practice.';
  end if;

  insert into public.portal_practice_attempts (profile_id, mode, question_ids, total, started_at)
  values (v_profile_id, 'dpe_questions', v_question_ids, v_total, now())
  returning id into v_attempt_id;

  update public.daily_drills
  set practice_attempt_id = v_attempt_id,
      status = case when status = 'pending' then 'in_progress' else status end,
      started_at = coalesce(started_at, now())
  where id = p_drill_id
  returning * into v_drill;

  return v_drill;
end;
$function$;

revoke execute on function public.start_daily_drill_practice_session(uuid) from public, anon;
grant execute on function public.start_daily_drill_practice_session(uuid) to authenticated, service_role;

-- mark_daily_drill_started() is superseded: calling it directly could flip
-- a drill to 'in_progress' with no linked practice session. Left in place
-- (nothing else in this codebase calls it) but no longer callable by
-- authenticated clients.
revoke execute on function public.mark_daily_drill_started(uuid) from authenticated;

-- ---------------------------------------------------------------------
-- 3. complete_mobile_practice_session(): v117 body, verbatim, plus the
--    Daily Drill completion linkage as the one new step.
-- ---------------------------------------------------------------------
create or replace function public.complete_mobile_practice_session(p_attempt_id uuid, p_responses jsonb)
 returns table(session_id uuid, score integer, total integer, completed_at timestamp with time zone, already_completed boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_profile_id uuid := auth.uid();
  v_attempt public.portal_practice_attempts%rowtype;
  v_response jsonb;
  v_question_id text;
  v_self_rating text;
  v_is_correct boolean;
  v_score integer := 0;
  v_today date;
  v_mapped_task record;
  v_submitted_count integer;
  v_distinct_count integer;
  v_attempt_size integer;
begin
  if v_profile_id is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_attempt from public.portal_practice_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'session_not_found: no practice session with this id exists';
  end if;
  if v_attempt.profile_id <> v_profile_id then
    raise exception 'not_your_session: this practice session belongs to a different learner';
  end if;

  if v_attempt.completed_at is not null then
    return query select v_attempt.id, v_attempt.score, v_attempt.total, v_attempt.completed_at, true;
    return;
  end if;

  for v_response in select * from jsonb_array_elements(coalesce(p_responses, '[]'::jsonb))
  loop
    v_question_id := v_response ->> 'question_id';
    v_self_rating := v_response ->> 'self_rating';

    if v_question_id is null then
      raise exception 'invalid_question: question_id is required on every response';
    end if;
    if v_self_rating is null or v_self_rating not in ('correct', 'incorrect', 'partial') then
      raise exception 'invalid_self_rating: % is not one of correct, incorrect, partial', coalesce(v_self_rating, 'null');
    end if;
    if not (v_attempt.question_ids @> to_jsonb(v_question_id)) then
      raise exception 'invalid_question: % is not part of this session', v_question_id;
    end if;
  end loop;

  select count(*), count(distinct r ->> 'question_id')
  into v_submitted_count, v_distinct_count
  from jsonb_array_elements(coalesce(p_responses, '[]'::jsonb)) r;

  if v_submitted_count <> v_distinct_count then
    raise exception 'duplicate_question_id: the same question_id was submitted more than once';
  end if;

  v_attempt_size := jsonb_array_length(v_attempt.question_ids);
  if v_distinct_count <> v_attempt_size then
    raise exception 'incomplete_submission: expected exactly % responses (one per question in this session), got %', v_attempt_size, v_distinct_count;
  end if;

  v_today := public.member_local_date(v_profile_id);

  for v_response in select * from jsonb_array_elements(p_responses)
  loop
    v_question_id := v_response ->> 'question_id';
    v_self_rating := v_response ->> 'self_rating';
    v_is_correct := (v_self_rating = 'correct');
    if v_is_correct then
      v_score := v_score + 1;
    end if;

    insert into public.portal_practice_attempt_responses (attempt_id, profile_id, question_id, self_rating, is_correct)
    values (p_attempt_id, v_profile_id, v_question_id, v_self_rating, v_is_correct);

    insert into public.portal_question_progress (profile_id, question_id, completed, answered_count, viewed_count, first_viewed_at, last_viewed_at, updated_at)
    values (v_profile_id, v_question_id, true, 1, 1, now(), now(), now())
    on conflict (profile_id, question_id) do update set
      completed = true,
      answered_count = public.portal_question_progress.answered_count + 1,
      last_viewed_at = now(),
      updated_at = now();

    for v_mapped_task in
      select acs_task_id from public.content_acs_mappings
      where content_type = 'dpe_question' and content_id = v_question_id
    loop
      perform public.record_task_evidence(v_profile_id, v_mapped_task.acs_task_id, v_is_correct, false);
    end loop;
  end loop;

  if v_attempt_size > 0 then
    insert into public.portal_study_activity (profile_id, activity_date, seconds)
    values (v_profile_id, v_today, v_attempt_size * 45)
    on conflict (profile_id, activity_date) do update set
      seconds = public.portal_study_activity.seconds + excluded.seconds;
  end if;

  update public.portal_practice_attempts
  set score = v_score, completed_at = now()
  where id = p_attempt_id
  returning * into v_attempt;

  -- v117: the mobile-only XP award that lived here in v113 is intentionally
  -- removed (see the v117 migration's header comment for the full
  -- rationale). The existing production award_xp_on_practice_attempt
  -- trigger (AFTER UPDATE on this same row, same statement/transaction) is
  -- the single XP authority for practice completion, mobile or web: 25 XP
  -- practice_set_completed, plus 15 XP perfect_score_bonus when
  -- score = total > 0.

  -- v118: if this attempt is the one linked to a Daily Drill (started via
  -- start_daily_drill_practice_session()), mark that drill completed in
  -- the SAME transaction. No-op when this is an ordinary ad-hoc
  -- mobile-practice session with no linked drill. Only ever runs on the
  -- genuine-completion path above (the already_completed branch already
  -- returned), so a drill can only be marked completed once.
  update public.daily_drills
  set status = 'completed', completed_at = v_attempt.completed_at
  where practice_attempt_id = p_attempt_id
    and profile_id = v_profile_id
    and status <> 'completed';

  return query select v_attempt.id, v_attempt.score, v_attempt.total, v_attempt.completed_at, false;
end;
$function$;
