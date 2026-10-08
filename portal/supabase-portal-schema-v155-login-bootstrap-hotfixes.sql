-- Live verification hotfixes (v155)
--
-- Found walking through the portal end-to-end as a real test account
-- (unrelated to what was being verified -- surfaced as console errors on
-- every single login).

-- (1) claim_first_portal_login declared v_claimed as `boolean` but
-- GET DIAGNOSTICS ... = ROW_COUNT always assigns an integer, then the
-- function's own `return v_claimed > 0` makes the intent obvious (hold
-- the row count, return whether it's > 0) -- the declared type was the
-- bug. This failed with "operator does not exist: boolean > integer" on
-- every login, silently (caught and console.error'd client-side), which
-- meant the 'portal_first_login' analytics event and the
-- CompleteRegistration Meta Pixel event never fired for ANY member, on
-- ANY login, since whenever this bug was introduced.
create or replace function public.claim_first_portal_login(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claimed integer := 0;
begin
  if auth.uid() is null or auth.uid() <> p_profile_id then
    raise exception 'Not authorized to claim first-login for this profile';
  end if;

  update public.profiles
    set first_portal_login_at = now()
    where id = p_profile_id
      and first_portal_login_at is null;

  get diagnostics v_claimed = row_count;
  return v_claimed > 0;
end;
$$;

-- (2) portal_study_activity's RLS policy ("Users manage their own study
-- activity", cmd ALL, auth.uid() = profile_id) already correctly scopes
-- writes to the owning member -- the table-level INSERT/UPDATE grants to
-- `authenticated` were simply never issued when this table was created,
-- so bumpStudyDay()'s upsert (fires on every answered question/scenario)
-- has been failing with "permission denied for table
-- portal_study_activity" for every member, silently, breaking the
-- streak/study-day tracking this portal's retention metrics depend on.
grant insert, update on public.portal_study_activity to authenticated;
