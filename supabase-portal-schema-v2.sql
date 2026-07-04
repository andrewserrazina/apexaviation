-- Apex Advantage Member Portal — retention & revenue schema (v2)
--
-- Run this in the Supabase SQL editor, same project as
-- supabase-portal-schema.sql and apexadvantage/supabase-schema.sql.
--
-- Adds: lifecycle event tracking, checkride date, mock oral bookings,
-- referrals, testimonials, checkride results (+ Success Wall), email
-- send log (dedup/throttle), and "Ask Andrew" question discussions.

-- ─────────────────────────────────────────────────────────────────
-- 1. Portal events — signup, first login, milestones, inactivity, etc.
-- The 'signup' event is logged automatically via trigger below.
-- ─────────────────────────────────────────────────────────────────
create table public.portal_events (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete cascade,
  event_type  text not null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

alter table public.portal_events enable row level security;

create policy "Users manage their own events"
  on public.portal_events for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all events"
  on public.portal_events for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Auto-log a 'signup' event whenever a new profile is created.
create or replace function public.handle_new_profile_portal_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.portal_events (profile_id, event_type) values (new.id, 'signup');
  return new;
end;
$$;

create trigger on_profile_created_portal_event
  after insert on public.profiles
  for each row execute procedure public.handle_new_profile_portal_event();

-- ─────────────────────────────────────────────────────────────────
-- 2. Email send log — dedup/throttle so lifecycle emails don't repeat
-- ─────────────────────────────────────────────────────────────────
create table public.portal_email_log (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete cascade,
  email_type  text not null,
  sent_at     timestamptz not null default now()
);

alter table public.portal_email_log enable row level security;

create policy "Users manage their own email log"
  on public.portal_email_log for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all email log"
  on public.portal_email_log for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 3. Checkride date tracking
-- ─────────────────────────────────────────────────────────────────
create table public.portal_checkride_date (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  checkride_date date not null,
  updated_at     timestamptz not null default now()
);

alter table public.portal_checkride_date enable row level security;

create policy "Users manage their own checkride date"
  on public.portal_checkride_date for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all checkride dates"
  on public.portal_checkride_date for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 4. Mock oral bookings — logged client-side when a student books
-- (actual scheduling happens via Calendly or a future in-house system)
-- ─────────────────────────────────────────────────────────────────
create table public.portal_mock_oral_bookings (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  notes       text
);

alter table public.portal_mock_oral_bookings enable row level security;

create policy "Users manage their own mock oral bookings"
  on public.portal_mock_oral_bookings for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all mock oral bookings"
  on public.portal_mock_oral_bookings for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 5. Referral program
-- One code per referring student; one row per friend they refer.
-- Accounts are invite-only, so "referred_profile_id" is filled in by
-- staff once they actually enroll — this table is a lead list, not an
-- automatic self-serve reward engine.
-- ─────────────────────────────────────────────────────────────────
create table public.portal_referral_codes (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

alter table public.portal_referral_codes enable row level security;

create policy "Users manage their own referral code"
  on public.portal_referral_codes for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins can view all referral codes"
  on public.portal_referral_codes for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create table public.portal_referrals (
  id               uuid primary key default gen_random_uuid(),
  referrer_id      uuid references public.profiles(id) on delete cascade,
  referred_email   text not null,
  referred_name    text,
  referred_profile_id uuid references public.profiles(id),
  status           text not null default 'pending' check (status in ('pending', 'signed_up', 'rewarded')),
  created_at       timestamptz not null default now()
);

alter table public.portal_referrals enable row level security;

create policy "Users manage their own referrals"
  on public.portal_referrals for all
  using (auth.uid() = referrer_id)
  with check (auth.uid() = referrer_id);

create policy "Admins can manage all referrals"
  on public.portal_referrals for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 6. Testimonials — prompted once readiness crosses 80%
-- ─────────────────────────────────────────────────────────────────
create table public.portal_testimonials (
  id                       uuid primary key default gen_random_uuid(),
  profile_id               uuid references public.profiles(id) on delete cascade,
  display_name             text,
  content                  text not null,
  readiness_score_at_submission integer,
  status                   text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at               timestamptz not null default now()
);

alter table public.portal_testimonials enable row level security;

create policy "Users manage their own testimonials"
  on public.portal_testimonials for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Any authenticated user can view approved testimonials"
  on public.portal_testimonials for select
  using (status = 'approved');

create policy "Admins can manage all testimonials"
  on public.portal_testimonials for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 7. Checkride results — "I Passed" + Success Wall
-- ─────────────────────────────────────────────────────────────────
create table public.portal_checkride_results (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  display_name   text,
  passed         boolean not null default true,
  exam_date      date not null,
  examiner_name  text,
  aircraft       text,
  notes          text,
  created_at     timestamptz not null default now()
);

alter table public.portal_checkride_results enable row level security;

create policy "Users manage their own checkride result"
  on public.portal_checkride_results for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Any authenticated user can view passed results (Success Wall)"
  on public.portal_checkride_results for select
  using (passed = true);

create policy "Admins can manage all checkride results"
  on public.portal_checkride_results for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 8. "Ask Andrew" — question discussions
-- Answered questions become visible to everyone as a growing FAQ.
-- ─────────────────────────────────────────────────────────────────
create table public.portal_question_discussions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete cascade,
  question_id  text not null,
  message      text not null,
  status       text not null default 'open' check (status in ('open', 'answered', 'archived')),
  answer       text,
  answered_at  timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.portal_question_discussions enable row level security;

create policy "Users manage their own question discussions"
  on public.portal_question_discussions for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Any authenticated user can view answered discussions (FAQ)"
  on public.portal_question_discussions for select
  using (status = 'answered');

create policy "Admins can manage all question discussions"
  on public.portal_question_discussions for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
