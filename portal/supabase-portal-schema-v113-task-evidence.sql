-- Apex Advantage Sprint 0 Phase C -- Task Evidence model (v113)
--
-- NOT YET APPLIED TO PRODUCTION. Source-controlled, locally tested only.
--
-- task_evidence tracks per-learner, per-ACS-task performance evidence --
-- the raw material readiness_snapshots (v114) and daily_drills (v115)
-- are computed from. It never trusts a client-supplied score: the only
-- write path is the SECURITY DEFINER function below, service_role-only,
-- called exclusively from the trusted server-side practice-completion
-- flow (Phase C8's mobile-practice-complete Edge Function and, in
-- principle, a future web equivalent) -- never a direct client RPC with
-- a caller-supplied profile_id or evidence_score.

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

-- ---------------------------------------------------------------------
-- record_task_evidence -- the sole write path. service_role only.
--
-- p_profile_id is caller-supplied because the caller here is always a
-- trusted server-side Edge Function that has already authenticated the
-- real learner and is recording an attempt IT witnessed -- this mirrors
-- the same trust boundary as stripe-webhook writing to
-- portal_access_purchases, not a client-facing RPC. It is intentionally
-- NOT authenticated-callable (see grants at the bottom).
--
-- Evidence score formula (v1, versioned so a v2 algorithm can be
-- introduced later without silently reinterpreting old evidence rows --
-- this table has no algorithm_version column because it holds current
-- rolling state, not a history; readiness_snapshots is where
-- algorithm_version-tagged history lives):
--   recent_accuracy = correct_count / attempt_count
--   evidence_score  = recent_accuracy * least(1.0, attempt_count / 5.0)
-- The volume dampener directly guards against a single lucky (or
-- unlucky) attempt on a task producing a misleadingly extreme score --
-- a task with 1 correct attempt scores 0.20, not 1.00; it takes 5+
-- attempts before the dampener stops suppressing the raw accuracy.
-- ---------------------------------------------------------------------
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

revoke execute on function public.record_task_evidence(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_task_evidence(uuid, uuid, boolean, boolean) to service_role;
