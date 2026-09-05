-- Apex Advantage Sprint 0 Rev3 Production Deployment -- Phase 9A hotfix
-- (v117): mobile practice compatibility fix.
--
-- Discovered during Phase 9 HTTP smoke testing against real production
-- schema (not caught locally -- see "Local harness parity" below): the
-- reviewed mobile-practice Edge Function inserts
-- portal_practice_attempts.mode = 'dpe_questions', but production's
-- portal_practice_attempts_mode_check constraint only allowed
-- 'checkride' and 'rapidfire'. Every mobile-practice `start` call failed
-- with a check-constraint violation (HTTP 500). Reproduced against
-- production with a rolled-back transaction; zero customer rows were
-- affected while diagnosing this.
--
-- Independent review also found a second, related defect: production
-- already has a trigger (award_xp_on_practice_attempt ->
-- trg_award_xp_practice_attempt()) that awards XP whenever a
-- portal_practice_attempts row transitions to completed --
-- 'practice_set_completed': 25 XP, plus 'perfect_score_bonus': 15 XP when
-- score = total > 0. The reviewed complete_mobile_practice_session()
-- (v113) ALSO explicitly called award_xp() with its own event type
-- ('mobile_practice_completed', score * 5). Because award_xp() dedupes on
-- (profile_id, event_type, source_id) -- a different event_type does not
-- dedupe against the trigger's own event -- this meant every mobile
-- practice completion earned XP under BOTH systems: the existing shared
-- trigger AND a mobile-only schedule, with no reviewed product
-- requirement calling for that. This migration removes the mobile-only
-- award_xp() call from complete_mobile_practice_session() so the existing
-- production trigger remains the single authority for practice-completion
-- XP, exactly as it already is for the web portal's practice flow. The
-- trigger fires inside the same transaction complete_mobile_practice_session()
-- runs in (AFTER UPDATE on the same row, same statement), so this is not a
-- behavior change to *when* XP is awarded, only a de-duplication of a
-- second, unreviewed award.
--
-- Scope: ONLY (1) widen the mode CHECK constraint to add 'dpe_questions',
-- and (2) remove the duplicate XP award from complete_mobile_practice_session().
-- Nothing else -- no RLS, entitlement, readiness, ACS, Daily Drill,
-- library, push, Stripe, or customer-row changes. No existing
-- 'checkride'/'rapidfire' rows are touched or reinterpreted.
--
-- Local harness parity: test/sql/00_harness_schema.sql previously modeled
-- portal_practice_attempts.mode as a plain `text` column with no CHECK
-- constraint at all, and modeled the practice-completion XP trigger only
-- via a separate, unrelated stub table (stub_practice_attempts) -- so the
-- local suite could not have caught either defect. The harness now
-- reproduces both the real (pre-v117) mode CHECK constraint and the real
-- award_xp_on_practice_attempt trigger/function on the real
-- portal_practice_attempts table, and the regression suite applies this
-- exact v117 file (not a hand-modified equivalent) as part of its
-- migration sequence.
--
-- Idempotent: CREATE OR REPLACE FUNCTION is naturally idempotent; the
-- constraint swap is guarded to a no-op if v117 has already been applied.
--
-- Rollback:
--   Restoring the two-value constraint is NOT safe to do blindly once any
--   'dpe_questions' rows exist -- doing so would immediately violate the
--   constraint against live data (or silently require deleting/
--   reclassifying those rows, which is a data decision, not a schema
--   rollback). Before rolling back the constraint: (a) confirm
--   `select count(*) from public.portal_practice_attempts where mode =
--   'dpe_questions'` is either 0, or that every such row has an agreed
--   disposition (reclassify vs. delete vs. keep 'dpe_questions'
--   permanently and abandon the rollback). Only once that is resolved:
--     alter table public.portal_practice_attempts
--       drop constraint portal_practice_attempts_mode_check;
--     alter table public.portal_practice_attempts
--       add constraint portal_practice_attempts_mode_check
--       check (mode = any (array['checkride'::text, 'rapidfire'::text]));
--   Restoring the mobile-specific XP award (not recommended -- reintroduces
--   the duplicate-XP defect this migration fixes) would mean re-adding the
--   removed `perform public.award_xp(v_profile_id, 'mobile_practice_completed',
--   v_score * 5, ...)` call back into complete_mobile_practice_session(),
--   i.e. reverting the CREATE OR REPLACE FUNCTION below to the v113 body.

-- ---------------------------------------------------------------------
-- 1. Widen portal_practice_attempts_mode_check to include 'dpe_questions',
--    preserving the constraint name.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'portal_practice_attempts_mode_check'
      and conrelid = 'public.portal_practice_attempts'::regclass
      and pg_get_constraintdef(oid) = 'CHECK ((mode = ANY (ARRAY[''checkride''::text, ''rapidfire''::text, ''dpe_questions''::text])))'
  ) then
    -- Already applied (matches this migration's exact target definition) -- no-op.
    return;
  end if;

  alter table public.portal_practice_attempts
    drop constraint if exists portal_practice_attempts_mode_check;

  alter table public.portal_practice_attempts
    add constraint portal_practice_attempts_mode_check
    check (mode = any (array['checkride'::text, 'rapidfire'::text, 'dpe_questions'::text]));
end $$;

-- ---------------------------------------------------------------------
-- 2. Remove the duplicate mobile-only XP award from
--    complete_mobile_practice_session(). Every other part of the
--    reviewed v113 body (SELECT ... FOR UPDATE, ownership checks, full
--    payload validation, response persistence, portal_question_progress
--    increments, task evidence, study activity, completed_at update,
--    concurrency/idempotency behavior) is unchanged.
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
  -- removed (see this file's header comment for the full rationale). The
  -- existing production award_xp_on_practice_attempt trigger (AFTER UPDATE
  -- on this same row, same statement/transaction) is now the single XP
  -- authority for practice completion, mobile or web: 25 XP
  -- practice_set_completed, plus 15 XP perfect_score_bonus when
  -- score = total > 0.

  return query select v_attempt.id, v_attempt.score, v_attempt.total, v_attempt.completed_at, false;
end;
$function$;
