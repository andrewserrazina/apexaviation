-- Apex Aviation Operations — Ground School class bidding (v59)
--
-- Lets instructors bid on published Ground School classes that don't yet
-- have an instructor assigned, so admins can assign based on who actually
-- wants/can teach a given class rather than manually chasing availability.
--
-- Design (confirmed with the user before building):
--   - A bid is a simple claim + an optional free-text note (no ranking).
--   - No formal monthly "round" or deadline -- any published, unassigned
--     class is biddable at any time; bidding on a class closes the
--     instant it's assigned (by either path below).
--   - When an instructor's bid is assigned, no email is sent -- their
--     other pending bids just update silently.
--   - Bidding only opens on classes with no instructor_id yet. Once
--     assigned, it's off the board entirely (matches
--     scheduled_ground_classes' existing shape -- no new "biddable"
--     flag needed, this is just "instructor_id is null").
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v58.

create table public.ground_school_class_bids (
  id                         uuid primary key default gen_random_uuid(),
  scheduled_ground_class_id  uuid not null references public.scheduled_ground_classes(id) on delete cascade,
  instructor_id              uuid not null references public.profiles(id) on delete cascade,
  note                       text,
  status                     text not null default 'pending' check (status in ('pending', 'selected', 'not_selected', 'withdrawn')),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (scheduled_ground_class_id, instructor_id)
);

create index ground_school_class_bids_instructor_idx on public.ground_school_class_bids (instructor_id);

alter table public.ground_school_class_bids enable row level security;

-- Both admins and instructors can see every bid on every class -- this is
-- an internal staffing-coordination tool for a small team, not a
-- competitive/blind-bid system, so instructors seeing who else wants a
-- given class is a feature (helps them decide whether to bid on an
-- already-popular slot), not a leak. All writes go through the
-- security-definer RPCs below, so no insert/update/delete policy is
-- needed here -- same pattern as confirm_scheduled_ground_class_enrollment
-- and enroll_in_ground_school_via_pack.
create policy "Operations staff view all ground school class bids"
  on public.ground_school_class_bids for select
  using (public.is_operations_staff(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- Places or refreshes the caller's own bid on a class. Upserts on the
-- (class, instructor) unique constraint so re-bidding after a withdrawal
-- resets status back to 'pending' with the new note, instead of erroring
-- on a duplicate-row conflict.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.submit_ground_school_class_bid(
  p_scheduled_ground_class_id uuid,
  p_note text default null
)
returns public.ground_school_class_bids
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.scheduled_ground_classes%rowtype;
  v_bid public.ground_school_class_bids%rowtype;
begin
  if auth.uid() is null or not public.is_operations_staff(auth.uid()) then
    raise exception 'Instructor access required.';
  end if;

  select * into v_class from public.scheduled_ground_classes where id = p_scheduled_ground_class_id for update;
  if not found then
    raise exception 'Class not found.';
  end if;
  if v_class.status <> 'published' then
    raise exception 'This class is not open for bidding.';
  end if;
  if v_class.instructor_id is not null then
    raise exception 'This class already has an instructor assigned.';
  end if;

  insert into public.ground_school_class_bids (scheduled_ground_class_id, instructor_id, note, status)
  values (p_scheduled_ground_class_id, auth.uid(), nullif(trim(coalesce(p_note, '')), ''), 'pending')
  on conflict (scheduled_ground_class_id, instructor_id)
  do update set note = excluded.note, status = 'pending', updated_at = now()
  returning * into v_bid;

  return v_bid;
end;
$$;

grant execute on function public.submit_ground_school_class_bid(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- Withdraws the caller's own still-pending bid. Can't withdraw a bid
-- that's already been decided (selected/not_selected) -- that's history
-- at that point, not an action to undo.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.withdraw_ground_school_class_bid(p_bid_id uuid)
returns public.ground_school_class_bids
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bid public.ground_school_class_bids%rowtype;
begin
  select * into v_bid from public.ground_school_class_bids where id = p_bid_id for update;
  if not found then
    raise exception 'Bid not found.';
  end if;
  if v_bid.instructor_id <> auth.uid() then
    raise exception 'Not your bid.';
  end if;
  if v_bid.status <> 'pending' then
    raise exception 'Only a pending bid can be withdrawn.';
  end if;

  update public.ground_school_class_bids
  set status = 'withdrawn', updated_at = now()
  where id = p_bid_id
  returning * into v_bid;

  return v_bid;
end;
$$;

grant execute on function public.withdraw_ground_school_class_bid(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- Admin-only: assigns the bidding instructor to the class. Only updates
-- scheduled_ground_classes' instructor fields -- the trigger below
-- cascades the resulting bid-status updates (selected/not_selected) for
-- every bid on that class, so this function doesn't need to touch the
-- bids table itself and stays correct regardless of whether an admin
-- assigns via a bid here or via the existing manual instructor dropdown
-- in the Class Scheduler (which never touches this table directly).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.assign_ground_school_class_bid(p_bid_id uuid)
returns public.scheduled_ground_classes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bid public.ground_school_class_bids%rowtype;
  v_instructor public.profiles%rowtype;
  v_class public.scheduled_ground_classes%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  select * into v_bid from public.ground_school_class_bids where id = p_bid_id for update;
  if not found then
    raise exception 'Bid not found.';
  end if;
  if v_bid.status <> 'pending' then
    raise exception 'This bid has already been decided.';
  end if;

  select * into v_instructor from public.profiles where id = v_bid.instructor_id;
  if not found then
    raise exception 'Instructor profile not found.';
  end if;

  update public.scheduled_ground_classes
  set instructor_id = v_instructor.id, instructor_name = v_instructor.full_name, updated_at = now()
  where id = v_bid.scheduled_ground_class_id
  returning * into v_class;

  return v_class;
end;
$$;

grant execute on function public.assign_ground_school_class_bid(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- Cascades bid status whenever a class's instructor_id is newly set --
-- regardless of whether that happened via assign_ground_school_class_bid
-- above or the Class Scheduler's existing manual instructor dropdown
-- (a plain .update({instructor_id, ...}) with no bid awareness at all).
-- Without this, a manually-assigned class would leave every bid on it
-- stuck at 'pending' forever, and an instructor's "my pending bids" list
-- would never reflect reality.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.sync_ground_school_class_bids_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.instructor_id is distinct from old.instructor_id and new.instructor_id is not null then
    update public.ground_school_class_bids
    set status = case when instructor_id = new.instructor_id then 'selected' else 'not_selected' end,
        updated_at = now()
    where scheduled_ground_class_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;

create trigger sync_ground_school_class_bids_on_assignment
  after update of instructor_id on public.scheduled_ground_classes
  for each row
  execute function public.sync_ground_school_class_bids_on_assignment();
