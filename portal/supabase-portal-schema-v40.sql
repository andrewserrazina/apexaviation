-- Apex Advantage — Nonbuyer follow-up: feedback + admin notes (v40)
--
-- Backs the new "Nonbuyers" admin view (portal/src/pages/Nonbuyers.jsx),
-- which surfaces the registered-but-unpurchased members (role='student',
-- checkride_prep_unlocked=false) alongside their checkride timing, last
-- activity, lessons completed, checkout attempts, and most recent
-- lifecycle email -- all of which already exist in profiles,
-- portal_question_progress, checkout_session_attempts, and
-- portal_email_log. The one thing that didn't exist anywhere: a place
-- to record WHY a given member hasn't bought, and free-text notes.
--
-- One row per profile (not a log) -- an admin's read on why someone
-- hasn't purchased is a current snapshot they update over time, not a
-- history of every answer ever given. feedback_category mirrors the
-- fixed answer set for "What stopped you from purchasing the Checkride
-- Prep System?" -- deliberately not used to automatically discount or
-- gate anything; it's for admin visibility only.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v39.

create table public.member_feedback (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  feedback_category text check (feedback_category in (
    'price', 'checkride_not_soon', 'unclear_what_included', 'wanted_to_see_more',
    'prefer_free_resources', 'not_ready_to_trust', 'checkout_technical_problem', 'other'
  )),
  notes      text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.member_feedback enable row level security;

create policy "Admins can view member feedback"
  on public.member_feedback for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Admins can insert member feedback"
  on public.member_feedback for insert
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Admins can update member feedback"
  on public.member_feedback for update
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
