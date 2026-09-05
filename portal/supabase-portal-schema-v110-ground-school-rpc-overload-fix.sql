-- Apex Advantage Sprint 0 Phase 2B -- Ground School RPC overload fix (v110)
--
-- PRODUCTION INCIDENT FIX, not a security-hardening migration (that was
-- v104-v109). Independent production review confirmed a live, active
-- revenue-path bug: a completed/paid $25 scheduled-class Ground School
-- Stripe Checkout Session left no matching scheduled_ground_class_enrollments
-- row and was subsequently fully refunded.
--
-- Root cause: public.confirm_scheduled_ground_class_enrollment has had two
-- overloads since v57.sql --
--   (uuid,text,text,uuid,text,integer)                -- v17, the original
--   (uuid,text,text,uuid,text,integer,text DEFAULT 'paid') -- v57, added for
--                                                            the pack-enrollment path
-- The second overload's extra parameter has a DEFAULT, which makes a call
-- supplying exactly the shared six parameters -- named or positional, even
-- with exact type casts -- genuinely ambiguous to Postgres's function
-- resolver ("function ... is not unique"), regardless of role or grants.
-- portal/supabase/functions/stripe-webhook/index.ts has called this RPC
-- with exactly those six named parameters since v57 shipped, meaning every
-- real Stripe payment for a scheduled Ground School class has likely been
-- silently failing at this exact line ever since, hitting stripe-webhook's
-- own refund-and-alert-admin fallback instead of completing. Reproduced
-- both in a local Postgres 16 test harness AND as a safe, read-only,
-- no-op diagnostic call against the live production database (a
-- nonexistent class id, so success or failure of *resolution* was
-- observable without ever reaching the INSERT). See
-- SPRINT_0_PHASE_2B_HOTFIX_REPORT.md for the full incident writeup and
-- the affected-transaction reconciliation procedure.
--
-- Caller graph, re-verified immediately before writing this migration
-- (full repo grep, both `.rpc(` call sites and internal SQL callers):
--   stripe-webhook/index.ts               -- the only external caller,
--                                             now fixed (this same PR) to
--                                             pass p_payment_status: 'paid'
--                                             explicitly, matching the
--                                             seven-argument signature.
--   enroll_in_ground_school_via_pack      -- the only internal SQL caller,
--                                             already calls the seven-
--                                             argument form positionally
--                                             with p_payment_status =
--                                             'ground_school_pack' (v57).
-- There are zero remaining callers -- external or internal -- of the
-- six-argument overload anywhere in the codebase. It has, in effect, been
-- dead/unreachable code since the day the seven-argument overload was
-- created with a default, which is exactly what made it safe to drop
-- rather than needing a deprecation window.
--
-- This migration:
--   A. Drops ONLY the obsolete six-argument overload. The seven-argument
--      canonical function is NOT dropped, and no row of application data
--      is touched.
--   B. Redefines the seven-argument function with the SAME body
--      (byte-for-byte identical logic -- only the parameter list changes)
--      but WITHOUT the `DEFAULT 'paid'` on p_payment_status. Recommendation
--      and rationale: keep payment_status mandatory at every call site
--      going forward. Both legitimate callers (stripe-webhook and
--      enroll_in_ground_school_via_pack) already pass it explicitly after
--      this fix, so the default now serves no legitimate caller -- only
--      the risk of a future caller silently defaulting to 'paid' without
--      realizing a value was required. Removing it converts that failure
--      mode from "silently wrong" to "fails loudly at call time," which
--      is strictly safer for a payment-status field. Postgres refuses a
--      plain `CREATE OR REPLACE FUNCTION` that removes a parameter's
--      default, so this migration DROPs and recreates the function
--      instead (wrapped in a transaction so it's never briefly absent) --
--      which means, unlike every other migration in this sprint, the
--      v104 grant state does NOT carry forward automatically and is
--      re-applied explicitly at the end of this file.
--
-- After this migration, there is exactly ONE function signature exposed
-- under the name confirm_scheduled_ground_class_enrollment:
--   public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)
-- with p_payment_status mandatory (no default), matching the same
-- CHECK-style validation it already had (`if p_payment_status not in
-- ('paid', 'ground_school_pack') then raise exception`).
--
-- Idempotent: `drop function if exists` and `create or replace function`
-- are both safe to re-run.
--
-- Rollback:
--   -- restore the six-argument overload (v17's body, unchanged):
--   create or replace function public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id uuid, p_full_name text, p_email text, p_profile_id uuid, p_stripe_session_id text, p_amount_cents integer)
--    returns scheduled_ground_class_enrollments language plpgsql security definer set search_path to 'public' as $function$
--   declare
--     v_class public.scheduled_ground_classes%rowtype;
--     v_existing public.scheduled_ground_class_enrollments%rowtype;
--     v_enrollment public.scheduled_ground_class_enrollments%rowtype;
--   begin
--     if p_scheduled_ground_class_id is null then raise exception 'Scheduled class id is required.'; end if;
--     if nullif(trim(coalesce(p_full_name, '')), '') is null then raise exception 'Full name is required.'; end if;
--     if nullif(trim(coalesce(p_email, '')), '') is null then raise exception 'Email is required.'; end if;
--     select * into v_existing from public.scheduled_ground_class_enrollments where stripe_session_id = p_stripe_session_id;
--     if found then return v_existing; end if;
--     select * into v_class from public.scheduled_ground_classes where id = p_scheduled_ground_class_id for update;
--     if not found then raise exception 'Scheduled ground school class not found.'; end if;
--     if v_class.status <> 'published' then raise exception 'Scheduled ground school class is not open for registration.'; end if;
--     if v_class.class_date < current_date then raise exception 'Scheduled ground school class is no longer upcoming.'; end if;
--     select * into v_existing from public.scheduled_ground_class_enrollments where scheduled_ground_class_id = p_scheduled_ground_class_id and lower(email) = lower(p_email) and payment_status = 'paid';
--     if found then return v_existing; end if;
--     if v_class.enrolled_count >= v_class.capacity then raise exception 'Scheduled ground school class is full.'; end if;
--     insert into public.scheduled_ground_class_enrollments (scheduled_ground_class_id, profile_id, full_name, email, stripe_session_id, amount_cents, payment_status)
--     values (p_scheduled_ground_class_id, p_profile_id, trim(p_full_name), lower(trim(p_email)), p_stripe_session_id, coalesce(p_amount_cents, 2500), 'paid') returning * into v_enrollment;
--     update public.scheduled_ground_classes set enrolled_count = enrolled_count + 1 where id = p_scheduled_ground_class_id;
--     return v_enrollment;
--   end; $function$;
--   grant execute on function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer) to service_role;
--   -- and re-add the default on the seven-argument overload:
--   alter function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text) alter argument p_payment_status set default 'paid';
--   -- (Postgres has no ALTER FUNCTION ... ALTER PARAMETER SET DEFAULT --
--   -- a real rollback would need a CREATE OR REPLACE with the DEFAULT
--   -- clause restored, same body, same shape as step B above but with
--   -- `text DEFAULT 'paid'::text` back on the last parameter.)
--   -- Reintroducing the six-argument overload also reintroduces the
--   -- ambiguity bug this migration fixes -- only do this if v110 itself
--   -- is found to have broken something, and fix the real problem instead
--   -- of rolling all the way back if at all possible.

