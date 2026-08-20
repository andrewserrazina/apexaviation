-- Checkride Readiness Assessment V1 -- upgrades the existing, already-
-- live readiness_assessment_leads table (v41.sql, site/readiness-
-- assessment.html) in place rather than creating a parallel
-- checkride_readiness_attempts table: same purpose, same shape, just
-- richer. Nonbuyers.jsx's existing query (email, score, readiness_level,
-- category_results, created_at) is untouched -- every change here is
-- additive.
alter table public.readiness_assessment_leads
  add column if not exists profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists strongest_category text,
  add column if not exists weakest_category_1 text,
  add column if not exists weakest_category_2 text,
  add column if not exists answers_json jsonb not null default '[]'::jsonb,
  add column if not exists source text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text;

create index if not exists readiness_assessment_leads_profile_id_idx on public.readiness_assessment_leads (profile_id);

-- A member can now see their own attempts (needed for the dashboard
-- baseline card and the inline "log in to unlock" flow) -- additive to
-- the existing "Anyone can submit" (insert) and "Admins can view all"
-- (select) policies, neither of which is touched.
create policy "Users can view their own readiness assessments"
  on public.readiness_assessment_leads for select
  using (auth.uid() = profile_id);

-- Reconciliation for a NEW account: create-free-account calls this after
-- account creation, exactly the same non-fatal, service-role-only
-- pattern as claim_ground_school_enrollments_by_email() (v77.sql) and
-- record_referral_signup() (v73.sql) -- someone who took the assessment
-- anonymously, then signed up afterward, gets every one of their prior
-- attempts (not just the latest -- retakes before signup should all
-- surface) attached to their new profile. Returns the count claimed so
-- the caller can log it as a distinct, countable admin-funnel event the
-- same way the GS enrollment claim does.
create or replace function public.claim_readiness_assessment_by_email(
  p_profile_id uuid,
  p_email text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed integer;
begin
  if p_email is null or p_email = '' then
    return 0;
  end if;

  update public.readiness_assessment_leads
  set profile_id = p_profile_id
  where profile_id is null
    and lower(email) = lower(p_email);

  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

grant execute on function public.claim_readiness_assessment_by_email(uuid, text) to service_role;
