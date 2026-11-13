-- Post-deploy advisor fixups for 20261113_crm_v02_unified_lead_pipeline.sql.
-- Applied live via mcp__Supabase__apply_migration on 2026-11-13
-- (migration: crm_v02_advisor_fixups), immediately after that migration,
-- once Supabase's security/performance advisors flagged both of these.
--
-- 1. Supabase projects grant EXECUTE on newly created public-schema
--    functions to `anon` and `authenticated` directly (not via the
--    PUBLIC pseudo-role), so the earlier migration's
--    `revoke all ... from public` did not actually remove anon's
--    execute privilege -- the security advisor caught this immediately
--    after deploy. The function already raises an exception for a
--    non-staff caller internally (is_staff()/is_office_manager() both
--    false for an unauthenticated/non-staff auth.uid()), so this was
--    never an actual data exposure, but revoking at the grant layer too
--    is the correct defense-in-depth fix. Verified afterward via
--    information_schema.routine_privileges: only authenticated,
--    service_role and postgres retain EXECUTE.
revoke execute on function public.lead_booking_indicators(text) from anon;

-- 2. Missed a covering index on the new linked_readiness_lead_id FK
--    (every other new FK/filter column on `leads` got one; this one
--    didn't) -- flagged by the performance advisor.
create index if not exists leads_linked_readiness_lead_id_idx on public.leads(linked_readiness_lead_id);
