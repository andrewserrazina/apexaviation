-- Apex Advantage Sprint 0 Phase C -- Daily Drills (v115)
--
-- NOT YET APPLIED TO PRODUCTION. Source-controlled, locally tested only.

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

-- No direct client INSERT/UPDATE/DELETE -- generation and status
-- transitions both go through auth.uid()-bound RPCs below, so the same
-- entitlement/idempotency checks apply every time regardless of which
-- client (mobile or a future web surface) is calling.
revoke insert, update, delete on public.daily_drills from anon, authenticated;

-- ---------------------------------------------------------------------
-- get_or_create_daily_drill() -- idempotent generation, auth.uid()-bound.
--
-- Inputs considered (v1): weak/stale task_evidence (lowest evidence_score
-- first, ties broken toward tasks never attempted at all -- a coverage
-- gap is treated as weaker than a low-but-nonzero score), recent
-- repetition (excludes questions the learner answered correctly within
-- the last 3 days, so a "weak task" drill doesn't just replay the same
-- handful of items forever), and entitlement (checkride_prep_unlocked,
-- read server-side from profiles -- never a caller-supplied claim).
-- Checkride-date proximity is not yet a separate branch in v1 (see
-- Sprint 0 report "Known Risks" / "Deferred Work") -- documented as a
-- v2 candidate rather than half-implemented here.
--
-- Idempotent and "stable through the study day": the unique constraint
-- on (profile_id, drill_date, algorithm_version) means a second call on
-- the same day returns the SAME row (via the existing-row branch below)
-- rather than regenerating a different set of questions mid-day.
-- drill_date uses member_local_date() (the same day-boundary helper
-- run_streak_maintenance already relies on), not UTC's current_date, so
-- "today" matches the learner's own clock.
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

  -- Entitlement is derived server-side, never trusted from the caller.
  select checkride_prep_unlocked into v_entitled from public.profiles where id = v_profile_id;
  if not coalesce(v_entitled, false) then
    raise exception 'Checkride Prep is not unlocked on this account.';
  end if;

  -- Target 2-4 weakest/least-covered tasks for this learner's certificate.
  select coalesce(jsonb_agg(jsonb_build_object('acs_task_id', task_id, 'task_code', task_code, 'area_code', area_code)), '[]'::jsonb),
         coalesce(array_agg(task_id), '{}')
  into v_target_tasks, v_target_task_ids
  from (
    select t.id as task_id, t.task_code, t.area_code,
           coalesce(e.evidence_score, 0) as score
    from public.acs_tasks t
    join public.acs_versions v on v.id = t.acs_version_id and v.certificate_type = 'private_pilot' and v.active
    left join public.task_evidence e on e.acs_task_id = t.id and e.profile_id = v_profile_id
    order by score asc, (e.attempt_count is null) desc
    limit 3
  ) weakest;

  -- 5-8 questions mapped to the target tasks, excluding anything the
  -- learner answered correctly in the last 3 days (avoid excessive
  -- repeats), capped at 7 items (this codebase's practice-attempt shape
  -- doesn't yet track "answered correctly" as its own event outside
  -- portal_question_progress, so the recency filter uses that table's
  -- own updated_at + completed flag -- the same source of truth the web
  -- portal's own progress UI already reads from).
  select coalesce(jsonb_agg(distinct q.id), '[]'::jsonb) into v_question_ids
  from (
    select d.id
    from public.content_acs_mappings m
    join public.dpe_questions d on d.id = m.content_id and m.content_type = 'dpe_question'
    left join public.portal_question_progress p on p.question_id = d.id and p.profile_id = v_profile_id
    where m.acs_task_id = any(v_target_task_ids)
      and d.is_scenario = false
      and (p.completed is not true or p.updated_at < now() - interval '3 days')
    order by random()
    limit 7
  ) q;

  insert into public.daily_drills (profile_id, drill_date, algorithm_version, target_acs_tasks, question_ids, scenario_ids, estimated_minutes, status)
  values (v_profile_id, v_today, 'v1', v_target_tasks, v_question_ids, '[]'::jsonb, 7, 'pending')
  returning * into v_row;

  return v_row;
end;
$function$;

revoke execute on function public.get_or_create_daily_drill() from public, anon;
grant execute on function public.get_or_create_daily_drill() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- mark_daily_drill_started() -- self-scoped status transition, called
-- when the learner opens today's drill in the app. A no-op (returns the
-- row unchanged) if it's already started/completed, so a retried/duplicate
-- client call can never move a drill backwards or double-log a start.
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
