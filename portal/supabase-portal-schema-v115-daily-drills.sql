-- Apex Advantage Sprint 0 Phase C -- Daily Drills (v115) -- REV2
--
-- NOT YET APPLIED TO PRODUCTION. Source-controlled, locally tested only.
--
-- ===========================================================================
-- REV2 CHANGE NOTE
-- ===========================================================================
-- Independent review found the v1 (Rev1) drill used only "lowest
-- evidence_score first" for target-task selection and used
-- portal_question_progress.completed = true as a (wrong) proxy for "the
-- learner answered this correctly recently" -- that column means "attempted
-- at least once, ever," not "recently correct." Rev2 fixes both, using only
-- signals that genuinely exist in this schema:
--
--  - ACS coverage gap and low/stale task evidence (task_evidence, now
--    measured against the COMPLETE authoritative ACS from v112 Rev2, not
--    just the tasks Apex has content for).
--  - Recent incorrect/partial responses and recent-correct anti-repeat, now
--    read from portal_practice_attempt_responses (v113 Rev2) -- REAL
--    per-question result events, not the completed flag.
--  - Favorites (portal_question_progress.favorited) as a LIGHT signal only
--    (small weight, never dominant) -- a favorited question's task gets a
--    small nudge, nothing more.
--  - Checkride-date proximity (portal_checkride_date), as a genuine
--    reweighting of the signals above, never a "make it harder" toggle and
--    never overwhelming actual evidence (weights are capped and documented
--    below).
--
-- Two signals mentioned in review are explicitly and honestly NOT
-- implemented, because the data to back them does not exist yet:
--  - "Confidence mismatch": there is no genuine self-reported learner
--    confidence capture anywhere in this schema yet (see v114's
--    confidence_score placeholder). Not simulated here either.
--  - "CFI review flag": no persisted field or event for this exists in the
--    schema. Deferred, not faked.
--
-- Target-task selection is a small, fully deterministic (modulo an
-- explicit, documented random tie-break within a ranked pool) weighted-sum
-- scoring formula -- see the comment directly above the query for the exact
-- weights and thresholds, all covered by regression tests for "no
-- checkride date," "far," and "near" scenarios (REV2.12).
--
-- get_active_acs_version() (v112 REV2.15) is used instead of an inline
-- `where active = true` join, so target-task selection always resolves the
-- one unambiguous applicable ACS version.
--
-- Rollback: `drop function if exists public.mark_daily_drill_started(uuid);
-- drop function if exists public.get_or_create_daily_drill();
-- drop table if exists public.daily_drills;` -- reads task_evidence/
-- content_acs_mappings/portal_practice_attempt_responses/
-- portal_question_progress/portal_checkride_date but never writes to any
-- of them.

create table if not exists public.daily_drills (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  drill_date date not null,
  algorithm_version text not null default 'v1',
  target_acs_tasks jsonb not null default '[]'::jsonb,
  question_ids jsonb not null default '[]'::jsonb,
  scenario_ids jsonb not null default '[]'::jsonb,
  estimated_minutes integer not null default 7,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, drill_date, algorithm_version)
);
comment on table public.daily_drills is 'One row per learner per study-day per algorithm version. Generation and status transitions go through the RPCs below, never a direct client write.';

alter table public.daily_drills enable row level security;

drop policy if exists "Members read their own daily drills" on public.daily_drills;
create policy "Members read their own daily drills" on public.daily_drills
  for select using (auth.uid() = profile_id);

revoke insert, update, delete on public.daily_drills from anon, authenticated;

