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

-- ---------------------------------------------------------------------
-- Mission/streak maintenance (Phase B, v111) -- supporting tables and
-- functions, bodies copied verbatim from pg_get_functiondef() output
-- read against the live project.
-- ---------------------------------------------------------------------
alter table public.profiles add column last_qualifying_study_date date;
alter table public.profiles add column streak_freezes_banked integer not null default 0;
alter table public.profiles add column timezone text;

create or replace function public.member_local_date(p_profile_id uuid)
 returns date
 language sql stable
 set search_path to 'public'
as $function$
  select (now() at time zone coalesce(
    (select timezone from public.profiles where id = p_profile_id), 'UTC'
  ))::date
$function$;

create table public.portal_study_activity (
  profile_id uuid not null,
  activity_date date not null,
  seconds integer not null default 0,
  primary key (profile_id, activity_date)
);
alter table public.portal_study_activity enable row level security;
create policy "Members view their own study activity" on public.portal_study_activity for select using (auth.uid() = profile_id);

create table public.portal_question_progress (
  profile_id uuid not null,
  question_id text not null,
  completed boolean not null default false,
  favorited boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (profile_id, question_id)
);
alter table public.portal_question_progress enable row level security;
create policy "Members view their own question progress" on public.portal_question_progress for select using (auth.uid() = profile_id);

create table public.portal_practice_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  score integer,
  total integer,
  completed_at timestamptz
);
alter table public.portal_practice_attempts enable row level security;
create policy "Members view their own practice attempts" on public.portal_practice_attempts for select using (auth.uid() = profile_id);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  is_premium_only boolean not null default false,
  requirement jsonb not null,
  xp_reward integer not null default 0
);

create table public.member_mission_progress (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  mission_id uuid not null,
  progress integer not null default 0,
  target integer not null default 1,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (profile_id, mission_id)
);
alter table public.member_mission_progress enable row level security;
create policy "Members view their own mission progress" on public.member_mission_progress for select using (auth.uid() = profile_id);

create table public.streak_freeze_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  event_type text not null,
  event_date date not null
);

create table public.recovery_sorties (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  missed_date date not null,
  expires_at timestamptz not null,
  unique (profile_id, missed_date)
);
alter table public.recovery_sorties enable row level security;
create policy "Members view their own recovery sorties" on public.recovery_sorties for select using (auth.uid() = profile_id);

create table public.member_subscriptions (
  profile_id uuid primary key,
  status text not null default 'active'
);

create or replace function public.member_has_active_membership(p_profile_id uuid)
 returns boolean
 language sql stable
 set search_path to 'public'
as $function$
  select exists (select 1 from public.member_subscriptions where profile_id = p_profile_id and status in ('active','trialing','past_due'))
$function$;

create or replace function public.get_member_streak(p_profile_id uuid)
 returns table(current_streak integer, longest_streak integer, days_studied integer)
 language plpgsql stable
 set search_path to 'public'
as $function$
declare
  v_today date := public.member_local_date(p_profile_id);
  v_dates date[];
  v_cursor date;
  v_prev date;
  v_run integer := 0;
  v_longest integer := 0;
  v_current integer := 0;
begin
  select array_agg(activity_date order by activity_date) into v_dates
  from public.portal_study_activity
  where profile_id = p_profile_id;

  if v_dates is null then
    return query select 0, 0, 0;
    return;
  end if;

  v_prev := null;
  foreach v_cursor in array v_dates loop
    if v_prev is not null and v_cursor = v_prev + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    if v_run > v_longest then v_longest := v_run; end if;
    v_prev := v_cursor;
  end loop;

  v_cursor := v_today;
  if not (v_cursor = any(v_dates)) then
    v_cursor := v_cursor - 1;
  end if;
  while v_cursor = any(v_dates) loop
    v_current := v_current + 1;
    v_cursor := v_cursor - 1;
  end loop;

  return query select v_current, v_longest, array_length(v_dates, 1);
end;
$function$;

create or replace function public.run_streak_maintenance()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_profile record;
  v_today date;
  v_yesterday date;
  v_day_before date;
  v_streak record;
  v_studied_yesterday boolean;
  v_studied_day_before boolean;
  v_already_handled boolean;
