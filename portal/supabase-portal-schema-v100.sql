-- ═══════════════════════════════════════════════════════════════════════
-- v100 — Study Pack RPC ACL hardening
-- ═══════════════════════════════════════════════════════════════════════
--
-- Post-build production audit finding: public.has_study_pack_entitlement
-- (uuid, text) is SECURITY DEFINER, does not itself check
-- p_profile_id = auth.uid(), and was granted EXECUTE to `authenticated`
-- directly (supabase-portal-schema-v99.sql line 287) -- revoking it from
-- PUBLIC (line 496 of that file) does not remove that separate explicit
-- grant. Any signed-in member could therefore call it directly via RPC
-- with an arbitrary profile UUID and learn whether some OTHER student
-- owns a given Study Pack -- a real, if narrow, authorization-boundary
-- violation for a SECURITY DEFINER function. This should be an internal
-- helper only: get-study-pack-content calls it from a service-role
-- client, and every other internal caller (upsert_study_pack_lesson_
-- progress, submit_study_pack_scenario, submit_study_pack_attempt) is
-- itself SECURITY DEFINER, so it runs as those functions' owner --
-- unaffected by revoking the `authenticated` grant, since Postgres
-- checks a SECURITY DEFINER function's *owner* privileges for calls it
-- makes internally, not the original caller's.
--
-- The one real internal caller that DOES execute as the original
-- querying role is the storage.objects RLS policy "Owners can read study
-- pack quick reference" (v99, section 10) -- RLS policies run as the
-- querying role itself, not as a definer. Revoking `authenticated` first
-- would silently break that policy for the exact members it's meant to
-- let in, so that policy is rewritten below to inline the equivalent
-- check (a direct EXISTS against study_pack_entitlements, filtered to
-- auth.uid() -- satisfies that table's own "view their own entitlements"
-- RLS policy, so no elevated privilege is needed) instead of calling the
-- function -- functionally identical, but no longer depends on
-- `authenticated` holding EXECUTE on the function.
--
-- The other 7 Study Pack functions are re-stated here (not changed) as
-- explicit REVOKE/GRANT pairs purely to make the intended ACL durable
-- and auditable in one place -- v99 already left them in the correct
-- state (revoked from PUBLIC, granted only to `authenticated`, internal
-- auth.uid()/is_admin() checks intact), confirmed by inspection before
-- writing this migration.

-- ── Rewrite the one real dependent policy first ─────────────────────
drop policy if exists "Owners can read study pack quick reference" on storage.objects;

create policy "Owners can read study pack quick reference"
  on storage.objects for select
  using (
    bucket_id = 'study-pack-resources'
    and (storage.foldername(name))[1] = 'quick-reference'
    and exists (
      select 1 from public.study_pack_entitlements e
      where e.profile_id = auth.uid()
        and e.pack_id = (storage.foldername(name))[2]
        and e.revoked_at is null
    )
  );

-- ── The actual fix: internal-only helper ────────────────────────────
revoke execute on function public.has_study_pack_entitlement(uuid, text) from public;
revoke execute on function public.has_study_pack_entitlement(uuid, text) from anon;
revoke execute on function public.has_study_pack_entitlement(uuid, text) from authenticated;
grant execute on function public.has_study_pack_entitlement(uuid, text) to service_role;

-- ── Student self-service RPCs (unchanged from v99 -- reaffirmed) ────
revoke execute on function public.get_my_study_packs() from public;
revoke execute on function public.get_my_study_packs() from anon;
grant execute on function public.get_my_study_packs() to authenticated;

revoke execute on function public.upsert_study_pack_lesson_progress(text, text, boolean) from public;
revoke execute on function public.upsert_study_pack_lesson_progress(text, text, boolean) from anon;
grant execute on function public.upsert_study_pack_lesson_progress(text, text, boolean) to authenticated;

revoke execute on function public.submit_study_pack_scenario(text, text, text, text) from public;
revoke execute on function public.submit_study_pack_scenario(text, text, text, text) from anon;
grant execute on function public.submit_study_pack_scenario(text, text, text, text) to authenticated;

revoke execute on function public.submit_study_pack_attempt(text, text, text, jsonb, jsonb, integer, integer, timestamptz) from public;
revoke execute on function public.submit_study_pack_attempt(text, text, text, jsonb, jsonb, integer, integer, timestamptz) from anon;
grant execute on function public.submit_study_pack_attempt(text, text, text, jsonb, jsonb, integer, integer, timestamptz) to authenticated;

-- ── Admin RPCs (unchanged from v99 -- reaffirmed) ───────────────────
-- Each of these still enforces is_admin(auth.uid()) internally; that
-- database-side check is the real authorization boundary, not this
-- grant (a non-admin `authenticated` caller reaches the function but
-- gets `raise exception 'Admin access required'`).
revoke execute on function public.admin_list_study_pack_entitlements(text) from public;
revoke execute on function public.admin_list_study_pack_entitlements(text) from anon;
grant execute on function public.admin_list_study_pack_entitlements(text) to authenticated;

revoke execute on function public.admin_grant_study_pack_entitlement(uuid, text) from public;
revoke execute on function public.admin_grant_study_pack_entitlement(uuid, text) from anon;
grant execute on function public.admin_grant_study_pack_entitlement(uuid, text) to authenticated;

revoke execute on function public.admin_revoke_study_pack_entitlement(uuid) from public;
revoke execute on function public.admin_revoke_study_pack_entitlement(uuid) from anon;
grant execute on function public.admin_revoke_study_pack_entitlement(uuid) to authenticated;
