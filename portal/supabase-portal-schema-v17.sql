-- Apex Advantage — Scheduled Ground School Enrollments (v17)
--
-- Connects admin-managed scheduled_ground_classes to paid student
-- registrations. Run after supabase-portal-schema-v16.sql.

create table public.scheduled_ground_class_enrollments (
  id                         uuid primary key default gen_random_uuid(),
  scheduled_ground_class_id  uuid not null references public.scheduled_ground_classes(id) on delete cascade,
  profile_id                 uuid references public.profiles(id) on delete set null,
  full_name                  text not null,
  email                      text not null,
  stripe_session_id          text not null unique,
  amount_cents               integer not null default 2500,
  payment_status             text not null default 'paid' check (payment_status in ('paid', 'refunded', 'canceled')),
  attendance_status          text not null default 'registered' check (attendance_status in ('registered', 'attended', 'no_show', 'canceled')),
  registered_at              timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

alter table public.scheduled_ground_class_enrollments enable row level security;

create policy "Admins manage scheduled ground class enrollments"
  on public.scheduled_ground_class_enrollments for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Members view their own scheduled ground class enrollments"
  on public.scheduled_ground_class_enrollments for select
  using (
    auth.role() = 'authenticated'
    and (
      profile_id = auth.uid()
      or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

create unique index scheduled_ground_class_enrollments_paid_class_email_key
  on public.scheduled_ground_class_enrollments (scheduled_ground_class_id, lower(email))
  where payment_status = 'paid';

create index scheduled_ground_class_enrollments_class_idx
  on public.scheduled_ground_class_enrollments (scheduled_ground_class_id, registered_at);

create index scheduled_ground_class_enrollments_profile_idx
  on public.scheduled_ground_class_enrollments (profile_id, registered_at desc);

create or replace function public.set_scheduled_ground_class_enrollments_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_scheduled_ground_class_enrollments_updated_at
  before update on public.scheduled_ground_class_enrollments
  for each row execute function public.set_scheduled_ground_class_enrollments_updated_at();

create or replace function public.confirm_scheduled_ground_class_enrollment(
  p_scheduled_ground_class_id uuid,
  p_full_name text,
  p_email text,
  p_profile_id uuid,
  p_stripe_session_id text,
  p_amount_cents integer
)
returns public.scheduled_ground_class_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.scheduled_ground_classes%rowtype;
  v_existing public.scheduled_ground_class_enrollments%rowtype;
  v_enrollment public.scheduled_ground_class_enrollments%rowtype;
begin
  if p_scheduled_ground_class_id is null then
    raise exception 'Scheduled class id is required.';
  end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Full name is required.';
  end if;
  if nullif(trim(coalesce(p_email, '')), '') is null then
    raise exception 'Email is required.';
  end if;

  select * into v_existing
  from public.scheduled_ground_class_enrollments
  where stripe_session_id = p_stripe_session_id;
  if found then
    return v_existing;
  end if;

  select * into v_class
  from public.scheduled_ground_classes
  where id = p_scheduled_ground_class_id
  for update;

  if not found then
    raise exception 'Scheduled ground school class not found.';
  end if;
  if v_class.status <> 'published' then
    raise exception 'Scheduled ground school class is not open for registration.';
  end if;
  if v_class.class_date < current_date then
    raise exception 'Scheduled ground school class is no longer upcoming.';
  end if;

  select * into v_existing
  from public.scheduled_ground_class_enrollments
  where scheduled_ground_class_id = p_scheduled_ground_class_id
    and lower(email) = lower(p_email)
    and payment_status = 'paid';
  if found then
    return v_existing;
  end if;

  if v_class.enrolled_count >= v_class.capacity then
    raise exception 'Scheduled ground school class is full.';
  end if;

  insert into public.scheduled_ground_class_enrollments (
    scheduled_ground_class_id,
    profile_id,
    full_name,
    email,
    stripe_session_id,
    amount_cents,
    payment_status
  ) values (
    p_scheduled_ground_class_id,
    p_profile_id,
    trim(p_full_name),
    lower(trim(p_email)),
    p_stripe_session_id,
    coalesce(p_amount_cents, 2500),
    'paid'
  ) returning * into v_enrollment;

  update public.scheduled_ground_classes
  set enrolled_count = enrolled_count + 1
  where id = p_scheduled_ground_class_id;

  return v_enrollment;
end;
$$;

grant execute on function public.confirm_scheduled_ground_class_enrollment(uuid, text, text, uuid, text, integer) to service_role;
