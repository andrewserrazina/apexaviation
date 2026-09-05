-- Sprint 0 Phase 2A test harness -- pre-hardening ("BEFORE") schema.
--
-- Purpose: reproduce, in a disposable local database, the exact pieces of
-- the live production schema/grants/RLS needed to prove migrations
-- v104-v109 fix what Sprint 0 Phase 1B found while breaking nothing that
-- Phase 1B verified as a legitimate caller. Not a full schema clone --
-- only the tables/functions/policies these six migrations and the
-- required regression tests touch, but every one of those is copied
-- verbatim (column names/types, function bodies, RLS policy text) from
-- what was read directly off the live project (wqzfhcjsfzwrimvsudxy) in
-- Sprint 0 Phase 1/1B, not reconstructed from memory.
--
-- Run order: 00_harness_schema.sql (this file, BEFORE state) -> the six
-- migrations in numeric order -> run_security_regression_tests.sh.

-- ---------------------------------------------------------------------
-- Roles -- mirrors Supabase's three standard DB roles. Supabase applies
-- `alter default privileges in schema public grant execute on functions
-- to anon, authenticated, service_role` at project creation, which is why
-- production's pg_proc.proacl shows explicit anon=X/authenticated=X
-- entries on every function, not just an inherited bare PUBLIC grant --
-- reproduced here so this harness's BEFORE state matches production's
-- BEFORE state exactly, not an idealized one.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) then
    execute 'drop owned by anon, authenticated, service_role cascade';
  end if;
exception when undefined_object then null;
end $$;
drop role if exists anon;
drop role if exists authenticated;
drop role if exists service_role;
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- auth.uid() stub -- Supabase's real auth.uid() reads the JWT claim
-- PostgREST sets as a GUC per-request. This stub reads a settable
-- session GUC instead, so a test can do `set myapp.uid = '<uuid>'` to
-- simulate "signed in as this profile" before running a query `set role
-- authenticated;`.
-- ---------------------------------------------------------------------
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('myapp.uid', true), '')::uuid $$;
create or replace function auth.role() returns text
  language sql stable
  as $$ select current_setting('myapp.role', true) $$;
grant usage on schema auth to anon, authenticated, service_role, postgres;
grant execute on function auth.uid() to anon, authenticated, service_role, postgres;
grant execute on function auth.role() to anon, authenticated, service_role, postgres;

-- ---------------------------------------------------------------------
-- Minimal tables (columns limited to what the tested functions/policies
-- actually reference). Admin/staff-dependent policies are added further
-- down, after is_admin()/is_staff() exist.
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key,
  email text,
  full_name text,
  role text not null default 'student',
  checkride_prep_unlocked boolean not null default false,
  private_pilot_ground_school_pack_unlocked boolean not null default false,
  total_xp integer not null default 0,
  current_rank text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users can view their own profile" on public.profiles for select using (auth.uid() = id);
create policy "Members can update their own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create table public.pilot_ranks (
  rank_key text primary key,
  min_xp integer not null
);
insert into public.pilot_ranks (rank_key, min_xp) values ('rookie', 0), ('apex_captain', 5000), ('legend', 10000);

create table public.member_milestones (
  profile_id uuid not null,
  milestone_key text not null,
  achieved_on date,
  verification_status text,
  primary key (profile_id, milestone_key)
);

create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  event_type text not null,
  xp_amount integer not null,
  source_table text,
  source_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (profile_id, event_type, source_id)
);
alter table public.xp_ledger enable row level security;
create policy "Members view their own XP ledger" on public.xp_ledger for select using (auth.uid() = profile_id);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid,
  action text,
  target_profile_id uuid,
  previous_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);

create table public.scheduled_ground_classes (
  id uuid primary key default gen_random_uuid(),
  course_id text not null default 'PPL',
  status text not null default 'published',
  class_date date not null,
  capacity integer not null default 20,
  enrolled_count integer not null default 0
);

create table public.scheduled_ground_class_enrollments (
  id uuid primary key default gen_random_uuid(),
  scheduled_ground_class_id uuid not null,
  profile_id uuid,
  full_name text not null,
  email text not null,
  stripe_session_id text unique,
  amount_cents integer,
  payment_status text not null default 'paid',
  created_at timestamptz not null default now()
);

