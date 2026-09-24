-- Apex Advantage — Mock Oral Availability Admin: instructor-eligibility
-- RLS hardening (v144)
--
-- Companion migration for the new admin Mock Oral Availability Manager
-- (portal/src/pages/MockOralAvailability.jsx). No new tables — this closes
-- two related gaps found while building the eligibility toggle, both of
-- which already existed in production (v97) before this feature:
--
-- 1. lock_profile_privileged_columns() (v8/v16) force-reverts role,
--    checkride_prep_unlocked, email, and created_at for any UPDATE not
--    performed by an admin/service-role -- but was never extended when
--    v97 added mock_oral_instructor/mock_oral_certificate_types/
--    mock_oral_rate_cents. Because "Members can update their own profile"
--    (v8) already grants every member UPDATE on their own row with no
--    column restriction beyond this trigger, any authenticated member
--    could currently self-declare mock_oral_instructor = true on their
--    own profile via a direct client update -- there is no admin-only
--    gate on these three columns today. Fixed by adding them to the
--    trigger's existing lock list, the same pattern already used for the
--    other admin-only columns.
--
-- 2. "Instructors manage their own mock oral availability" (v97) only
--    checks instructor_id = auth.uid() -- it never checks that the named
--    instructor is actually eligible. Combined with gap #1, ANY
--    authenticated member could INSERT a mock_oral_availability row
--    naming themselves as instructor_id, which is immediately visible to
--    students via "Authenticated users view open future mock oral slots"
--    and get_mock_oral_availability(), and immediately bookable/payable
--    through the real Stripe checkout -- assigning themselves a real,
--    paid Mock Oral booking with no vetting at all. Fixed by requiring
--    the caller's own profile to have mock_oral_instructor = true and
--    the target certificate_type in their mock_oral_certificate_types,
--    in both USING (existing rows) and WITH CHECK (new/updated rows).
--    Admins are unaffected -- "Admins manage mock oral availability" is
--    a separate, unrestricted policy, exactly as before.
--
-- Deliberately NOT touched, per this feature's explicit instruction not
-- to casually rewrite working security policy without a clear need:
-- "Authenticated users view open future mock oral slots" still targets
-- authenticated via `auth.role() = 'authenticated'` inside USING rather
-- than a policy-level `TO authenticated` clause. Current Supabase
-- guidance prefers the `TO` form for a small performance win (the
-- planner can skip the policy entirely for other roles), but the
-- existing form is not a security defect -- it evaluates correctly for
-- every role today. Flagged here for a future style pass, not changed
-- as a side effect of this feature.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v143.

create or replace function public.lock_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin(auth.uid()) then
    new.role := old.role;
    new.checkride_prep_unlocked := old.checkride_prep_unlocked;
    new.email := old.email;
    new.created_at := old.created_at;
    new.mock_oral_instructor := old.mock_oral_instructor;
    new.mock_oral_certificate_types := old.mock_oral_certificate_types;
    new.mock_oral_rate_cents := old.mock_oral_rate_cents;
  end if;
  return new;
end;
$$;

drop policy if exists "Instructors manage their own mock oral availability" on public.mock_oral_availability;
create policy "Instructors manage their own mock oral availability"
  on public.mock_oral_availability for all
  using (
    instructor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.mock_oral_instructor = true
        and mock_oral_availability.certificate_type = any (p.mock_oral_certificate_types)
    )
  )
  with check (
    instructor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.mock_oral_instructor = true
        and mock_oral_availability.certificate_type = any (p.mock_oral_certificate_types)
    )
  );
