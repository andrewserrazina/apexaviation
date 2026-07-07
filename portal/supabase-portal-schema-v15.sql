-- Apex Advantage — Admin Scheduled Ground School Classes (v15)
--
-- Adds a structured, admin-managed live ground school scheduling table for
-- Private Pilot curriculum-backed classes. This is separate from the legacy
-- public ground_sessions registration workflow so admins can draft/publish
-- curriculum classes before exposing them to students.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v14.

create table public.scheduled_ground_classes (
  id               uuid primary key default gen_random_uuid(),
  course_id        text not null default 'PPL',
  lesson_id        text not null,
  lesson_title     text not null,
  module_id        text,
  module_title     text,
  title            text not null,
  description      text not null,
  class_date       date not null,
  start_time       time not null,
  end_time         time not null,
  timezone         text not null default 'America/Chicago',
  instructor_name  text,
  instructor_id    uuid references public.profiles(id) on delete set null,
  meeting_url      text,
  capacity         integer not null default 20 check (capacity > 0),
  enrolled_count   integer not null default 0 check (enrolled_count >= 0),
  status           text not null default 'draft' check (status in ('draft', 'published', 'canceled', 'completed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_time > start_time),
  check (
    status <> 'published'
    or (
      class_date is not null
      and start_time is not null
      and end_time is not null
      and nullif(trim(coalesce(instructor_name, '')), '') is not null
      and nullif(trim(coalesce(meeting_url, '')), '') is not null
    )
  )
);

alter table public.scheduled_ground_classes enable row level security;

create policy "Admins manage scheduled ground classes"
  on public.scheduled_ground_classes for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Students view published upcoming ground classes"
  on public.scheduled_ground_classes for select
  using (
    auth.role() = 'authenticated'
    and status = 'published'
    and class_date >= current_date
  );

create index scheduled_ground_classes_date_idx
  on public.scheduled_ground_classes (class_date, start_time);

create index scheduled_ground_classes_status_date_idx
  on public.scheduled_ground_classes (status, class_date, start_time);

create or replace function public.set_scheduled_ground_classes_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_scheduled_ground_classes_updated_at
  before update on public.scheduled_ground_classes
  for each row execute function public.set_scheduled_ground_classes_updated_at();
