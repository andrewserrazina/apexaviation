-- Apex Advantage — Apex Operations scheduling foundation (v22)
-- Adds internal Operations events with RLS for admins/instructors only.

create or replace function public.is_operations_staff(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_uid
      and role in ('admin', 'instructor')
  )
$$;

create table if not exists public.operations_events (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null check (event_type in ('flight', 'simulator', 'ground', 'availability', 'maintenance', 'other')),
  title         text not null,
  event_date    date not null,
  start_time    time not null,
  end_time      time not null,
  resource_name text,
  instructor_id uuid references public.profiles(id) on delete set null,
  student_id    uuid references public.profiles(id) on delete set null,
  status        text not null default 'scheduled' check (status in ('scheduled', 'completed', 'canceled')),
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_time > start_time)
);

alter table public.operations_events enable row level security;

drop policy if exists "Operations staff can view operations events" on public.operations_events;
create policy "Operations staff can view operations events"
  on public.operations_events for select
  using (public.is_operations_staff(auth.uid()));

drop policy if exists "Operations staff can create operations events" on public.operations_events;
create policy "Operations staff can create operations events"
  on public.operations_events for insert
  with check (public.is_operations_staff(auth.uid()));

drop policy if exists "Operations staff can update operations events" on public.operations_events;
create policy "Operations staff can update operations events"
  on public.operations_events for update
  using (public.is_operations_staff(auth.uid()))
  with check (public.is_operations_staff(auth.uid()));

create index if not exists operations_events_date_idx
  on public.operations_events (event_date, start_time);

create index if not exists operations_events_instructor_idx
  on public.operations_events (instructor_id, event_date);
