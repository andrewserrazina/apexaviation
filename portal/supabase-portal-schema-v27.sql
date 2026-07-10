-- Apex Advantage — Roster/attendance management for the Class Scheduler (v27)
--
-- scheduled_ground_class_enrollments already has attendance_status
-- (registered/attended/no_show/canceled) from v17 -- nothing in the app
-- ever read or wrote it. Admins can already update it directly via the
-- existing "Admins manage scheduled ground class enrollments" RLS
-- policy, so no new column or policy is needed for attendance.
--
-- Canceling an enrollment is the one operation that needs to be atomic
-- across two tables (mark the enrollment canceled AND free the seat on
-- scheduled_ground_classes.enrolled_count), so it gets its own
-- function, mirroring confirm_scheduled_ground_class_enrollment's
-- locking pattern from v17. This system has no waitlist (unlike the
-- legacy ground_registrations path), so canceling here just frees
-- capacity -- it does not promote anyone.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v26.

create or replace function public.cancel_scheduled_ground_class_enrollment(p_enrollment_id uuid)
returns public.scheduled_ground_class_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.scheduled_ground_class_enrollments%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  select * into v_enrollment
  from public.scheduled_ground_class_enrollments
  where id = p_enrollment_id
  for update;

  if not found then
    raise exception 'Enrollment not found.';
  end if;

  if v_enrollment.payment_status = 'canceled' then
    return v_enrollment;
  end if;

  update public.scheduled_ground_class_enrollments
  set payment_status = 'canceled', attendance_status = 'canceled', updated_at = now()
  where id = p_enrollment_id
  returning * into v_enrollment;

  update public.scheduled_ground_classes
  set enrolled_count = greatest(enrolled_count - 1, 0)
  where id = v_enrollment.scheduled_ground_class_id;

  return v_enrollment;
end;
$$;

grant execute on function public.cancel_scheduled_ground_class_enrollment(uuid) to authenticated;
