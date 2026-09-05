-- Apex Advantage Sprint 0 Phase C -- Task Evidence + Practice Response
-- model, and atomic practice completion (v113) -- REV2
--
-- NOT YET APPLIED TO PRODUCTION. Source-controlled, locally tested only.
--
-- task_evidence tracks per-learner, per-ACS-task performance evidence --
-- the raw material readiness_snapshots (v114) and daily_drills (v115)
-- are computed from. It never trusts a client-supplied score: the only
-- write path is record_task_evidence(), called only from
-- complete_mobile_practice_session() below (or, in principle, a trusted
-- server-side web equivalent) -- never a direct client RPC with a
-- caller-supplied profile_id or evidence_score.
--
-- ===========================================================================
-- REV2 CHANGE NOTE
-- ===========================================================================
-- Independent review found three defects in the Rev1 design, all fixed here:
--
-- (1) mobile-practice's `complete` action orchestrated multiple separate
--     writes (progress, evidence, study activity, attempt row, XP) from the
--     Edge Function itself, each its own round trip. Two concurrent
--     completion requests for the same session could both observe
--     completed_at IS NULL before either finished writing, and both would
--     replay every side effect. Rev2 moves ALL of that into ONE
--     SECURITY DEFINER RPC, complete_mobile_practice_session(), that takes
--     an explicit `select ... for update` row lock on the attempt before
--     doing anything else -- a second concurrent call blocks on that lock
--     until the first transaction commits, then sees completed_at already
--     set and takes the idempotent read-only branch. Proven with a REAL
--     two-process concurrency test, not a sequential retry -- see
--     test/run_security_regression_tests.sh section 24 and
--     SPRINT_0_MOBILE_BACKEND_IMPLEMENTATION_REPORT_REV2.md section 13.
--
-- (2) portal_question_progress's upsert previously set `answered_count: 1`
--     unconditionally, which on conflict (existing row) OVERWROTE any prior
--     count back down to 1 instead of incrementing it. Fixed: the upsert's
--     ON CONFLICT clause now does `answered_count = answered_count + 1`,
--     and leaves viewed_count/favorited/first_viewed_at untouched unless
--     the row is being created for the first time.
--
-- (3) there was no reliable per-question correctness history -- only an
--     aggregate score on portal_practice_attempts. Added
--     portal_practice_attempt_responses, a child event table (NOT a second
--     progress system) that daily-drill recency logic (v115) and future
--     evidence-provenance/debugging needs can read from directly.
--
-- Evidence score formula (v1, unchanged from Rev1, versioned so a v2
-- algorithm can be introduced later without silently reinterpreting old
-- evidence rows):
--   recent_accuracy = correct_count / attempt_count
--   evidence_score  = recent_accuracy * least(1.0, attempt_count / 5.0)
--
-- Rollback: `drop function if exists public.complete_mobile_practice_session(uuid, jsonb);
-- drop table if exists public.portal_practice_attempt_responses;
-- drop function if exists public.record_task_evidence(uuid, uuid, boolean, boolean);
-- drop table if exists public.task_evidence;` -- no other table is touched;
-- portal_question_progress/portal_practice_attempts/portal_study_activity
-- rows already written by complete_mobile_practice_session before a
-- rollback are NOT retroactively undone (this is additive-write history,
-- same as any other production data -- a schema rollback is not a data
-- rollback).

create table if not exists public.task_evidence (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  acs_task_id uuid not null references public.acs_tasks(id) on delete cascade,
  attempt_count integer not null default 0,
  correct_count integer not null default 0,
  scenario_attempt_count integer not null default 0,
  recent_accuracy numeric,
  confidence_alignment numeric,
  last_attempt_at timestamptz,
  last_correct_at timestamptz,
  evidence_score numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (profile_id, acs_task_id)
);
comment on table public.task_evidence is 'Per-learner, per-ACS-task performance evidence. Writable only via public.record_task_evidence(), never directly.';

alter table public.task_evidence enable row level security;

drop policy if exists "Members read their own task evidence" on public.task_evidence;
create policy "Members read their own task evidence" on public.task_evidence
  for select using (auth.uid() = profile_id);

-- Deliberately no INSERT/UPDATE/DELETE policy at all -- default-deny for
-- every client role. The only write path is the function below, which
-- runs as SECURITY DEFINER (bypasses RLS) and is service_role-only.
revoke insert, update, delete on public.task_evidence from anon, authenticated;