begin
  for v_profile in
    select id, streak_freezes_banked from public.profiles where last_qualifying_study_date is not null
  loop
    v_today := public.member_local_date(v_profile.id);
    v_yesterday := v_today - 1;
    v_day_before := v_today - 2;

    select * into v_streak from public.get_member_streak(v_profile.id);
    if v_streak.current_streak > 0 and v_streak.current_streak % 14 = 0 and v_profile.streak_freezes_banked < 2 then
      if not exists (
        select 1 from public.streak_freeze_events
        where profile_id = v_profile.id and event_type = 'earned' and event_date = v_today
      ) then
        update public.profiles set streak_freezes_banked = streak_freezes_banked + 1 where id = v_profile.id;
        insert into public.streak_freeze_events (profile_id, event_type, event_date) values (v_profile.id, 'earned', v_today);
      end if;
    end if;

    select exists (select 1 from public.portal_study_activity where profile_id = v_profile.id and activity_date = v_yesterday) into v_studied_yesterday;
    select exists (select 1 from public.portal_study_activity where profile_id = v_profile.id and activity_date = v_day_before) into v_studied_day_before;

    if v_studied_day_before and not v_studied_yesterday then
      select exists (
        select 1 from public.streak_freeze_events
        where profile_id = v_profile.id and event_date = v_yesterday and event_type in ('consumed', 'recovery_offered')
      ) into v_already_handled;

      if not v_already_handled then
        if v_profile.streak_freezes_banked > 0 then
          insert into public.portal_study_activity (profile_id, activity_date, seconds)
          values (v_profile.id, v_yesterday, 0)
          on conflict (profile_id, activity_date) do nothing;
          update public.profiles set streak_freezes_banked = streak_freezes_banked - 1 where id = v_profile.id;
          insert into public.streak_freeze_events (profile_id, event_type, event_date) values (v_profile.id, 'consumed', v_yesterday);
        else
          insert into public.recovery_sorties (profile_id, missed_date, expires_at)
          values (v_profile.id, v_yesterday, (v_today + 1)::timestamptz - interval '1 second')
          on conflict (profile_id, missed_date) do nothing;
          insert into public.streak_freeze_events (profile_id, event_type, event_date) values (v_profile.id, 'recovery_offered', v_yesterday);
        end if;
      end if;
    end if;
  end loop;
end;
$function$;

create or replace function public.refresh_mission_progress()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_mission record;
  v_profile record;
  v_progress integer;
  v_target integer;
  v_met boolean;
  v_row_id uuid;
  v_was_completed boolean;
begin
  for v_mission in
    select * from public.missions where current_date between starts_on and ends_on
  loop
    for v_profile in
      select id from public.profiles where checkride_prep_unlocked = true
    loop
      if v_mission.is_premium_only and not public.member_has_active_membership(v_profile.id) then
        continue;
      end if;

      v_progress := 0;
      v_target := coalesce((v_mission.requirement->>'target')::integer, 1);

      if v_mission.requirement->>'type' = 'study_days' then
        select count(distinct activity_date) into v_progress
        from public.portal_study_activity
        where profile_id = v_profile.id
          and activity_date between v_mission.starts_on and v_mission.ends_on
          and seconds > 0;

      elsif v_mission.requirement->>'type' = 'questions_answered' then
        select count(*) into v_progress
        from public.portal_question_progress
        where profile_id = v_profile.id
          and completed = true
          and updated_at::date between v_mission.starts_on and v_mission.ends_on;

      elsif v_mission.requirement->>'type' = 'practice_sets_completed' then
        select count(*) into v_progress
        from public.portal_practice_attempts
        where profile_id = v_profile.id
          and completed_at is not null
          and completed_at::date between v_mission.starts_on and v_mission.ends_on;

      elsif v_mission.requirement->>'type' = 'score_threshold' then
        select exists (
          select 1 from public.portal_practice_attempts
          where profile_id = v_profile.id
            and completed_at is not null
            and completed_at::date between v_mission.starts_on and v_mission.ends_on
            and total > 0
            and (score::float / total) * 100 >= v_target
        ) into v_met;
        v_progress := case when v_met then 1 else 0 end;
        v_target := 1;

      else
        continue;
      end if;

      insert into public.member_mission_progress (profile_id, mission_id, progress, target, updated_at)
      values (v_profile.id, v_mission.id, v_progress, v_target, now())
      on conflict (profile_id, mission_id) do update
        set progress = excluded.progress, target = excluded.target, updated_at = now()
      returning id, (completed_at is not null) into v_row_id, v_was_completed;

      if not v_was_completed and v_progress >= v_target then
        update public.member_mission_progress set completed_at = now() where id = v_row_id;
        perform public.award_xp(v_profile.id, 'mission_completed', v_mission.xp_reward, 'missions', v_mission.id::text);
      end if;
    end loop;
  end loop;
end;
$function$;

-- ---------------------------------------------------------------------
-- Sprint 0 Phase C -- DPE question bank prerequisite (dpe_questions
-- predates Phase C by many migrations, e.g. v5/v68; reproduced here only
-- with the columns v112-v116 and the mobile-* Edge Functions actually
-- read/write, RLS copied verbatim -- admin-SELECT-only, since the real
-- read path for a non-admin caller is always a service-role Edge
-- Function that bypasses RLS entirely, never a direct client query).
-- ---------------------------------------------------------------------
create table public.dpe_categories (
  id text primary key,
  label text not null
);

create table public.dpe_questions (
  id text primary key,
  category text not null references public.dpe_categories(id),
  question text not null,
  model_answer text not null,
  common_mistakes text,
  dpe_evaluating text,
  acs_reference text,
  real_world_application text,
  is_scenario boolean not null default false,
  scenario_order integer,
  sort_order integer not null default 0,
  exam_type text not null default 'private_pilot',
  created_at timestamptz not null default now()
);
alter table public.dpe_questions enable row level security;
create policy "Admins can view all DPE questions"
  on public.dpe_questions for select
  using (public.is_admin(auth.uid()));
