-- v23 — Launch reliability helpers for Checkride Prep unlock reconciliation.
-- Keeps the privileged profile flag update server-side while allowing a
-- member with a recorded purchase to repair their own access.

create or replace function public.reconcile_own_checkride_prep_access()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  has_purchase boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select exists (
    select 1
    from public.portal_access_purchases p
    where p.profile_id = auth.uid()
  ) into has_purchase;

  if has_purchase then
    update public.profiles
       set checkride_prep_unlocked = true
     where id = auth.uid()
       and checkride_prep_unlocked is distinct from true;
  end if;

  return has_purchase;
end;
$$;

grant execute on function public.reconcile_own_checkride_prep_access() to authenticated;

create or replace function public.admin_unlock_checkride_prep(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  update public.profiles
     set checkride_prep_unlocked = true
   where id = p_profile_id;
end;
$$;

grant execute on function public.admin_unlock_checkride_prep(uuid) to authenticated;
