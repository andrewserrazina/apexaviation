-- Ground school RLS hardening (v6)
--
-- ground_sessions / ground_registrations have no CREATE TABLE anywhere in
-- this repo (created directly in the Supabase dashboard) -- this migration
-- was written against their ACTUAL live state, inspected via
-- inspect-ground-school-rls.sql, not guessed at. See
-- GROUND_SCHOOL_RLS_AUDIT.md for the full before/after and the live query
-- results this was based on.
--
-- Summary of what was actually live before this migration:
--   ground_sessions      -- fine as-is, not touched below except to
--                            re-declare the same 2 policies idempotently.
--   ground_registrations -- RLS was enabled but every policy used
--                            `using (true)` / `with_check (true)`, which
--                            provided no real protection at all:
--     - "Anyone can register" (INSERT, with_check=true) let any caller
--       insert a row with payment_status='paid' directly, bypassing
--       Stripe entirely.
--     - "Public can read own registration by token" (SELECT, qual=true)
--       let anyone read every registrant's name/email/payment data with
--       one unfiltered query -- the "by token" in the name was never
--       actually enforced by the policy.
--     - "Public can update attendance by token" (UPDATE, using/check=true)
--       let anyone overwrite any row's any column.
--     - Only a SELECT policy existed for admins -- no admin
--       INSERT/UPDATE/DELETE policy at all (admin actions in
--       GroundSchedule.jsx only worked because the blanket public
--       policies above incidentally covered admins too).

-- ─────────────────────────────────────────────────────────────────
-- 1. ground_sessions -- re-declare idempotently. No behavior change;
-- these were already correct.
-- ─────────────────────────────────────────────────────────────────
alter table public.ground_sessions enable row level security;

drop policy if exists "Anyone can view ground sessions" on public.ground_sessions;
create policy "Anyone can view ground sessions"
  on public.ground_sessions for select
  using (true);

drop policy if exists "Admins can manage ground sessions" on public.ground_sessions;
create policy "Admins can manage ground sessions"
  on public.ground_sessions for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ─────────────────────────────────────────────────────────────────
-- 2. ground_registrations -- drop every unsafe policy, replace with a
-- properly scoped set.
-- ─────────────────────────────────────────────────────────────────
alter table public.ground_registrations enable row level security;

drop policy if exists "Anyone can register" on public.ground_registrations;
drop policy if exists "Public can read own registration by token" on public.ground_registrations;
drop policy if exists "Public can update attendance by token" on public.ground_registrations;
drop policy if exists "Admins can view all registrations" on public.ground_registrations;
drop policy if exists "Public can register (unpaid, unattended only)" on public.ground_registrations;

-- Admins: full access, same pattern as every other admin policy in this schema.
create policy "Admins can manage all registrations"
  on public.ground_registrations for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Students: can see their own registrations (supports the future "My
-- Sessions" view noted in LAUNCH_READINESS_REPORT.md Phase 6 -- profile_id
-- is already populated by the Stripe webhook, this just makes it usable).
create policy "Students can view their own registrations"
  on public.ground_registrations for select
  using (auth.uid() = profile_id);

-- No direct public INSERT policy: a plain `with_check` policy can't work
-- here, because GroundSchedule.jsx's registration flow also needs to read
-- back the row it just created (to send the confirmation/waitlist email),
-- and Postgres RLS evaluates INSERT ... RETURNING (and any follow-up
-- SELECT) against the SELECT policies too. Anon has no SELECT policy on
-- this table (correctly -- see "Students can view their own registrations"
-- above), so a direct anon insert-then-select would always fail. Public
-- self-registration instead goes entirely through the
-- register_for_ground_school() RPC below (SECURITY DEFINER, callable by
-- anon), which performs the insert and hands back the row directly.
--
-- No public SELECT/UPDATE policy is added to replace the removed
-- "by token" ones either -- token-based check-in/out now goes through
-- get_ground_registration_by_token()/record_ground_attendance_by_token()
-- below (SECURITY DEFINER, callable by anon), not direct table access.
-- This is the only way to actually enforce "by token" -- a `using(true)`
-- RLS policy has no way to validate that the caller supplied the right
-- token, since RLS filters rows, it doesn't inspect the query itself.

-- ─────────────────────────────────────────────────────────────────
-- 3. Token-based attendance RPCs -- replace direct table access from
-- the public /attend/:type/:token route.
-- ─────────────────────────────────────────────────────────────────

