-- Apex Advantage — Curriculum Knowledge Check Attempts (v18)
--
-- Stores student attempts for curriculum module knowledge checks. The first
-- runtime uses existing approved DPE question content as the question source;
-- this table records attempts/results without creating new aviation content.

create table public.curriculum_quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  course_id     text not null default 'PPL',
  module_id     text not null,
  quiz_key      text not null,
  question_ids  text[] not null default '{}',
  answers       jsonb not null default '{}'::jsonb,
  score         integer not null check (score >= 0),
  total         integer not null check (total > 0),
  passed        boolean not null default false,
  submitted_at  timestamptz not null default now()
);

alter table public.curriculum_quiz_attempts enable row level security;

create policy "Members view their own curriculum quiz attempts"
  on public.curriculum_quiz_attempts for select
  using (auth.role() = 'authenticated' and profile_id = auth.uid());

create policy "Members create their own curriculum quiz attempts"
  on public.curriculum_quiz_attempts for insert
  with check (auth.role() = 'authenticated' and profile_id = auth.uid());

create policy "Admins view curriculum quiz attempts"
  on public.curriculum_quiz_attempts for select
  using (public.is_admin(auth.uid()));

create index curriculum_quiz_attempts_profile_module_idx
  on public.curriculum_quiz_attempts (profile_id, module_id, submitted_at desc);
