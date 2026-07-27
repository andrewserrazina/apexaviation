-- Apex Advantage — Free Checkride Readiness Assessment leads (v41)
--
-- Backs site/readiness-assessment.html, a public (no login required)
-- 8-question knowledge quiz + checkride timing + email capture. This is
-- deliberately a separate, lightweight table rather than creating a real
-- auth.users/profiles row for every quiz-taker -- most visitors won't
-- convert immediately, and the whole point of a low-friction lead magnet
-- is not forcing full account creation just to see a quiz result.
--
-- If someone later signs up for real (the assessment's own CTA links to
-- portal-login.html?view=signup&dest=checkride-prep&email=...&timing=...,
-- prefilling both), that's a normal, independent account -- this table is
-- not automatically linked/merged into profiles. Matching by email later
-- (e.g. surfacing "came from the readiness assessment, scored X%" on the
-- admin Nonbuyers view) is a reasonable follow-up, not built here.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v40.

create table public.readiness_assessment_leads (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  full_name         text,
  checkride_timing  text check (checkride_timing in (
    'within_14_days', 'within_30_days', 'within_60_days', 'more_than_60_days', 'not_scheduled'
  )),
  score             integer not null check (score >= 0 and score <= 100),
  readiness_level   text not null,
  category_results  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index readiness_assessment_leads_email_idx on public.readiness_assessment_leads (email);

alter table public.readiness_assessment_leads enable row level security;

create policy "Anyone can submit a readiness assessment"
  on public.readiness_assessment_leads for insert
  with check (true);

create policy "Admins can view readiness assessment leads"
  on public.readiness_assessment_leads for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
