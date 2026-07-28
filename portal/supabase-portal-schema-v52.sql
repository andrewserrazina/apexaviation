-- Apex Advantage — Pilot Journey (v52)
--
-- Phase 4 of the habit-layer expansion. Separate from XP -- XP measures
-- portal engagement, Pilot Journey records real aviation progress.
-- Extends rather than duplicates the existing "I Passed My Checkride"
-- feature (portal_checkride_results, site/portal-stable.js's
-- showCelebration()/renderSuccessWall()) -- that flow is untouched;
-- a trigger below syncs it into this timeline automatically so a
-- student never has to log the same thing twice.
--
-- Flexible model: journey_milestone_types is a reference table, not an
-- enum or hardcoded column set, so a future certificate/rating just
-- needs a new row here, never a schema change or a new table.
--
-- Verification is protected server-side: a member can always log their
-- own milestone as 'self_reported', but cannot set 'instructor_verified'
-- or 'apex_verified' themselves, however they craft the request --
-- trg_protect_milestone_verification forces those fields back to
-- self-reported/null for any self-update, regardless of what a client
-- attempts to send.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v51.

-- ─────────────────────────────────────────────────────────────────
-- 1. Milestone type catalog
-- ─────────────────────────────────────────────────────────────────
create table public.journey_milestone_types (
  milestone_key text primary key,
  label         text not null,
  sort_order    integer not null,
  xp_value      integer not null default 25
);

alter table public.journey_milestone_types enable row level security;

create policy "Anyone can read milestone types"
  on public.journey_milestone_types for select using (true);

insert into public.journey_milestone_types (milestone_key, label, sort_order, xp_value) values
  ('joined_apex_advantage',          'Joined Apex Advantage',              10,  0),
  ('began_flight_training',          'Began Flight Training',              20,  25),
  ('first_discovery_flight',         'First Discovery Flight',             30,  25),
  ('first_logged_lesson',            'First Logged Lesson',                40,  25),
  ('first_solo',                     'First Solo',                         50,  250),
  ('first_cross_country',            'First Cross-Country',                60,  50),
  ('night_requirement_completed',    'Night Requirement Completed',        70,  50),
  ('written_exam_scheduled',         'Written Exam Scheduled',             80,  25),
  ('written_exam_passed',            'Written Exam Passed',                90,  100),
  ('checkride_scheduled',            'Checkride Scheduled',                100, 25),
  ('mock_oral_completed',            'Mock Oral Completed',                110, 25),
  ('private_pilot_checkride_passed', 'Private Pilot Checkride Passed',     120, 500),
  ('instrument_training_started',    'Instrument Training Started',        130, 25),
  ('instrument_written_passed',      'Instrument Written Passed',          140, 100),
  ('instrument_checkride_passed',    'Instrument Checkride Passed',        150, 300),
  ('commercial_training_started',    'Commercial Training Started',        160, 25),
  ('commercial_certificate_earned',  'Commercial Certificate Earned',      170, 400),
  ('cfi_training_started',           'CFI Training Started',               180, 25),
  ('cfi_certificate_earned',         'CFI Certificate Earned',             190, 400),
  ('cfii_earned',                    'CFII Earned',                        200, 300),
  ('multi_engine_rating_earned',     'Multi-Engine Rating Earned',         210, 200),
  ('first_student_soloed',           'First Student Soloed',               220, 100),
  ('first_student_passed',           'First Student Passed',               230, 150),
  ('first_aviation_job',             'First Aviation Job',                 240, 200),
  ('airline_interview',              'Airline Interview',                  250, 100),
  ('airline_class_date',             'Airline Class Date',                 260, 300)
on conflict (milestone_key) do nothing;

-- ─────────────────────────────────────────────────────────────────
-- 2. Member milestone log
-- ─────────────────────────────────────────────────────────────────
create table public.member_milestones (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  milestone_key      text not null references public.journey_milestone_types(milestone_key),
  achieved_on        date not null default current_date,
  notes              text,
  reflection         text,
  photo_url          text,
  visibility         text not null default 'private' check (visibility in ('private', 'instructor', 'public')),
  verification_status text not null default 'self_reported' check (verification_status in ('self_reported', 'instructor_verified', 'apex_verified')),
  verified_by        uuid references public.profiles(id),
  verified_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (profile_id, milestone_key)
);

create index member_milestones_profile_id_idx on public.member_milestones (profile_id);

alter table public.member_milestones enable row level security;

create policy "Members manage their own milestones"
  on public.member_milestones for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "Admins and instructors can view all milestones"
  on public.member_milestones for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'instructor')));

create policy "Admins and instructors can verify milestones"
  on public.member_milestones for update
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'instructor')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'instructor')));

