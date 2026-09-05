-- Apex Advantage Sprint 0 Phase 2A -- 004_admin_grant_tightening (v107)
--
-- Grant hygiene only. Every function below already has a correct internal
-- `if not public.is_admin(auth.uid()) then raise exception` (or an
-- equivalent instructor/office-manager ownership check) -- none of these
-- were exploitable, confirmed by full source read in Sprint 0 Phase 1B.
-- The only issue is that pg_proc.proacl showed a default-PUBLIC EXECUTE
-- grant (explicit `anon=X` entries, not just inherited) on functions that
-- are only ever meant to be called by an authenticated admin/staff member
-- through the admin React app -- anon has no legitimate reason to hold
-- EXECUTE on any of these, even though the internal check already blocks
-- anon from doing anything with it.
--
-- authenticated EXECUTE is preserved throughout -- the admin React app
-- (portal/src/pages/*.jsx) always calls these while authenticated, and the
-- internal is_admin()/instructor/office-manager check remains the real
-- security boundary, exactly as it is today.
--
-- Three sibling functions (admin_grant_study_pack_entitlement,
-- admin_revoke_study_pack_entitlement, admin_list_study_pack_entitlements)
-- were checked and already have no anon grant at all (pg_proc.proacl has
-- no `anon=X` entry) -- no change needed for those three, and they are
-- intentionally NOT listed below.
--
-- Idempotent: revoking an already-revoked privilege is a no-op.
--
-- Rollback: grant execute on function <signature> to anon; (per function,
-- listed at the bottom of this file).

revoke execute on function public.admin_award_xp(uuid,integer,text) from public, anon;
revoke execute on function public.admin_unlock_checkride_prep(uuid) from public, anon;
revoke execute on function public.assign_ground_school_class_bid(uuid) from public, anon;
revoke execute on function public.cancel_scheduled_ground_class_enrollment(uuid) from public, anon;
revoke execute on function public.finish_scheduled_ground_class(uuid) from public, anon;
revoke execute on function public.start_scheduled_ground_class(uuid) from public, anon;

revoke execute on function public.get_activation_email_kpis(integer) from public, anon;
revoke execute on function public.get_analytics_data_quality(integer) from public, anon;
revoke execute on function public.get_channel_performance(timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_checkride_prep_funnel_stats(timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_ground_school_funnel_stats(timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_marketing_executive_funnel(timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_marketing_revenue_summary(timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_portal_activation_funnel(timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_readiness_funnel_stats(timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_retention_kpis() from public, anon;
revoke execute on function public.get_utm_campaign_performance(timestamptz, timestamptz) from public, anon;

-- authenticated keeps EXECUTE on every function above -- confirm explicitly
-- rather than relying on "we never revoked it":
grant execute on function public.admin_award_xp(uuid,integer,text) to authenticated;
grant execute on function public.admin_unlock_checkride_prep(uuid) to authenticated;
grant execute on function public.assign_ground_school_class_bid(uuid) to authenticated;
grant execute on function public.cancel_scheduled_ground_class_enrollment(uuid) to authenticated;
grant execute on function public.finish_scheduled_ground_class(uuid) to authenticated;
grant execute on function public.start_scheduled_ground_class(uuid) to authenticated;
grant execute on function public.get_activation_email_kpis(integer) to authenticated;
grant execute on function public.get_analytics_data_quality(integer) to authenticated;
grant execute on function public.get_channel_performance(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_checkride_prep_funnel_stats(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_ground_school_funnel_stats(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_marketing_executive_funnel(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_marketing_revenue_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_portal_activation_funnel(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_readiness_funnel_stats(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_retention_kpis() to authenticated;
grant execute on function public.get_utm_campaign_performance(timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------
-- Rollback (re-grant anon -- should never be needed, since anon never had
-- a legitimate use for any of these):
-- -----------------------------------------------------------------------
-- grant execute on function public.admin_award_xp(uuid,integer,text) to anon;
-- grant execute on function public.admin_unlock_checkride_prep(uuid) to anon;
-- grant execute on function public.assign_ground_school_class_bid(uuid) to anon;
-- grant execute on function public.cancel_scheduled_ground_class_enrollment(uuid) to anon;
-- grant execute on function public.finish_scheduled_ground_class(uuid) to anon;
-- grant execute on function public.start_scheduled_ground_class(uuid) to anon;
-- grant execute on function public.get_activation_email_kpis(integer) to anon;
-- grant execute on function public.get_analytics_data_quality(integer) to anon;
-- grant execute on function public.get_channel_performance(timestamptz, timestamptz) to anon;
-- grant execute on function public.get_checkride_prep_funnel_stats(timestamptz, timestamptz) to anon;
-- grant execute on function public.get_ground_school_funnel_stats(timestamptz, timestamptz) to anon;
-- grant execute on function public.get_marketing_executive_funnel(timestamptz, timestamptz) to anon;
-- grant execute on function public.get_marketing_revenue_summary(timestamptz, timestamptz) to anon;
-- grant execute on function public.get_portal_activation_funnel(timestamptz, timestamptz) to anon;
-- grant execute on function public.get_readiness_funnel_stats(timestamptz, timestamptz) to anon;
-- grant execute on function public.get_retention_kpis() to anon;
-- grant execute on function public.get_utm_campaign_performance(timestamptz, timestamptz) to anon;
