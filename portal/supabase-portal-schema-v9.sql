-- Content Operations (v9) — Phase 4
--
-- Phase 1 moved the DPE question library out of a public static JS file
-- and into real tables (dpe_categories/dpe_questions), locked to
-- admin-SELECT-only -- "nothing should ever write to these tables from a
-- client... except through a future admin CMS" (see the v5 migration's
-- own comment). This is that CMS's write access, plus the one other real
-- gap called out in IMPLEMENTATION_PLAN.md Phase 4: referrals have no
-- admin workflow at all today.

-- ─────────────────────────────────────────────────────────────────
-- 1. DPE content CMS -- admins can now create/edit/delete questions
-- and categories directly (previously view-only). Uses is_admin()
-- (added in v8) instead of the inline subquery the v5 migration used --
-- both are equivalent here (this table isn't `profiles`, so the
-- inline form doesn't actually recurse), just consistent with the
-- helper now that it exists.
-- ─────────────────────────────────────────────────────────────────
drop policy if exists "Admins can view all DPE categories" on public.dpe_categories;
create policy "Admins can manage all DPE categories"
  on public.dpe_categories for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can view all DPE questions" on public.dpe_questions;
create policy "Admins can manage all DPE questions"
  on public.dpe_questions for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 2. Referral admin workflow -- portal_referrals.status can currently
-- only ever move via a direct database edit. The existing "Users
-- manage their own referrals" policy (auth.uid() = referrer_id) plus
-- the v5 lock_referral_status trigger correctly stops a referrer from
-- self-approving their OWN referral, but there was never a
-- counterpart policy letting an admin update a referral that ISN'T
-- their own row in the first place -- so nobody, admin included, could
-- move a referral from pending to signed_up/rewarded through the
-- normal RLS-protected client. This is that missing policy.
-- ─────────────────────────────────────────────────────────────────
drop policy if exists "Admins can manage all referrals" on public.portal_referrals;
create policy "Admins can manage all referrals"
  on public.portal_referrals for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