-- ---------------------------------------------------------------------
-- A. Drop the obsolete, unreachable six-argument overload.
--
-- Wrapped in an explicit transaction: Postgres refuses a plain
-- `CREATE OR REPLACE FUNCTION` that removes a parameter's default
-- (`cannot remove parameter defaults from existing function`), so
-- dropping the seven-argument function and recreating it (step B) is
-- required, not just the six-argument one. A transaction ensures there is
-- never a moment where confirm_scheduled_ground_class_enrollment doesn't
-- exist at all -- both drops and the recreate commit atomically together,
-- so no concurrent webhook delivery can land in the gap.
-- ---------------------------------------------------------------------
begin;

drop function if exists public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer);
drop function if exists public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text);

-- ---------------------------------------------------------------------
-- B. Recreate the canonical seven-argument function without the default
--    on p_payment_status. Body is byte-for-byte identical to the
--    existing live definition -- only the parameter list changes.
--    NOTE: since this is a fresh CREATE (not a same-signature REPLACE),
--    it does NOT inherit the previous function's ACL -- Postgres applies
--    this database's `ALTER DEFAULT PRIVILEGES` rule instead (Supabase's
--    own default grants EXECUTE to anon/authenticated/service_role on
--    every newly created function). The explicit REVOKE/GRANT at the end
--    of this migration is therefore REQUIRED, not defensive, to restore
--    the v104-hardened grant state.
-- ---------------------------------------------------------------------
create function public.confirm_scheduled_ground_class_enrollment(
  p_scheduled_ground_class_id uuid,
  p_full_name text,
  p_email text,
  p_profile_id uuid,
  p_stripe_session_id text,
  p_amount_cents integer,
  p_payment_status text
)
 returns scheduled_ground_class_enrollments
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_class public.scheduled_ground_classes%rowtype;
  v_existing public.scheduled_ground_class_enrollments%rowtype;
  v_enrollment public.scheduled_ground_class_enrollments%rowtype;
