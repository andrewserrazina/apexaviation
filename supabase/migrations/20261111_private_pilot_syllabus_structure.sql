-- Private Pilot ASEL syllabus structure (Draft 0.3): stage/mode/plan-hours on
-- syllabus_lessons, syllabus_lesson_id tags on logbook_entries + lessons,
-- plus new per-student progress, remediation, and FAA §61.109(a) experience
-- audit tables. Additive only. Applied live via mcp__Supabase__apply_migration
-- on 2026-11-11 (migrations: private_pilot_syllabus_structure_v2, then
-- syllabus_lessons_duration_hours_precision_fix to widen duration_hours from
-- numeric(4,1) to numeric(5,2) so the exact 0.75-hour G01 ground lesson no
-- longer rounds to 0.8 and the stage/grand totals reconcile exactly to the
-- source syllabus's 61.5 flight / 38.25 ground / 99.75 combined hours).

-- ───────────────────────── syllabus_lessons ─────────────────────────
alter table public.syllabus_lessons
  add column if not exists lesson_code text,
  add column if not exists stage smallint,
  add column if not exists mode text,
  add column if not exists plan_flight_hours numeric,
  add column if not exists plan_ground_hours numeric;

alter table public.syllabus_lessons alter column duration_hours type numeric(5,2);

update public.syllabus_lessons as sl set
  lesson_code = v.lesson_code, stage = v.stage, mode = v.mode,
  plan_flight_hours = v.plan_flight, plan_ground_hours = v.plan_ground,
  duration_hours = v.plan_flight + v.plan_ground
from (values
  ('a091c33f-bf51-43b5-b630-9dec03d35286'::uuid, 'F01', 1, 'Dual', 1.0, 0.5),
  ('43bbda0a-43ea-434c-b8bd-53dccaa151ca'::uuid, 'F02', 1, 'Dual', 1.5, 0.5),
  ('84312602-383f-4ed8-8417-d47571893e4c'::uuid, 'F03', 1, 'Dual', 1.5, 0.5),
  ('c827b832-d4dd-40a1-85fe-556a782e4058'::uuid, 'F04', 1, 'Dual', 1.5, 0.5),
  ('d7c3dc5e-e744-4835-9473-5a7636f162e1'::uuid, 'F05', 1, 'Dual', 1.5, 0.5),
  ('a644b97f-dacf-437b-a384-4807e559033f'::uuid, 'F06', 1, 'Dual', 3.0, 1.0),
  ('8ac0e1df-fe24-4a12-a76e-4b428c326f87'::uuid, 'F07', 1, 'Dual', 3.0, 1.0),
  ('952a94cf-d2f6-42be-8e86-91eff76d0a53'::uuid, 'F08', 1, 'Dual', 4.0, 1.5),
  ('c855e21d-c672-4463-9de3-c2db60492929'::uuid, 'F09', 1, 'Dual', 2.0, 1.0),
  ('f8506330-2a0f-41bc-b075-b6a41c6411dd'::uuid, 'F10', 1, 'Dual', 1.5, 0.5),
  ('6ac46370-5f90-4854-9c4e-3ebc3f9ece9d'::uuid, 'F11', 1, 'Dual', 1.0, 0.5),
  ('f756da8a-84a7-4697-aef5-ba26d9d9b3dd'::uuid, 'F12', 1, 'Dual', 1.5, 1.0),
  ('1693c205-7dd8-4c93-9dd5-55650972aa25'::uuid, 'F13', 2, 'Dual / Solo', 1.0, 0.5),
  ('f6b6401c-5bda-4b73-b807-1042c843851d'::uuid, 'F14', 2, 'Solo', 1.5, 0.5),
  ('2745c922-6f27-4e58-ace4-4358cd5b123f'::uuid, 'F15', 2, 'Dual', 2.0, 1.0),
  ('11cf13a9-2158-422a-ab20-993fb9b30e56'::uuid, 'F16', 2, 'Dual', 1.5, 0.5),
  ('abf80383-4249-4dfc-a316-74b7fbd06de4'::uuid, 'F17', 2, 'Dual', 1.5, 0.5),
  ('9b71980d-d31d-4159-89a6-37b1b790f199'::uuid, 'F18', 3, 'Dual', 2.0, 0.5),
  ('a883b094-e622-449e-b58d-bb71dfed15c0'::uuid, 'F19', 3, 'Dual', 2.0, 0.5),
  ('6370ed62-8e47-4234-9e03-689dbe18ec60'::uuid, 'F20', 3, 'Dual', 1.5, 0.5),
  ('8a6729fa-3fe4-4189-9767-3d5cbe24743b'::uuid, 'F21', 3, 'Dual', 1.5, 0.5),
  ('120f4d32-81e3-4868-8228-90fda20d4384'::uuid, 'F22', 3, 'Dual', 2.0, 0.5),
  ('b4db1bae-35a7-49c2-b58e-6f5d1d87abbc'::uuid, 'F23', 3, 'Dual', 1.5, 1.0),
  ('a23756e0-db68-4a66-b7cd-b09101134168'::uuid, 'F24', 3, 'Solo', 2.5, 0.5),
  ('df3ff058-eb9a-45dd-875f-22dc21098541'::uuid, 'F25', 3, 'Solo', 3.0, 0.5),
  ('3471eb10-1ff8-4975-a787-717ec0e9398a'::uuid, 'F26', 3, 'Solo', 1.5, 0.5),
  ('5ab73771-d3d0-410d-b3e7-f847de48f1c4'::uuid, 'F27', 3, 'Solo', 2.0, 1.0),
  ('39291c4d-aa0a-4644-9828-4c9a2da7de03'::uuid, 'F28', 3, 'Dual', 1.5, 0.5),
  ('792c6f6f-f500-4a0b-bc5f-595f352c3453'::uuid, 'F29', 4, 'Dual', 3.0, 1.0),
  ('c7bcf9ec-8227-4623-91b3-e66a9472561d'::uuid, 'F30', 4, 'Dual', 2.0, 2.0),
  ('0d558169-e372-42dc-b0e0-8594352ea33c'::uuid, 'F31', 4, 'Dual', 3.0, 1.0),
  ('274e5ad4-d49c-4dc8-a741-ace1500d4a6a'::uuid, 'F32', 4, 'Dual', 2.0, 1.0),
  ('5c8fb592-a25d-4993-b662-444eca974e29'::uuid, 'G01', 1, 'Ground', 0.0, 0.75),
  ('400864f8-04c0-4e78-9c57-4e815e8d886a'::uuid, 'G02', 1, 'Ground', 0.0, 1.5),
  ('b6520460-040c-44e7-a826-a7f2a0bba0e6'::uuid, 'G03', 1, 'Ground', 0.0, 1.5),
  ('279734b2-56cb-47a1-a676-fcbd5fac995d'::uuid, 'G04', 1, 'Ground', 0.0, 2.0),
  ('bd1aa44e-9063-4032-a55d-68c2e543fb70'::uuid, 'G05', 1, 'Ground', 0.0, 1.5),
  ('b10f16c1-a4ef-4c6b-8208-8e8f9f49c4c3'::uuid, 'G06', 3, 'Ground', 0.0, 2.0),
  ('d0a8dc8b-5590-4d86-b717-a5e89d58b27f'::uuid, 'G07', 3, 'Ground', 0.0, 1.0),
  ('c162ed2e-7b5c-4a97-aa72-07687ef304dc'::uuid, 'G08', 2, 'Ground', 0.0, 1.5),
  ('a92df8a4-ae2c-402f-bf5d-96f026533039'::uuid, 'G09', 3, 'Ground', 0.0, 1.0),
  ('e62515d6-44a0-42b6-a96c-b36e8d0673cc'::uuid, 'G10', 4, 'Ground', 0.0, 2.0)
) as v(id, lesson_code, stage, mode, plan_flight, plan_ground)
where sl.id = v.id;

create index if not exists idx_syllabus_lessons_code on public.syllabus_lessons(syllabus_id, lesson_code);

-- ───────────────────────── logbook_entries / lessons tagging ─────────────────────────
alter table public.logbook_entries
  add column if not exists syllabus_lesson_id uuid references public.syllabus_lessons(id);
create index if not exists idx_logbook_entries_syllabus_lesson on public.logbook_entries(syllabus_lesson_id);

alter table public.lessons
  add column if not exists syllabus_lesson_id uuid references public.syllabus_lessons(id);
create index if not exists idx_lessons_syllabus_lesson on public.lessons(syllabus_lesson_id);

-- ───────────────────────── syllabus_lesson_progress ─────────────────────────
create table if not exists public.syllabus_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  student_syllabus_id uuid not null references public.student_syllabi(id) on delete cascade,
  syllabus_lesson_id uuid not null references public.syllabus_lessons(id) on delete cascade,
  rating text not null default 'N' check (rating in ('N','A','P','R')),
  disposition text not null default 'Not Started' check (disposition in (
    'Not Started','In Progress','Repeat Required','Remediation Assigned','Complete','Revalidation Required'
  )),
  actual_ground numeric not null default 0,
  last_date date,
  instructor_id uuid references public.profiles(id),
  remediation_case_id uuid,
  notes text,
  updated_at timestamptz not null default now(),
  unique (student_syllabus_id, syllabus_lesson_id)
);

