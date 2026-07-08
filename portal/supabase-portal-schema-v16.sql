-- Apex Advantage — Checkride Prep unlock trigger repair (v16)
--
-- Fixes a production payment edge case introduced by the profile column-lock
-- trigger in v8: Stripe Edge Functions write with the service-role key, but
-- auth.uid() is not an admin profile inside the trigger, so the trigger could
-- silently revert profiles.checkride_prep_unlocked back to its old value while
-- the webhook still inserted portal_access_purchases. Result: Stripe payment
-- and admin revenue showed correctly, but the member dashboard stayed locked.
--
-- Run this in the Supabase SQL editor after v15. It also backfills any member
-- who has a successful portal_access_purchases row but still has the unlock
-- flag set to false.

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
  end if;
  return new;
end;
$$;

alter table public.profiles disable trigger trg_lock_profile_privileged_columns;

update public.profiles p
set checkride_prep_unlocked = true
where p.checkride_prep_unlocked = false
  and exists (
    select 1
    from public.portal_access_purchases pap
    where pap.profile_id = p.id
  );

alter table public.profiles enable trigger trg_lock_profile_privileged_columns;
