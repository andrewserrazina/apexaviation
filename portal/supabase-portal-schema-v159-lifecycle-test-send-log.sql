-- Apex Advantage — lifecycle-email single-recipient test: atomic reservation (v159)
--
-- Stage 3 lifecycle-email recovery: send-lifecycle-emails/index.ts gains a
-- single-recipient test-mode branch (see that file's own comment at the
-- top of its test-mode block). That branch must not throttle itself
-- using portal_email_log or any other table the real campaigns dedup
-- against -- Task 2 explicitly requires the test mechanism never touch
-- customer dedup/log records. Neither table below is a customer record
-- of any kind: no profile_id, no foreign key to anything a real
-- campaign touches.
--
-- Revised (Stage 3 review): the original version of this migration had
-- the Edge Function do a plain "SELECT count(*) ... WHERE sent_at >=
-- cutoff" cooldown check, then call the email provider, then INSERT a
-- row -- a check-then-act race across two round trips. Two concurrent
-- requests could both pass the SELECT before either INSERTed, both
-- proceeding to send. This revision moves the check-and-claim into one
-- atomic SQL statement (lifecycle_test_reserve_send(), below), called
-- BEFORE the provider is ever invoked.
--
-- lifecycle_test_send_lock is a one-row table; lifecycle_test_reserve_send()
-- does a single `update ... where ... returning` against that row.
-- Postgres takes a row-level lock for the duration of that one
-- statement, so a concurrent second call blocks until the first
-- commits, then re-evaluates the WHERE clause against the
-- now-just-updated timestamp and gets zero rows back -- only one
-- concurrent caller can ever receive `true`. This is the same
-- "UPDATE ... WHERE ... RETURNING as an atomic reservation" pattern
-- used anywhere a singleton row needs to gate concurrent access; it
-- needs no explicit advisory lock because the single statement's own
-- row lock already provides it.
--
-- Being reserved BEFORE the provider call (not after) is what satisfies
-- "an ambiguous provider outcome cannot cause a duplicate send": if the
-- provider call then times out or throws, the cooldown is already
-- claimed, so an immediate manual retry is refused by the same
-- reservation check regardless of how the first attempt's send turned
-- out.
--
-- lifecycle_test_sends remains as an append-only audit log, one row per
-- attempt that actually reached the provider, recording its outcome.
--
-- Deliberately no RLS policies on either table -- enabling RLS with
-- zero policies means no client (anon, authenticated, or otherwise) can
-- read or write via the API at all; only the Edge Function's own
-- service-role client (which bypasses RLS) ever touches them.
-- lifecycle_test_reserve_send() is further locked to service_role only
-- via explicit revoke/grant below, so it can't be called directly by
-- an anon/authenticated API caller even as an RPC.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v158.

create table public.lifecycle_test_send_lock (
  id                integer primary key,
  last_reserved_at  timestamptz
);
insert into public.lifecycle_test_send_lock (id, last_reserved_at) values (1, null);

alter table public.lifecycle_test_send_lock enable row level security;

create table public.lifecycle_test_sends (
  id                 uuid primary key default gen_random_uuid(),
  sent_at            timestamptz not null default now(),
  provider_accepted  boolean not null,
  provider_error     text
);

alter table public.lifecycle_test_sends enable row level security;

create or replace function public.lifecycle_test_reserve_send(p_cooldown_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved boolean;
begin
  update public.lifecycle_test_send_lock
  set last_reserved_at = now()
  where id = 1
    and (last_reserved_at is null or now() - last_reserved_at >= (p_cooldown_seconds || ' seconds')::interval)
  returning true into v_reserved;

  return coalesce(v_reserved, false);
end;
$$;

revoke all on function public.lifecycle_test_reserve_send(integer) from public;
grant execute on function public.lifecycle_test_reserve_send(integer) to service_role;
