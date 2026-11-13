-- CRM 0.2 (GitHub issue #311): unified lead pipeline + manual
-- TikTok/Instagram/Facebook/ManyChat/referral lead capture.
--
-- NOT APPLIED to the live ApexAdvantage project (wqzfhcjsfzwrimvsudxy) as
-- part of this change -- issue #311 explicitly forbids production
-- migrations without separate approval. This file is the reviewable,
-- ready-to-apply artifact; apply it with mcp__Supabase__apply_migration
-- (or `supabase db push`) only after that approval.
--
-- Scope: additive only. No table is dropped or renamed, no existing
-- column is dropped, no existing row's `stage` value is overwritten.
-- Audited against production on 2026-11-13: 3 rows in `leads` (all
-- stage='inquiry', referral_source='Website'), 0 rows in `lead_notes`,
-- 194 rows in `readiness_assessment_leads`. The `stage` backfill CASE
-- below is exercised against those exact 3 rows by
-- portal/src/lib/leads.js's mapLegacyStageToPipeline() and its test
-- (portal/src/lib/leads.test.js), which assert the same mapping so the
-- JS documentation and this SQL never drift apart.
--
-- Rollback (forward-safe -- nothing below is destructive, so "rollback"
-- just means removing what this file added; no data is lost by running
-- it, since `pipeline_stage`/`stage` both still exist afterward):
--   alter table public.leads
--     drop constraint if exists leads_name_or_handle_required,
--     drop constraint if exists leads_origin_platform_check,
--     drop constraint if exists leads_capture_method_check,
--     drop constraint if exists leads_pipeline_stage_check,
--     alter column full_name set not null, -- only safe if no row relies on social_username-only
--     drop column if exists origin_platform,
--     drop column if exists capture_method,
--     drop column if exists social_username,
--     drop column if exists profile_url,
--     drop column if exists training_interest,
--     drop column if exists aircraft_interest,
--     drop column if exists checkride_date,
--     drop column if exists source_campaign,
--     drop column if exists source_content,
--     drop column if exists assigned_to,
--     drop column if exists next_follow_up_at,
--     drop column if exists pipeline_stage,
--     drop column if exists linked_readiness_lead_id;
--   alter table public.lead_notes
--     drop constraint if exists lead_notes_contact_method_check,
--     drop constraint if exists lead_notes_outcome_check,
--     drop column if exists contact_method,
--     drop column if exists outcome;
--   drop policy if exists "Staff can view readiness assessment leads" on public.readiness_assessment_leads;
--   drop function if exists public.lead_booking_indicators(text);

begin;

-- ---------------------------------------------------------------------
-- 1. leads: allow a lead with only a social handle (no full_name), and
--    add the Quick Add Lead / pipeline / attribution columns.
-- ---------------------------------------------------------------------

alter table public.leads alter column full_name drop not null;

alter table public.leads
  add column if not exists origin_platform text,
  add column if not exists capture_method text,
  add column if not exists social_username text,
  add column if not exists profile_url text,
  add column if not exists training_interest text,
  add column if not exists aircraft_interest text,
  add column if not exists checkride_date date,
  add column if not exists source_campaign text,
  add column if not exists source_content text,
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists next_follow_up_at timestamptz,
  -- A new axis, deliberately separate from the pre-existing `stage`
  -- column (inquiry/discovery/enrolled/active/graduated/inactive),
  -- which tracks a prospect's progression INTO an active training
  -- relationship and is read nowhere else in the codebase (grepped
  -- portal/src before writing this) but is left untouched so nothing
  -- that depends on it elsewhere, now or later, silently breaks.
  -- `pipeline_stage` is the sales/contact pipeline CRM 0.2 is about.
  add column if not exists pipeline_stage text,
  -- Explicit, staff-driven identity link ("this manual lead is the same
  -- person as this readiness assessment") -- never an automatic merge.
  add column if not exists linked_readiness_lead_id uuid references public.readiness_assessment_leads(id) on delete set null;

-- At least a name or a social handle is required (issue #311 phase 3:
-- "Name or social media username (at least one required)"). Existing
-- rows all have full_name set, so this is satisfied immediately.
alter table public.leads
  drop constraint if exists leads_name_or_handle_required;
alter table public.leads
  add constraint leads_name_or_handle_required
  check (full_name is not null or social_username is not null);

alter table public.leads
  drop constraint if exists leads_origin_platform_check;
alter table public.leads
  add constraint leads_origin_platform_check
  check (origin_platform is null or origin_platform in
    ('tiktok', 'instagram', 'facebook', 'manychat', 'website', 'referral', 'other'));

alter table public.leads
  drop constraint if exists leads_capture_method_check;
alter table public.leads
  add constraint leads_capture_method_check
  check (capture_method is null or capture_method in
    ('manual', 'manychat', 'website_form', 'referral', 'walk_in', 'phone', 'email', 'other'));

alter table public.leads
  drop constraint if exists leads_pipeline_stage_check;
alter table public.leads
  add constraint leads_pipeline_stage_check
  check (pipeline_stage in ('new', 'contacted', 'qualified', 'offer_sent', 'won', 'lost', 'nurture'));

-- Backfill existing rows from the legacy `stage` value, explicitly --
-- not just defaulting everything to 'new' -- so a lead that was already
-- further along (discovery/enrolled/active/graduated/inactive) doesn't
-- silently reset to the top of a brand new pipeline. Mirrors
-- mapLegacyStageToPipeline() in portal/src/lib/leads.js exactly.
update public.leads
set pipeline_stage = case stage
  when 'inquiry'   then 'new'
  when 'discovery' then 'contacted'
  when 'enrolled'  then 'qualified'
  when 'active'    then 'won'
  when 'graduated' then 'won'
  when 'inactive'  then 'lost'
  else 'new'
end
where pipeline_stage is null;

alter table public.leads
  alter column pipeline_stage set default 'new',
  alter column pipeline_stage set not null;

create index if not exists leads_pipeline_stage_idx on public.leads(pipeline_stage);
create index if not exists leads_assigned_to_idx on public.leads(assigned_to);
create index if not exists leads_next_follow_up_at_idx on public.leads(next_follow_up_at);
create index if not exists leads_origin_platform_idx on public.leads(origin_platform);

comment on column public.leads.stage is
  'Legacy training-lifecycle stage (inquiry/discovery/enrolled/active/graduated/inactive). Preserved as-is for CRM 0.2 (not read elsewhere in the codebase as of 2026-11-13) -- see pipeline_stage for the sales pipeline.';
comment on column public.leads.pipeline_stage is
  'CRM 0.2 sales pipeline: new, contacted, qualified, offer_sent, won, lost, nurture. Backfilled once from `stage` at migration time; independent of it going forward.';
comment on column public.leads.origin_platform is
  'Where this person originally came from (tiktok/instagram/facebook/manychat/website/referral/other). Distinct from capture_method -- e.g. a TikTok follower who messages via ManyChat has origin_platform=tiktok, capture_method=manychat.';
comment on column public.leads.capture_method is
  'How this lead entered our system (manual/manychat/website_form/referral/walk_in/phone/email/other). See origin_platform for where they originally came from.';
comment on column public.leads.linked_readiness_lead_id is
  'Optional explicit staff-made link to a readiness_assessment_leads row believed to be the same person. Never set automatically -- see Quick Add Lead / lead detail "link identity" action.';

-- ---------------------------------------------------------------------
-- 2. lead_notes: timestamped activity timeline needs a contact method
--    and outcome alongside the existing free-text body.
-- ---------------------------------------------------------------------

alter table public.lead_notes
  add column if not exists contact_method text,
  add column if not exists outcome text;

alter table public.lead_notes
  drop constraint if exists lead_notes_contact_method_check;
alter table public.lead_notes
  add constraint lead_notes_contact_method_check
  check (contact_method is null or contact_method in
    ('call', 'text', 'email', 'dm', 'in_person', 'other'));

alter table public.lead_notes
  drop constraint if exists lead_notes_outcome_check;
alter table public.lead_notes
  add constraint lead_notes_outcome_check
  check (outcome is null or outcome in
    ('no_answer', 'left_message', 'connected', 'scheduled', 'not_interested', 'follow_up_needed', 'other'));

-- No RLS change needed for leads/lead_notes: the existing "Staff can
-- manage leads/lead_notes" (is_staff()) and "Office managers can manage
-- leads/lead_notes" (is_office_manager()) ALL-command policies already
-- cover every new column added above, and already deny student/anon
-- access entirely (verified via pg_policies before writing this file --
-- no other policy exists on either table).

-- ---------------------------------------------------------------------
-- 3. readiness_assessment_leads: widen staff read access.
--
--    Today only role='admin' can read these (and a user their own, via
--    profile_id). Phase 2's unified directory needs instructors and
--    office managers -- the same roles who already manage `leads` -- to
--    see them too. Purely additive: the existing admin-only and
--    self-view SELECT policies, and the public INSERT policy, are
--    untouched.
-- ---------------------------------------------------------------------

drop policy if exists "Staff can view readiness assessment leads" on public.readiness_assessment_leads;
create policy "Staff can view readiness assessment leads"
  on public.readiness_assessment_leads for select
  using (is_staff() or is_office_manager(auth.uid()));

-- ---------------------------------------------------------------------
-- 4. lead_booking_indicators(): staff-gated, least-privilege booking /
--    purchase indicator for the lead detail view.
--
--    Deliberately NOT a broader RLS grant on mock_oral_bookings /
--    portal_access_purchases / verified_purchases -- those tables hold
--    every student's name/email/phone and widening row-level access to
--    them would expose far more than "has this lead booked/bought
--    anything yet". A SECURITY DEFINER function returning only three
--    booleans, gated on is_staff()/is_office_manager() internally,
--    keeps the indicator without touching those tables' RLS at all.
--
--    verified_purchases is keyed by `uid` (a profiles.id, confirmed by
--    inspecting live rows before writing this), not email, so matching
--    it requires first resolving the lead's email to a profile.
-- ---------------------------------------------------------------------

create or replace function public.lead_booking_indicators(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_norm_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not (is_staff() or is_office_manager(auth.uid())) then
    raise exception 'not authorized';
  end if;

  if v_norm_email = '' then
    return jsonb_build_object(
      'has_mock_oral_booking', false,
      'has_portal_access_purchase', false,
      'has_verified_purchase', false
    );
  end if;

  select id into v_profile_id from public.profiles where lower(email) = v_norm_email limit 1;

  return jsonb_build_object(
    'has_mock_oral_booking', exists(
      select 1 from public.mock_oral_bookings where lower(email) = v_norm_email
    ),
    'has_portal_access_purchase', exists(
      select 1 from public.portal_access_purchases where lower(email) = v_norm_email
    ),
    'has_verified_purchase', v_profile_id is not null and exists(
      select 1 from public.verified_purchases where uid = v_profile_id::text
    )
  );
end;
$$;

revoke all on function public.lead_booking_indicators(text) from public;
grant execute on function public.lead_booking_indicators(text) to authenticated;

comment on function public.lead_booking_indicators(text) is
  'Staff-gated (is_staff()/is_office_manager() checked internally) booking/purchase indicator for a lead''s email, used by the CRM 0.2 lead detail view. Returns only booleans -- never row data -- so it does not widen read access to mock_oral_bookings/portal_access_purchases/verified_purchases.';

commit;
