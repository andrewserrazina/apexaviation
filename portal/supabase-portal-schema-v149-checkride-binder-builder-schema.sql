-- V149: Checkride Binder Builder -- schema (Phase 1 of 4).
--
-- New portal feature: a digital, checkbox-driven version of the "Apex
-- Advantage Private Pilot Checkride Binder Builder" workbook (20
-- sections across 5 parts -- Applicant, Aircraft, Flight, Oral, Final
-- Readiness), bundled into the existing Checkride Prep ($29) unlock --
-- no new product, no new checkout flow, no new entitlement flag.
--
-- Three tables, each modeled directly on an existing, proven precedent
-- rather than a new pattern:
--
--   1. checkride_binder_content -- the authored reference text (section
--      labels, checklist-item prompts, tips, FAA source citations),
--      transcribed from the source PDF in a later seed migration. Same
--      shape and same admin-only-at-rest RLS as module_companion_content
--      (supabase-portal-schema-v88.sql) -- this text IS the paid content,
--      so it is reachable only through the get-checkride-binder-content
--      Edge Function, which verifies checkride_prep_unlocked server-side
--      before returning anything. No client SELECT grant exists at all;
--      RLS's only policy is admin-manage, matching v88's module_
--      companion_content exactly.
--
--   2. checkride_binder_responses -- one row per checklist field the
--      student fills in (plain checkbox, or one half of a dual-state
--      "Found"/"Verified" pair as two independent prompt_ids, or a
--      free-text field). Exactly guided_notes' (supabase-portal-schema-
--      v14.sql, opened to real students in v88) proven shape and RLS:
--      own-row upsert via a (profile_id, section_id, prompt_id) unique
--      key, response_text reused as a plain sentinel ('checked'/''), a
--      fixed-vocabulary value, or real free text depending on the field.
--      Relies on Supabase's default per-table grants to `authenticated`
--      (guided_notes/portal_study_activity/portal_question_progress all
--      rely on the same default -- see v143/v148's history for why that
--      default must never be blanket-revoked without checking every real
--      client call site first).
--
--   3. checkride_binder_tracker_entries -- the four sections with
--      student-added/removed repeatable rows (endorsement tracker,
--      knowledge-deficiency review, 10-question oral log, weak-area
--      plan). No existing precedent in this codebase for a student-
--      editable repeatable-row UI, so this is new -- but keeps the same
--      relational-per-row philosophy as every other table here (one row
--      = one entry, own-row RLS, cheap to add/delete/reorder), using
--      jsonb only for each entry's own sub-fields (which vary by
--      section), consistent with how analytics_events.properties and
--      module_companion_content.content already use jsonb for a
--      sub-object whose shape varies by type.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v148.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. checkride_binder_content
-- ═══════════════════════════════════════════════════════════════════════

create table public.checkride_binder_content (
  section_id  text primary key,
  content     jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.checkride_binder_content enable row level security;

create policy "Admins can manage checkride binder content"
  on public.checkride_binder_content for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. checkride_binder_responses
-- ═══════════════════════════════════════════════════════════════════════

create table public.checkride_binder_responses (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  section_id     text not null,
  prompt_id      text not null,
  response_text  text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (profile_id, section_id, prompt_id)
);

alter table public.checkride_binder_responses enable row level security;

create policy "Users manage their own checkride binder responses"
  on public.checkride_binder_responses for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create index checkride_binder_responses_profile_section_idx
  on public.checkride_binder_responses (profile_id, section_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. checkride_binder_tracker_entries
-- ═══════════════════════════════════════════════════════════════════════

create table public.checkride_binder_tracker_entries (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  section_id  text not null,
  sort_order  integer not null default 0,
  fields      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.checkride_binder_tracker_entries enable row level security;

create policy "Users manage their own checkride binder tracker entries"
  on public.checkride_binder_tracker_entries for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create index checkride_binder_tracker_entries_profile_section_idx
  on public.checkride_binder_tracker_entries (profile_id, section_id, sort_order);