-- ---------------------------------------------------------------------
-- get_or_create_daily_drill() -- idempotent generation, auth.uid()-bound.
--
-- TARGET-TASK WEIGHTING (v1, REV2.11/2.12 -- documented, testable):
-- For each ACS task in the learner's active authoritative ACS version:
--   no_evidence   = 1 if the learner has zero attempts on this task, else 0
--   weakness      = (1 - evidence_score) if the learner has attempts, else 0
--   stale         = 1 if last_attempt_at is >14 days old, else 0
--   recent_miss   = 1 if any question mapped to this task got an
--                   incorrect/partial response in the last 14 days
--                   (portal_practice_attempt_responses), else 0
--   favorite      = 1 if any question mapped to this task is favorited
--                   (portal_question_progress.favorited), else 0
--
-- These are combined with weights chosen by checkride-date proximity
-- (portal_checkride_date vs. member_local_date()):
--   no date, or >30 days out ("far"):    coverage-weighted (explore broadly)
--     w_coverage=3.0  w_weak=1.0  w_stale=0.5  w_miss=1.0  w_fav=0.25
--   8-30 days out ("moderate"):          weak/stale evidence weighted more
--     w_coverage=1.5  w_weak=2.0  w_stale=1.0  w_miss=2.0  w_fav=0.25
--   0-7 days out, or overdue ("near"):   weak/high-risk/recent-miss favored,
--                                        novelty (raw coverage) reduced
--     w_coverage=0.5  w_weak=2.0  w_stale=0.5  w_miss=3.0  w_fav=0.25
-- score = w_coverage*no_evidence + w_weak*weakness + w_stale*stale
--         + w_miss*recent_miss + w_fav*favorite
-- The top 3 tasks by score (random tie-break) become target_acs_tasks --
-- "random selection within a ranked eligible pool," per the approved
-- design, not an unexplainable black box.
--
-- QUESTION SELECTION (REV2.13): pulled from those target tasks, excluding
-- any question with a 'correct' response in portal_practice_attempt_
-- responses within the last 3 days (real anti-repeat, not the `completed`
-- proxy), prioritizing (in order) a recent 'incorrect' response, then a
-- recent 'partial' response, then no recent response at all -- capped at 7.
--
-- Idempotent and "stable through the study day" exactly as Rev1: the
-- unique constraint on (profile_id, drill_date, algorithm_version) means a
-- second call on the same day returns the SAME row.
-- ---------------------------------------------------------------------
create or replace function public.get_or_create_daily_drill()
returns public.daily_drills
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_id uuid := auth.uid();
  v_today date;
  v_existing public.daily_drills%rowtype;
  v_entitled boolean;
  v_active_version uuid;
  v_checkride_date date;
  v_days_to_checkride integer;
  v_w_coverage numeric; v_w_weak numeric; v_w_stale numeric; v_w_miss numeric; v_w_fav numeric;
  v_target_tasks jsonb;
  v_target_task_ids uuid[];
  v_question_ids jsonb;
  v_row public.daily_drills%rowtype;
