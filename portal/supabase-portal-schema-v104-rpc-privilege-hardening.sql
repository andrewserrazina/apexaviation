-- Apex Advantage Sprint 0 Phase 2A -- 001_rpc_privilege_hardening (v104)
--
-- Security fix only. No table schema change, no function body change.
--
-- Sprint 0 Phase 1/1B (audit-only) found four SECURITY DEFINER functions
-- with default-PUBLIC EXECUTE -- confirmed live via pg_proc.proacl, which
-- shows explicit `anon=X` and `authenticated=X` entries, not just an
-- inherited PUBLIC grant -- that take a fully caller-supplied identity
-- and/or payment fields with no internal auth check at all:
--
--   confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer)
--   confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)
--   confirm_legacy_ground_registration(uuid,text,text,uuid,text,integer)
--   award_xp(uuid,text,integer,text,text,jsonb)
--
-- Any authenticated client (the two ground-school confirm functions were
-- even anon-callable) could invoke these directly and forge a "paid"
-- Ground School enrollment or unlimited XP without ever touching Stripe
-- or a real in-app XP event.
--
-- Verified callers (Sprint 0 Phase 1B, full repo grep + pg_get_functiondef
-- read of every candidate caller -- see SPRINT_0_PHASE_2A_REPORT.md
-- section 9/10 for the full trace):
--   confirm_scheduled_ground_class_enrollment (6-arg) <- stripe-webhook only (service_role client)
--   confirm_scheduled_ground_class_enrollment (7-arg) <- enroll_in_ground_school_via_pack only
--                                                         (internal SQL call, not a client RPC)
--   confirm_legacy_ground_registration                <- stripe-webhook only (service_role client)
--   award_xp                                           <- admin_award_xp, log_daily_dispatch_open,
--                                                          refresh_mission_progress, and the
--                                                          trg_award_xp_* triggers only. Zero direct
--                                                          `.rpc('award_xp', ...)` call sites exist
--                                                          anywhere in the repo.
--
-- Why every legitimate caller keeps working after this migration:
--   - service_role has its own independent EXECUTE grant, untouched here.
--   - Every function in `public` (including all four above and every one
--     of their internal callers) is owned by the same `postgres` role.
--     A SECURITY DEFINER function's body executes as its owner, and an
--     object owner has implicit, ungrantable, un-revocable privileges on
--     objects it owns -- so a postgres-owned function calling another
--     postgres-owned function always succeeds regardless of what has been
--     revoked from anon/authenticated/PUBLIC on the callee.
--   - Trigger functions (trg_award_xp_*) are invoked directly by the
--     trigger engine, which never consults EXECUTE grants at all.
--
-- Idempotent: revoking a privilege that was never granted (or already
-- revoked) is a no-op in Postgres, not an error, so this file is safe to
-- re-run.
--
-- Rollback: re-grant to anon and/or authenticated as shown at the bottom
-- of this file. There is no data to roll back -- this migration touches
-- only privileges, never rows.

revoke execute on function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer)
  from public, anon, authenticated;
grant execute on function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer)
  to service_role;

revoke execute on function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)
  to service_role;

revoke execute on function public.confirm_legacy_ground_registration(uuid,text,text,uuid,text,integer)
  from public, anon, authenticated;
grant execute on function public.confirm_legacy_ground_registration(uuid,text,text,uuid,text,integer)
  to service_role;

revoke execute on function public.award_xp(uuid,text,integer,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.award_xp(uuid,text,integer,text,text,jsonb)
  to service_role;

-- -----------------------------------------------------------------------
-- Rollback (re-grant client access -- only do this if this migration is
-- found to have broken a caller that Phase 1B's trace missed):
-- -----------------------------------------------------------------------
-- grant execute on function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer) to anon, authenticated;
-- grant execute on function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text) to anon, authenticated;
-- grant execute on function public.confirm_legacy_ground_registration(uuid,text,text,uuid,text,integer) to anon, authenticated;
-- grant execute on function public.award_xp(uuid,text,integer,text,text,jsonb) to anon, authenticated;