create or replace function public.record_task_evidence(
  p_profile_id uuid,
  p_acs_task_id uuid,
  p_correct boolean,
  p_is_scenario boolean default false
)
returns public.task_evidence
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.task_evidence%rowtype;
begin
  insert into public.task_evidence (profile_id, acs_task_id, attempt_count, correct_count, scenario_attempt_count, last_attempt_at, last_correct_at)
  values (
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

  update public.task_evidence
  set
    recent_accuracy = round(v_row.correct_count::numeric / nullif(v_row.attempt_count, 0), 4),
    evidence_score = round((v_row.correct_count::numeric / nullif(v_row.attempt_count, 0)) * least(1.0, v_row.attempt_count / 5.0), 4),
    updated_at = now()
  where profile_id = p_profile_id and acs_task_id = p_acs_task_id
  returning * into v_row;

  return v_row;
end;
$function$;

-- record_task_evidence() itself remains service_role-only: its only two
-- legitimate callers are complete_mobile_practice_session() below (which,
-- being SECURITY DEFINER and owned by the same role as this function,
-- calls it as that owning role regardless of who invoked
-- complete_mobile_practice_session -- the standard Postgres
-- owner-bypasses-its-own-revokes behavior already relied on elsewhere in
-- this codebase, e.g. run_streak_maintenance calling award_xp) and a
-- future trusted server-side web equivalent.
revoke execute on function public.record_task_evidence(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_task_evidence(uuid, uuid, boolean, boolean) to service_role;

-- ===========================================================================
-- REV2.5: per-question response history -- a child event/result table, not
-- a second progress system. portal_practice_attempts keeps the aggregate
-- score/total; this table is the durable per-question record that daily
-- drill recency logic (v115) and future evidence-provenance/debugging needs
-- read from.
--
-- `partial` semantics (documented explicitly per REV2.5's requirement, not
-- left ambiguous):
--   - is_correct is FALSE for both 'incorrect' and 'partial' -- a partial
--     self-rating does NOT count toward the session's aggregate score or
--     toward task_evidence's correct_count. Only a 'correct' rating does.
--   - For daily-drill recency (v115), 'partial' is treated as a MODERATE
--     priority signal for re-drilling that task -- weaker than 'incorrect'
--     (which is the strongest re-drill signal) but stronger than a task
--     with no recent response at all.
-- ===========================================================================
create table if not exists public.portal_practice_attempt_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.portal_practice_attempts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  question_id text not null,
  self_rating text not null check (self_rating in ('correct', 'incorrect', 'partial')),
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);
comment on table public.portal_practice_attempt_responses is 'Per-question result history for a practice attempt. Child event table, not a second progress system -- portal_question_progress/portal_practice_attempts remain the aggregate records. Written only by complete_mobile_practice_session(), never directly by a client.';

create index if not exists idx_practice_responses_profile_question on public.portal_practice_attempt_responses (profile_id, question_id, answered_at desc);

alter table public.portal_practice_attempt_responses enable row level security;

drop policy if exists "Members read their own practice responses" on public.portal_practice_attempt_responses;
create policy "Members read their own practice responses" on public.portal_practice_attempt_responses
  for select using (auth.uid() = profile_id);

-- No INSERT/UPDATE/DELETE policy -- the sole write path is
-- complete_mobile_practice_session() (SECURITY DEFINER, bypasses RLS).
revoke insert, update, delete on public.portal_practice_attempt_responses from anon, authenticated;

-- ===========================================================================
-- REV2.4/2.6/2.7/2.8: complete_mobile_practice_session() -- the ONE atomic,
-- concurrency-safe write path for finishing a mobile practice session.
-- auth.uid()-bound (no caller-supplied profile_id anywhere), so mobile-
-- practice's Edge Function can become a thin authenticate-and-call wrapper
-- per REV2.8, rather than orchestrating multiple non-transactional writes
-- itself.
--
-- Concurrency design: `select ... for update` takes a row lock on the
-- specific portal_practice_attempts row as the very first statement. If two
-- requests for the SAME attempt_id arrive concurrently, the second blocks
-- at this line until the first's transaction commits or rolls back. Once
-- unblocked, it reads the LATEST committed state of the row (Postgres
-- guarantees this for a lock-then-read, not a stale snapshot) -- so if the
-- first call already completed the attempt, the second sees
-- completed_at IS NOT NULL and takes the idempotent branch below,
-- performing NO side effects a second time. Two racing callers therefore
-- always serialize into exactly one real completion; both may receive a
-- 200 response, but only one of them actually mutated state.
--
-- Progress-counter fix (REV2.6): the portal_question_progress upsert now
-- increments answered_count instead of overwriting it, and leaves
-- viewed_count/favorited/first_viewed_at alone on conflict.
-- ===========================================================================
create or replace function public.complete_mobile_practice_session(
  p_attempt_id uuid,
  p_responses jsonb -- array of {"question_id": text, "self_rating": "correct"|"incorrect"|"partial"}
)
returns table (session_id uuid, score integer, total integer, completed_at timestamptz, already_completed boolean)
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
  v_valid_count integer := 0;
  v_today date;
  v_mapped_task record;
begin
  if v_profile_id is null then
    raise exception 'Not signed in.';
  end if;

  -- Row lock FIRST, before any other read or write -- this is the entire
  -- concurrency guarantee. Everything below runs with this row locked
  -- until the function's implicit transaction ends.
  select * into v_attempt from public.portal_practice_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'Session not found.';
  end if;
  if v_attempt.profile_id <> v_profile_id then
    raise exception 'Not your session.';
  end if;

  -- Idempotent short-circuit, evaluated under the row lock: a concurrent
  -- racer that lost the race to acquire the lock lands here and performs
  -- zero side effects, returning the same result the winner already
  -- committed.
  if v_attempt.completed_at is not null then
    return query select v_attempt.id, v_attempt.score, v_attempt.total, v_attempt.completed_at, true;
    return;
  end if;

  v_today := public.member_local_date(v_profile_id);

  for v_response in select * from jsonb_array_elements(coalesce(p_responses, '[]'::jsonb))
  loop
    v_question_id := v_response ->> 'question_id';
    v_self_rating := v_response ->> 'self_rating';

    -- Validate every submitted question belongs to this attempt, and that
    -- self_rating is one of the three accepted values -- anything else is
    -- silently skipped, not trusted.
    if v_question_id is null or v_self_rating not in ('correct', 'incorrect', 'partial') then
      continue;
    end if;
    if not (v_attempt.question_ids @> to_jsonb(v_question_id)) then
      continue;
    end if;

    v_is_correct := (v_self_rating = 'correct');
    v_valid_count := v_valid_count + 1;
    if v_is_correct then
      v_score := v_score + 1;
    end if;

    insert into public.portal_practice_attempt_responses (attempt_id, profile_id, question_id, self_rating, is_correct)
    values (p_attempt_id, v_profile_id, v_question_id, v_self_rating, v_is_correct)
    on conflict (attempt_id, question_id) do nothing;

    -- REV2.6 fix: increment, never overwrite. viewed_count/favorited/
    -- first_viewed_at are left exactly as they were on conflict.
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

  if v_valid_count > 0 then
    insert into public.portal_study_activity (profile_id, activity_date, seconds)
    values (v_profile_id, v_today, v_valid_count * 45)
    on conflict (profile_id, activity_date) do update set
      seconds = public.portal_study_activity.seconds + excluded.seconds;
  end if;

  update public.portal_practice_attempts
  set score = v_score, completed_at = now()
  where id = p_attempt_id
  returning * into v_attempt;

  -- XP through the existing trusted mechanism -- source_id is the attempt
  -- id, so award_xp's own unique(profile_id, event_type, source_id)
  -- constraint (v104) is a second, independent idempotency guard on top of
  -- the row lock above.
  perform public.award_xp(
    v_profile_id, 'mobile_practice_completed', v_score * 5,
    'portal_practice_attempts', p_attempt_id::text,
    jsonb_build_object('score', v_score, 'total', v_attempt.total)
  );

  return query select v_attempt.id, v_attempt.score, v_attempt.total, v_attempt.completed_at, false;
end;
$function$;

revoke execute on function public.complete_mobile_practice_session(uuid, jsonb) from public, anon;
grant execute on function public.complete_mobile_practice_session(uuid, jsonb) to authenticated, service_role;
