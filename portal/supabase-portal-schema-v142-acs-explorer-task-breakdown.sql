-- V142: ACS Explorer task-level drill-down (mobile).
--
-- The mobile ACS Explorer screen already shows a category-level rollup
-- (category_breakdown, exposed by mobile-readiness since Sprint 4/4.1)
-- with zero backend change. This migration adds the one thing that
-- wasn't already exposed: the individual ACS tasks inside each category,
-- so tapping a category can show "which specific tasks, applicable to
-- this student's own certificate/aircraft class, have content mapped
-- and evidence recorded" -- the "and tasks" half of the ACS Explorer's
-- original placeholder copy ("a full map of your ACS areas and tasks").
--
-- Deliberately scoped to get_readiness_scoped_acs_tasks() (REV3.3-4's
-- existing applicable-tasks resolution, filtered to
-- digital_assessment_supported = true) -- the exact same task set
-- compute_readiness_snapshot() already uses to build category_breakdown.
-- Scoping to anything else (e.g. the full get_applicable_acs_tasks()
-- universe, which includes flight-only tasks with no possible digital
-- evidence) would make this screen's task list disagree with the
-- category header's own "N of M assessable tasks have evidence" count
-- directly above it -- two numbers about the same category that don't
-- match is worse than not shipping this at all.
--
-- Zero-argument, auth.uid()-bound design (matching
-- compute_readiness_snapshot()'s own convention) rather than accepting
-- a p_profile_id parameter: there is no legitimate reason for this
-- function to ever resolve a task breakdown for anyone other than the
-- calling member, so there is no ownership check to get wrong -- the
-- function simply cannot be pointed at another profile_id in the first
-- place.
--
-- content_available is a plain EXISTS against content_acs_mappings --
-- the same authoritative "does Apex have content mapped to this task"
-- signal compute_readiness_snapshot()'s insufficient_content_coverage
-- reason code already relies on, not a client-side guess.
--
-- evidence_score/attempt_count are returned as-is (null when no
-- task_evidence row exists) -- the client renders "no evidence yet"
-- honestly rather than a fabricated 0, matching every other readiness
-- surface's existing invariant.
--
-- NOT YET DEPLOYED. Source-controlled only, alongside the rest of the
-- mobile ACS Explorer task-level work.

create or replace function public.get_member_acs_task_breakdown()
  returns table(
    acs_task_id uuid,
    area_code text,
    area_title text,
    task_code text,
    task_title text,
    dpe_category text,
    content_available boolean,
    attempt_count integer,
    evidence_score numeric
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $function$
  select
    t.id,
    t.area_code,
    t.area_title,
    t.task_code,
    t.task_title,
    t.dpe_category,
    exists (select 1 from public.content_acs_mappings m where m.acs_task_id = t.id) as content_available,
    e.attempt_count,
    e.evidence_score
  from public.get_readiness_scoped_acs_tasks(auth.uid()) t
  left join public.task_evidence e on e.acs_task_id = t.id and e.profile_id = auth.uid()
  order by t.sort_order
$function$;

revoke execute on function public.get_member_acs_task_breakdown() from public, anon;
grant execute on function public.get_member_acs_task_breakdown() to authenticated, service_role;
