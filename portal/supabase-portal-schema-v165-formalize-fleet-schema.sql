-- v165: formalizes the fleet-maintenance schema (aircraft, squawks,
-- maintenance_records) into version control. These three tables and
-- their RLS policies already exist in production -- they were created
-- directly in the Supabase dashboard while building Aircraft.jsx and,
-- unlike the rest of the schema, were never captured in a migration
-- file (same gap already flagged in v35's comments for
-- ground_sessions/ground_registrations). Written entirely from the
-- live schema (information_schema.columns + pg_policies) as part of
-- the portal operations overhaul, so the Fleet module's backing tables
-- are finally tracked. Every statement below is additive/idempotent
-- (IF NOT EXISTS, or drop-then-recreate an identical policy) -- this
-- changes no columns, no data, and no access rules.

create table if not exists public.aircraft (
  id uuid primary key default gen_random_uuid(),
  tail_number text not null,
  make text,
  model text,
  year integer,
  status text not null default 'available',
  total_hours numeric default 0,
  current_tach numeric,
  next_100hr_tach numeric,
  annual_due_date date,
  last_inspection date,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.squawks (
  id uuid primary key default gen_random_uuid(),
  aircraft_id uuid references public.aircraft(id),
  description text not null,
  notes text,
  status text not null default 'open',
  reported_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  aircraft_id uuid references public.aircraft(id),
  maint_type text not null,
  performed_at date not null,
  tach_at_service numeric,
  description text,
  performed_by text,
  next_due_tach numeric,
  next_due_date date,
  created_at timestamptz default now()
);

alter table public.aircraft enable row level security;
alter table public.squawks enable row level security;
alter table public.maintenance_records enable row level security;

drop policy if exists "Admins manage aircraft" on public.aircraft;
create policy "Admins manage aircraft" on public.aircraft
  for all using (is_admin());

drop policy if exists "All authenticated can view aircraft" on public.aircraft;
create policy "All authenticated can view aircraft" on public.aircraft
  for select using (auth.role() = 'authenticated');

drop policy if exists "All authenticated can view squawks" on public.squawks;
create policy "All authenticated can view squawks" on public.squawks
  for select using (auth.role() = 'authenticated');

drop policy if exists "Authenticated can insert squawks" on public.squawks;
create policy "Authenticated can insert squawks" on public.squawks
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Staff can update squawks" on public.squawks;
create policy "Staff can update squawks" on public.squawks
  for update using (is_staff());

drop policy if exists "Staff can manage maintenance records" on public.maintenance_records;
create policy "Staff can manage maintenance records" on public.maintenance_records
  for all using (is_staff()) with check (is_staff());

drop policy if exists "Students can view maintenance records" on public.maintenance_records;
create policy "Students can view maintenance records" on public.maintenance_records
  for select using (auth.role() = 'authenticated');