create table public.ground_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  max_students integer not null default 20
);

create table public.ground_registrations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  full_name text not null,
  email text not null,
  is_waitlisted boolean not null default false,
  waitlist_position integer,
  profile_id uuid,
  stripe_session_id text unique,
  amount_cents integer,
  payment_status text not null default 'unpaid'
);

create table public.portal_referral_codes (
  code text primary key,
  profile_id uuid not null
);

create table public.portal_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid,
  referred_email text,
  referred_profile_id uuid,
  status text not null default 'pending',
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.readiness_assessment_leads (
  id uuid primary key default gen_random_uuid(),
  email text,
  profile_id uuid,
  score integer,
  claimed_at timestamptz
);

create table public.ai_dpe_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  status text not null default 'in_progress',
  started_at timestamptz not null default now()
);
alter table public.ai_dpe_sessions enable row level security;
create policy "Students can view their own AI DPE sessions" on public.ai_dpe_sessions for select using (auth.uid() = profile_id);

create table public.ai_cfi_messages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  content text
);
alter table public.ai_cfi_messages enable row level security;
create policy "Members can view their own Ask Andrew history" on public.ai_cfi_messages for select using (auth.uid() = profile_id);

create table public.study_pack_entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  pack_id text not null,
  source text,
  unique (profile_id, pack_id)
);
alter table public.study_pack_entitlements enable row level security;
create policy "Members can view their own study pack entitlements" on public.study_pack_entitlements for select using (auth.uid() = profile_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text,
  body text,
  type text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "Users see own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "Users update own notifications" on public.notifications for update using (user_id = auth.uid());
-- BEFORE-state insert policy, verbatim per live-verified production state:
create policy "Staff insert notifications" on public.notifications for insert with check (true);

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  anon_id text,
  profile_id uuid,
  properties jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.analytics_events enable row level security;
create policy "Anyone can log an analytics event" on public.analytics_events for insert with check (true);

-- ---------------------------------------------------------------------
-- Functions (bodies copied verbatim from pg_get_functiondef() output read
-- against the live project in Sprint 0 Phase 1/1B)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
 returns boolean
 language sql stable security definer
as $function$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$function$;

create or replace function public.is_admin(p_uid uuid)
 returns boolean
 language sql stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin')
$function$;

create or replace function public.is_staff()
 returns boolean
 language sql stable security definer
as $function$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'instructor'));
$function$;

create or replace function public.is_office_manager(p_uid uuid)
 returns boolean
 language sql stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.profiles where id = p_uid and role = 'office_manager')
$function$;

create or replace function public.is_operations_staff(p_uid uuid)
 returns boolean
 language sql stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles where id = p_uid and role in ('admin', 'instructor')
  )
$function$;

-- Now that is_admin()/is_staff() exist, add the admin/staff-dependent
-- policies that reference them:
create policy "Admins can view all profiles" on public.profiles for select using (public.is_admin(auth.uid()));
create policy "Admins can view all XP ledger entries" on public.xp_ledger for select using (public.is_admin(auth.uid()));
create policy "Admins can view all AI DPE sessions" on public.ai_dpe_sessions for select using (public.is_admin(auth.uid()));
create policy "Admins can view all Ask Andrew history" on public.ai_cfi_messages for select using (public.is_admin(auth.uid()));
create policy "Admins can manage study pack entitlements" on public.study_pack_entitlements for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
alter policy "Members can view their own study pack entitlements" on public.study_pack_entitlements using (auth.uid() = profile_id or public.is_admin(auth.uid()));
create policy "Admins can view analytics events" on public.analytics_events for select using (public.is_admin(auth.uid()));

-- BEFORE-state funnel_report, verbatim from supabase-portal-schema-v39.sql
-- (plain view, no security_invoker => runs as owner postgres, which
-- bypasses RLS -- this is the bug 005 fixes):
create or replace view public.funnel_report as
select
  event_name,
  count(*) as total_events,
  count(distinct coalesce(anon_id, profile_id::text)) as unique_visitors,
  min(created_at) as first_seen,
  max(created_at) as last_seen
