-- Apex Advantage Sprint 0 Phase C -- Mobile device / notification model (v116)
--
-- NOT YET APPLIED TO PRODUCTION. Source-controlled, locally tested only.

create table if not exists public.mobile_devices (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  expo_push_token text not null,
  installation_id text,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (profile_id, expo_push_token)
);
comment on table public.mobile_devices is 'Push-notification registration per learner device. No device fingerprinting beyond the Expo push token and an app-supplied installation id -- no IP, no advertising id, no hardware serial.';

create index if not exists idx_mobile_devices_profile on public.mobile_devices (profile_id) where revoked_at is null;

alter table public.mobile_devices enable row level security;

-- Self-scoped, direct-client RLS (unlike task_evidence/readiness/drills,
-- this is low-risk data a learner legitimately owns end-to-end -- there
-- is no forgeable entitlement or score here, just "this token belongs to
-- my account").
drop policy if exists "Members manage their own devices" on public.mobile_devices;
create policy "Members manage their own devices" on public.mobile_devices
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

revoke all on public.mobile_devices from anon;
grant select, insert, update on public.mobile_devices to authenticated;
grant all on public.mobile_devices to service_role;

create table if not exists public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  daily_drill_enabled boolean not null default true,
  daily_drill_time time not null default '07:00',
  checkride_countdown_enabled boolean not null default true,
  weak_area_enabled boolean not null default true,
  streak_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table public.notification_preferences is 'Deliberately has no timezone column -- profiles.timezone (already used by member_local_date()) is the single source of truth for a learner''s local time; duplicating it here would let the two drift out of sync.';

alter table public.notification_preferences enable row level security;

drop policy if exists "Members manage their own notification preferences" on public.notification_preferences;
create policy "Members manage their own notification preferences" on public.notification_preferences
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

revoke all on public.notification_preferences from anon;
grant select, insert, update on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

-- ---------------------------------------------------------------------
-- revoke_mobile_device() -- explicit self-service revoke, separate from
-- a raw UPDATE so "revoked" has one unambiguous meaning (revoked_at set,
-- never unset by the same function) regardless of what a future client
-- version sends.
-- ---------------------------------------------------------------------
create or replace function public.revoke_mobile_device(p_device_id uuid)
returns public.mobile_devices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.mobile_devices%rowtype;
begin
  update public.mobile_devices
  set revoked_at = now()
  where id = p_device_id and profile_id = auth.uid()
  returning * into v_row;
  if not found then
    raise exception 'Device not found.';
  end if;
  return v_row;
end;
$function$;

revoke execute on function public.revoke_mobile_device(uuid) from public, anon;
grant execute on function public.revoke_mobile_device(uuid) to authenticated, service_role;
