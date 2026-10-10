-- Apex Advantage — Close privilege-lock trigger coverage gap (v121)
--
-- Bug (found in a repo-wide security sweep): lock_profile_privileged_
-- columns() (v8, last redefined v16) only resets role, checkride_prep_
-- unlocked, email, and created_at back to their prior value on a non-
-- admin/non-service-role update. Two boolean privilege columns added to
-- profiles AFTER v16 were never added to that list:
--
--   - private_pilot_ground_school_pack_unlocked (added v57) -- gates the
--     entire $400 Private Pilot Ground School pack (every scheduled
--     class + every module's companion content, see requireModuleAccess
--     in _shared/premiumAccess.ts).
--   - mock_oral_instructor (added v97) -- gates whether a profile
--     appears as a bookable Mock Oral instructor in the admin's
--     MockOralDashboard.jsx (the ONLY place that ever sets this column,
--     via a plain client-side `.update()` -- toggleMockOralInstructor()
--     at MockOralDashboard.jsx:59).
--
-- The "Members can update their own profile" RLS policy (v8) restricts
-- which ROW a member can touch (auth.uid() = id), not which COLUMNS --
-- so with neither column in the trigger's protected list, any
-- authenticated member can run, from the browser:
--   supabase.from('profiles').update({ private_pilot_ground_school_pack_unlocked: true }).eq('id', auth.uid())
--   supabase.from('profiles').update({ mock_oral_instructor: true }).eq('id', auth.uid())
-- and immediately grant themselves the entire Ground School pack for
-- free, or promote themselves to a bookable Mock Oral instructor, with
-- no payment, no Stripe webhook, and no admin action.
--
-- Verified safe to close (production trace, read-only queries only):
-- the ONLY code that ever sets private_pilot_ground_school_pack_
-- unlocked to true is stripe-webhook/index.ts (lines ~348, ~430), which
-- runs under the SUPABASE_SERVICE_ROLE_KEY -- i.e. as Postgres
-- `service_role`. The trigger already special-cases
-- `coalesce(auth.role(), '') <> 'service_role' and not
-- public.is_admin(auth.uid())` -- service-role callers skip the reset
-- block entirely regardless of which columns are listed inside it, so
-- the real Ground School fulfillment path is completely unaffected by
-- adding this column to the list. mock_oral_instructor is toggled only
-- by MockOralDashboard.jsx, an admin-only page (gated by is_admin() at
-- the route/RLS level elsewhere in that app) -- an admin session
-- resolves via `public.is_admin(auth.uid())`, the trigger's OTHER
-- bypass condition, so that legitimate path is also unaffected.
--
-- No other boolean privilege column exists on profiles today (checked
-- via information_schema against the live production schema) --
-- checkride_prep_unlocked was already protected in v16.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v120.

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
    new.private_pilot_ground_school_pack_unlocked := old.private_pilot_ground_school_pack_unlocked;
    new.mock_oral_instructor := old.mock_oral_instructor;
  end if;
  return new;
end;
$$;
