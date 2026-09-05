-- Apex Advantage Sprint 0 Phase 2A -- 003_claim_function_service_role_only (v106)
--
-- Security fix only. No function body change.
--
-- claim_ground_school_enrollments_by_email, claim_readiness_assessment_by_email,
-- and record_referral_signup each take a caller-supplied profile id
-- (p_profile_id / p_new_profile_id) with no ownership binding to
-- auth.uid(). Sprint 0 Phase 1B traced their one legitimate caller --
-- portal/supabase/functions/create-free-account/index.ts -- and confirmed
-- it has always used a service-role client
-- (`createClient(SUPABASE_URL, SERVICE_ROLE_KEY)` at line 91, the same
-- client instance used for every RPC call in that function).
--
-- Deliberately NOT adding an auth.uid() check here: a service-role caller
-- has no meaningful auth.uid() of its own (it isn't acting as any signed-in
-- user), so binding these functions to auth.uid() would break the one
-- real caller instead of fixing the exposure. Making them server-only is
-- the smallest change that preserves create-free-account's working
-- signup flow while closing the direct-client forgery path:
--   - claim_ground_school_enrollments_by_email / claim_readiness_assessment_by_email:
--     a known victim email otherwise lets an attacker link/claim someone
--     else's Ground School enrollment or readiness-assessment lead onto
--     their own account.
--   - record_referral_signup: an attacker who knows a victim's profile_id
--     could otherwise race the real signup call and steal referral-
--     attribution credit for themselves (the function's own idempotency
--     guard is keyed per profile_id, so only the first caller wins).
--
-- Idempotent: revoking an already-revoked privilege is a no-op.
--
-- Rollback:
--   grant execute on function public.claim_ground_school_enrollments_by_email(uuid,text) to anon, authenticated;
--   grant execute on function public.claim_readiness_assessment_by_email(uuid,text) to anon, authenticated;
--   grant execute on function public.record_referral_signup(uuid,text,text) to anon, authenticated;

revoke execute on function public.claim_ground_school_enrollments_by_email(uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_ground_school_enrollments_by_email(uuid,text)
  to service_role;

revoke execute on function public.claim_readiness_assessment_by_email(uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_readiness_assessment_by_email(uuid,text)
  to service_role;

revoke execute on function public.record_referral_signup(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.record_referral_signup(uuid,text,text)
  to service_role;
