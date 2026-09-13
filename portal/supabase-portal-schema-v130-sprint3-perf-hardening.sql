-- Apex Advantage — Sprint 3 Part H/8: performance advisor follow-ups
--
-- Two real, in-scope findings from get_advisors('performance') after
-- v126-v129, both on tables/columns this sprint actually introduced
-- (pre-existing gaps on task_evidence/readiness_snapshots -- present
-- since v113/v114, not caused by this sprint -- are left alone; fixing
-- those would touch dozens of unrelated pre-existing policies/tables,
-- well beyond this sprint's scope):
--
-- 1. acs_tasks.dpe_category and task_evidence_sources.acs_task_id are
--    new foreign keys (v126, v127) with no covering index -- added here.
-- 2. task_evidence_sources' own new RLS policy (v127) called auth.uid()
--    directly rather than (select auth.uid()), the pattern Postgres's
--    planner can cache/inline better at scale -- fixed here, in the one
--    new policy this sprint wrote, not the many pre-existing ones using
--    the older pattern elsewhere in the schema.

create index if not exists idx_acs_tasks_dpe_category on public.acs_tasks (dpe_category);
create index if not exists idx_task_evidence_sources_acs_task_id on public.task_evidence_sources (acs_task_id);

drop policy if exists "Users can view their own evidence sources" on public.task_evidence_sources;
create policy "Users can view their own evidence sources"
  on public.task_evidence_sources for select
  using ((select auth.uid()) = profile_id);
