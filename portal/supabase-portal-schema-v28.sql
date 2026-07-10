-- Apex Advantage — Mock Oral booking, tied into the portal (v28)
--
-- The "Book a Mock Oral" CTA on checkride-prep.html previously linked
-- out to the generic contact page. It's now a real $99 purchase inside
-- the member portal (create-checkout-session purpose
-- 'book-mock-oral'), same pattern as the Checkride Prep unlock. A mock
-- oral is a 1:1 session against an instructor's calendar, not a fixed
-- class slot like ground school, so there's no capacity/scheduling
-- logic here -- payment just creates a request row that shows up for
-- admin/instructors to actually coordinate a time with the student.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v27.

create table public.mock_oral_requests (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid references public.profiles(id) on delete set null,
  full_name          text not null,
  email              text not null,
  stripe_session_id  text not null unique,
  amount_cents       integer not null default 9900,
  status             text not null default 'requested' check (status in ('requested', 'scheduled', 'completed', 'canceled')),
  scheduled_at       timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index mock_oral_requests_status_idx on public.mock_oral_requests (status, created_at);

alter table public.mock_oral_requests enable row level security;

create policy "Admins manage mock oral requests"
  on public.mock_oral_requests for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Members view their own mock oral requests"
  on public.mock_oral_requests for select
  using (
    auth.role() = 'authenticated'
    and (
      profile_id = auth.uid()
      or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );
