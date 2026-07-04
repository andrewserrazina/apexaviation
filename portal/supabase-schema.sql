-- Run this in your Supabase SQL editor to set up the database

-- Profiles (extends Supabase auth.users)
create table public.profiles (
  id            uuid references auth.users(id) on delete cascade primary key,
  full_name     text,
  email         text,
  role          text not null default 'student' check (role in ('admin', 'instructor', 'student')),
  certificate_status text,
  medical_expiry     date,
  created_at    timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Admins can update profiles"
  on public.profiles for update
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Logbook entries
create table public.logbook_entries (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid references public.profiles(id) on delete cascade,
  instructor_id  uuid references public.profiles(id),
  date           date not null,
  aircraft_id    text,
  route          text,
  duration_hours numeric(5,1) not null,
  notes          text,
  created_at     timestamptz default now()
);

alter table public.logbook_entries enable row level security;

create policy "Students see own entries; admins see all"
  on public.logbook_entries for select
  using (
    auth.uid() = student_id
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','instructor'))
  );

create policy "Admins and instructors can insert entries"
  on public.logbook_entries for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','instructor'))
  );

-- Lessons (schedule)
create table public.lessons (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid references public.profiles(id) on delete cascade,
  instructor_id  uuid references public.profiles(id),
  aircraft_id    text,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  lesson_type    text,
  notes          text,
  created_at     timestamptz default now()
);

alter table public.lessons enable row level security;

create policy "Students see own lessons; admins/instructors see all"
  on public.lessons for select
  using (
    auth.uid() = student_id
    or auth.uid() = instructor_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can manage lessons"
  on public.lessons for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Invoices
create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid references public.profiles(id) on delete cascade,
  description  text,
  amount_cents integer not null,
  status       text not null default 'unpaid' check (status in ('unpaid','paid','pending')),
  issued_at    timestamptz default now()
);

alter table public.invoices enable row level security;

create policy "Students see own invoices; admins see all"
  on public.invoices for select
  using (
    auth.uid() = student_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can manage invoices"
  on public.invoices for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
