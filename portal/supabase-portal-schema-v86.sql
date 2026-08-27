-- Apex Advantage — Hotfix: malformed array literal in get_analytics_data_quality() (v86)
--
-- v85's get_analytics_data_quality() built its funnel_warnings array with
-- `v_warnings := v_warnings || 'some sentence';`. In plpgsql, `||` between
-- a text[] variable and an untyped string literal is ambiguous -- Postgres
-- resolved it as array-to-array concatenation and tried to parse the
-- plain sentence itself as an array literal (expecting `{...}` syntax),
-- which fails on any string containing a space or punctuation. Every one
-- of the six warning lines had this bug; array_append() is unambiguous
-- (element, not array, on the right) and is the fix.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v85.

create or replace function public.get_analytics_data_quality(p_documented_event_count integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
  v_purchase_total integer;
  v_purchase_with_session integer;
  v_purchase_distinct_sessions integer;
  v_first_login_total integer;
  v_first_login_distinct_profiles integer;
  v_observed_events text[];
  v_unattributed_pct numeric;
  v_exec jsonb;
  v_readiness jsonb;
  v_cp jsonb;
  v_warnings text[] := array[]::text[];
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required';
  end if;

  select count(*) into v_purchase_total from public.analytics_events where event_name = 'purchase_completed';
  select count(*) into v_purchase_with_session from public.analytics_events where event_name = 'purchase_completed' and properties ? 'session_id';
  select count(distinct properties->>'session_id') into v_purchase_distinct_sessions from public.analytics_events where event_name = 'purchase_completed' and properties ? 'session_id';

  select count(*) into v_first_login_total from public.analytics_events where event_name = 'portal_first_login';
  select count(distinct profile_id) into v_first_login_distinct_profiles from public.analytics_events where event_name = 'portal_first_login' and profile_id is not null;

  select array_agg(distinct event_name) into v_observed_events
  from public.analytics_events
  where created_at >= now() - interval '90 days';

  with scoped as (
    select public.resolve_analytics_identity(anon_id, profile_id) as uid, nullif(properties->>'traffic_source','') as traffic_source, nullif(properties->>'traffic_medium','') as traffic_medium, created_at
    from public.analytics_events
    where event_name = 'landing_page_viewed'
  ),
  first_touch as (
    select distinct on (uid) uid, public.classify_marketing_channel(traffic_source, traffic_medium) as channel
    from scoped order by uid, created_at asc
  )
  select case when count(*) > 0 then round(100.0 * count(*) filter (where channel = 'Unknown / Unattributed') / count(*), 1) else null end
  into v_unattributed_pct
  from first_touch;

  v_exec := public.get_marketing_executive_funnel(now() - interval '90 days', now());
  v_readiness := public.get_readiness_funnel_stats(now() - interval '90 days', now());
  v_cp := public.get_checkride_prep_funnel_stats(now() - interval '90 days', now());

  if (v_exec->'acquisition_activation'->>'registration_started')::int > (v_exec->'acquisition_activation'->>'landing_visitors')::int then
    v_warnings := array_append(v_warnings, 'FUNNEL DEFINITION WARNING: Executive Acquisition funnel has a step exceeding 100% of landing visitors.');
  end if;
  if (v_exec->'monetization'->>'purchase_completed')::int > (v_exec->'monetization'->>'checkout_started')::int then
    v_warnings := array_append(v_warnings, 'FUNNEL DEFINITION WARNING: Executive Monetization funnel has more purchases than checkout starts.');
  end if;
  if (v_readiness->>'completed')::int > (v_readiness->>'started')::int then
    v_warnings := array_append(v_warnings, 'FUNNEL DEFINITION WARNING: Readiness funnel has more completions than starts.');
  end if;
  if (v_readiness->>'checkride_prep_purchased')::int > (v_readiness->>'checkride_prep_clicked')::int then
    v_warnings := array_append(v_warnings, 'FUNNEL DEFINITION WARNING: Readiness funnel has more Checkride Prep purchases than clicks.');
  end if;
  if (v_cp->>'purchases')::int > (v_cp->>'checkout_started')::int then
    v_warnings := array_append(v_warnings, 'FUNNEL DEFINITION WARNING: Checkride Prep funnel has more purchases than checkout starts.');
  end if;
  if v_first_login_distinct_profiles > 0 and v_first_login_total > v_first_login_distinct_profiles * 2 then
    v_warnings := array_append(v_warnings, 'FUNNEL DEFINITION WARNING: portal_first_login firing meaningfully more than once per profile on average.');
  end if;

  select jsonb_build_object(
    'purchase_dedupe_status', case
      when v_purchase_with_session = 0 then 'NO DATA YET'
      when v_purchase_with_session = v_purchase_distinct_sessions then 'PASS'
      else 'WARNING'
    end,
    'purchase_events_with_session_id', v_purchase_with_session,
    'purchase_events_total', v_purchase_total,
    'purchase_distinct_sessions', v_purchase_distinct_sessions,
    'first_login_status', case
      when v_first_login_total = 0 then 'NO DATA YET'
      when v_first_login_total = v_first_login_distinct_profiles then 'PASS'
      else 'WARNING'
    end,
    'first_login_events_total', v_first_login_total,
    'first_login_distinct_profiles', v_first_login_distinct_profiles,
    'unattributed_pct', v_unattributed_pct,
    'observed_event_count', coalesce(array_length(v_observed_events, 1), 0),
    'documented_event_count', p_documented_event_count,
    'observed_events', to_jsonb(coalesce(v_observed_events, array[]::text[])),
    'last_event_at', (select max(created_at) from public.analytics_events),
    'funnel_warnings', to_jsonb(v_warnings)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_analytics_data_quality(integer) to authenticated;
