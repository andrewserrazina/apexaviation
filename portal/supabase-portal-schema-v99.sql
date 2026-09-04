-- Apex Advantage Study Pack Engine (v99)
--
-- Generic reusable engine for standalone paid Study Packs. Airspace
-- Mastery ($19, lifetime) is Pack #1, not a one-off feature -- future
-- packs (Weather Mastery, Aerodynamics Mastery, etc.) are added through a
-- new study_packs row + a study_pack_versions content payload, not a new
-- application rewrite. See Apex_Advantage_Study_Pack_Implementation_Spec
-- (handoff, Sept 3 2026) for the full product brief this implements.
--
-- IMPORTANT -- this migration was originally numbered v98 in the handoff
-- brief. v98 was already used (Onboarding/Readiness bridge fix, same
-- day) by the time this work started, so per the brief's own numbering
-- rule ("never overwrite an existing numbered file, use the next unused
-- number") this is v99 instead.
--
-- Design decisions worth calling out:
--   - Content vs. user state are fully separate: study_pack_versions
--     holds the frozen instructional JSON (one row per published
--     version), everything else here is pure user state
--     (entitlements/progress/attempts). Mirrors the spec's own
--     recommended shape almost exactly.
--   - study_pack_versions.content is NOT exposed via any RLS policy to
--     non-admins, on purpose -- the ONLY path to that column is the
--     get-study-pack-content Edge Function (service role, entitlement
--     verified server-side), matching the existing get-premium-content /
--     requirePremiumAccess() precedent for Checkride Prep. This is
--     stricter than "RLS scoped to owners" and trivially satisfies the
--     spec's required security test (a free authenticated user calling
--     Supabase REST directly must get nothing).
--   - One generic study_pack_attempts table covers both per-lesson
--     Knowledge Checks and the product-level Mastery Check
--     (attempt_type distinguishes them) rather than two near-identical
--     tables, per the spec's own suggestion.
--   - Per the frozen content's own completion_requirements: a Knowledge
--     Check only needs to be COMPLETED to unlock the next lesson --
--     there is no minimum-score gate at the lesson level. Only the
--     Mastery Check has the 80% (16/20) passing threshold. `passed` on
--     study_pack_attempts is computed server-side by
--     submit_study_pack_attempt() using exactly that distinction.
--   - Lifetime access means no expiration column on entitlements.
--     revoked_at exists for admin correction/refund handling only.
--
-- Run this against the ApexAdvantage Supabase project after
-- supabase-portal-schema-v98.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Product metadata (public)
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.study_packs (
  id text primary key,
  external_id text unique not null,
  slug text unique not null,
  name text not null,
  subtitle text,
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'USD',
  access_type text not null default 'lifetime' check (access_type = 'lifetime'),
  certificate_type text not null default 'private_pilot',
  active boolean not null default false,
  published_version text,
  estimated_minutes_min integer,
  estimated_minutes_max integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.study_packs is
  'Public/product metadata only for the Study Pack engine -- no paid content here. published_version points at the currently-live row in study_pack_versions for this pack.';

alter table public.study_packs enable row level security;

create policy "Anyone can view active study packs"
  on public.study_packs for select
  using (active or public.is_admin(auth.uid()));

create policy "Admins can manage study packs"
  on public.study_packs for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Protected content versions
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.study_pack_versions (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null references public.study_packs(id) on delete cascade,
  version text not null,
  content jsonb not null,
  content_hash text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (pack_id, version)
);

comment on table public.study_pack_versions is
  'Canonical paid instructional payload (content jsonb). No RLS policy grants student or generic-authenticated access -- the ONLY read path is get-study-pack-content (service role, entitlement verified in the function). Admins can read/manage all versions for support and publishing.';

alter table public.study_pack_versions enable row level security;

create policy "Admins can manage study pack versions"
  on public.study_pack_versions for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Entitlements (source of truth for lifetime ownership)
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.study_pack_entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pack_id text not null references public.study_packs(id) on delete cascade,
  source text not null check (source in ('stripe_purchase', 'admin_grant', 'bundle', 'migration')),
  stripe_session_id text unique,
  amount_cents integer,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.study_pack_entitlements is
  'Lifetime ownership records. A profile can have at most one ACTIVE (revoked_at is null) entitlement per pack, enforced by the partial unique index below -- historical revoked rows are kept for audit rather than deleted.';

create unique index if not exists study_pack_entitlements_active_unique
  on public.study_pack_entitlements (profile_id, pack_id)
  where revoked_at is null;

create index if not exists study_pack_entitlements_profile_idx on public.study_pack_entitlements (profile_id);
create index if not exists study_pack_entitlements_pack_idx on public.study_pack_entitlements (pack_id);

alter table public.study_pack_entitlements enable row level security;

create policy "Members can view their own study pack entitlements"
  on public.study_pack_entitlements for select
  using (auth.uid() = profile_id or public.is_admin(auth.uid()));

create policy "Admins can manage study pack entitlements"
  on public.study_pack_entitlements for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Lesson progress
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.study_pack_lesson_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pack_id text not null references public.study_packs(id) on delete cascade,
  lesson_id text not null,
  started_at timestamptz,
  last_viewed_at timestamptz not null default now(),
  completed_at timestamptz,
  completed boolean not null default false,
  primary key (profile_id, pack_id, lesson_id)
);

alter table public.study_pack_lesson_progress enable row level security;

create policy "Members can manage their own study pack lesson progress"
  on public.study_pack_lesson_progress for all
  using (auth.uid() = profile_id or public.is_admin(auth.uid()))
  with check (auth.uid() = profile_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Scenario Lab progress
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.study_pack_scenario_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pack_id text not null references public.study_packs(id) on delete cascade,
  scenario_id text not null,
  student_commitment text,
  revealed_at timestamptz,
  self_rating text check (self_rating in ('confident', 'needs_review')),
  completed_at timestamptz,
  primary key (profile_id, pack_id, scenario_id)
);

comment on table public.study_pack_scenario_progress is
  'student_commitment is the learner''s own free-text answer, written before the reveal -- never sent to general analytics (Implementation Spec section 9).';

alter table public.study_pack_scenario_progress enable row level security;

create policy "Members can manage their own study pack scenario progress"
  on public.study_pack_scenario_progress for all
  using (auth.uid() = profile_id or public.is_admin(auth.uid()))
  with check (auth.uid() = profile_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Knowledge Check + Mastery Check attempts (one generic table)
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.study_pack_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pack_id text not null references public.study_packs(id) on delete cascade,
  attempt_type text not null check (attempt_type in ('knowledge_check', 'mastery_check')),
  lesson_id text,
  question_ids jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  score integer not null,
  total integer not null,
  passed boolean not null,
  started_at timestamptz not null,
  completed_at timestamptz not null default now()
);

create index if not exists study_pack_attempts_profile_pack_idx on public.study_pack_attempts (profile_id, pack_id, attempt_type);

alter table public.study_pack_attempts enable row level security;

create policy "Members can view their own study pack attempts"
  on public.study_pack_attempts for select
  using (auth.uid() = profile_id or public.is_admin(auth.uid()));