alter table public.syllabus_lesson_progress enable row level security;

create policy "Staff can manage lesson progress" on public.syllabus_lesson_progress
  for all using (public.is_staff()) with check (public.is_staff());

create policy "Students see own lesson progress" on public.syllabus_lesson_progress
  for select using (exists (
    select 1 from public.student_syllabi ss
    where ss.id = syllabus_lesson_progress.student_syllabus_id and ss.student_id = auth.uid()
  ));

-- ───────────────────────── remediation_cases ─────────────────────────
create table if not exists public.remediation_cases (
  id uuid primary key default gen_random_uuid(),
  student_syllabus_id uuid not null references public.student_syllabi(id) on delete cascade,
  syllabus_lesson_id uuid not null references public.syllabus_lessons(id),
  task text not null,
  identified_date date not null default current_date,
  evidence text,
  likely_cause text,
  corrective_ground text,
  corrective_flight text,
  recheck_standard text,
  failed_attempts int not null default 0,
  owner_instructor_id uuid references public.profiles(id),
  recheck_date date,
  status text not null default 'Open' check (status in ('Open','Scheduled','Closed')),
  result text,
  closed_date date,
  review_notes text,
  created_at timestamptz not null default now()
);

alter table public.remediation_cases enable row level security;

create policy "Staff can manage remediation cases" on public.remediation_cases
  for all using (public.is_staff()) with check (public.is_staff());

