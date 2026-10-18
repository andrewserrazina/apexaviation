-- Apex Advantage — lifecycle-email single-recipient test: replay guard (v159)
--
-- Stage 3 lifecycle-email recovery: send-lifecycle-emails/index.ts gains a
-- single-recipient test-mode branch (see that file's own comment at the
-- top of its test-mode block). That branch must not throttle itself
-- using portal_email_log or any other table the real campaigns dedup
-- against -- Task 2 explicitly requires the test mechanism never touch
-- customer dedup/log records. This table exists solely to rate-limit
-- test sends: it has no profile_id, no foreign key to any customer
-- table, and holds nothing but a timestamp per test send. It is not a
-- customer record of any kind.
--
-- Deliberately no RLS policies are added below -- enabling RLS with zero
-- policies means no client (anon, authenticated, or otherwise) can read
-- or write this table via the API at all, which is exactly right here:
-- only the Edge Function's own service-role client (which bypasses RLS)
-- ever needs to touch it.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v158.

create table public.lifecycle_test_sends (
  id       uuid primary key default gen_random_uuid(),
  sent_at  timestamptz not null default now()
);

alter table public.lifecycle_test_sends enable row level security;
