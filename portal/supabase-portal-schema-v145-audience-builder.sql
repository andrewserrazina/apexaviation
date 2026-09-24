-- Apex Advantage — Audience Builder + Segmented Broadcasts (v145)
--
-- Extends the existing admin_broadcasts/admin_broadcast_recipients
-- system (v33.sql, v82.sql) with server-side, filter-based audience
-- targeting. Does NOT replace or duplicate the existing simple
-- "All Students" broadcast flow (Broadcast.jsx / lib/email.js's
-- sendAdminEmail()) -- that path keeps working exactly as before.
-- The Audience Builder is a second way to populate the same two tables
-- and feed the same composer/send pipeline, gated behind three new
-- admin-only RPCs.
--
-- IMPORTANT PRE-EXISTING GAP THIS SPRINT DOES NOT FIX: the current
-- sendAdminEmail() "All Students"/"Flight Students"/"Apex Advantage
-- Students" broadcast path never checks email_marketing_opt_out at all
-- -- studentQuery() in Broadcast.jsx has no opt-out filter. This
-- migration does not touch that existing query (out of scope: "do not
-- alter unrelated product logic" -- changing it would alter the
-- semantics of an existing, already-shipped admin flow with its own
-- history in admin_broadcasts). It IS fixed for every broadcast sent
-- through the new Audience Builder path, which is the one this sprint
-- is responsible for and enforces opt-out unconditionally, with no way
-- to override it from the UI. Flagged prominently in the implementation
-- report as a follow-up for the existing simple-mode path.
--
-- Architecture decision: SECURITY DEFINER RPCs, matching this codebase's
-- established pattern for admin-authorized cross-user reads (e.g.
-- get_mock_oral_availability, get_my_mock_oral_report, is_admin itself)
-- rather than a new Edge Function. This is a pure-SQL, no-external-API
-- computation (no Resend/Stripe/Anthropic call involved in matching or
-- previewing an audience), which is exactly the shape every other RPC
-- in this schema already handles this way; Edge Functions in this repo
-- are reserved for external API orchestration (checkout, webhooks,
-- email sending, AI calls) or complex multi-step flows, neither of
-- which applies to "filter existing rows and count/list them."
--
-- Security model, mirroring has_study_pack_entitlement_self's pattern
-- (v121.sql): the actual audience-matching logic lives in one internal
-- function, admin_match_broadcast_audience(), which is NOT granted
-- EXECUTE to authenticated/anon at all -- it is only reachable through
-- the three public wrapper RPCs below, each of which independently
-- calls public.is_admin(auth.uid()) and raises an exception otherwise,
-- has a fixed search_path, and is SECURITY DEFINER only because it must
-- read across every profile (impossible under each table's own
-- own-row-or-admin RLS from a non-admin's connection -- but every caller
-- of these RPCs IS independently re-verified as an admin first, so this
-- does not broaden access beyond what an admin already has).
--
-- No arbitrary SQL is ever constructed from client input anywhere in
-- this migration -- every filter is read from a fixed, named jsonb path
-- (e.g. p_segment->'checkride'->>'mode') and compared with ordinary
-- parameterized operators (=, IN, BETWEEN, ANY(array)). An unrecognized
-- top-level key or malformed value in p_segment simply has no matching
-- branch and is silently inert (equivalent to "not filtered on"),
-- exactly the same safety property a client-supplied column name or
-- raw WHERE fragment would NOT have -- there is no code path anywhere
-- here that interpolates a client string into a SQL statement.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v144.

-- ─────────────────────────────────────────────────────────────────
-- 1. Extend admin_broadcasts (additive, nullable -- every existing row
--    and every future simple-mode broadcast just leaves these null).
-- ─────────────────────────────────────────────────────────────────
alter table public.admin_broadcasts
  add column if not exists segment_definition jsonb,
  add column if not exists audience_label text,
  add column if not exists matched_count integer,
  add column if not exists excluded_count integer;

comment on column public.admin_broadcasts.segment_definition is
  'Normalized Audience Builder filters used at send time (see admin_match_broadcast_audience() for the supported shape). Null for broadcasts sent through the older simple "All Students"-style flow. Never executable SQL -- a plain allowlisted filter description.';