-- Neutralizes any attempt to self-verify: whenever the row's OWNER is
-- the one making the change (auth.uid() = profile_id), verification
-- fields are forced back to the unverified defaults no matter what the
-- client sent. Only reached via the "Admins and instructor can verify"
-- policy above (a different profile_id acting on the row) does the
-- attempted verification_status/verified_by/verified_at actually stick.
create or replace function public.trg_protect_milestone_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.profile_id then
    new.verification_status := 'self_reported';
    new.verified_by := null;
    new.verified_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_milestone_verification on public.member_milestones;
create trigger protect_milestone_verification
  before insert or update on public.member_milestones
  for each row execute function public.trg_protect_milestone_verification();

-- ─────────────────────────────────────────────────────────────────
-- 3. Award XP once per milestone logged (idempotent via award_xp's own
-- unique constraint, keyed on milestone_key -- re-editing notes/
-- reflection on an already-logged milestone never re-awards).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.trg_award_xp_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xp integer;
begin
  select xp_value into v_xp from public.journey_milestone_types where milestone_key = new.milestone_key;
  if v_xp is not null and v_xp > 0 then
    perform public.award_xp(new.profile_id, 'milestone_logged', v_xp, 'member_milestones', new.milestone_key);
  end if;
  return new;
end;
$$;

drop trigger if exists award_xp_on_milestone on public.member_milestones;
create trigger award_xp_on_milestone
  after insert on public.member_milestones
  for each row execute function public.trg_award_xp_milestone();

-- ─────────────────────────────────────────────────────────────────
-- 4. Auto-log "Joined Apex Advantage" on signup (apex_verified -- it's
-- a system fact, not a self-report) -- mirrors handle_new_user()'s
-- existing signup-trigger pattern (portal/supabase-schema.sql).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.handle_new_profile_journey_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_milestones (profile_id, milestone_key, achieved_on, verification_status)
  values (new.id, 'joined_apex_advantage', current_date, 'apex_verified')
  on conflict (profile_id, milestone_key) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created_journey_milestone on public.profiles;
create trigger on_profile_created_journey_milestone
  after insert on public.profiles
  for each row execute function public.handle_new_profile_journey_milestone();

-- ─────────────────────────────────────────────────────────────────
-- 5. Sync the existing "I Passed My Checkride" feature
-- (portal_checkride_results) into the Journey timeline automatically.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.trg_sync_checkride_passed_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.passed then
    insert into public.member_milestones (profile_id, milestone_key, achieved_on, verification_status)
    values (new.profile_id, 'private_pilot_checkride_passed', new.exam_date, 'self_reported')
    on conflict (profile_id, milestone_key) do update
      set achieved_on = excluded.achieved_on;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_checkride_passed_milestone on public.portal_checkride_results;
create trigger sync_checkride_passed_milestone
  after insert or update on public.portal_checkride_results
  for each row execute function public.trg_sync_checkride_passed_milestone();

-- ─────────────────────────────────────────────────────────────────
-- 6. Rank fix: Apex Captain and Legend require a logged, passed
-- checkride in addition to the XP threshold (see v47's original
-- comment noting this was deferred until Pilot Journey existed).
-- Falls back to the next rank below if the XP threshold is met but the
-- checkride hasn't been logged yet.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.award_xp(
  p_profile_id uuid,
  p_event_type text,
  p_xp_amount integer,
  p_source_table text,
  p_source_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_id uuid;
  v_new_total integer;
  v_new_rank text;
begin
  insert into public.xp_ledger (profile_id, event_type, xp_amount, source_table, source_id, metadata)
  values (p_profile_id, p_event_type, p_xp_amount, p_source_table, p_source_id, p_metadata)
  on conflict (profile_id, event_type, source_id) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return false;
  end if;

  update public.profiles
  set total_xp = total_xp + p_xp_amount
  where id = p_profile_id
  returning total_xp into v_new_total;

  select rank_key into v_new_rank
  from public.pilot_ranks
  where min_xp <= v_new_total
    and (
      rank_key not in ('apex_captain', 'legend')
      or exists (
        select 1 from public.member_milestones
        where profile_id = p_profile_id and milestone_key = 'private_pilot_checkride_passed'
      )
    )
  order by min_xp desc
  limit 1;

  if v_new_rank is not null then
    update public.profiles set current_rank = v_new_rank where id = p_profile_id;
  end if;

  return true;
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 7. Post-checkride "What's next?" signal, captured once from the
-- celebration flow -- not yet used to personalize Dispatch content
-- (no Dispatch screen exists in the React sense; this just stores the
-- signal for whenever that build happens).
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists next_rating_interest text check (next_rating_interest in (
    'build_confidence', 'instrument', 'cross_country_experience', 'commercial', 'stay_current', 'not_sure'
  ));
