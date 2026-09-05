-- Apex Advantage Sprint 0 Phase 2A (deferred item, closed here) --
-- 007_mission_streak_client_lockout (v111)
--
-- Security fix only. No function body change, no data touched.
--
-- run_streak_maintenance() and refresh_mission_progress() had default-
-- PUBLIC EXECUTE (confirmed live via has_function_privilege(): anon=true,
-- authenticated=true, service_role=true), flagged in Sprint 0 Phase 1B and
-- explicitly deferred pending confirmation that their real caller --
-- send-lifecycle-emails, via the send-lifecycle-emails-daily pg_cron job
-- -- was actually healthy. That cron was returning HTTP 401 (a Vault vs.
-- Edge Function secret mismatch, unrelated to this migration) until the
-- operator rotated both secrets to a matching fresh value; a manual
-- invocation after rotation returned HTTP 200 with an empty errors[]
-- array covering both functions by name. See
-- SPRINT_0_PHASE_2B_HOTFIX_REPORT.md section 12 and the Sprint 0 mobile-
-- backend session's Phase A verification for the full incident/rotation
-- writeup.
--
-- Final caller trace (re-confirmed immediately before writing this
-- migration -- full repo grep of `.rpc(`, plus a pg_get_functiondef()
-- scan of every function in `public` for internal references to either
-- function name, plus a trigger/admin-UI check):
--   run_streak_maintenance()      <- send-lifecycle-emails/index.ts:1431 only
--   refresh_mission_progress()    <- send-lifecycle-emails/index.ts:1438 only
-- Both called via that function's single service-role client
-- (`createClient(SUPABASE_URL, SERVICE_ROLE_KEY)`), itself invoked daily
-- by the send-lifecycle-emails-daily pg_cron job. Zero frontend `.rpc()`
-- calls, zero other Edge Functions, zero internal SQL callers, zero
-- triggers, zero admin/staff UI call sites -- the only non-caller
-- references anywhere in the repo are explanatory comments in
-- site/portal-stable.js and portal/src/pages/Missions.jsx describing that
-- progress/streaks are computed server-side by these functions, not
-- calling them.
--
-- Why the legitimate caller is unaffected: service_role has its own
-- independent EXECUTE grant, untouched by this migration.
--
-- Idempotent: revoking an already-revoked privilege is a no-op.
--
-- Rollback:
--   grant execute on function public.run_streak_maintenance() to anon, authenticated;
--   grant execute on function public.refresh_mission_progress() to anon, authenticated;

revoke execute on function public.run_streak_maintenance()
  from public, anon, authenticated;
grant execute on function public.run_streak_maintenance()
  to service_role;

revoke execute on function public.refresh_mission_progress()
  from public, anon, authenticated;
grant execute on function public.refresh_mission_progress()
  to service_role;
