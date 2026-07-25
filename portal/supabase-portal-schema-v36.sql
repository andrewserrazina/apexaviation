-- Apex Advantage Member Portal — fix remaining profile-delete blockers (v36)
--
-- Same bug class v34 already fixed for logbook_entries.instructor_id and
-- lessons.instructor_id: these five columns were each defined referencing
-- profiles(id) with no "on delete" clause at all, so deleting a user (from
-- the Supabase dashboard's Auth > Users page, or the admin API) cascades
-- auth.users -> profiles, then hits one of these un-set (blocking, RESTRICT
-- by default) constraints and aborts the whole delete with a generic
-- "Database error deleting user" / empty error object in the dashboard --
-- exactly what surfaced when trying to delete novagraphicdesignus@gmail.com.
--
-- All five get "on delete set null" rather than cascade: each of these
-- tables is a payment, registration, payroll, or referral *record* that
-- should survive the referenced profile's deletion for accounting/audit
-- purposes -- only the dangling reference should go, not the row itself.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v35.sql.

alter table public.portal_access_purchases drop constraint if exists portal_access_purchases_profile_id_fkey;
alter table public.portal_access_purchases
  add constraint portal_access_purchases_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;

alter table public.ground_registrations drop constraint if exists ground_registrations_profile_id_fkey;
alter table public.ground_registrations
  add constraint ground_registrations_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;

alter table public.payroll_adjustments drop constraint if exists payroll_adjustments_created_by_fkey;
alter table public.payroll_adjustments
  add constraint payroll_adjustments_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.checkout_session_attempts drop constraint if exists checkout_session_attempts_profile_id_fkey;
alter table public.checkout_session_attempts
  add constraint checkout_session_attempts_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;

alter table public.portal_referrals drop constraint if exists portal_referrals_referred_profile_id_fkey;
alter table public.portal_referrals
  add constraint portal_referrals_referred_profile_id_fkey
  foreign key (referred_profile_id) references public.profiles(id) on delete set null;
