-- Apex Advantage — Ask Andrew: AI Flight Instructor (v53)
--
-- Phase 5 of the habit-layer expansion. Extends rather than duplicates the
-- existing AI DPE Practice feature (dpe-chat / ai_dpe_sessions,
-- supabase-portal-schema-v32.sql) -- that is a bounded, structured oral-exam
-- simulation gated by Checkride Prep. This is a different product: an
-- open-ended, ongoing aviation Q&A companion, gated by an active Apex
-- Advantage Membership (the 'ask_andrew' capability defined in
-- get_member_capabilities(), supabase-portal-schema-v51.sql), one
-- continuous thread per member rather than discrete sessions.
--
-- IMPORTANT — this is an AI assistant, not the real Andrew. The system
-- prompt (portal/supabase/functions/ai-cfi-chat/index.ts) explicitly
-- instructs the model to identify itself as an AI, modeled on Andrew's
-- teaching approach, and never claim to literally be him -- see that
-- file's comments for the reasoning. This migration only concerns the
-- storage layer.
--
-- No client-writable path, same pattern as ai_dpe_sessions: only the
-- ai-cfi-chat Edge Function (service role) inserts messages. Members can
-- read their own history directly for fast page loads.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v52.

create table public.ai_cfi_messages (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index ai_cfi_messages_profile_id_created_at_idx on public.ai_cfi_messages (profile_id, created_at);

alter table public.ai_cfi_messages enable row level security;

create policy "Members can view their own Ask Andrew history"
  on public.ai_cfi_messages for select
  using (auth.uid() = profile_id);

create policy "Admins can view all Ask Andrew history"
  on public.ai_cfi_messages for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
