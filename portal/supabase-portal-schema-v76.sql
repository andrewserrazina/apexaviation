-- Ground School -> Portal Growth Funnel sprint, section 4 -- Purchase to
-- Account Attribution.
--
-- handleGroundSchoolRegistration (stripe-webhook/index.ts) already links
-- a $25 registration to an existing profile by email match at purchase
-- time (matchingProfile lookup) -- that case was already correct. The
-- gap is the OTHER direction: someone with no Apex Advantage account at
-- all buys a class anonymously (checkout never requires an account, by
-- design), then creates a free account afterward with the same email.
-- Their scheduled_ground_class_enrollments row was left with
-- profile_id = null permanently, and get_my_ground_school_enrollments()
-- (v65.sql) filters strictly on profile_id = auth.uid(), so that class
-- would never appear on their dashboard.
--
-- Mirrors record_referral_signup()'s (v73.sql) pending-match pattern:
-- a plain email-keyed claim, called once from create-free-account right
-- after the new profile is created.
create or replace function public.claim_ground_school_enrollments_by_email(
  p_profile_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_email is null or p_email = '' then
    return;
  end if;

  update public.scheduled_ground_class_enrollments
  set profile_id = p_profile_id
  where profile_id is null
    and lower(email) = lower(p_email)
    and payment_status in ('paid', 'ground_school_pack');
end;
$$;

grant execute on function public.claim_ground_school_enrollments_by_email(uuid, text) to service_role;