begin
  if p_scheduled_ground_class_id is null then
    raise exception 'Scheduled class id is required.';
  end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Full name is required.';
  end if;
  if nullif(trim(coalesce(p_email, '')), '') is null then
    raise exception 'Email is required.';
  end if;
  if p_payment_status not in ('paid', 'ground_school_pack') then
    raise exception 'Invalid payment_status for a new enrollment: %', p_payment_status;
  end if;

  select * into v_existing
  from public.scheduled_ground_class_enrollments
  where stripe_session_id = p_stripe_session_id;
  if found then
    return v_existing;
  end if;

  select * into v_class
  from public.scheduled_ground_classes
  where id = p_scheduled_ground_class_id
  for update;

  if not found then
    raise exception 'Scheduled ground school class not found.';
  end if;
  if v_class.status <> 'published' then
    raise exception 'Scheduled ground school class is not open for registration.';
  end if;
  if v_class.class_date < current_date then
    raise exception 'Scheduled ground school class is no longer upcoming.';
  end if;

  select * into v_existing
  from public.scheduled_ground_class_enrollments
  where scheduled_ground_class_id = p_scheduled_ground_class_id
    and lower(email) = lower(p_email)
    and payment_status in ('paid', 'ground_school_pack');
  if found then
    return v_existing;
  end if;

  if v_class.enrolled_count >= v_class.capacity then
    raise exception 'Scheduled ground school class is full.';
  end if;

  insert into public.scheduled_ground_class_enrollments (
    scheduled_ground_class_id,
    profile_id,
    full_name,
    email,
    stripe_session_id,
    amount_cents,
    payment_status
  ) values (
    p_scheduled_ground_class_id,
    p_profile_id,
    trim(p_full_name),
    lower(trim(p_email)),
    p_stripe_session_id,
    coalesce(p_amount_cents, 2500),
    p_payment_status
  ) returning * into v_enrollment;

  update public.scheduled_ground_classes
  set enrolled_count = enrolled_count + 1
  where id = p_scheduled_ground_class_id;

  return v_enrollment;
end;
$function$;

-- REQUIRED (see note in step B): a fresh CREATE does not carry forward
-- the previous function's ACL the way CREATE OR REPLACE would -- without
-- this, the new function would pick up Supabase's default-privileges rule
-- and silently re-expose EXECUTE to anon/authenticated, undoing v104.
revoke execute on function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)
  to service_role;

commit;
