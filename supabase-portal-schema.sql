-- Apex Advantage Member Portal — engagement schema
--
-- Run this in the Supabase SQL editor for the SAME project used by the
-- apexadvantage app (profiles, auth.users, etc. already exist there).
-- Depends on public.profiles from apexadvantage/supabase-schema.sql.
--
-- Adds: per-question / per-scenario / per-lesson progress (with viewed,
-- answered, completed, favorited tracking), daily study activity (for
-- streaks + study time), Checkride Mode / Rapid Fire practice attempts,
-- and achievements. Every table follows the same RLS pattern already
-- used by apexadvantage: a student can only read/write their own rows,
-- and profiles.role = 'admin' can read everything (for the Admin
-- Analytics dashboard).

-- ─────────────────────────────────────────────────────────────────
-- 1. Per-question progress — DPE Questions Library + Question of the Day
-- ─────────────────────────────────────────────────────────────────
create table public.portal_question_progress (
  profile_id      uuid references public.profiles(id) on delete cascade,
  question_id     text not null,
  viewed_count    integer not null default 0,
  answered_count  integer not null default 0,
  completed       boolean not null default false,
  favorited       boolean not null default false,
  first_viewed_at timestamptz,
  last_viewed_at  timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (profile_id, question_id)
);

alter table public.portal_question_progress enable row level security;

create policy "Users manage their own question progress"
  on public.portal_question_progress for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all question progress"
  on public.portal_question_progress for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 2. Per-scenario progress — Scenario Training Center
-- ─────────────────────────────────────────────────────────────────
create table public.portal_scenario_progress (
  profile_id     uuid references public.profiles(id) on delete cascade,
  scenario_id    text not null,
  viewed_count   integer not null default 0,
  completed      boolean not null default false,
  favorited      boolean not null default false,
  last_viewed_at timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (profile_id, scenario_id)
);

alter table public.portal_scenario_progress enable row level security;

create policy "Users manage their own scenario progress"
  on public.portal_scenario_progress for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all scenario progress"
  on public.portal_scenario_progress for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 3. Per-lesson completion — Checkride Prep Pack lessons
-- ─────────────────────────────────────────────────────────────────
create table public.portal_lesson_progress (
  profile_id     uuid references public.profiles(id) on delete cascade,
  lesson_id      text not null,
  completed      boolean not null default false,
  last_viewed_at timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (profile_id, lesson_id)
);

alter table public.portal_lesson_progress enable row level security;

create policy "Users manage their own lesson progress"
  on public.portal_lesson_progress for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all lesson progress"
  on public.portal_lesson_progress for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 4. Daily study activity — powers Study Streaks + Study Time
-- One row per profile per calendar date that had any study activity.
-- ─────────────────────────────────────────────────────────────────
create table public.portal_study_activity (
  profile_id    uuid references public.profiles(id) on delete cascade,
  activity_date date not null,
  seconds       integer not null default 0,
  primary key (profile_id, activity_date)
);

alter table public.portal_study_activity enable row level security;

create policy "Users manage their own study activity"
  on public.portal_study_activity for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all study activity"
  on public.portal_study_activity for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 5. Practice attempts — Checkride Mode (20 Q) + DPE Rapid Fire (5 min)
-- ─────────────────────────────────────────────────────────────────
create table public.portal_practice_attempts (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete cascade,
  mode         text not null check (mode in ('checkride', 'rapidfire')),
  question_ids jsonb not null default '[]',
  score        integer not null default 0,
  total        integer not null default 0,
  started_at   timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.portal_practice_attempts enable row level security;

create policy "Users manage their own practice attempts"
  on public.portal_practice_attempts for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all practice attempts"
  on public.portal_practice_attempts for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 6. Achievements
-- ─────────────────────────────────────────────────────────────────
create table public.portal_achievements (
  profile_id      uuid references public.profiles(id) on delete cascade,
  achievement_key text not null,
  earned_at       timestamptz not null default now(),
  primary key (profile_id, achievement_key)
);

alter table public.portal_achievements enable row level security;

create policy "Users manage their own achievements"
  on public.portal_achievements for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all achievements"
  on public.portal_achievements for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