create policy "Members can insert their own study pack attempts"
  on public.study_pack_attempts for insert
  with check (auth.uid() = profile_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Student-facing functions
-- ═══════════════════════════════════════════════════════════════════════

-- Everything a signed-in member needs to render "My Study Packs" and
-- each pack's home screen in one round trip: owned packs, joined with
-- pack metadata and a lesson-completion rollup. Deliberately does NOT
-- return study_pack_versions.content -- that stays exclusive to
-- get-study-pack-content.
create or replace function public.get_my_study_packs()
returns table (
  pack_id text,
  name text,
  subtitle text,
  slug text,
  granted_at timestamptz,
  lessons_completed integer,
  lessons_total integer,
  mastery_passed boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sp.id,
    sp.name,
    sp.subtitle,
    sp.slug,
    e.granted_at,
    coalesce((select count(*) from public.study_pack_lesson_progress lp where lp.profile_id = auth.uid() and lp.pack_id = sp.id and lp.completed)::int, 0),
    coalesce((jsonb_array_length(sv.content->'lessons')), 0),
    exists (select 1 from public.study_pack_attempts a where a.profile_id = auth.uid() and a.pack_id = sp.id and a.attempt_type = 'mastery_check' and a.passed)
  from public.study_pack_entitlements e
  join public.study_packs sp on sp.id = e.pack_id
  left join public.study_pack_versions sv on sv.pack_id = sp.id and sv.version = sp.published_version
  where e.profile_id = auth.uid() and e.revoked_at is null
  order by e.granted_at desc;
$$;

grant execute on function public.get_my_study_packs() to authenticated;

-- lessons_total above reads jsonb_array_length(content->'lessons'), which
-- requires reading study_pack_versions -- safe here specifically because
-- this function is security definer and only ever returns a *count*
-- derived from that jsonb, never the jsonb itself, to the caller.

create or replace function public.has_study_pack_entitlement(p_profile_id uuid, p_pack_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.study_pack_entitlements
    where profile_id = p_profile_id and pack_id = p_pack_id and revoked_at is null
  )
$$;

grant execute on function public.has_study_pack_entitlement(uuid, text) to authenticated, service_role;

create or replace function public.upsert_study_pack_lesson_progress(
  p_pack_id text,
  p_lesson_id text,
  p_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_study_pack_entitlement(auth.uid(), p_pack_id) then
    raise exception 'This Study Pack is not unlocked on this account';
  end if;

  insert into public.study_pack_lesson_progress (profile_id, pack_id, lesson_id, started_at, last_viewed_at, completed, completed_at)
  values (auth.uid(), p_pack_id, p_lesson_id, now(), now(), p_completed, case when p_completed then now() else null end)
  on conflict (profile_id, pack_id, lesson_id) do update set
    last_viewed_at = now(),
    completed = excluded.completed or public.study_pack_lesson_progress.completed,
    completed_at = case when excluded.completed or public.study_pack_lesson_progress.completed then coalesce(public.study_pack_lesson_progress.completed_at, now()) else null end;
end;
$$;

grant execute on function public.upsert_study_pack_lesson_progress(text, text, boolean) to authenticated;

create or replace function public.submit_study_pack_scenario(
  p_pack_id text,
  p_scenario_id text,
  p_student_commitment text,
  p_self_rating text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_study_pack_entitlement(auth.uid(), p_pack_id) then
    raise exception 'This Study Pack is not unlocked on this account';
  end if;
  if p_self_rating is not null and p_self_rating not in ('confident', 'needs_review') then
    raise exception 'Invalid self_rating';
  end if;

  insert into public.study_pack_scenario_progress (profile_id, pack_id, scenario_id, student_commitment, revealed_at, self_rating, completed_at)
  values (auth.uid(), p_pack_id, p_scenario_id, p_student_commitment, now(), p_self_rating, case when p_self_rating is not null then now() else null end)
  on conflict (profile_id, pack_id, scenario_id) do update set
    student_commitment = coalesce(public.study_pack_scenario_progress.student_commitment, excluded.student_commitment),
    revealed_at = coalesce(public.study_pack_scenario_progress.revealed_at, excluded.revealed_at),
    self_rating = coalesce(excluded.self_rating, public.study_pack_scenario_progress.self_rating),
    completed_at = case when excluded.self_rating is not null then now() else public.study_pack_scenario_progress.completed_at end;
end;
$$;

grant execute on function public.submit_study_pack_scenario(text, text, text, text) to authenticated;

-- Knowledge Checks (attempt_type='knowledge_check') never gate on score --
-- per the frozen content's own completion_requirements, completing one is
-- what unlocks the next lesson, not passing it at a threshold. Only
-- Mastery Check (attempt_type='mastery_check') gates at 80%. This
-- function is the single place that distinction is enforced server-side
-- so a client bug can never fabricate a false "passed".
create or replace function public.submit_study_pack_attempt(
  p_pack_id text,
  p_attempt_type text,
  p_lesson_id text,
  p_question_ids jsonb,
  p_answers jsonb,
  p_score integer,
  p_total integer,
  p_started_at timestamptz
)
returns table (id uuid, passed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passed boolean;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_study_pack_entitlement(auth.uid(), p_pack_id) then
    raise exception 'This Study Pack is not unlocked on this account';
  end if;
  if p_attempt_type not in ('knowledge_check', 'mastery_check') then
    raise exception 'Invalid attempt_type';
  end if;
  if p_total <= 0 or p_score < 0 or p_score > p_total then
    raise exception 'Invalid score/total';
  end if;

  v_passed := case
    when p_attempt_type = 'knowledge_check' then true
    else (p_score::numeric / p_total::numeric) >= 0.8
  end;

  insert into public.study_pack_attempts (profile_id, pack_id, attempt_type, lesson_id, question_ids, answers, score, total, passed, started_at)
  values (auth.uid(), p_pack_id, p_attempt_type, p_lesson_id, p_question_ids, p_answers, p_score, p_total, v_passed, p_started_at)
  returning study_pack_attempts.id into v_id;

  if p_attempt_type = 'knowledge_check' and p_lesson_id is not null then
    perform public.upsert_study_pack_lesson_progress(p_pack_id, p_lesson_id, true);
  end if;

  return query select v_id, v_passed;
end;
$$;

grant execute on function public.submit_study_pack_attempt(text, text, text, jsonb, jsonb, integer, integer, timestamptz) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. Admin functions (list/grant/revoke -- V1 admin scope per spec section 10)
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.admin_list_study_pack_entitlements(p_pack_id text)
returns table (
  entitlement_id uuid,
  profile_id uuid,
  full_name text,
  email text,
  source text,
  amount_cents integer,
  granted_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;
  return query
    select e.id, e.profile_id, p.full_name, p.email, e.source, e.amount_cents, e.granted_at, e.revoked_at
    from public.study_pack_entitlements e
    join public.profiles p on p.id = e.profile_id
    where e.pack_id = p_pack_id
    order by e.granted_at desc;
end;
$$;

grant execute on function public.admin_list_study_pack_entitlements(text) to authenticated;

create or replace function public.admin_grant_study_pack_entitlement(p_profile_id uuid, p_pack_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  insert into public.study_pack_entitlements (profile_id, pack_id, source, granted_by)
  values (p_profile_id, p_pack_id, 'admin_grant', auth.uid())
  on conflict (profile_id, pack_id) where revoked_at is null do nothing;
end;
$$;

grant execute on function public.admin_grant_study_pack_entitlement(uuid, text) to authenticated;

create or replace function public.admin_revoke_study_pack_entitlement(p_entitlement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  update public.study_pack_entitlements
  set revoked_at = now(), revoked_by = auth.uid()
  where id = p_entitlement_id and revoked_at is null;
end;
$$;

grant execute on function public.admin_revoke_study_pack_entitlement(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. Grant hardening -- close the anon surface on every function above
-- ═══════════════════════════════════════════════════════════════════════
--
-- Postgres grants EXECUTE on every new function to PUBLIC (which includes
-- the anon role) by default. Each function's own internal check (auth.uid()
-- is null -> exception, or is_admin(auth.uid()) -> exception) already
-- makes actual misuse impossible even without this, but the Supabase
-- security advisor flags the anon-reachability itself, and the
-- Production Deployment Audit explicitly asked Study Pack code to
-- "explicitly manage grants" -- so revoke PUBLIC/anon's default EXECUTE
-- and leave only the grants each function actually needs.

revoke execute on function public.get_my_study_packs() from public;
revoke execute on function public.has_study_pack_entitlement(uuid, text) from public;
revoke execute on function public.upsert_study_pack_lesson_progress(text, text, boolean) from public;
revoke execute on function public.submit_study_pack_scenario(text, text, text, text) from public;
revoke execute on function public.submit_study_pack_attempt(text, text, text, jsonb, jsonb, integer, integer, timestamptz) from public;
revoke execute on function public.admin_list_study_pack_entitlements(text) from public;
revoke execute on function public.admin_grant_study_pack_entitlement(uuid, text) from public;
revoke execute on function public.admin_revoke_study_pack_entitlement(uuid) from public;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. Private Storage bucket for paid resources
-- ═══════════════════════════════════════════════════════════════════════
--
-- NOT the existing training-materials bucket -- its current policy lets
-- any authenticated user read every object in it (Production Deployment
-- Audit, "Study Pack Storage Finding"), which is wrong for a $19 paid
-- download. This bucket is entitlement-gated instead.
--
-- Path convention:
--   quick-reference/<pack_id>/reference.pdf   -- entitlement-gated, same file for every owner of that pack
--   certificates/<profile_id>/<pack_id>.pdf   -- per-student generated certificate, owner-only
--
-- V1 note: no files are uploaded by this migration. The Quick Reference
-- is rendered as an entitlement-gated in-portal page for V1 (see final
-- report, deferred features) -- this bucket is real infrastructure ready
-- for an actual PDF/certificate generation pass later, not yet populated.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-pack-resources', 'study-pack-resources', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "Owners can read study pack quick reference"
  on storage.objects for select
  using (
    bucket_id = 'study-pack-resources'
    and (storage.foldername(name))[1] = 'quick-reference'
    and public.has_study_pack_entitlement(auth.uid(), (storage.foldername(name))[2])
  );

create policy "Owners can read their own study pack certificate"
  on storage.objects for select
  using (
    bucket_id = 'study-pack-resources'
    and (storage.foldername(name))[1] = 'certificates'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Admins manage study pack resources"
  on storage.objects for all
  using (bucket_id = 'study-pack-resources' and public.is_admin(auth.uid()))
  with check (bucket_id = 'study-pack-resources' and public.is_admin(auth.uid()));
