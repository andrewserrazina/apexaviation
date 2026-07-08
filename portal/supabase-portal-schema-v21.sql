-- Apex Advantage — ground school instructor assignment (v21)
-- Adds instructor assignment support to legacy ground school sessions so
-- admins can schedule a class and associate it with an instructor profile.

alter table public.ground_sessions
  add column if not exists instructor_id uuid references public.profiles(id) on delete set null;

create index if not exists ground_sessions_instructor_id_idx
  on public.ground_sessions (instructor_id, scheduled_at);
