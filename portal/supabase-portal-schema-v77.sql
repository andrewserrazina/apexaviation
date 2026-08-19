-- GS -> Portal Growth Funnel, section 19 -- admin metrics need to know
-- when claim_ground_school_enrollments_by_email() (v76.sql) actually
-- linked a purchase to a brand-new signup, not just that it ran. It
-- previously returned void, so create-free-account had no way to log
-- "this signup was a GS purchaser activating" as a distinct, countable
-- event. Returns the number of enrollments claimed instead -- 0 means
-- "ran fine, nothing to claim" (the common case), which is exactly the
-- caller-observable signal needed.
drop function if exists public.claim_ground_school_enrollments_by_email(uuid, text);

create or replace function public.claim_ground_school_enrollments_by_email(
  p_profile_id uuid,
  p_email text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed integer;
begin
  if p_email is null or p_email = '' then
    return 0;
  end if;

  update public.scheduled_ground_class_enrollments
  set profile_id = p_profile_id
  where profile_id is null
    and lower(email) = lower(p_email)
    and payment_status in ('paid', 'ground_school_pack');

  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

grant execute on function public.claim_ground_school_enrollments_by_email(uuid, text) to service_role;
