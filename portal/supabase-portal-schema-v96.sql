-- Apex Advantage — Ground School class recordings (v96)
--
-- Live Ground School classes run over a single shared Apex Aviation
-- Google Meet account. Google Workspace's plan-level cloud recording
-- saves each recording to that account's own Drive -- there's no Meet
-- API that publishes a shareable link automatically, so recording_url
-- is a plain admin-entered field, exactly like meeting_url already is.
--
-- Access model (explicit product decision, not inferred): a member with
-- private_pilot_ground_school_pack_unlocked = true gets every class's
-- recording once posted, regardless of whether they personally
-- registered for that specific session -- that's the whole point of the
-- $400 complete-course tier. A member who only bought individual $25
-- classes only gets the recording for the class(es) they actually paid
-- for. This is deliberately NOT the same set of rows
-- get_my_ground_school_enrollments() (v58) returns, since that RPC is
-- registration-based (only classes a member explicitly RSVP'd to,
-- whether paid or free-via-pack) -- a full-course member who never
-- clicked "register" on a given module's live session should still be
-- able to watch its recording later.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v95.

alter table public.scheduled_ground_classes
  add column if not exists recording_url text;

create or replace function public.get_my_ground_school_recordings()
returns table (
  id uuid,
  title text,
  module_id text,
  module_title text,
  class_date date,
  start_time time,
  end_time time,
  timezone text,
  instructor_name text,
  recording_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sgc.id, sgc.title, sgc.module_id, sgc.module_title, sgc.class_date,
    sgc.start_time, sgc.end_time, sgc.timezone, sgc.instructor_name, sgc.recording_url
  from public.scheduled_ground_classes sgc
  where sgc.course_id = 'PPL'
    and sgc.status in ('published', 'completed')
    and sgc.class_date < current_date
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.private_pilot_ground_school_pack_unlocked = true
      )
      or exists (
        select 1 from public.scheduled_ground_class_enrollments e
        where e.scheduled_ground_class_id = sgc.id
          and e.profile_id = auth.uid()
          and e.payment_status = 'paid'
      )
    )
  order by sgc.class_date desc, sgc.start_time desc;
$$;

grant execute on function public.get_my_ground_school_recordings() to authenticated;
