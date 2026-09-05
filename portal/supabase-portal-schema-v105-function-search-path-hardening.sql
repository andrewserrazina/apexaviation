-- Apex Advantage Sprint 0 Phase 2A -- 002_function_search_path_hardening (v105)
--
-- Security hygiene fix only. No behavior change.
--
-- is_admin() and is_staff() (the no-arg overloads) were missing an
-- explicit search_path, unlike their already-correct is_admin(uuid),
-- is_office_manager(uuid), and is_operations_staff(uuid) siblings (all of
-- which already carry `SET search_path TO 'public'`). This matches the
-- Supabase security advisor's own flagged list.
--
-- Both functions already fully-qualify every reference (public.profiles),
-- so pinning search_path does not change what either function returns for
-- any input today -- it only removes the theoretical risk of a future
-- session-level search_path change altering name resolution inside a
-- SECURITY DEFINER function. See the regression test in
-- test/sql/002_search_path_hardening.test.sql for the behavioral proof.
--
-- Idempotent: ALTER FUNCTION ... SET search_path is a plain state
-- assignment, safe to re-run.
--
-- Rollback:
--   alter function public.is_admin() reset search_path;
--   alter function public.is_staff() reset search_path;

alter function public.is_admin() set search_path = public, pg_temp;
alter function public.is_staff() set search_path = public, pg_temp;