comment on column public.admin_broadcasts.audience_label is
  'Admin-facing name for the audience at send time, e.g. "Checkride Prep Owners -- Checkride Within 45 Days -- No Mock Oral". Null for simple-mode broadcasts.';
comment on column public.admin_broadcasts.matched_count is
  'Total profiles matching segment_definition before opt-out/missing-email/suppression exclusions, captured at send time. recipient_count (existing column) remains the actual send count.';
comment on column public.admin_broadcasts.excluded_count is
  'matched_count minus recipient_count, captured at send time -- how many matched profiles were excluded by opt-out, missing email, or suppression rules.';

-- ─────────────────────────────────────────────────────────────────
-- 2. Internal audience matcher. Not granted to anon/authenticated --
--    only callable from the three SECURITY DEFINER wrappers below.
--
--    Returns one row per matched profile (before opt-out/email
--    eligibility is applied -- callers filter on is_eligible
--    themselves, since preview_audience needs the *count* of
--    ineligible-but-matched profiles, not just the eligible list).
--
--    Deterministic readiness rule (per the task's own instruction):
--    a profile's canonical readiness record is its LATEST
--    readiness_assessment_leads row by created_at. A profile with
--    multiple retakes is represented exactly once here.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.admin_match_broadcast_audience(p_segment jsonb)
returns table (
  profile_id uuid,
  full_name text,
  email text,
  is_eligible boolean,
  opted_out boolean,
  has_email boolean,
  checkride_date date,
  current_rating text,
  training_stage text,
  student_type text,
  last_touch_source text,
  portal_last_active_at timestamptz,
  checkride_prep_unlocked boolean,
  ground_school_unlocked boolean,
  mock_oral_status text,
  readiness_score integer,
  readiness_level text
)
language sql
security definer
set search_path = public
stable
as $$
  with latest_readiness as (
    select distinct on (r.profile_id)
      r.profile_id, r.score, r.readiness_level, r.strongest_category,
      r.weakest_category_1, r.weakest_category_2, r.checkride_timing as lead_checkride_timing
    from public.readiness_assessment_leads r
    where r.profile_id is not null
    order by r.profile_id, r.created_at desc
  ),
  mock_oral_flags as (
    select
      b.profile_id,
      bool_or(b.status in ('confirmed', 'completed')) as has_active_booking,
      bool_or(b.status = 'confirmed' and a.class_date >= current_date) as has_upcoming_booking,
      bool_or(b.status = 'completed') as has_completed_booking
    from public.mock_oral_bookings b
    join public.mock_oral_availability a on a.id = b.availability_id
    group by b.profile_id
  ),
  study_pack_flags as (
    select
      e.profile_id,
      bool_or(e.revoked_at is null) as owns_any_pack,
      bool_or(e.revoked_at is null and e.pack_id = (p_segment->'products'->'study_pack'->>'pack_id')) as owns_specific_pack
    from public.study_pack_entitlements e
    group by e.profile_id
  ),
  base as (
    select
      p.id as profile_id,
      p.full_name,
      p.email,
      p.email_marketing_opt_out as opted_out,
      (p.email is not null and length(trim(p.email)) > 0) as has_email,
      cd.checkride_date,
      p.current_rating,
      p.training_stage,
      p.student_type,
      p.checkride_timing,
      p.next_rating_interest,
      p.primary_focus_area,
      p.primary_aircraft_class,
      p.signup_utm_source, p.signup_utm_medium, p.signup_utm_campaign, p.signup_utm_content,
      p.first_touch_landing_page, p.last_touch_source, p.last_touch_campaign, p.last_touch_landing_page,
      p.portal_last_active_at,
      p.first_portal_login_at,
      p.activated_at,
      p.created_at,
      p.checkride_prep_unlocked,
      p.private_pilot_ground_school_pack_unlocked as ground_school_unlocked,
      coalesce(mo.has_active_booking, false) as has_active_mo_booking,
      coalesce(mo.has_upcoming_booking, false) as has_upcoming_mo_booking,
      coalesce(mo.has_completed_booking, false) as has_completed_mo_booking,
      coalesce(sp.owns_any_pack, false) as owns_any_study_pack,
      coalesce(sp.owns_specific_pack, false) as owns_specific_study_pack,
      exists (select 1 from public.portal_access_purchases pu where pu.profile_id = p.id) as has_legacy_purchase,
      lr.score as readiness_score,
      lr.readiness_level,
      lr.strongest_category,
      lr.weakest_category_1,
      lr.weakest_category_2,
      (lr.profile_id is not null) as has_readiness
    from public.profiles p
    left join public.portal_checkride_date cd on cd.profile_id = p.id
    left join mock_oral_flags mo on mo.profile_id = p.id
    left join study_pack_flags sp on sp.profile_id = p.id
    left join latest_readiness lr on lr.profile_id = p.id
  )
  select
    b.profile_id, b.full_name, b.email,
    (not b.opted_out and b.has_email) as is_eligible,
    b.opted_out, b.has_email,
    b.checkride_date, b.current_rating, b.training_stage, b.student_type,
    b.last_touch_source, b.portal_last_active_at,
    b.checkride_prep_unlocked, b.ground_school_unlocked,
    case
      when b.has_completed_mo_booking then 'completed'
      when b.has_upcoming_mo_booking then 'upcoming'
      when b.has_active_mo_booking then 'booked'
      else 'none'
    end as mock_oral_status,
    b.readiness_score, b.readiness_level
  from base b
  where
    -- Checkride filters ------------------------------------------------
    (
      p_segment->'checkride' is null
      or case p_segment->'checkride'->>'mode'
        when 'within_days' then
          b.checkride_date is not null
          and b.checkride_date >= current_date
          and b.checkride_date <= current_date + make_interval(days => greatest((p_segment->'checkride'->>'within_days')::int, 0))
        when 'exact_range' then
          b.checkride_date is not null
          and (p_segment->'checkride'->>'from' is null or b.checkride_date >= (p_segment->'checkride'->>'from')::date)
          and (p_segment->'checkride'->>'to' is null or b.checkride_date <= (p_segment->'checkride'->>'to')::date)
        when 'past' then
          b.checkride_date is not null and b.checkride_date < current_date
        when 'none_set' then
          b.checkride_date is null
        when 'timing_value' then
          b.checkride_timing = (p_segment->'checkride'->>'timing_value')
        else true
      end
    )
    -- Acquisition / attribution filters ---------------------------------
    and (p_segment->'acquisition'->'signup_utm_source' is null or b.signup_utm_source = any (array(select jsonb_array_elements_text(p_segment->'acquisition'->'signup_utm_source'))))
    and (p_segment->'acquisition'->'signup_utm_medium' is null or b.signup_utm_medium = any (array(select jsonb_array_elements_text(p_segment->'acquisition'->'signup_utm_medium'))))
    and (p_segment->'acquisition'->'signup_utm_campaign' is null or b.signup_utm_campaign = any (array(select jsonb_array_elements_text(p_segment->'acquisition'->'signup_utm_campaign'))))
    and (p_segment->'acquisition'->'signup_utm_content' is null or b.signup_utm_content = any (array(select jsonb_array_elements_text(p_segment->'acquisition'->'signup_utm_content'))))
    and (p_segment->'acquisition'->'first_touch_landing_page' is null or b.first_touch_landing_page = any (array(select jsonb_array_elements_text(p_segment->'acquisition'->'first_touch_landing_page'))))
    and (p_segment->'acquisition'->'last_touch_source' is null or b.last_touch_source = any (array(select jsonb_array_elements_text(p_segment->'acquisition'->'last_touch_source'))))
    and (p_segment->'acquisition'->'last_touch_campaign' is null or b.last_touch_campaign = any (array(select jsonb_array_elements_text(p_segment->'acquisition'->'last_touch_campaign'))))
    and (p_segment->'acquisition'->'last_touch_landing_page' is null or b.last_touch_landing_page = any (array(select jsonb_array_elements_text(p_segment->'acquisition'->'last_touch_landing_page'))))
    -- Training profile filters ------------------------------------------
    and (p_segment->'training'->'current_rating' is null or b.current_rating = any (array(select jsonb_array_elements_text(p_segment->'training'->'current_rating'))))
    and (p_segment->'training'->'training_stage' is null or b.training_stage = any (array(select jsonb_array_elements_text(p_segment->'training'->'training_stage'))))
    and (p_segment->'training'->'student_type' is null or b.student_type = any (array(select jsonb_array_elements_text(p_segment->'training'->'student_type'))))
    and (p_segment->'training'->'next_rating_interest' is null or b.next_rating_interest = any (array(select jsonb_array_elements_text(p_segment->'training'->'next_rating_interest'))))
    and (p_segment->'training'->'primary_focus_area' is null or b.primary_focus_area = any (array(select jsonb_array_elements_text(p_segment->'training'->'primary_focus_area'))))
    and (p_segment->'training'->'primary_aircraft_class' is null or b.primary_aircraft_class = any (array(select jsonb_array_elements_text(p_segment->'training'->'primary_aircraft_class'))))
    -- Product ownership filters ------------------------------------------
    and (p_segment->'products'->>'checkride_prep' is null or (p_segment->'products'->>'checkride_prep' = 'owns') = b.checkride_prep_unlocked)
    and (p_segment->'products'->>'ground_school' is null or (p_segment->'products'->>'ground_school' = 'owns') = b.ground_school_unlocked)
    and (
      p_segment->'products'->'study_pack' is null
      or case p_segment->'products'->'study_pack'->>'mode'
        when 'owns_any' then b.owns_any_study_pack
        when 'owns_specific' then b.owns_specific_study_pack
        when 'not_owns_specific' then not b.owns_specific_study_pack
        else true
      end
    )
    and (
      p_segment->'products'->>'mock_oral' is null
      or case p_segment->'products'->>'mock_oral'
        when 'any' then b.has_active_mo_booking
        when 'none' then not b.has_active_mo_booking
        when 'upcoming' then b.has_upcoming_mo_booking
        when 'completed' then b.has_completed_mo_booking
        else true
      end
    )
    and (
      p_segment->'products'->>'customer_status' is null
      or case p_segment->'products'->>'customer_status'
        when 'purchased_any' then (b.checkride_prep_unlocked or b.ground_school_unlocked or b.owns_any_study_pack or b.has_active_mo_booking or b.has_legacy_purchase)
        when 'never_purchased' then not (b.checkride_prep_unlocked or b.ground_school_unlocked or b.owns_any_study_pack or b.has_active_mo_booking or b.has_legacy_purchase)
        else true
      end
    )
    -- Engagement filters --------------------------------------------------
    and (p_segment->'engagement'->>'active_within_days' is null or (b.portal_last_active_at is not null and b.portal_last_active_at >= now() - make_interval(days => (p_segment->'engagement'->>'active_within_days')::int)))
    and (p_segment->'engagement'->>'inactive_at_least_days' is null or (b.portal_last_active_at is null or b.portal_last_active_at < now() - make_interval(days => (p_segment->'engagement'->>'inactive_at_least_days')::int)))
    and (p_segment->'engagement'->>'never_logged_in' is null or ((p_segment->'engagement'->>'never_logged_in')::boolean = (b.first_portal_login_at is null)))
    and (p_segment->'engagement'->>'activated' is null or ((p_segment->'engagement'->>'activated')::boolean = (b.activated_at is not null)))
    and (p_segment->'engagement'->>'signed_up_within_days' is null or b.created_at >= now() - make_interval(days => (p_segment->'engagement'->>'signed_up_within_days')::int))
    -- Readiness filters -----------------------------------------------------
    and (p_segment->'readiness'->>'completed' is null or ((p_segment->'readiness'->>'completed')::boolean = b.has_readiness))
    and (p_segment->'readiness'->>'score_min' is null or b.readiness_score >= (p_segment->'readiness'->>'score_min')::int)
    and (p_segment->'readiness'->>'score_max' is null or b.readiness_score <= (p_segment->'readiness'->>'score_max')::int)
    and (p_segment->'readiness'->'readiness_level' is null or b.readiness_level = any (array(select jsonb_array_elements_text(p_segment->'readiness'->'readiness_level'))))
    and (p_segment->'readiness'->'strongest_category' is null or b.strongest_category = any (array(select jsonb_array_elements_text(p_segment->'readiness'->'strongest_category'))))
    and (
      p_segment->'readiness'->'weakest_category' is null
      or b.weakest_category_1 = any (array(select jsonb_array_elements_text(p_segment->'readiness'->'weakest_category')))
      or b.weakest_category_2 = any (array(select jsonb_array_elements_text(p_segment->'readiness'->'weakest_category')))
    )
    -- Suppression filters (exclude on match) ---------------------------------
    and (
      p_segment->'suppression'->>'emailed_within_days' is null
      or not exists (
        select 1 from public.portal_email_log el
        where el.profile_id = b.profile_id
          and el.sent_at >= now() - make_interval(days => (p_segment->'suppression'->>'emailed_within_days')::int)
      )
    )
    and (
      p_segment->'suppression'->>'received_broadcast_id' is null
      or not exists (
        select 1 from public.admin_broadcast_recipients br
        where br.profile_id = b.profile_id
          and br.broadcast_id = (p_segment->'suppression'->>'received_broadcast_id')::uuid
      )
    )
    and (
      p_segment->'suppression'->>'received_email_type' is null
      or not exists (
        select 1 from public.portal_email_log el
        where el.profile_id = b.profile_id
          and el.email_type = (p_segment->'suppression'->>'received_email_type')
      )
    )
$$;

revoke all on function public.admin_match_broadcast_audience(jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. Public wrapper #1 — aggregate preview counts.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.admin_preview_broadcast_audience(p_segment jsonb)
returns table (
  matched_count integer,
  eligible_count integer,
  opted_out_count integer,
  missing_email_count integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  return query
    select
      count(*)::int as matched_count,
      count(*) filter (where m.is_eligible)::int as eligible_count,
      count(*) filter (where m.opted_out and m.has_email)::int as opted_out_count,
      count(*) filter (where not m.has_email)::int as missing_email_count
    from public.admin_match_broadcast_audience(p_segment) m;
end;
$$;

revoke all on function public.admin_preview_broadcast_audience(jsonb) from public, anon;
grant execute on function public.admin_preview_broadcast_audience(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4. Public wrapper #2 — paginated, eligible-only recipient preview.
--    Total eligible count is returned separately by wrapper #1 --
--    this only ever returns one page of rows, per the "pagination for
--    recipient preview" and "counts returned separately from rows"
--    requirements.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.admin_preview_broadcast_recipients(
  p_segment jsonb,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  profile_id uuid,
  full_name text,
  email text,
  checkride_date date,
  current_rating text,
  training_stage text,
  last_touch_source text,
  portal_last_active_at timestamptz,
  checkride_prep_unlocked boolean,
  ground_school_unlocked boolean,
  mock_oral_status text,
  readiness_score integer,
  readiness_level text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  return query
    select
      m.profile_id, m.full_name, m.email, m.checkride_date, m.current_rating,
      m.training_stage, m.last_touch_source, m.portal_last_active_at,
      m.checkride_prep_unlocked, m.ground_school_unlocked, m.mock_oral_status,
      m.readiness_score, m.readiness_level
    from public.admin_match_broadcast_audience(p_segment) m
    where m.is_eligible
    order by m.full_name nulls last, m.profile_id
    limit greatest(least(coalesce(p_limit, 25), 100), 1)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.admin_preview_broadcast_recipients(jsonb, integer, integer) from public, anon;
grant execute on function public.admin_preview_broadcast_recipients(jsonb, integer, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 5. Public wrapper #3 — re-evaluate the audience fresh and snapshot
--    it. This is the ONLY function that writes admin_broadcasts /
--    admin_broadcast_recipients for the Audience Builder path. It never
--    trusts a count or recipient list the client already has in memory
--    from an earlier preview call -- it recomputes
--    admin_match_broadcast_audience(p_segment) from scratch.
--
--    Recipients are deduped by lower(email) (case-insensitive) before
--    insert, so a data anomaly that produced two profile rows sharing
--    one email address can never result in two sends to the same
--    address for one broadcast.
--
--    Returns the new broadcast_id plus the exact recipient rows
--    (admin_broadcast_recipients.id, profile_id, email) the caller must
--    send to -- the caller sends to *these* rows and updates their
--    `delivered` flag afterward, via the existing admin-only RLS on
--    admin_broadcast_recipients (unchanged). The caller has no way to
--    add, remove, or substitute a recipient at send time.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.admin_create_broadcast_snapshot(
  p_segment jsonb,
  p_subject text,
  p_body text,
  p_audience_label text default null
)
returns table (
  broadcast_id uuid,
  recipient_id uuid,
  profile_id uuid,
  email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broadcast_id uuid;
  v_matched_count integer;
  v_eligible_count integer;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;
  if coalesce(trim(p_subject), '') = '' then
    raise exception 'Subject is required';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Body is required';
  end if;

  create temporary table _audience_match on commit drop as
    select * from public.admin_match_broadcast_audience(p_segment);

  create temporary table _audience_snapshot on commit drop as
    select distinct on (lower(m.email)) m.profile_id, m.email
    from _audience_match m
    where m.is_eligible
    order by lower(m.email), m.profile_id;

  select count(*) into v_matched_count from _audience_match;
  select count(*) into v_eligible_count from _audience_snapshot;

  if v_eligible_count = 0 then
    raise exception 'No eligible recipients matched this audience.';
  end if;

  insert into public.admin_broadcasts (sent_by, subject, body, recipient_count, segment_definition, audience_label, matched_count, excluded_count)
  values (auth.uid(), p_subject, p_body, v_eligible_count, p_segment, p_audience_label, v_matched_count, v_matched_count - v_eligible_count)
  returning id into v_broadcast_id;

  return query
    insert into public.admin_broadcast_recipients (broadcast_id, profile_id, email)
    select v_broadcast_id, a.profile_id, a.email
    from _audience_snapshot a
    returning admin_broadcast_recipients.broadcast_id, admin_broadcast_recipients.id as recipient_id, admin_broadcast_recipients.profile_id, admin_broadcast_recipients.email;
end;
$$;

revoke all on function public.admin_create_broadcast_snapshot(jsonb, text, text, text) from public, anon;
grant execute on function public.admin_create_broadcast_snapshot(jsonb, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 6. Distinct attribution values, for populating the Acquisition
--    filter dropdowns without ever pulling a raw per-profile column to
--    the browser to dedupe client-side. One small aggregate query,
--    admin-only, same is_admin() gate as everything else here.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.admin_distinct_attribution_values()
returns table (
  signup_utm_source text[],
  signup_utm_medium text[],
  signup_utm_campaign text[],
  signup_utm_content text[],
  first_touch_landing_page text[],
  last_touch_source text[],
  last_touch_campaign text[],
  last_touch_landing_page text[]
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  return query
    select
      array_remove(array_agg(distinct p.signup_utm_source), null),
      array_remove(array_agg(distinct p.signup_utm_medium), null),
      array_remove(array_agg(distinct p.signup_utm_campaign), null),
      array_remove(array_agg(distinct p.signup_utm_content), null),
      array_remove(array_agg(distinct p.first_touch_landing_page), null),
      array_remove(array_agg(distinct p.last_touch_source), null),
      array_remove(array_agg(distinct p.last_touch_campaign), null),
      array_remove(array_agg(distinct p.last_touch_landing_page), null)
    from public.profiles p;
end;
$$;

revoke all on function public.admin_distinct_attribution_values() from public, anon;
grant execute on function public.admin_distinct_attribution_values() to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 7. Indexes -- inspected existing indexes first (mock_oral_bookings
--    already has profile_idx/status_idx from v97; study_pack_
--    entitlements already has profile_idx from v99; readiness_
--    assessment_leads already has profile_id_idx from v78). The one
--    genuinely missing, justified index for this feature's query
--    pattern (matching/sorting by checkride date) is on
--    portal_checkride_date.checkride_date itself -- the table's only
--    existing index is its primary key on profile_id.
-- ─────────────────────────────────────────────────────────────────
create index if not exists portal_checkride_date_date_idx on public.portal_checkride_date (checkride_date);
create index if not exists profiles_portal_last_active_at_idx on public.profiles (portal_last_active_at);
