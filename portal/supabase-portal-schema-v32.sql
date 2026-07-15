-- Apex Advantage Member Portal — AI DPE Practice sessions (v32)
--
-- Backs the new "AI DPE Practice" feature: a text-based simulated oral
-- exam, gated behind checkride_prep_unlocked exactly like the DPE
-- Questions Library and Scenario Training Center — no separate purchase,
-- included with the existing Checkride Prep Pack unlock. All reads and
-- writes go through the dpe-chat Edge Function (service role); the RLS
-- below only needs to let a student read their own session history and
-- admins read everyone's (there is no client-side insert/update policy
-- because the Edge Function is the only writer).
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v31.sql.

create table public.ai_dpe_sessions (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  status             text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  transcript         jsonb not null default '[]'::jsonb,
  questions_asked    integer not null default 0,
  debrief            jsonb,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz
);

alter table public.ai_dpe_sessions enable row level security;

create policy "Students can view their own AI DPE sessions"
  on public.ai_dpe_sessions for select
  using (auth.uid() = profile_id);

create policy "Admins can view all AI DPE sessions"
  on public.ai_dpe_sessions for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create index ai_dpe_sessions_profile_id_idx on public.ai_dpe_sessions (profile_id);
