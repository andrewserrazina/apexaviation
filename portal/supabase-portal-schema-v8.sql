-- Retention System server-side reconciliation (v8) — Phase 3
--
-- Everything lifecycle-email-related (readiness milestones, first-question,
-- Checkride-Mode-complete, weak-area nudges) fires from the browser only,
-- on page load/UI events (see checkLifecycleMilestones()/checkWeakAreaEmail()
-- in site/portal.js). A member who crosses a milestone without the portal
-- tab open at the right moment never gets that email — there's no
-- server-side reconciliation. This migration adds what the new
-- send-lifecycle-emails Edge Function (portal/supabase/functions/
-- send-lifecycle-emails/index.ts) needs to compute the same conditions
-- server-side on a schedule, catching whatever the client missed.
--
-- See RETENTION_SYSTEM.md for the full design, the manual Supabase
-- dashboard/cron steps required to actually deploy and schedule this
-- (which this sandbox has no access to perform), and what was verified
-- vs. what needs a live run to confirm.

-- ─────────────────────────────────────────────────────────────────
-- 1. Last-active timestamp — the signal the 7-day inactivity nudge
-- needs. Nothing in the existing schema tracks "when did this member
-- last actually open the portal" as its own field; portal_study_activity
-- only records days with >=5 seconds of active tab time, which is a
-- study-engagement signal, not a login/visit signal, and would miss a
-- member who opens the portal but doesn't linger. Updated once per
-- session by portal.js on load (see the client patch), not on every
-- click, to keep this to one cheap write per visit.
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists portal_last_active_at timestamptz;

-- ─────────────────────────────────────────────────────────────────
-- 2. Fix pre-existing infinite recursion in the profiles admin
-- policies -- found while testing this migration against a real
-- Postgres instance, NOT introduced by it. "Admins can view all
-- profiles" and "Admins can update profiles" (both in the original
-- portal/supabase-schema.sql) check admin-ness via
-- `exists (select 1 from public.profiles where id = auth.uid() and
-- role = 'admin')` -- an inline subquery ON THE SAME TABLE the policy
-- protects. Every other table in this schema uses that identical
-- pattern safely (querying profiles FROM another table's policy is
-- fine), but a policy ON profiles itself querying profiles again means
-- evaluating the subquery's scan requires re-applying profiles' own
-- SELECT policies -- including this same policy -- which Postgres
-- correctly detects as unbounded and rejects outright with
-- "infinite recursion detected in policy for relation". Confirmed this
-- reproduces on the ORIGINAL schema alone, no v8 changes needed to
-- trigger it: any admin session doing a plain
-- `select * from profiles` (e.g. the CRM's admin user list, or this
-- migration's own new self-update policy below, which is evaluated
-- together with the existing admin policies as one OR'd expression)
-- hits this error today.
--
-- Fix: move the admin check into a SECURITY DEFINER function. Because
-- it runs as the function owner (not the calling role), its internal
-- query is not subject to the calling session's RLS, breaking the
-- cycle -- the standard, documented pattern for self-referential RLS
-- checks. Used below for profiles' own policies; every other table's
-- inline admin-check subquery is unaffected (they don't recurse) and
-- is intentionally left as-is rather than touched for style reasons.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.is_admin(p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin')
$$;

drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin(auth.uid()));

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
  on public.profiles for update
  using (public.is_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 3. Members can update their own profile — genuinely missing before
-- this. Only "Admins can update profiles" existed; there was no policy
-- letting a student update their OWN row at all. This means the
-- existing Account Management "Save Changes" form (full_name/
-- certificate_status) has been silently doing nothing for every
-- non-admin member: the update runs into zero matching rows under RLS,
-- Postgrest returns no error either way, and the client's success toast
-- fires unconditionally regardless of whether anything actually saved.
-- Found while wiring up the last-active ping below, which has the exact
-- same requirement (a student's own client updating their own row) --
-- fixed here since it's the same missing policy either way.
--
-- The `with check` is intentionally identical to `using` (own-row only);
-- the trigger below is what actually prevents a student from using this
-- new policy to rewrite their own role/checkride_prep_unlocked/email.
-- ─────────────────────────────────────────────────────────────────
drop policy if exists "Members can update their own profile" on public.profiles;
create policy "Members can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.lock_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    new.role := old.role;
    new.checkride_prep_unlocked := old.checkride_prep_unlocked;
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_profile_privileged_columns on public.profiles;
create trigger trg_lock_profile_privileged_columns
  before update on public.profiles
  for each row execute procedure public.lock_profile_privileged_columns();

-- ─────────────────────────────────────────────────────────────────
-- 4. Checkride countdown emails (30/14/7/3/1 days out) are entirely new
-- dedup ground -- nothing client-side ever sent these, so there's no
-- existing portal_events flag to preserve compatibility with. Straight
-- portal_email_log throttling, one email_type per day-mark
-- (e.g. "checkride_countdown_7"), is enough on its own.
--
-- No new table needed -- portal_checkride_date and portal_email_log
-- both already exist (site/supabase-portal-schema-v2.sql).
-- ─────────────────────────────────────────────────────────────────
