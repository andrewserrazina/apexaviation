-- Apex Aviation Operations — Ground School class time tracking for payroll (v60)
--
-- Instructors click "Start Class" / "Finish Class" on the class they're
-- assigned to teach; the actual start/end timestamps get recorded so
-- payroll reflects classes that were genuinely taught (and for the
-- expected duration), not just classes that were scheduled. This is
-- also the first real use of scheduled_ground_classes.status =
-- 'completed' -- that value existed in the check constraint since v15
-- but nothing ever set it; finishing a class now does.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v59.

alter table public.scheduled_ground_classes
  add column if not exists actual_start_time timestamptz,
  add column if not exists actual_end_time timestamptz;

-- $50/class default going forward, and backfilled for existing
-- instructors who never had a rate set -- never overwrites an
-- already-set custom rate (see the Payroll page's existing per-instructor
-- "Rates" editor, supabase-portal-schema-v26.sql).
alter table public.profiles alter column ground_school_rate set default 50;

update public.profiles
set ground_school_rate = 50
where role = 'instructor' and ground_school_rate is null;

-- ─────────────────────────────────────────────────────────────────
-- Starts the clock on a class. Caller must be an admin or the instructor
-- actually assigned to it -- never trusts a client-supplied instructor
-- id. Blocks starting a class twice (the UI hides the button once
-- actual_start_time is set, but this is the real boundary).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.start_scheduled_ground_class(p_class_id uuid)
returns public.scheduled_ground_classes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.scheduled_ground_classes%rowtype;
begin
  select * into v_class from public.scheduled_ground_classes where id = p_class_id for update;
  if not found then
    raise exception 'Class not found.';
  end if;
  if v_class.instructor_id is distinct from auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Only the assigned instructor or an admin can start this class.';
  end if;
  if v_class.status <> 'published' then
    raise exception 'This class is not published.';
  end if;
  if v_class.actual_start_time is not null then
    raise exception 'This class has already been started.';
  end if;

  update public.scheduled_ground_classes
  set actual_start_time = now(), updated_at = now()
  where id = p_class_id
  returning * into v_class;

  return v_class;
end;
$$;

grant execute on function public.start_scheduled_ground_class(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- Ends the clock and marks the class completed -- the first real writer
-- of status = 'completed' (existed in the check constraint since v15,
-- never previously set by anything).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.finish_scheduled_ground_class(p_class_id uuid)
returns public.scheduled_ground_classes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.scheduled_ground_classes%rowtype;
begin
  select * into v_class from public.scheduled_ground_classes where id = p_class_id for update;
  if not found then
    raise exception 'Class not found.';
  end if;
  if v_class.instructor_id is distinct from auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Only the assigned instructor or an admin can finish this class.';
  end if;
  if v_class.actual_start_time is null then
    raise exception 'This class has not been started yet.';
  end if;
  if v_class.actual_end_time is not null then
    raise exception 'This class has already been finished.';
  end if;

  update public.scheduled_ground_classes
  set actual_end_time = now(), status = 'completed', updated_at = now()
  where id = p_class_id
  returning * into v_class;

  return v_class;
end;
$$;

grant execute on function public.finish_scheduled_ground_class(uuid) to authenticated;