begin
  if v_profile_id is null then
    raise exception 'Not signed in.';
  end if;

  v_today := public.member_local_date(v_profile_id);

  select * into v_existing from public.daily_drills
  where profile_id = v_profile_id and drill_date = v_today and algorithm_version = 'v1';
  if found then
    return v_existing;
  end if;

  select checkride_prep_unlocked into v_entitled from public.profiles where id = v_profile_id;
  if not coalesce(v_entitled, false) then
    raise exception 'Checkride Prep is not unlocked on this account.';
  end if;

  v_active_version := public.get_active_acs_version('private_pilot');

  -- Checkride-date proximity weighting (REV2.12). No date, or a date more
  -- than 30 days out, both use the "far" weights -- a very distant date
  -- gives no meaningful signal over having none at all.
  select checkride_date into v_checkride_date from public.portal_checkride_date where profile_id = v_profile_id;
  v_days_to_checkride := case when v_checkride_date is not null then v_checkride_date - v_today else null end;

  if v_days_to_checkride is null or v_days_to_checkride > 30 then
    v_w_coverage := 3.0; v_w_weak := 1.0; v_w_stale := 0.5; v_w_miss := 1.0; v_w_fav := 0.25;
  elsif v_days_to_checkride >= 8 then
    v_w_coverage := 1.5; v_w_weak := 2.0; v_w_stale := 1.0; v_w_miss := 2.0; v_w_fav := 0.25;
  else
    v_w_coverage := 0.5; v_w_weak := 2.0; v_w_stale := 0.5; v_w_miss := 3.0; v_w_fav := 0.25;
  end if;

  with task_signals as (
    select
      t.id as task_id, t.task_code, t.area_code,
      case when e.attempt_count is null or e.attempt_count = 0 then 1 else 0 end as no_evidence,
      case when e.attempt_count > 0 then (1 - e.evidence_score) else 0 end as weakness,
      case when e.last_attempt_at is not null and e.last_attempt_at < now() - interval '14 days' then 1 else 0 end as stale,
      case when exists (
        select 1 from public.content_acs_mappings m
        join public.portal_practice_attempt_responses r on r.question_id = m.content_id
        where m.acs_task_id = t.id and m.content_type = 'dpe_question'
          and r.profile_id = v_profile_id and r.is_correct = false
          and r.answered_at > now() - interval '14 days'
      ) then 1 else 0 end as recent_miss,
      case when exists (
        select 1 from public.content_acs_mappings m
        join public.portal_question_progress p on p.question_id = m.content_id
        where m.acs_task_id = t.id and m.content_type = 'dpe_question'
          and p.profile_id = v_profile_id and p.favorited = true
      ) then 1 else 0 end as favorite
    from public.acs_tasks t
    left join public.task_evidence e on e.acs_task_id = t.id and e.profile_id = v_profile_id
    where t.acs_version_id = v_active_version
  ),
  scored as (
    select task_id, task_code, area_code,
      (v_w_coverage * no_evidence + v_w_weak * weakness + v_w_stale * stale + v_w_miss * recent_miss + v_w_fav * favorite) as score
    from task_signals
  )
  select coalesce(jsonb_agg(jsonb_build_object('acs_task_id', task_id, 'task_code', task_code, 'area_code', area_code)), '[]'::jsonb),
         coalesce(array_agg(task_id), '{}')
  into v_target_tasks, v_target_task_ids
  from (
    select task_id, task_code, area_code from scored
    order by score desc, random()
    limit 3
  ) top3;

  select coalesce(jsonb_agg(picked.id), '[]'::jsonb) into v_question_ids
  from (
    select d.id,
      case
        when exists (
          select 1 from public.portal_practice_attempt_responses r
          where r.question_id = d.id and r.profile_id = v_profile_id and r.self_rating = 'incorrect'
            and r.answered_at > now() - interval '14 days'
        ) then 2
        when exists (
          select 1 from public.portal_practice_attempt_responses r
          where r.question_id = d.id and r.profile_id = v_profile_id and r.self_rating = 'partial'
            and r.answered_at > now() - interval '14 days'
        ) then 1
        else 0
      end as priority
    from public.content_acs_mappings m
    join public.dpe_questions d on d.id = m.content_id and m.content_type = 'dpe_question'
    where m.acs_task_id = any(v_target_task_ids)
      and d.is_scenario = false
      and not exists (
        select 1 from public.portal_practice_attempt_responses r
        where r.question_id = d.id and r.profile_id = v_profile_id and r.self_rating = 'correct'
          and r.answered_at > now() - interval '3 days'
      )
    order by priority desc, random()
    limit 7
  ) picked;

  insert into public.daily_drills (profile_id, drill_date, algorithm_version, target_acs_tasks, question_ids, scenario_ids, estimated_minutes, status)
  values (v_profile_id, v_today, 'v1', v_target_tasks, v_question_ids, '[]'::jsonb, 7, 'pending')
  returning * into v_row;

  return v_row;
end;
$function$;

revoke execute on function public.get_or_create_daily_drill() from public, anon;
grant execute on function public.get_or_create_daily_drill() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- mark_daily_drill_started() -- unchanged from Rev1: self-scoped status
-- transition, safe no-op if already started/completed.
-- ---------------------------------------------------------------------
create or replace function public.mark_daily_drill_started(p_drill_id uuid)
returns public.daily_drills
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.daily_drills%rowtype;
begin
  select * into v_row from public.daily_drills where id = p_drill_id and profile_id = auth.uid();
  if not found then
    raise exception 'Drill not found.';
  end if;
  if v_row.status = 'pending' then
    update public.daily_drills set status = 'in_progress', started_at = now()
    where id = p_drill_id
    returning * into v_row;
  end if;
  return v_row;
end;
$function$;

revoke execute on function public.mark_daily_drill_started(uuid) from public, anon;
grant execute on function public.mark_daily_drill_started(uuid) to authenticated, service_role;
