-- V143: close two related gaps found in the 2026-09-20 mobile bug sweep.
--
-- 1. Any signed-in member (paid or not) could POST directly to
--    /rest/v1/portal_practice_attempts with completed_at/score already
--    set, entirely bypassing complete_mobile_practice_session()'s real
--    scoring/evidence/XP logic. RLS ("Users manage their own practice
--    attempts", auth.uid() = profile_id) does not stop this -- it's the
--    member's own row by definition, RLS was never meant to police
--    which COLUMNS of their own row they can set. The `authenticated`
--    role's table-level INSERT/UPDATE grant is what actually let this
--    through. Each such insert independently fires award_xp_on_practice_
--    attempt (AFTER INSERT/UPDATE, fires whenever completed_at is not
--    null and wasn't already), so this was a real unlimited XP/rank
--    farming vector, plus fabricated evidence via any content_acs_mappings
--    row for a question_id the caller made up.
--
--    The fix is column-level, not a blanket revoke: the web portal
--    (site/portal-stable.js, the "Play Again" / Rapid Fire / Checkride
--    Mode flow) legitimately does `apexSupabase.from('portal_practice_
--    attempts').insert({ profile_id, mode, question_ids, total })`
--    directly from the client, then calls complete_mobile_practice_
--    session() to do the actual scoring -- that insert never sets
--    completed_at or score (score's own column default is 0), so it's
--    exactly the safe subset of columns this migration continues to
--    allow. The RPC's own internal `update ... set score = ..., completed_
--    at = now()` is SECURITY DEFINER and runs as the function owner, so
--    it is entirely unaffected by revoking direct UPDATE from
--    `authenticated`.
--
--    portal_study_activity and portal_question_progress have zero direct
--    client writes anywhere in site/ or portal/src/ (grepped) -- every
--    write to either table already goes through complete_mobile_practice_
--    session()'s own inserts/upserts (SECURITY DEFINER, unaffected) -- so
--    those two get a full revoke, no column carve-out needed.
revoke insert, update, delete on public.portal_practice_attempts from authenticated, anon;
grant insert (profile_id, mode, question_ids, total) on public.portal_practice_attempts to authenticated;

revoke insert, update, delete on public.portal_study_activity from authenticated, anon;
revoke insert, update, delete on public.portal_question_progress from authenticated, anon;

-- 2. complete_mobile_practice_session() is granted directly to
--    `authenticated` (same as resume_mobile_practice_session(), for the
--    same reason -- the mobile Edge Function calls it through the
--    caller's own JWT, not a service-role proxy), so a client can call
--    it straight through PostgREST, bypassing mobile-practice's
--    requirePremiumAccess() entirely. resume_mobile_practice_session()
--    already re-checks entitlement in-RPC for exactly this reason
--    (Rev2 Blocker 1); complete_mobile_practice_session() never got the
--    same treatment. Combined with finding 1 above, a never-paid or
--    lapsed member could self-insert an attempt (of the safe-columns
--    shape now enforced) and still call complete() directly to have it
--    scored and evidenced for free.
--
--    Checked BEFORE the session lookup, mirroring resume's placement and
--    its own stated reason: a direct unentitled caller must never be
--    able to use response shape (404 vs 403 vs data) to distinguish an
--    existing session from a missing one or someone else's.
create or replace function public.complete_mobile_practice_session(p_attempt_id uuid, p_responses jsonb)
  returns table(session_id uuid, score integer, total integer, completed_at timestamp with time zone, already_completed boolean)
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_profile_id uuid := auth.uid();
  v_entitled boolean;
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

  select
    coalesce((select p.checkride_prep_unlocked from public.profiles p where p.id = v_profile_id), false)
    or exists (select 1 from public.portal_access_purchases pur where pur.profile_id = v_profile_id)
  into v_entitled;

  if not v_entitled then
    raise exception 'premium_access_required: Checkride Prep is not unlocked on this account';
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

  update public.daily_drills
  set status = 'completed', completed_at = v_attempt.completed_at
  where practice_attempt_id = p_attempt_id
    and profile_id = v_profile_id
    and status <> 'completed';

  return query select v_attempt.id, v_attempt.score, v_attempt.total, v_attempt.completed_at, false;
end;
$function$;