-- Read-only lookup, used by Attend.jsx to show session details before
-- deciding what state to render. Returns only what the check-in page
-- actually displays -- no email, no payment fields.
create or replace function public.get_ground_registration_by_token(p_token uuid)
returns table (
  id uuid,
  full_name text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  attendance_status text,
  session_title text,
  session_scheduled_at timestamptz,
  session_location text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select r.id, r.full_name, r.checked_in_at, r.checked_out_at, r.attendance_status,
           s.title, s.scheduled_at, s.location
    from public.ground_registrations r
    join public.ground_sessions s on s.id = r.session_id
    where r.check_in_token = p_token or r.check_out_token = p_token;
end;
$$;

grant execute on function public.get_ground_registration_by_token(uuid) to anon, authenticated;

-- Performs the actual check-in/check-out, looked up and validated by
-- token server-side (never trusting a client-supplied row id). Encodes
-- the same "already recorded" / "must check in before check out" state
-- machine Attend.jsx already implements, so the client stays a thin
-- renderer of whatever this function reports.
create or replace function public.record_ground_attendance_by_token(p_token uuid, p_type text)
returns table (
  id uuid,
  full_name text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  attendance_status text,
  session_title text,
  session_scheduled_at timestamptz,
  session_location text,
  already_recorded boolean,
  needs_checkin_first boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_check_in_token uuid;
  v_check_out_token uuid;
  v_checked_in_at timestamptz;
  v_checked_out_at timestamptz;
begin
  if p_type not in ('in', 'out') then
    raise exception 'invalid attendance type: %', p_type;
  end if;

  if p_type = 'in' then
    select r.id, r.checked_in_at into v_id, v_checked_in_at
    from public.ground_registrations r where r.check_in_token = p_token;
  else
    select r.id, r.checked_in_at, r.checked_out_at into v_id, v_checked_in_at, v_checked_out_at
    from public.ground_registrations r where r.check_out_token = p_token;
  end if;

  if v_id is null then
    return; -- no matching token -- caller treats an empty result as invalid
  end if;

  if p_type = 'in' and v_checked_in_at is not null then
    return query
      select r.id, r.full_name, r.checked_in_at, r.checked_out_at, r.attendance_status,
             s.title, s.scheduled_at, s.location, true, false
      from public.ground_registrations r join public.ground_sessions s on s.id = r.session_id
      where r.id = v_id;
    return;
  end if;

  if p_type = 'out' then
    if v_checked_out_at is not null then
      return query
        select r.id, r.full_name, r.checked_in_at, r.checked_out_at, r.attendance_status,
               s.title, s.scheduled_at, s.location, true, false
        from public.ground_registrations r join public.ground_sessions s on s.id = r.session_id
        where r.id = v_id;
      return;
    end if;
    if v_checked_in_at is null then
      return query
        select r.id, r.full_name, r.checked_in_at, r.checked_out_at, r.attendance_status,
               s.title, s.scheduled_at, s.location, false, true
        from public.ground_registrations r join public.ground_sessions s on s.id = r.session_id
        where r.id = v_id;
      return;
    end if;
  end if;

  update public.ground_registrations
    set checked_in_at = case when p_type = 'in' then now() else ground_registrations.checked_in_at end,
        checked_out_at = case when p_type = 'out' then now() else ground_registrations.checked_out_at end,
        attendance_status = case when p_type = 'in' then 'checked_in' else 'completed' end
    where ground_registrations.id = v_id;

  return query
    select r.id, r.full_name, r.checked_in_at, r.checked_out_at, r.attendance_status,
           s.title, s.scheduled_at, s.location, false, false
    from public.ground_registrations r join public.ground_sessions s on s.id = r.session_id
    where r.id = v_id;
end;
$$;

grant execute on function public.record_ground_attendance_by_token(uuid, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4. Public self-registration RPC -- replaces the direct INSERT policy
-- that used to back GroundSchedule.jsx's handleRegister(). Computes
-- waitlist placement server-side (same rule the client already used:
-- confirmed registrants >= max_students -> waitlist) and returns the new
-- row directly, so the caller doesn't need a SELECT policy to read back
-- what it just inserted.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.register_for_ground_school(
  p_session_id uuid,
  p_full_name text,
  p_email text
)
returns table (
  id uuid,
  full_name text,
  email text,
  check_in_token uuid,
  check_out_token uuid,
  is_waitlisted boolean,
  waitlist_position integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_students integer;
  v_confirmed_count integer;
  v_waitlist_count integer;
  v_go_waitlist boolean;
  v_id uuid;
begin
  select s.max_students into v_max_students
  from public.ground_sessions s where s.id = p_session_id;

  if v_max_students is null then
    raise exception 'session not found';
  end if;

  select count(*) into v_confirmed_count
  from public.ground_registrations r
  where r.session_id = p_session_id and r.is_waitlisted = false;

  v_go_waitlist := v_confirmed_count >= v_max_students;

  if v_go_waitlist then
    select count(*) into v_waitlist_count
    from public.ground_registrations r
    where r.session_id = p_session_id and r.is_waitlisted = true;
  end if;

  begin
    insert into public.ground_registrations (session_id, full_name, email, is_waitlisted, waitlist_position)
    values (
      p_session_id, p_full_name, p_email, v_go_waitlist,
      case when v_go_waitlist then v_waitlist_count + 1 else null end
    )
    returning ground_registrations.id into v_id;
  exception
    when unique_violation then
      raise exception 'This email is already registered for this session.';
  end;

  return query
    select r.id, r.full_name, r.email, r.check_in_token, r.check_out_token, r.is_waitlisted, r.waitlist_position
    from public.ground_registrations r
    where r.id = v_id;
end;
$$;

grant execute on function public.register_for_ground_school(uuid, text, text) to anon, authenticated;
