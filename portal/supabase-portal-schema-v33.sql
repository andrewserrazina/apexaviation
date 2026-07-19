-- Apex Advantage Member Portal — Admin broadcasts / ad-hoc student emails (v33)
--
-- Backs the new "Broadcast" page and the per-student "Email" action on
-- the Students page: lets an admin send an ad-hoc email to one student
-- or a filtered group of students, and keeps a history of what was sent
-- to whom, so it's visible which students have already been contacted
-- and duplicate outreach can be avoided. Writes happen directly from
-- the portal client (an already-authenticated admin session), same as
-- announcements/payroll_adjustments elsewhere in this schema — there is
-- no server-side function for this, since the actual email delivery
-- goes through the existing generic send-email Edge Function.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v32.sql.

create table public.admin_broadcasts (
  id                uuid primary key default gen_random_uuid(),
  sent_by           uuid references public.profiles(id) on delete set null,
  subject           text not null,
  body              text not null,
  recipient_count   integer not null default 0,
  created_at        timestamptz not null default now()
);

create table public.admin_broadcast_recipients (
  id             uuid primary key default gen_random_uuid(),
  broadcast_id   uuid not null references public.admin_broadcasts(id) on delete cascade,
  profile_id     uuid references public.profiles(id) on delete set null,
  email          text not null,
  created_at     timestamptz not null default now()
);

alter table public.admin_broadcasts enable row level security;

create policy "Admins manage broadcasts"
  on public.admin_broadcasts for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

alter table public.admin_broadcast_recipients enable row level security;

create policy "Admins manage broadcast recipients"
  on public.admin_broadcast_recipients for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create index admin_broadcast_recipients_broadcast_id_idx on public.admin_broadcast_recipients (broadcast_id);
create index admin_broadcast_recipients_profile_id_idx on public.admin_broadcast_recipients (profile_id);
