-- Apex Advantage — Guided Notes (admin-only feature preview)
--
-- Backs the new "Guided Notes" test page in the member portal, gated to
-- role = 'admin' only while the feature is being built out. Initial
-- content is Private Pilot Module 3 (Aircraft Systems), per the Apex
-- Advantage Content Architecture doc's PPL-M03 module ID convention.
--
-- Uses profile_id (not user_id) to match every other per-member table in
-- this schema (portal_checkride_date, portal_referral_codes,
-- portal_study_activity, etc. all key off profiles(id) as profile_id).
--
-- The admin gate lives here, in the RLS policy itself, not just in the
-- client UI -- this is the real security boundary, same pattern as
-- get-premium-content's requirePremiumAccess() check. A signed-in
-- student who called the Supabase client directly would still get
-- rejected at the database layer.
--
-- To open Guided Notes to every student once the feature is ready,
-- replace this single policy with the plain "manage their own rows"
-- version (drop the "and exists(...role = 'admin')" clause) -- no
-- other schema or application code changes are needed, since every
-- query already scopes by the caller's own profile_id plus the
-- specific course/module/section/prompt.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v13.

create table public.guided_notes (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  course_id      text not null,
  module_id      text not null,
  section_id     text not null,
  prompt_id      text not null,
  response_text  text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (profile_id, course_id, module_id, section_id, prompt_id)
);

alter table public.guided_notes enable row level security;

create policy "Admins manage their own guided notes (feature-gated)"
  on public.guided_notes for all
  using (
    auth.uid() = profile_id
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    auth.uid() = profile_id
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create index guided_notes_profile_module_idx
  on public.guided_notes (profile_id, course_id, module_id);