from public.analytics_events
group by event_name
order by min(created_at);

-- award_xp -- verbatim body
create or replace function public.award_xp(p_profile_id uuid, p_event_type text, p_xp_amount integer, p_source_table text, p_source_id text, p_metadata jsonb DEFAULT '{}'::jsonb)
 returns boolean
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v_inserted_id uuid;
  v_new_total integer;
  v_new_rank text;
begin
  insert into public.xp_ledger (profile_id, event_type, xp_amount, source_table, source_id, metadata)
  values (p_profile_id, p_event_type, p_xp_amount, p_source_table, p_source_id, p_metadata)
  on conflict (profile_id, event_type, source_id) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return false;
  end if;

  update public.profiles
  set total_xp = total_xp + p_xp_amount
  where id = p_profile_id
  returning total_xp into v_new_total;

  select rank_key into v_new_rank
  from public.pilot_ranks
  where min_xp <= v_new_total
    and (
      rank_key not in ('apex_captain', 'legend')
      or exists (
        select 1 from public.member_milestones
        where profile_id = p_profile_id and milestone_key = 'private_pilot_checkride_passed'
      )
    )
  order by min_xp desc
  limit 1;

  if v_new_rank is not null then
    update public.profiles set current_rank = v_new_rank where id = p_profile_id;
  end if;

  return true;
end;
$function$;

create or replace function public.admin_award_xp(p_profile_id uuid, p_xp_amount integer, p_reason text)
 returns boolean
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_awarded boolean;
begin
  if not exists (select 1 from public.profiles where id = v_admin and role = 'admin') then
    raise exception 'Admin access required.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required for manual XP awards.';
  end if;

  v_awarded := public.award_xp(
    p_profile_id, 'admin_manual_award', p_xp_amount, 'admin_audit_log', gen_random_uuid()::text,
    jsonb_build_object('reason', p_reason, 'awarded_by', v_admin)
  );

  insert into public.admin_audit_log (admin_id, action, target_profile_id, previous_value, new_value, reason)
  values (v_admin, 'award_xp', p_profile_id, null, jsonb_build_object('xp_amount', p_xp_amount)::text, p_reason);

  return v_awarded;
end;
$function$;

create or replace function public.trg_award_xp_practice_attempt_stub()
 returns trigger
 language plpgsql security definer
 set search_path to 'public'
as $function$
begin
  perform public.award_xp(new.profile_id, 'practice_set_completed', 25, 'stub_practice_attempts', new.id::text);
  return new;
end;
$function$;

create table public.stub_practice_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  completed_at timestamptz
);
create trigger trg_award_xp_practice_attempt after insert on public.stub_practice_attempts
  for each row when (new.completed_at is not null) execute function public.trg_award_xp_practice_attempt_stub();

create or replace function public.admin_unlock_checkride_prep(p_profile_id uuid)
 returns boolean
 language plpgsql security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;
  update public.profiles set checkride_prep_unlocked = true where id = p_profile_id;
  return true;
end;
$function$;

-- Representative admin-gated analytics function standing in for the
-- get_*_funnel_stats/get_marketing_*/get_retention_kpis family (004) --
-- same `if not is_admin() then raise exception` shape as every one of them.
create or replace function public.get_retention_kpis()
 returns jsonb
 language plpgsql stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

-- Remaining admin/staff-gated functions targeted by 004 -- stubbed with
-- the same `if not is_admin() then raise exception` shape as their real
-- counterparts (verified in Phase 1B) so migration v107 can be applied to
-- this harness unmodified and its exact function-signature REVOKE/GRANT
-- statements proven against real objects, not skipped.
create or replace function public.assign_ground_school_class_bid(p_bid_id uuid) returns boolean
 language plpgsql security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required.'; end if; return true; end; $f$;

create or replace function public.cancel_scheduled_ground_class_enrollment(p_enrollment_id uuid) returns boolean
 language plpgsql security definer set search_path to 'public' as $f$
begin if not (public.is_admin(auth.uid()) or public.is_office_manager(auth.uid())) then raise exception 'Admin access required.'; end if; return true; end; $f$;

