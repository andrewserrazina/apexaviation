-- Apex Advantage — Activation Optimization Pass (v84)
--
-- Root causes found while auditing why training_stage/primary_focus_area
-- show "not_set" for the current signup cohort (see the accompanying
-- code changes in site/portal-stable.js and the audit notes in the final
-- report -- not repeated in full here):
--
-- 1. showWelcomeOnboarding() only ever ran once per profile, gated behind
--    the SAME atomic claim as portal_first_login/CompleteRegistration
--    (claim_first_portal_login(), v83). That's correct for an analytics
--    event that must fire exactly once ever, but wrong for a UI prompt
--    that's supposed to keep asking until it actually gets an answer --
--    a member who dismissed the card, or whose first session ended
--    before clicking through, permanently lost any future chance to set
--    training_stage/primary_focus_area. Fixed client-side (no schema
--    change needed for this part): onboarding visibility is now its own
--    condition (training_stage IS NULL), decoupled from the one-shot
--    login claim.
--
-- 2. The client-side "has this member done anything yet" checks
--    (checkLifecycleMilestones()'s first_question_completed milestone,
--    and by extension checkAchievements()) were built on DPE_DATA, which
--    loadPremiumContent() only ever populates for checkride_prep_
--    unlocked members (get-premium-content returns 403 for everyone
--    else, by design -- the real paywall enforcement). A FREE member
--    answering the free daily question writes a real row to
--    portal_question_progress (and the server-side get_retention_kpis()/
--    get_activation_email_kpis() correctly count it), but every
--    client-side check keyed on `DPE_DATA.some(d => studied[d.id])`
--    silently saw an empty array and never fired -- meaning free
--    members, the exact population this pass is trying to activate,
--    got no in-app confirmation of their own first real activity, ever.
--    claim_activation_completed() below is keyed on the `studied` map
--    directly (not DPE_DATA), so it works identically for free and paid
--    members.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v83.

alter table public.profiles
  add column if not exists activated_at timestamptz;

comment on column public.profiles.activated_at is
  'Set exactly once, the first time this profile completes a real meaningful training action (a DPE question, a scenario, or an AI DPE session -- the same definition get_retention_kpis() uses, just cached here for O(1) funnel/UI reads). NULL = not yet activated. Written only via claim_activation_completed() so the claim stays atomic under concurrent tabs/devices, same pattern as first_portal_login_at (v83).';

create or replace function public.claim_activation_completed(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  if auth.uid() is null or auth.uid() <> p_profile_id then
    raise exception 'Not authorized to claim activation for this profile';
  end if;

  update public.profiles
    set activated_at = now()
    where id = p_profile_id
      and activated_at is null;

  get diagnostics v_claimed = row_count;
  return v_claimed > 0;
end;
$$;

grant execute on function public.claim_activation_completed(uuid) to authenticated;

-- Extends get_portal_activation_funnel() (v83) with the exact sequence
-- from the activation-optimization brief: signups -> onboarding started
-- -> onboarding completed -> first action started -> activated ->
-- returned D1 -> returned D7. Every field the Marketing & Funnel
-- dashboard already reads from this RPC (signups, first_login,
-- onboarding_goal_saved, onboarding_focus_saved, onboarding_first_
-- training, first_lesson_started, first_lesson_completed, purchasers,
-- purchasers_activated, purchasers_first_training) is preserved
-- unchanged -- this only adds fields, it doesn't remove or rename any.
--
-- "Returned D1/D7" here means "had any recorded event by day N," a
-- cumulative-through-day-N reading -- deliberately not the same as
-- get_retention_kpis()'s stricter D1/D7 (activity on EXACTLY signup_date
-- + N, no earlier no later), which stays untouched and remains the
-- authoritative retention metric elsewhere in the admin analytics. Two
-- different denominators/questions ("are they still around by day N" vs
-- "were they active on exactly day N"), not a competing definition of
-- the same one.
create or replace function public.get_portal_activation_funnel(p_start timestamptz default null, p_end timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  with cohort as (
    select distinct ae.profile_id, p.created_at as signed_up_at
    from public.analytics_events ae
    join public.profiles p on p.id = ae.profile_id
    where ae.event_name = 'registration_completed'
      and ae.profile_id is not null
      and (p_start is null or ae.created_at >= p_start)
      and (p_end is null or ae.created_at < p_end)
  ),
  ev as (
    select profile_id, event_name
    from public.analytics_events
    where event_name in ('portal_first_login', 'onboarding_viewed', 'onboarding_training_goal_saved', 'onboarding_focus_area_saved', 'onboarding_completed', 'onboarding_first_training_started', 'first_lesson_started', 'first_lesson_completed')
      and profile_id in (select profile_id from cohort)
  ),
  returned as (
    select c.profile_id,
      exists (select 1 from public.analytics_events ae2 where ae2.profile_id = c.profile_id and ae2.created_at >= c.signed_up_at + interval '1 day') as returned_d1,
      exists (select 1 from public.analytics_events ae3 where ae3.profile_id = c.profile_id and ae3.created_at >= c.signed_up_at + interval '7 days') as returned_d7
    from cohort c
  ),
  purchase_cohort as (
    select distinct profile_id
    from public.analytics_events
    where event_name = 'purchase_completed'
      and profile_id is not null
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at < p_end)
  ),
  purchase_ev as (
    select profile_id, event_name
    from public.analytics_events
    where event_name in ('portal_first_login', 'first_lesson_started')
      and profile_id in (select profile_id from purchase_cohort)
  )
  select jsonb_build_object(
    'signups', (select count(*) from cohort),
    'first_login', (select count(distinct profile_id) from ev where event_name = 'portal_first_login'),
    'onboarding_started', (select count(distinct profile_id) from ev where event_name = 'onboarding_viewed'),
    'onboarding_goal_saved', (select count(distinct profile_id) from ev where event_name = 'onboarding_training_goal_saved'),
    'onboarding_focus_saved', (select count(distinct profile_id) from ev where event_name = 'onboarding_focus_area_saved'),
    'onboarding_completed', (select count(distinct profile_id) from ev where event_name = 'onboarding_completed'),
    'onboarding_first_training', (select count(distinct profile_id) from ev where event_name = 'onboarding_first_training_started'),
    'first_lesson_started', (select count(distinct profile_id) from ev where event_name = 'first_lesson_started'),
    'first_lesson_completed', (select count(distinct profile_id) from ev where event_name = 'first_lesson_completed'),
    'activated', (select count(*) from cohort c join public.profiles p on p.id = c.profile_id where p.activated_at is not null),
    'returned_d1', (select count(*) from returned where returned_d1),
    'returned_d7', (select count(*) from returned where returned_d7),
    'purchasers', (select count(*) from purchase_cohort),
    'purchasers_activated', (select count(distinct profile_id) from purchase_ev where event_name = 'portal_first_login'),
    'purchasers_first_training', (select count(distinct profile_id) from purchase_ev where event_name = 'first_lesson_started')
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_portal_activation_funnel(timestamptz, timestamptz) to authenticated;
