-- Apex Advantage Membership — subscription state + capability model (v51)
--
-- Phase 3 of the habit-layer expansion. The existing one-time Checkride
-- Prep Pack purchase (portal_access_purchases, profiles.checkride_
-- prep_unlocked) is untouched and keeps working exactly as it does
-- today -- Membership is a separate, parallel commercial product, not
-- a replacement. $19/mo or $190/yr, no trial (see create-checkout-
-- session's join-membership purpose).
--
-- Capability model: rather than a second boolean bolted on next to
-- checkride_prep_unlocked, get_member_capabilities() returns the actual
-- set of capability keys a profile currently holds. Membership is
-- treated as a strict superset of the Prep Pack (a paying $19/mo member
-- should never see LESS than a $29-one-time member) plus its own
-- exclusive extras -- see the function body for exactly which
-- capability comes from which entitlement. Capabilities for content
-- that doesn't exist yet (instrument_preview, commercial_preview,
-- community_access) are included as forward-looking keys only; nothing
-- in the product currently checks them, and no fabricated content sits
-- behind them.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v50.

create table public.member_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null references public.profiles(id) on delete cascade,
  tier                   text not null check (tier in ('monthly', 'annual')),
  status                 text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  last_webhook_event     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index member_subscriptions_profile_id_idx on public.member_subscriptions (profile_id);

alter table public.member_subscriptions enable row level security;

create policy "Members view their own subscription"
  on public.member_subscriptions for select
  using (auth.uid() = profile_id);

create policy "Admins can view all subscriptions"
  on public.member_subscriptions for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- No client insert/update/delete policy -- every row is written by
-- stripe-webhook (service role) in response to real Stripe events,
-- never by client-side "I paid" claims.

-- Convenience check used both by the capability function below and
-- directly by create-checkout-session (to block starting a second
-- subscription while one is already active/past_due).
create or replace function public.member_has_active_membership(p_profile_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.member_subscriptions
    where profile_id = p_profile_id and status in ('active', 'trialing', 'past_due')
  )
$$;

create or replace function public.get_member_capabilities(p_profile_id uuid)
returns table (capability text)
language plpgsql
stable
set search_path = public
as $$
declare
  v_unlocked boolean;
  v_member boolean;
  v_is_admin boolean;
begin
  select checkride_prep_unlocked into v_unlocked from public.profiles where id = p_profile_id;
  v_member := public.member_has_active_membership(p_profile_id);
  select (role = 'admin') into v_is_admin from public.profiles where id = p_profile_id;

  -- Free, every account.
  return query select unnest(array['daily_dispatch', 'basic_practice']);

  -- Granted by either the one-time Prep Pack or an active Membership --
  -- Membership is a superset, never a downgrade from what a Prep Pack
  -- buyer already has.
  if v_unlocked or v_member or v_is_admin then
    return query select unnest(array[
      'full_private_question_bank', 'private_checkride_pack', 'premium_missions', 'advanced_analytics'
    ]);
  end if;

  -- Membership-exclusive: not granted by the Prep Pack alone. Some of
  -- these (ask_andrew, ai_cfi_unlimited, live_ground_school) don't have
  -- real product surfaces built yet -- the capability exists so future
  -- features can check it from day one rather than needing another
  -- migration once they're built.
  if v_member or v_is_admin then
    return query select unnest(array[
      'ask_andrew', 'ai_cfi_unlimited', 'live_ground_school', 'replay_library',
      'instrument_preview', 'commercial_preview', 'community_access'
    ]);
  end if;
end;
$$;

grant execute on function public.get_member_capabilities(uuid) to authenticated;
grant execute on function public.member_has_active_membership(uuid) to authenticated;

-- Redefines refresh_mission_progress() (v50) to actually honor
-- is_premium_only, which existed as a column with no effect until now:
-- a premium-only mission is skipped entirely for a profile with no
-- active Membership, rather than silently computing progress toward
-- something they can't actually complete for a reward.
create or replace function public.refresh_mission_progress()
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;