create or replace function public.finish_scheduled_ground_class(p_class_id uuid) returns boolean
 language plpgsql security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Only the assigned instructor or an admin can finish this class.'; end if; return true; end; $f$;

create or replace function public.start_scheduled_ground_class(p_class_id uuid) returns boolean
 language plpgsql security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Only the assigned instructor or an admin can start this class.'; end if; return true; end; $f$;

create or replace function public.get_activation_email_kpis(p_days integer default 30) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '{}'::jsonb; end; $f$;

create or replace function public.get_analytics_data_quality(p_documented_event_count integer default null) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '{}'::jsonb; end; $f$;

create or replace function public.get_channel_performance(p_start timestamptz default null, p_end timestamptz default null) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '[]'::jsonb; end; $f$;

create or replace function public.get_checkride_prep_funnel_stats(p_start timestamptz default null, p_end timestamptz default null) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '{}'::jsonb; end; $f$;

create or replace function public.get_ground_school_funnel_stats(p_start timestamptz default null, p_end timestamptz default null) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '{}'::jsonb; end; $f$;

create or replace function public.get_marketing_executive_funnel(p_start timestamptz default null, p_end timestamptz default null) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '{}'::jsonb; end; $f$;

create or replace function public.get_marketing_revenue_summary(p_start timestamptz default null, p_end timestamptz default null) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '{}'::jsonb; end; $f$;

create or replace function public.get_portal_activation_funnel(p_start timestamptz default null, p_end timestamptz default null) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '{}'::jsonb; end; $f$;

create or replace function public.get_readiness_funnel_stats(p_start timestamptz default null, p_end timestamptz default null) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '{}'::jsonb; end; $f$;

create or replace function public.get_utm_campaign_performance(p_start timestamptz default null, p_end timestamptz default null) returns jsonb
 language plpgsql stable security definer set search_path to 'public' as $f$
begin if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if; return '[]'::jsonb; end; $f$;

-- confirm_scheduled_ground_class_enrollment -- both overloads, verbatim
create or replace function public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id uuid, p_full_name text, p_email text, p_profile_id uuid, p_stripe_session_id text, p_amount_cents integer)
 returns scheduled_ground_class_enrollments
 language plpgsql security definer
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
    and payment_status = 'paid';
  if found then
    return v_existing;
  end if;

  if v_class.enrolled_count >= v_class.capacity then
    raise exception 'Scheduled ground school class is full.';
  end if;

  insert into public.scheduled_ground_class_enrollments (
    scheduled_ground_class_id, profile_id, full_name, email, stripe_session_id, amount_cents, payment_status
  ) values (
    p_scheduled_ground_class_id, p_profile_id, trim(p_full_name), lower(trim(p_email)), p_stripe_session_id,
    coalesce(p_amount_cents, 2500), 'paid'
  ) returning * into v_enrollment;

  update public.scheduled_ground_classes set enrolled_count = enrolled_count + 1 where id = p_scheduled_ground_class_id;

  return v_enrollment;
end;
$function$;

create or replace function public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id uuid, p_full_name text, p_email text, p_profile_id uuid, p_stripe_session_id text, p_amount_cents integer, p_payment_status text DEFAULT 'paid'::text)
 returns scheduled_ground_class_enrollments
 language plpgsql security definer
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
    scheduled_ground_class_id, profile_id, full_name, email, stripe_session_id, amount_cents, payment_status
  ) values (
    p_scheduled_ground_class_id, p_profile_id, trim(p_full_name), lower(trim(p_email)), p_stripe_session_id,
    coalesce(p_amount_cents, 2500), p_payment_status
  ) returning * into v_enrollment;

  update public.scheduled_ground_classes set enrolled_count = enrolled_count + 1 where id = p_scheduled_ground_class_id;

  return v_enrollment;
end;
$function$;