create policy "Students see own remediation cases" on public.remediation_cases
  for select using (exists (
    select 1 from public.student_syllabi ss
    where ss.id = remediation_cases.student_syllabus_id and ss.student_id = auth.uid()
  ));

alter table public.syllabus_lesson_progress
  add constraint syllabus_lesson_progress_remediation_case_id_fkey
  foreign key (remediation_case_id) references public.remediation_cases(id) on delete set null;

-- ───────────────────────── FAA §61.109(a) experience audit ─────────────────────────
create table if not exists public.faa_experience_requirements (
  id uuid primary key default gen_random_uuid(),
  requirement_key text not null unique,
  label text not null,
  minimum numeric not null,
  sort_order int not null default 0
);

alter table public.faa_experience_requirements enable row level security;

create policy "Authenticated users can view FAA experience requirements"
  on public.faa_experience_requirements for select using (auth.uid() is not null);

create policy "Admins can manage FAA experience requirements"
  on public.faa_experience_requirements for all using (public.is_admin()) with check (public.is_admin());

insert into public.faa_experience_requirements (requirement_key, label, minimum, sort_order) values
  ('total_flight', 'Total flight', 40, 1),
  ('dual_flight', 'Dual flight training', 20, 2),
  ('solo_flight', 'Solo flight', 10, 3),
  ('dual_xc', 'Dual cross-country', 3, 4),
  ('night_instruction', 'Night instruction', 3, 5),
  ('night_xc_100nm', 'Night cross-country over 100 NM', 1, 6),
  ('night_takeoffs', 'Night takeoffs', 10, 7),
  ('night_landings', 'Night full-stop landings', 10, 8),
  ('instrument_reference', 'Instrument-reference instruction', 3, 9),
  ('recent_test_prep', 'Recent practical test preparation', 3, 10),
  ('solo_xc', 'Solo cross-country', 5, 11),
  ('long_solo_xc', 'Long solo cross-country qualifying route', 1, 12),
  ('solo_towered_takeoffs', 'Solo towered takeoffs', 3, 13),
  ('solo_towered_landings', 'Solo towered full-stop landings', 3, 14)
on conflict (requirement_key) do nothing;

create table if not exists public.student_faa_experience_checks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  requirement_key text not null references public.faa_experience_requirements(requirement_key),
  verified boolean not null default false,
  verified_date date,
  instructor_id uuid references public.profiles(id),
  logbook_evidence text,
  notes text,
  manual_actual_override numeric,
  updated_at timestamptz not null default now(),
  unique (student_id, requirement_key)
);

alter table public.student_faa_experience_checks enable row level security;

create policy "Staff can manage FAA experience checks" on public.student_faa_experience_checks
  for all using (public.is_staff()) with check (public.is_staff());

create policy "Students see own FAA experience checks" on public.student_faa_experience_checks
  for select using (student_id = auth.uid());