create or replace function public.enroll_in_ground_school_via_pack(p_scheduled_ground_class_id uuid)
 returns scheduled_ground_class_enrollments
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v_profile public.profiles%rowtype;
  v_class public.scheduled_ground_classes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found or not v_profile.private_pilot_ground_school_pack_unlocked then
    raise exception 'This account has not unlocked the Private Pilot Ground School pack.';
  end if;

  select * into v_class from public.scheduled_ground_classes where id = p_scheduled_ground_class_id;
  if not found then
    raise exception 'Scheduled ground school class not found.';
  end if;
  if v_class.course_id <> 'PPL' then
    raise exception 'The Private Pilot Ground School pack only covers Private Pilot classes.';
  end if;

  return public.confirm_scheduled_ground_class_enrollment(
    p_scheduled_ground_class_id, v_profile.full_name, v_profile.email, v_profile.id,
    'pack_' || gen_random_uuid()::text, 0, 'ground_school_pack'
  );
end;
$function$;

create or replace function public.confirm_legacy_ground_registration(p_session_id uuid, p_full_name text, p_email text, p_profile_id uuid, p_stripe_session_id text, p_amount_cents integer)
 returns ground_registrations
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v_max_students integer;
  v_confirmed_count integer;
  v_is_waitlisted boolean;
  v_existing public.ground_registrations%rowtype;
  v_registration public.ground_registrations%rowtype;
begin
  select * into v_existing from public.ground_registrations where stripe_session_id = p_stripe_session_id;
  if found then
    return v_existing;
  end if;

  select max_students into v_max_students from public.ground_sessions where id = p_session_id for update;

  select * into v_existing
  from public.ground_registrations
  where session_id = p_session_id and lower(email) = lower(p_email) and payment_status = 'paid';
  if found then
    return v_existing;
  end if;

  select count(*) into v_confirmed_count from public.ground_registrations where session_id = p_session_id and is_waitlisted = false;
  v_is_waitlisted := v_max_students is not null and v_confirmed_count >= v_max_students;

  insert into public.ground_registrations (session_id, full_name, email, is_waitlisted, profile_id, stripe_session_id, amount_cents, payment_status)
  values (p_session_id, p_full_name, p_email, v_is_waitlisted, p_profile_id, p_stripe_session_id, p_amount_cents, 'paid')
  returning * into v_registration;

  return v_registration;
end;
$function$;

create or replace function public.claim_ground_school_enrollments_by_email(p_profile_id uuid, p_email text)
 returns integer
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  update public.scheduled_ground_class_enrollments
  set profile_id = p_profile_id
  where lower(email) = lower(p_email) and profile_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.claim_readiness_assessment_by_email(p_profile_id uuid, p_email text)
 returns integer
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  update public.readiness_assessment_leads
  set profile_id = p_profile_id, claimed_at = now()
  where lower(email) = lower(p_email) and profile_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.record_referral_signup(p_new_profile_id uuid, p_email text, p_ref_code text DEFAULT NULL::text)
 returns void
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v_referrer_id uuid;
  v_pending_id uuid;
begin
  if p_email is null or p_email = '' then
    return;
  end if;

  if exists (select 1 from public.portal_referrals where referred_profile_id = p_new_profile_id) then
    return;
  end if;

  select id into v_pending_id
  from public.portal_referrals
  where lower(referred_email) = lower(p_email) and status = 'pending' and referred_profile_id is null
  order by created_at asc limit 1;

  if v_pending_id is not null then
    update public.portal_referrals set status = 'signed_up', referred_profile_id = p_new_profile_id where id = v_pending_id;
    return;
  end if;

  if p_ref_code is not null and p_ref_code <> '' then
    select profile_id into v_referrer_id from public.portal_referral_codes where lower(code) = lower(p_ref_code) limit 1;
    if v_referrer_id is not null and v_referrer_id <> p_new_profile_id then
      insert into public.portal_referrals (referrer_id, referred_email, referred_profile_id, status)
      values (v_referrer_id, p_email, p_new_profile_id, 'signed_up');
    end if;
  end if;
end;
$function$;

-- lock_profile_privileged_columns -- the real enforcement behind
-- "Members can update their own profile" having no column restriction
create or replace function public.lock_profile_privileged_columns()
 returns trigger
 language plpgsql security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin(auth.uid()) then
    new.role := old.role;
    new.checkride_prep_unlocked := old.checkride_prep_unlocked;
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$function$;
create trigger lock_profile_privileged_columns before update on public.profiles
  for each row execute function public.lock_profile_privileged_columns();
